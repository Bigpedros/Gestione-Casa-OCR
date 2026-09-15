import type { GeometricPriceProposal } from './geometricPriceAlignment';
import type { OcrWordGeometry, ParsedReceiptDraft } from './types';

export type GeometryCalibrationLineSource =
  | 'first_pass'
  | 'geometry'
  | 'regional'
  | 'variant'
  | 'variant_corrected'
  | 'unresolved';

export interface GeometryCalibrationLineResult {
  readonly index: number;
  readonly description: string;
  readonly beforePrice: number;
  readonly afterPrice: number;
  readonly source: GeometryCalibrationLineSource;
  readonly warnings: readonly string[];
}

export interface GeometryCalibrationReport {
  readonly fileName: string;
  readonly wordCount: number;
  readonly exactMonetaryWordCount: number;
  readonly baseline: {
    readonly lineCount: number;
    readonly pricedLineCount: number;
    readonly unresolvedPriceCount: number;
    readonly lineSum: number;
    readonly total: number | null;
  };
  readonly geometry: {
    readonly proposalCount: number;
    readonly proposals: readonly {
      readonly itemIndex: number;
      readonly description: string;
      readonly proposedPrice: number;
      readonly priceText: string;
      readonly priceWordConfidence: number;
      readonly descriptionCoverage: number;
      readonly matchedDescriptionTokens: readonly string[];
      readonly priceBox: GeometricPriceProposal['priceBox'];
    }[];
  };
  readonly final: {
    readonly lineCount: number;
    readonly recoveredByGeometry: number;
    readonly recoveredByRegional: number;
    readonly recoveredByVariant: number;
    readonly correctedByVariant: number;
    readonly totalRecoveredByVariantConsensus: boolean;
    readonly unresolvedPriceCount: number;
    readonly lineSum: number;
    readonly total: number | null;
    readonly requiresManualReview: boolean;
  };
  readonly unresolvedReduction: number;
  readonly lineResults: readonly GeometryCalibrationLineResult[];
}

const EXACT_MONETARY_WORD_RE = /^[-−]?\d{1,4}[.,]\d{2}$/;

function roundedLineSum(draft: ParsedReceiptDraft): number {
  return Math.round(
    draft.lines.reduce((sum, line) => sum + (line.lineTotal > 0 ? line.lineTotal : 0), 0) * 100
  ) / 100;
}

function unresolvedPriceCount(draft: ParsedReceiptDraft): number {
  return draft.lines.filter(
    (line) => line.lineTotal <= 0 || line.warnings?.includes('PRICE_NOT_DETECTED')
  ).length;
}

function classifyLineSource(
  beforePrice: number,
  afterWarnings: readonly string[] | undefined,
  afterPrice: number
): GeometryCalibrationLineSource {
  if (afterWarnings?.includes('PRICE_RECOVERED_FROM_GEOMETRY')) return 'geometry';
  if (afterWarnings?.includes('PRICE_RECOVERED_FROM_REGIONAL_OCR')) return 'regional';
  if (afterWarnings?.includes('PRICE_RECOVERED_FROM_VARIANT_FUSION')) return 'variant';
  if (afterWarnings?.includes('PRICE_CORRECTED_FROM_VARIANT_FUSION')) return 'variant_corrected';
  if (beforePrice > 0 && afterPrice > 0) return 'first_pass';
  return 'unresolved';
}

export function buildGeometryCalibrationReport(
  fileName: string,
  baseline: ParsedReceiptDraft,
  finalDraft: ParsedReceiptDraft,
  words: readonly OcrWordGeometry[],
  proposals: readonly GeometricPriceProposal[]
): GeometryCalibrationReport {
  const baselineUnresolved = unresolvedPriceCount(baseline);
  const finalUnresolved = unresolvedPriceCount(finalDraft);

  const usedBaselineIndices = new Set<number>();
  const lineResults: GeometryCalibrationLineResult[] = finalDraft.lines.map((line, index) => {
    let baselineIndex = baseline.lines.findIndex(
      (candidate, candidateIndex) =>
        !usedBaselineIndices.has(candidateIndex) &&
        candidate.normalizedDescription.trim() === line.normalizedDescription.trim()
    );
    if (baselineIndex < 0 && index < baseline.lines.length && !usedBaselineIndices.has(index)) {
      baselineIndex = index;
    }
    if (baselineIndex >= 0) usedBaselineIndices.add(baselineIndex);

    const before = baselineIndex >= 0 ? baseline.lines[baselineIndex] : undefined;
    const beforePrice = before?.lineTotal ?? 0;
    const afterPrice = line.lineTotal ?? 0;
    return {
      index,
      description: line.normalizedDescription,
      beforePrice,
      afterPrice,
      source: classifyLineSource(beforePrice, line.warnings, afterPrice),
      warnings: [...(line.warnings ?? [])],
    };
  });

  const recoveredByGeometry = lineResults.filter((line) => line.source === 'geometry').length;
  const recoveredByRegional = lineResults.filter((line) => line.source === 'regional').length;
  const recoveredByVariant = lineResults.filter((line) => line.source === 'variant').length;
  const correctedByVariant = lineResults.filter((line) => line.source === 'variant_corrected').length;

  return {
    fileName,
    wordCount: words.length,
    exactMonetaryWordCount: words.filter((word) =>
      EXACT_MONETARY_WORD_RE.test(word.text.trim().replace(/[€\s]/g, ''))
    ).length,
    baseline: {
      lineCount: baseline.lines.length,
      pricedLineCount: baseline.lines.filter((line) => line.lineTotal > 0).length,
      unresolvedPriceCount: baselineUnresolved,
      lineSum: roundedLineSum(baseline),
      total: baseline.total.value,
    },
    geometry: {
      proposalCount: proposals.length,
      proposals: proposals.map((proposal) => ({
        itemIndex: proposal.itemIndex,
        description: baseline.lines[proposal.itemIndex]?.normalizedDescription ?? '',
        proposedPrice: proposal.proposedPrice,
        priceText: proposal.priceText,
        priceWordConfidence: proposal.priceWordConfidence,
        descriptionCoverage: proposal.descriptionCoverage,
        matchedDescriptionTokens: [...proposal.matchedDescriptionTokens],
        priceBox: proposal.priceBox,
      })),
    },
    final: {
      lineCount: finalDraft.lines.length,
      recoveredByGeometry,
      recoveredByRegional,
      recoveredByVariant,
      correctedByVariant,
      totalRecoveredByVariantConsensus: finalDraft.total.warnings?.includes('TOTAL_RECOVERED_FROM_VARIANT_CONSENSUS') ?? false,
      unresolvedPriceCount: finalUnresolved,
      lineSum: roundedLineSum(finalDraft),
      total: finalDraft.total.value,
      requiresManualReview: finalDraft.requiresManualReview ?? false,
    },
    unresolvedReduction: baselineUnresolved - finalUnresolved,
    lineResults,
  };
}
