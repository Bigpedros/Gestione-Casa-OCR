import { OCRLineReviewStatus, EntityId, MoneyAmount } from '../../types';

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
}

export interface ReceiptParserModule<T> {
  name: string;
  parse(context: ReceiptParserContext): ParsedField<T> | ParsedField<T>[] | ParsedReceiptLine[] | ParserWarning[];
}
