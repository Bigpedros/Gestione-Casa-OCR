import { DocumentCategory } from '../../types';

export type HarnessExecutionMode = 'IMAGE_E2E' | 'RAW_FIXTURE';

export type HarnessEvaluationStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'SKIPPED';

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
