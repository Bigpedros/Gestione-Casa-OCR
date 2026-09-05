/**
 * RC-05E: SECOND-PASS REGIONAL OCR — SHADOW INTERNAL TYPES
 *
 * Tipi interni transitori (IN-MEMORY ONLY) per il motore regionale.
 * Nessuna persistenza a database, nessuna estensione dello schema Dexie.
 */

export interface RelativeCropBox {
  readonly xPct: number;
  readonly yPct: number;
  readonly widthPct: number;
  readonly heightPct: number;
}

export interface PixelCropBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type RegionalTokenClassification = 'exact_monetary' | 'degraded' | 'rejected';

export interface RegionalMonetaryToken {
  readonly rawToken: string;
  readonly parsedValue: number | null;
  readonly lineIndex: number;
  readonly confidence: number;
  readonly classification: RegionalTokenClassification;
  readonly isNegative?: boolean;
  readonly reason?: string;
}

export interface RegionalBodyEvidence {
  readonly executed: boolean;
  readonly variantUsed: string;
  readonly tokens: readonly RegionalMonetaryToken[];
  readonly confidence: number;
  readonly cropBox: RelativeCropBox;
  readonly rawText?: string;
}

export interface RegionalFooterEvidence {
  readonly executed: boolean;
  readonly variantUsed: string;
  readonly totalCandidate: {
    readonly rawText: string;
    readonly parsedValue: number;
    readonly confidence: number;
  } | null;
  readonly paymentMethodCandidate: {
    readonly rawText: string;
    readonly method: string;
    readonly confidence: number;
  } | null;
  readonly cropBox: RelativeCropBox;
  readonly rawText?: string;
}

export type AlignmentTier = 'TIER_1' | 'TIER_2' | 'TIER_3';
export type AlignmentProposalStatus = 'PROPOSED' | 'AMBIGUOUS' | 'REJECTED';

export interface RegionalAlignmentProposal {
  readonly itemIndex: number;
  readonly itemDescription: string;
  readonly tokenIndex: number;
  readonly proposedPrice: number | null;
  readonly tier: AlignmentTier;
  readonly status: AlignmentProposalStatus;
  readonly reason: string;
}

export interface RegionalOcrEvidence {
  readonly executed: boolean;
  readonly triggerReason: 'missing_total' | 'low_price_density' | 'math_discrepancy' | null;
  readonly bodyEvidence?: RegionalBodyEvidence;
  readonly footerEvidence?: RegionalFooterEvidence;
  readonly proposals?: readonly RegionalAlignmentProposal[];
  readonly durationMs?: number;
}
