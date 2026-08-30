import { OCRLineReviewStatus, EntityId, MoneyAmount, DocumentCategory, PaymentMethod } from '../../types';

export interface ReceiptParserContext {
  rawText: string;
  normalizedText: string;
  lines: string[];
  normalizedLines: string[];
  overallOcrConfidence: number;
  documentType?: string;
  sourceMode?: string;
  processingMode?: string;
  ocrProcessId?: string;
  metadata?: Record<string, any>;
}

export interface ParsedField<T> {
  value: T | null;
  confidence: number;
  sourceText?: string;
  pageIndex?: number;
  lineIndex?: number;
  alternatives?: T[];
  warnings?: string[];
}

export interface ParserWarning {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  field?: string;
  details?: Record<string, any>;
}

export interface ParsedReceiptLine {
  id?: EntityId;
  originalText: string;
  normalizedDescription: string;
  quantity: number;
  unitOfMeasure?: string | null;
  unitPrice: MoneyAmount;
  lineTotal: MoneyAmount;
  discount?: MoneyAmount | null;
  isNegative?: boolean;
  pageIndex?: number;
  lineIndex?: number;
  confidence: number;
  reviewStatus: OCRLineReviewStatus;
  warnings?: string[];
}

export interface ParsedReceiptDraft {
  supplier: ParsedField<string>;
  address: ParsedField<string>;
  taxIdentifier: ParsedField<string>;
  date: ParsedField<string>; // ISO date string YYYY-MM-DD
  time: ParsedField<string>; // HH:mm or HH:mm:ss
  total: ParsedField<MoneyAmount>;
  subtotal: ParsedField<MoneyAmount>;
  vat: ParsedField<MoneyAmount>;
  discounts: ParsedField<MoneyAmount>;
  paymentMethod: ParsedField<string>;
  lines: ParsedReceiptLine[];
  warnings: ParserWarning[];
  overallConfidence: number;
  paymentEvidence?: PaymentEvidenceParseResult | null;
}

export interface ReceiptParserModule<T> {
  name: string;
  parse(context: ReceiptParserContext): ParsedField<T> | ParsedField<T>[] | ParsedReceiptLine[] | ParserWarning[];
}

/**
 * =========================================================================
 * ARCHITETTURA REGOLA CECCOTTI (CONTRATTI DI STADIO OCR IMMUTABILI)
 * =========================================================================
 */

/**
 * 1. Risultato grezzo prodotto dal motore OCR (Tesseract / Cloud OCR)
 */
export interface RawOcrResult {
  readonly rawText: string;
  readonly tesseractConfidence?: number;
  readonly variant?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Riga normalizzata che conserva il tracciamento all'indice originale della riga grezza.
 */
export interface NormalizedOcrLine {
  readonly rawIndex: number;
  readonly rawText: string;
  readonly normalizedText: string;
}

/**
 * 2. Testo normalizzato e tokenizzato con mapping di tracciabilità agli indici raw
 */
export interface NormalizedOcrText {
  readonly rawText: string;
  readonly normalizedText: string;
  readonly rawLines: readonly string[];
  readonly lines: readonly NormalizedOcrLine[];
  readonly transformations: readonly string[];
}

/**
 * Tipo di zona strutturale per lo scontrino
 */
export type ReceiptZoneType =
  | 'HEADER'
  | 'BODY'
  | 'TOTALS_FOOTER'
  | 'TRAILING_METADATA'
  | 'AMBIGUOUS';

/**
 * Singola riga classificata all'interno di una zona strutturale
 */
export interface SegmentedReceiptLine {
  readonly index: number;
  readonly rawIndex: number;
  readonly text: string;
  readonly rawText: string;
  readonly zone: ReceiptZoneType;
  readonly confidence: number;
  readonly reasons: readonly string[];
}

/**
 * 3. Insieme strutturato di zone prodotte dal ReceiptZoneSegmenter
 */
export interface ReceiptZones {
  readonly header: readonly SegmentedReceiptLine[];
  readonly body: readonly SegmentedReceiptLine[];
  readonly totalsFooter: readonly SegmentedReceiptLine[];
  readonly trailingMetadata: readonly SegmentedReceiptLine[];
  readonly ambiguous: readonly SegmentedReceiptLine[];
  readonly allLines: readonly SegmentedReceiptLine[];
}

/**
 * =========================================================================
 * ARCHITETTURA REGOLA CECCOTTI - BLOCCO 2: LINE ITEM PARSER V2
 * =========================================================================
 */

export type MonetaryTokenEvidence = 'CERTAIN' | 'PLAUSIBLE' | 'AMBIGUOUS' | 'MISSING' | 'INVALID';

export type LineItemTypeV2 = 'ARTICLE' | 'DISCOUNT' | 'ROUNDING' | 'RETURN_STORNO' | 'UNKNOWN';

export interface LineItemFieldConfidenceV2 {
  readonly description: number;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
  readonly vat: number;
  readonly overall: number;
}

export interface LineItemMonetaryEvidenceV2 {
  readonly unitPriceEvidence: MonetaryTokenEvidence;
  readonly lineTotalEvidence: MonetaryTokenEvidence;
  readonly detectedRawToken?: string | null;
  readonly candidateValue?: number | null;
}

export interface ParsedLineItemV2 {
  readonly id: string;
  readonly type: LineItemTypeV2;
  readonly rawIndices: readonly number[];
  readonly rawText: string;
  readonly normalizedText: string;
  readonly description: string;
  readonly quantity: number | null;
  readonly unitOfMeasure: string | null;
  readonly unitPrice: MoneyAmount | null;
  readonly lineTotal: MoneyAmount | null;
  readonly vatRate: number | null;
  readonly discount: MoneyAmount | null;
  readonly isNegative: boolean;
  readonly confidence: LineItemFieldConfidenceV2;
  readonly monetaryEvidence: LineItemMonetaryEvidenceV2;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly rawLines: readonly { rawIndex: number; rawText: string; normalizedText: string }[];
}

export interface LineItemParseResultV2 {
  readonly items: readonly ParsedLineItemV2[];
  readonly legacyLines: readonly ParsedReceiptLine[];
  readonly unparsedNoiseLines: readonly SegmentedReceiptLine[];
  readonly overallConfidence: number;
  readonly summary: {
    readonly articleCount: number;
    readonly discountCount: number;
    readonly unknownCount: number;
    readonly certainPriceCount: number;
    readonly uncertainPriceCount: number;
  };
}

/**
 * =========================================================================
 * ESTENSIONE PAGAMENTI - BLOCCO P2: DOCUMENT TYPE CLASSIFIER
 * =========================================================================
 */

export interface DocumentTypeEvidence {
  readonly category: DocumentCategory;
  readonly signal: string;
  readonly weight: number;
  readonly rawSnippet?: string;
  readonly lineIndex?: number;
}

export interface DocumentTypeClassificationResult {
  readonly category: DocumentCategory;
  readonly confidence: number;
  readonly evidences: readonly DocumentTypeEvidence[];
  readonly warnings: readonly string[];
  readonly categoryScores: {
    readonly commercialReceipt: number;
    readonly paymentProof: number;
    readonly invoiceOrBill: number;
  };
}

/**
 * =========================================================================
 * ESTENSIONE PAGAMENTI - BLOCCO P3: PAYMENT EVIDENCE PARSER
 * =========================================================================
 */

export type PaymentEvidenceSubtype =
  | 'POS_RECEIPT'
  | 'PAGOPA_RECEIPT'
  | 'BANK_TRANSFER_RECEIPT'
  | 'SISAL_OR_AUTHORIZED_POINT'
  | 'CRYPTO_PAYMENT'
  | 'GENERIC_PAYMENT_PROOF';

export interface PaymentEvidenceMethodHint {
  readonly macroCategoryHint?: PaymentMethod;
  readonly methodAliasHint?: string;
  readonly circuitOrBrand?: string;
  readonly maskedPan?: string;
}

export interface PaymentEvidenceCryptoDetails {
  readonly cryptoAmount?: number | null;
  readonly cryptoAsset?: string | null;
  readonly networkFee?: MoneyAmount | null;
  readonly txHash?: string | null;
}

export interface PaymentEvidenceParseResult {
  readonly subtype: PaymentEvidenceSubtype;
  readonly amount: MoneyAmount | null;
  readonly fee: MoneyAmount | null;
  readonly totalCharged: MoneyAmount | null;
  readonly dateTime: string | null;
  readonly merchantOrBeneficiary: string | null;
  readonly transactionReference: string | null;
  readonly paymentMethodHint: PaymentEvidenceMethodHint;
  readonly paymentChannelHint: string | null;
  readonly cryptoDetails?: PaymentEvidenceCryptoDetails;
  readonly confidence: number;
  readonly fieldConfidence: Record<string, number>;
  readonly evidences: readonly string[];
  readonly warnings: readonly string[];
  readonly unparsedRelevantLines: readonly string[];
}

/**
 * =========================================================================
 * ARCHITETTURA REGOLA CECCOTTI - BLOCCO P4-B1: SHADOW MODE V1 vs V2
 * =========================================================================
 */

export interface LineItemComparisonDifference {
  v1Index?: number;
  v2Index?: number;
  type:
    | 'LOST_IN_V2'
    | 'ADDED_IN_V2'
    | 'QUANTITY_MISMATCH'
    | 'PRICE_MISMATCH'
    | 'DESCRIPTION_MISMATCH'
    | 'SEMANTIC_DIFFERENCE';
  v1Line?: ParsedReceiptLine;
  v2Line?: ParsedReceiptLine;
  v2Item?: ParsedLineItemV2;
  message: string;
}

export interface ShadowV2ComparisonResult {
  executed: boolean;
  documentCategory: DocumentCategory;
  isV2Official?: boolean;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  v1Count: number;
  v2Count: number;
  matchedCount: number;
  lostInV2Count: number;
  addedInV2Count: number;
  v2NoiseCount: number;
  differences: LineItemComparisonDifference[];
  v2Summary?: LineItemParseResultV2['summary'];
  zones?: {
    headerCount: number;
    bodyCount: number;
    totalsFooterCount: number;
    trailingMetadataCount: number;
    ambiguousCount: number;
  };
}

/**
 * =========================================================================
 * ARCHITETTURA REGOLA CECCOTTI - BLOCCO P4-C1: SHADOW MODE PAYMENT EVIDENCE
 * =========================================================================
 */
export interface ShadowPaymentEvidenceResult {
  readonly executed: boolean;
  readonly documentCategory: DocumentCategory;
  readonly result: PaymentEvidenceParseResult | null;
  readonly error?: string;
}

