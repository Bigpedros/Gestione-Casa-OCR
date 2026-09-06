import { DocumentCategory } from '../../types';

export type HarnessExecutionMode = 'IMAGE_E2E' | 'RAW_FIXTURE';

export type HarnessEvaluationStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'SKIPPED';

export type ReplayValidationLevel =
  | 'L0_UNACQUIRED'
  | 'L1_REAL_RAWTEXT'
  | 'L2_RECORDED_REGIONAL';

export interface ExpectedProductItem {
  descriptionContains?: string;
  price?: number;
  quantity?: number;
  isDiscount?: boolean;
}

export interface RealReceiptGroundTruth {
  id: string;
  expectedDocumentCategory: DocumentCategory;
  expectedMerchant?: string | string[] | null;
  expectedLineCount?: number;
  expectedTotal?: number;
  expectedPaymentMethod?: string | null;
  expectedProducts?: ExpectedProductItem[];
  expectedDate?: string;
  notes?: string;

  // Shadow Replay Ground Truth Extensions (RC-05G)
  expectedTriggerReason?: 'missing_total' | 'low_price_density' | 'math_discrepancy' | null;
  expectedRegionalTotal?: number | null;
  expectedRegionalMonetaryValues?: number[];
  expectedRegionalTokenCount?: number;
  expectedAlignmentOutcome?: 'PROPOSED' | 'AMBIGUOUS' | 'NO_FILL' | 'NOT_MEASURABLE';
  validationLevel?: ReplayValidationLevel;
}

export interface RealReceiptFixture {
  id: string;
  label: string;
  imagePath?: string;
  imageDataUrl?: string;
  imagePaths?: string[];
  imageDataUrls?: string[];
  rawText?: string;
  groundTruth: RealReceiptGroundTruth;
  layoutNotes?: string;
  metadata?: {
    acquisitionDate?: string;
    rawFrozenAt?: string;
    ocrEngineVersion?: string;
    sourceVariant?: string;
    sha256?: string;
  };

  // Recorded Regional Replay (L2)
  recordedRegionalReplay?: {
    bodyRaw?: string;
    footerRaw?: string;
    provenance: string;
  };
}

export interface HarnessDocumentReport {
  documentId: string;
  label: string;
  mode: HarnessExecutionMode;
  status: HarnessEvaluationStatus;
  durationMs: number;

  // Category
  category: string;
  categoryConfidence: number;
  expectedCategory: string;
  categoryMatch: boolean;

  // Merchant
  merchantRaw: string;
  merchantCandidate: string;
  merchantConfidence: number;
  expectedMerchant?: string | string[] | null;
  merchantMatch?: boolean;

  // Line items
  expectedLineCount?: number;
  detectedLineCount: number;
  linesWithPrice: number;
  linesPriceNotDetected: number;
  lineCountMatch?: boolean;
  unfoundExpectedProducts: string[];
  suspiciousLinesCount: number;

  // Total
  detectedTotal: number | null;
  expectedTotal?: number;
  totalMatch?: boolean;
  itemsSumVsTotalDiff: number | null;

  // Payment
  detectedPaymentMethod: string | null;
  expectedPaymentMethod?: string | null;
  paymentMethodMatch?: boolean;

  // Diagnostics & Noise
  warnings: string[];
  unparsedNoiseCount: number;
  notes?: string;
  failureReasons: string[];
  partialReasons: string[];
}

export interface HarnessBatchSummary {
  totalDocuments: number;
  passCount: number;
  partialCount: number;
  failCount: number;
  skippedCount: number;

  categoryAccuracyPct: number;
  merchantAccuracyPct: number;
  totalAccuracyPct: number;
  lineCountAccuracyPct: number;
  paymentMethodAccuracyPct: number;

  totalDurationMs: number;
}

export interface ShadowReplayDocumentReport {
  fixtureId: string;
  merchant: string;
  validationLevel: ReplayValidationLevel;
  acquisitionStatus: 'ACQUIRED_REAL_RAWTEXT' | 'SKIPPED_NO_RAWTEXT';
  fullPageAvailable: boolean;
  recordedRegionalAvailable: boolean;

  // First Pass Official Draft
  officialCategory: string;
  officialTotal: number | null;

  // Trigger Policy Evaluation
  expectedTriggerReason: 'missing_total' | 'low_price_density' | 'math_discrepancy' | null | 'NOT_AVAILABLE';
  actualTriggerReason: 'missing_total' | 'low_price_density' | 'math_discrepancy' | null;
  triggerMatch: boolean | 'NOT_AVAILABLE';
  requestedRegions: readonly ('body' | 'footer')[];

  // Regional Replay (L2 only)
  regionalReplayStatus: 'EXECUTED_L2' | 'UNAVAILABLE' | 'SKIPPED_NO_TRIGGER';
  regionalTotalCandidate: number | null;
  expectedTotal?: number | null;
  totalCandidateMatch?: boolean | 'NOT_AVAILABLE';

  monetaryTokenCount: number;
  expectedMonetaryTokenCount?: number;
  priceTokensExtracted: number[];

  alignmentOutcome: 'PROPOSED' | 'AMBIGUOUS' | 'NO_FILL' | 'NOT_MEASURABLE';
  falsePositiveAssessment: 'NO_FALSE_POSITIVE' | 'FALSE_POSITIVE' | 'NOT_MEASURABLE';
  notes?: string;
}

export interface ShadowReplayBatchSummary {
  totalCorpus: number;
  rawTextAcquiredCount: number;
  recordedRegionalCount: number;
  unacquiredCount: number;

  triggerEvaluatedCount: number;
  triggerMatchCount: number;

  totalRecoveryEvaluatedCount: number;
  totalRecoverySuccessCount: number;

  falsePositiveRate: 'NOT_MEASURABLE';
  correctSkipRate: 'NOT_MEASURABLE_ON_REAL_CORPUS';
  priceProposalAccuracy: 'NOT_MEASURABLE';
}

