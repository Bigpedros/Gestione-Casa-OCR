/**
 * =========================================================================
 * RECEIPT KNOWLEDGE BASE v1 — TYPE DEFINITIONS
 * =========================================================================
 *
 * Tipi, ruoli semantici e interfacce per la base di conoscenza deterministica
 * e versionata del motore OCR di Gestione Casa.
 */

export type ReceiptKnowledgeRole =
  | 'COMMERCIAL_DOCUMENT_HEADER'
  | 'ITEM_TABLE_HEADER'
  | 'SUBTOTAL'
  | 'FINAL_TOTAL_CANDIDATE'
  | 'VAT_TOTAL'
  | 'VAT_RATE'
  | 'VAT_METADATA'
  | 'PAYMENT'
  | 'CASH_PAYMENT'
  | 'CARD_PAYMENT'
  | 'DEBIT_CARD_PAYMENT'
  | 'CREDIT_PAYMENT'
  | 'CHANGE'
  | 'UNPAID_OR_CREDIT_STATUS'
  | 'PAYMENT_PROOF_EVIDENCE'
  | 'TRAILING_METADATA'
  | 'PAYMENT_DETAILS_HEADER'
  | 'ITEM_DISCOUNT'
  | 'DOCUMENT_DISCOUNT'
  | 'ROUNDING_ADJUSTMENT'
  | 'COMMERCIAL_CARRIER_HINT'
  | 'LOYALTY_METADATA'
  | 'MARKETING_OR_CLOSING_FOOTER'
  | 'FISCAL_HEALTH_METADATA'
  | 'DEPARTMENT_HEADER'
  | 'PRODUCT_IDENTIFIER';

export type KnowledgeSource = 'builtin' | 'learned' | 'shared';

export interface ReceiptKnowledgeEntry {
  id: string;
  canonical: string;
  aliases?: string[];
  patterns?: RegExp[];
  semanticRole: ReceiptKnowledgeRole;
  confidenceWeight?: number; // 0.0 - 1.0 (default 1.0)
  source: KnowledgeSource;
  version: string;
  notes?: string;
}

export interface KnowledgeLookupResult {
  matched: boolean;
  role: ReceiptKnowledgeRole | null;
  entry: ReceiptKnowledgeEntry | null;
  confidence: number;
  matchedTerm?: string;
}

export interface MerchantDirectoryEntry {
  id: string;
  canonicalName: string;
  legalName?: string;
  aliases: string[];
  categoryHint?: string;
  notes?: string;
}

export interface MerchantMatchResult {
  matched: boolean;
  canonicalName: string | null;
  matchedEntry: MerchantDirectoryEntry | null;
  similarity: number; // 0.0 - 1.0
  confidenceAdjustment: number; // Incremento o decremento di confidenza
  isFuzzyMatch: boolean;
  isAmbiguous?: boolean;
  secondBestSimilarity?: number;
  secondBestEntry?: MerchantDirectoryEntry | null;
  ambiguityMargin?: number;
}

export interface OcrAliasRule {
  pattern: RegExp;
  replacement: string;
  description: string;
  conservativeOnly: boolean;
}
