import type { Product, ProductAlias, Supplier, EntityId, MoneyAmount } from '../../types';

export interface ProductFingerprintData {
  rawDescription: string;
  normalizedDescription: string;
  tokens: string[];
  trigrams: Set<string>;
  brand: string | null;
  barcode: string | null;
  unitOfMeasure: string | null;
  unitQuantity: number | null;
  supplierId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  historicalPrices: MoneyAmount[];
  averageUnitPrice: MoneyAmount | null;
  minUnitPrice: MoneyAmount | null;
  maxUnitPrice: MoneyAmount | null;
}

export type MatchType =
  | 'exact_barcode'
  | 'exact_alias'
  | 'fuzzy_alias'
  | 'exact_name'
  | 'fuzzy_name'
  | 'fingerprint'
  | 'none';

export type ConflictType =
  | 'ambiguous_products'
  | 'price_anomaly'
  | 'short_description'
  | 'different_suppliers';

export interface CandidateMatch {
  product: Product;
  alias?: ProductAlias | null;
  score: number;
  matchType: MatchType;
  reasons: string[];
}

export interface ProposedCategoryInfo {
  id: string;
  name: string;
  code: string;
  isDefaultUnclassified?: boolean;
}

export interface ProposedNewProductInfo {
  normalizedName: string;
  displayName: string;
  brand?: string | null;
  barcode?: string | null;
  unitOfMeasure?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  suggestedCategoryName?: string;
  reason: string;
}

export interface ClassificationMatchResult {
  lineId?: EntityId;
  originalDescription: string;
  normalizedDescription: string;
  unitPrice?: MoneyAmount;
  lineTotal?: MoneyAmount;
  matchedProduct: Product | null;
  matchedAlias: ProductAlias | null;
  confidence: number;
  matchType: MatchType;
  proposedCategory: ProposedCategoryInfo | null;
  proposedSubcategory: ProposedCategoryInfo | null;
  proposedNewProduct: ProposedNewProductInfo | null;
  candidateMatches: CandidateMatch[];
  hasConflict: boolean;
  conflictType?: ConflictType;
  conflictDetails?: string;
  warnings?: string[];
}

export interface SupplierClassificationProposal {
  detectedName: string | null;
  matchedSupplier: Supplier | null;
  confidence: number;
  proposedNewSupplier: {
    name: string;
    aliases: string[];
    status: 'new';
    suggestedCategoryCode?: string;
  } | null;
  isNewSupplier: boolean;
}

export interface ReceiptClassificationProposal {
  ocrProcessId: EntityId;
  supplierProposal: SupplierClassificationProposal;
  lineProposals: ClassificationMatchResult[];
  unclassifiedCount: number;
  knownProductCount: number;
  newProductCount: number;
  conflictCount: number;
  isProvisional: true;
}
