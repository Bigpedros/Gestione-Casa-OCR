/**
 * RC-05F: SECOND-PASS REGIONAL OCR — SHADOW ORCHESTRATOR
 *
 * Orchestratore puro in-memory per coordinare il secondo passaggio
 * regionale in modalità shadow non-invasiva.
 *
 * - Zero modifiche ai dati ufficiali
 * - Zero mutazioni a database / Dexie
 * - Isolamento totale degli errori (failure-safe)
 * - Riutilizzo sequenziale del Worker Tesseract esistente
 */

import type { Worker } from 'tesseract.js';
import {
  RegionalOcrEvidence,
  RegionalTriggerReason,
  RegionalBodyEvidence,
  RegionalFooterEvidence,
  RegionalAlignmentProposal,
} from './types';
import { resolveRelativeCropBox, SHADOW_REFERENCE_POLICY } from './geometry';
import { extractRegionalMonetaryTokens } from './monetaryTokenParser';
import { generateShadowAlignmentProposals } from './shadowAlignment';
import { shouldRunRegionalSecondPass } from './triggerPolicy';
import {
  executeRegionalCropRecognition,
  WorkerParameterConfig,
  PRODUCTION_TESSERACT_PARAMETERS,
} from './regionalWorkerHelper';
import { receiptParserService } from '../receiptParserService';
import { TextNormalizationModule } from '../modules/TextNormalizationModule';
import { ReceiptZoneSegmenter } from '../modules/ReceiptZoneSegmenter';
import { LineItemParserV2 } from '../modules/LineItemParserV2';

export type RegionalSkipReason =
  | 'shadow_mode_disabled'
  | 'multi_source_document_skipped'
  | 'ineligible_document_category'
  | 'trigger_not_activated'
  | 'image_source_unavailable';

export interface RegionalDiagnosticLog {
  shadowEnabled: boolean;
  documentCategory: string;
  triggerActivated: boolean;
  triggerReason: RegionalTriggerReason;
  skipReason?: RegionalSkipReason;
  regionsAttempted: readonly ('body' | 'footer')[];
  pricesExtractedCount: number;
  mergeSuccessCount: number;
  totalRecovered: number | null;
  durationMs: number;
  failureReason?: string;
}

export interface RunRegionalShadowOptions {
  worker: Pick<Worker, 'setParameters' | 'recognize'> | null;
  imageSource: string | null;
  combinedRawText: string;
  overallConfidence: number;
  shadowEnabled?: boolean;
  imageDimensions?: { width: number; height: number };
  variantUsed?: string;
  sourceCount?: number;
  restoreParameters?: WorkerParameterConfig;
}

export interface RunRegionalShadowResult {
  evidence: RegionalOcrEvidence | null;
  diagnostic: RegionalDiagnosticLog;
}

/**
 * Risolve il triggerReason formale RC-05E a partire dalle regioni e dalla policy.
 */
export function resolveRegionalTriggerReason(
  targetRegions: readonly ('body' | 'footer')[],
  policyReason?: string
): RegionalTriggerReason {
  if (policyReason === 'math_discrepancy') {
    return 'math_discrepancy';
  }
  if (targetRegions.includes('footer') && !targetRegions.includes('body')) {
    return 'missing_total';
  }
  if (targetRegions.includes('body') && !targetRegions.includes('footer')) {
    return 'low_price_density';
  }
  if (targetRegions.includes('body') && targetRegions.includes('footer')) {
    return 'missing_total';
  }
  return null;
}

/**
 * Ottiene le dimensioni dell'immagine in pixel in modo resiliente e safe.
 */
export async function getImageDimensions(
  imageSource: string
): Promise<{ width: number; height: number }> {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof Image === 'undefined'
  ) {
    return { width: 1000, height: 2000 };
  }

  return new Promise<{ width: number; height: number }>((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ width: 1000, height: 2000 });
        }
      }, 500);

      img.onload = () => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve({
            width: img.naturalWidth || img.width || 1000,
            height: img.naturalHeight || img.height || 2000,
          });
        }
      };

      img.onerror = () => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve({ width: 1000, height: 2000 });
        }
      };

      img.src = imageSource;
    } catch {
      resolve({ width: 1000, height: 2000 });
    }
  });
}

/**
 * Formatta il log diagnostico deterministico con prefisso [OCRService:SecondPass]
 */
export function formatRegionalDiagnosticLog(diag: RegionalDiagnosticLog): string {
  const parts = [
    `[OCRService:SecondPass]`,
    `shadowEnabled=${diag.shadowEnabled}`,
    `documentCategory=${diag.documentCategory}`,
    `triggerActivated=${diag.triggerActivated}`,
    `triggerReason=${diag.triggerReason !== null ? diag.triggerReason : 'null'}`,
  ];
  if (diag.skipReason) {
    parts.push(`skipReason=${diag.skipReason}`);
  }
  parts.push(
    `regionsAttempted=${JSON.stringify(diag.regionsAttempted)}`,
    `pricesExtractedCount=${diag.pricesExtractedCount}`,
    `mergeSuccessCount=${diag.mergeSuccessCount}`,
    `totalRecovered=${diag.totalRecovered !== null ? diag.totalRecovered : 'null'}`,
    `durationMs=${diag.durationMs}`
  );
  if (diag.failureReason) {
    parts.push(`failureReason=${diag.failureReason}`);
  }
  return parts.join(' ');
}

/**
 * Esegue il flusso shadow del Second-Pass Regional OCR con isolamento totale.
 */
export async function runRegionalSecondPassShadow(
  options: RunRegionalShadowOptions
): Promise<RunRegionalShadowResult> {
  const {
    worker,
    imageSource,
    combinedRawText,
    overallConfidence,
    shadowEnabled = true,
    imageDimensions,
    variantUsed = 'default',
    sourceCount,
    restoreParameters,
  } = options;

  const startTime = Date.now();

  // 1. Verifica Kill Switch
  if (!shadowEnabled) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: false,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'shadow_mode_disabled',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: 0,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 1.5. Verifica coerenza mono-sorgente (Multi-Source Safety RC-05F-R1)
  if ((sourceCount ?? 1) > 1) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'multi_source_document_skipped',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 1.6. Verifica presenza sorgente immagine (prerequisito nominale)
  if (!imageSource) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'image_source_unavailable',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 2. Esecuzione First-Pass Parsing (in-memory puro)
  let firstParseDraft;
  try {
    firstParseDraft = receiptParserService.parseText(combinedRawText, {
      overallOcrConfidence: overallConfidence,
    });
  } catch (parseErr) {
    const failureReason = parseErr instanceof Error ? parseErr.message : String(parseErr);
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
      failureReason,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  const documentCategory = firstParseDraft.documentCategory;

  // 3. Verifica eleggibilità documento (solo COMMERCIAL_RECEIPT)
  if (documentCategory !== 'COMMERCIAL_RECEIPT') {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'ineligible_document_category',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 4. Valutazione trigger decision deterministica
  const trigger = shouldRunRegionalSecondPass(firstParseDraft);
  if (!trigger.shouldRun) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'trigger_not_activated',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  const resolvedTriggerReason = resolveRegionalTriggerReason(trigger.targetRegions, trigger.reason);

  // 5. Verifica disponibilità worker
  if (!worker) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: true,
      triggerReason: resolvedTriggerReason,
      regionsAttempted: trigger.targetRegions,
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
      failureReason: 'worker_not_available',
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 6. Esecuzione mirata dei crop regionali con isolamento errori
  try {
    const dims = imageDimensions || (await getImageDimensions(imageSource));
    const imageWidth = dims.width;
    const imageHeight = dims.height;

    let bodyEvidence: RegionalBodyEvidence | undefined;
    let footerEvidence: RegionalFooterEvidence | undefined;
    let proposals: readonly RegionalAlignmentProposal[] | undefined;
    let pricesExtractedCount = 0;
    let mergeSuccessCount = 0;
    let totalRecovered: number | null = null;

    // A. FOOTER CROP (se richiesto dal trigger)
    if (trigger.targetRegions.includes('footer')) {
      const footerPixelBox = resolveRelativeCropBox(
        imageWidth,
        imageHeight,
        SHADOW_REFERENCE_POLICY.footerBox
      );

      const footerOcrRes = await executeRegionalCropRecognition(
        worker,
        imageSource,
        footerPixelBox,
        restoreParameters ?? PRODUCTION_TESSERACT_PARAMETERS
      );

      const footerTokens = extractRegionalMonetaryTokens(footerOcrRes.text);
      const exactFooterTokens = footerTokens.filter((t) => t.classification === 'exact_monetary');
      const totalCandidateToken =
        exactFooterTokens.length > 0 ? exactFooterTokens[exactFooterTokens.length - 1] : null;

      if (totalCandidateToken && totalCandidateToken.parsedValue !== null) {
        totalRecovered = totalCandidateToken.parsedValue;
        pricesExtractedCount += 1;
      }

      // Riconoscimento payment method nel footer se presente
      let paymentCandidate: { rawText: string; method: string; confidence: number } | null = null;
      const paymentMatch = footerOcrRes.text.match(
        /\b(CARTA|BANCOMAT|CONTANTI|MASTERCARD|VISA|PAGOBANCOMAT)\b/i
      );
      if (paymentMatch) {
        paymentCandidate = {
          rawText: paymentMatch[0],
          method: paymentMatch[0].toLowerCase(),
          confidence: Math.round(footerOcrRes.confidence || 75),
        };
      }

      footerEvidence = {
        executed: true,
        variantUsed,
        totalCandidate:
          totalCandidateToken && totalCandidateToken.parsedValue !== null
            ? {
                rawText: totalCandidateToken.rawToken,
                parsedValue: totalCandidateToken.parsedValue,
                confidence: totalCandidateToken.confidence,
              }
            : null,
        paymentMethodCandidate: paymentCandidate,
        cropBox: SHADOW_REFERENCE_POLICY.footerBox,
        rawText: footerOcrRes.text,
      };
    }

    // B. BODY CROP (se richiesto dal trigger)
    if (trigger.targetRegions.includes('body')) {
      const bodyPixelBox = resolveRelativeCropBox(
        imageWidth,
        imageHeight,
        SHADOW_REFERENCE_POLICY.bodyBox
      );

      const bodyOcrRes = await executeRegionalCropRecognition(
        worker,
        imageSource,
        bodyPixelBox,
        restoreParameters ?? PRODUCTION_TESSERACT_PARAMETERS
      );

      const bodyTokens = extractRegionalMonetaryTokens(bodyOcrRes.text, {
        knownTotalValue: totalRecovered ?? firstParseDraft.total.value ?? undefined,
      });

      const exactBodyTokens = bodyTokens.filter(
        (t) => t.classification === 'exact_monetary' && t.reason !== 'matches_known_total'
      );
      pricesExtractedCount += exactBodyTokens.length;

      // Segmentazione body V2 per generare le proposte shadow di allineamento
      const structuredNorm = TextNormalizationModule.normalizeToStructuredOcrText(combinedRawText);
      const zones = ReceiptZoneSegmenter.segment(structuredNorm);
      const v2Result = LineItemParserV2.parseBody(zones.body);

      const alignmentProposals = generateShadowAlignmentProposals(v2Result.items, bodyTokens);
      proposals = alignmentProposals;
      mergeSuccessCount = alignmentProposals.filter((p) => p.status === 'PROPOSED').length;

      bodyEvidence = {
        executed: true,
        variantUsed,
        tokens: bodyTokens,
        confidence: bodyOcrRes.confidence,
        cropBox: SHADOW_REFERENCE_POLICY.bodyBox,
        rawText: bodyOcrRes.text,
      };
    }

    const evidence: RegionalOcrEvidence = {
      executed: true,
      triggerReason: resolvedTriggerReason,
      bodyEvidence,
      footerEvidence,
      proposals,
      durationMs: Date.now() - startTime,
    };

    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: true,
      triggerReason: resolvedTriggerReason,
      regionsAttempted: trigger.targetRegions,
      pricesExtractedCount,
      mergeSuccessCount,
      totalRecovered,
      durationMs: Date.now() - startTime,
    };

    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence, diagnostic };
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: true,
      triggerReason: resolvedTriggerReason,
      regionsAttempted: trigger.targetRegions,
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
      failureReason,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }
}
