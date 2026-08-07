import type { ContactRequestDocument } from '@gestione-casa/shared-sdk/contact-requests';

export type EntityId = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // ISO 8601
export type YearMonth = string; // YYYY-MM
export type MoneyAmount = number;

export type UserMode = 'single' | 'family';
export type Currency = 'EUR';
export type Language = 'it-IT';
export type BudgetMode = 'prudential';
export type ExpenseClassification = 'necessary' | 'voluntary' | 'toEvaluate';
export type ExpenseStatus = 'draft' | 'planned' | 'paid' | 'cancelled';
export type IncomeStatus = 'planned' | 'received' | 'skipped' | 'cancelled';
export type FixedExpenseStatus = 'active' | 'suspended' | 'terminated';
export type SavingStatus = 'active' | 'completed' | 'suspended' | 'cancelled';
export type ProjectStatus = 'active' | 'completed' | 'cancelled';
export type ReportStatus = 'provisional' | 'final';
export type ExtraBudgetStatus = 'accumulated' | 'used' | 'exhausted';
export type SupplierStatus = 'new' | 'confirmed' | 'merged';
export type Frequency = 'once' | 'weekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'fourMonthly' | 'semiannual' | 'annual';
export type PaymentMethod = 'cash' | 'debitCard' | 'creditCard' | 'bankTransfer' | 'directDebit' | 'digitalWallet' | 'other';
export type Priority = 'high' | 'medium' | 'low' | 'none';

export interface RecordMetadata {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | null;
  version: number;
  deviceId?: string | null;
  syncStatus?: 'local' | 'pending' | 'synced' | 'conflict';
}

export interface HomeAddress {
  address: string;
  streetNumber: string;
  postalCode: string;
}

export interface AppSettings {
  id: EntityId;
  userMode: UserMode;
  contributorsCount: number;
  currency: Currency;
  language: Language;
  budgetMode: BudgetMode;
  monthlyBudgetSource: 'manualContributorIncome';
  includePaidExpensesInBudget: boolean;
  includeNotifiedPlannedExpensesInBudget: boolean;
  includeSavingPlansInBudget: boolean;
  includeProjectQuotasInBudget: boolean;
  extraBudgetUsage: 'coverDeficitOnly';
  reportClosingMode: 'automaticEndOfMonth';
  reportClosingTime: string;
  attachmentRetentionMonths: number;
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  notificationAdvanceDays: number;
  homeAddress?: HomeAddress;
  metadata: RecordMetadata;
}

export type ContributorType = 'Stipendio' | 'Pensione' | 'Rendita' | 'Rimborso' | 'Altro';

export interface Contributor {
  id: EntityId;
  order: number;
  name: string;
  label?: ContributorType | string;
  active: boolean;
  colorToken?: string | null;
  email?: string;
  receiveDeadlineEmails?: boolean;
  receive48HourReminder?: boolean;
  receive24HourReminder?: boolean;
  emailDeliveryStatus?: string;
  metadata: RecordMetadata;
}

export interface AppNotification {
  id: EntityId;
  type: 'deadline_48h' | 'deadline_24h' | 'general' | string;
  title: string;
  message: string;
  createdAt: ISODateTime;
  scheduledFor: ISODateTime;
  dueAt: ISODate;
  read: boolean;
  internalStatus: 'unread' | 'read';
  emailStatus: 'pending' | 'sent' | 'failed' | 'provider_not_configured';
  relatedEntityType: 'expense' | 'fixedExpense' | 'bill' | string;
  relatedEntityId: EntityId;
  reminderOffsetHours: 48 | 24 | number;
  uniqueKey: string;
  amount?: MoneyAmount;
  supplierName?: string;
  recipientContributorIds?: EntityId[];
  recipientEmails?: string[];
  sentAt?: ISODateTime;
  lastError?: string;
}

export type IncomeEntryType =
  | 'salary'
  | 'pension'
  | 'income'
  | 'refund'
  | 'extraordinary_contribution'
  | 'other'
  | string;

export interface IncomeEntry {
  id: EntityId;
  contributorId: EntityId;
  type: IncomeEntryType;
  description?: string;
  amount: MoneyAmount;
  incomeDate: ISODate;
  competenceMonth: number; // 1-12
  competenceYear: number;
  frequency: Frequency;
  recurring: boolean;
  expectedDay?: number | null;
  status: IncomeStatus;
  notes?: string;
  metadata: RecordMetadata;
}

export interface Expense {
  id: EntityId;
  entryMode: 'manual' | 'receipt' | 'fixedExpense' | 'projectPurchase';
  supplierId?: EntityId | null;
  projectId?: EntityId | null;
  fixedExpenseId?: EntityId | null;
  fixedExpenseOccurrenceId?: EntityId | null;
  description: string;
  amount: MoneyAmount;
  expenseDate: ISODate;
  paymentDate?: ISODate | null;
  competenceMonth: number;
  competenceYear: number;
  categoryId: EntityId;
  subcategoryId: EntityId;
  paymentMethod: PaymentMethod;
  status: ExpenseStatus;
  classification: ExpenseClassification;
  notified: boolean;
  recurring?: boolean;
  frequency?: Frequency | null;
  priority?: Priority;
  notes?: string;
  metadata: RecordMetadata;
}

export interface ExpenseItem {
  id: EntityId;
  expenseId: EntityId;
  description: string;
  quantity: number;
  unitPrice: MoneyAmount;
  total: MoneyAmount;
  categoryId: EntityId;
  subcategoryId: EntityId;
  classification: ExpenseClassification;
  classificationSource: 'manual' | 'automatic' | 'userCorrected';
  productId?: EntityId | null;
  unitOfMeasure?: string | null;
  ocrReceiptLineId?: EntityId | null;
  notes?: string;
  metadata: RecordMetadata;
}

export interface Category {
  id: EntityId;
  parentId?: EntityId | null;
  name: string;
  code: string;
  type: 'income' | 'expense';
  level: 1 | 2;
  enabled: boolean;
  system: boolean;
  sortOrder: number;
  icon?: string | null;
  metadata: RecordMetadata;
}

export interface Supplier {
  id: EntityId;
  name: string;
  aliases: string[];
  defaultCategoryId?: EntityId | null;
  defaultSubcategoryId?: EntityId | null;
  taxCodeOrVatNumber?: string | null;
  address?: string | null;
  status: SupplierStatus;
  mergedIntoSupplierId?: EntityId | null;
  notes?: string;
  metadata: RecordMetadata;
}

export interface FixedExpense {
  id: EntityId;
  name: string;
  supplierId?: EntityId | null;
  categoryId: EntityId;
  subcategoryId: EntityId;
  expectedAmount: MoneyAmount;
  frequency: Frequency;
  dueDay: number;
  dueMonth?: number | null;
  startDate: ISODate;
  endDate?: ISODate | null;
  durationMonths?: number | null;
  startMonth?: number | null;
  startYear?: number | null;
  endMonth?: number | null;
  endYear?: number | null;
  priority: Priority;
  paymentMethod: PaymentMethod;
  status: FixedExpenseStatus;
  generateAutomatically: boolean;
  monthlyProvisioningEnabled: boolean;
  notes?: string;
  metadata: RecordMetadata;
}

export interface FixedExpenseOccurrence {
  id: EntityId;
  fixedExpenseId: EntityId;
  expenseId?: EntityId | null;
  competenceMonth: number;
  competenceYear: number;
  expectedAmount: MoneyAmount;
  actualAmount?: MoneyAmount | null;
  dueDate: ISODate;
  paymentDate?: ISODate | null;
  status: 'planned' | 'paid' | 'overdue' | 'skipped' | 'cancelled';
  notified: boolean;
  metadata: RecordMetadata;
}

export interface SavingPlan {
  id: EntityId;
  fixedExpenseId?: EntityId | null;
  projectId?: EntityId | null;
  name: string;
  targetAmount: MoneyAmount;
  currentAmount: MoneyAmount;
  monthlyQuota: MoneyAmount;
  startDate: ISODate;
  targetDate: ISODate;
  status: SavingStatus;
  calculationMode: 'remainingAmountDividedByRemainingMonths';
  metadata: RecordMetadata;
}

export interface SavingMovement {
  id: EntityId;
  savingPlanId: EntityId;
  movementDate: ISODate;
  amount: MoneyAmount;
  type: 'deposit' | 'withdrawal' | 'adjustment';
  notes?: string;
  metadata: RecordMetadata;
}

export interface Project {
  id: EntityId;
  slot: number; // 1, 2, 3
  name: string;
  description?: string;
  targetAmount: MoneyAmount;
  savedAmount: MoneyAmount;
  monthlyQuota: MoneyAmount;
  startDate: ISODate;
  targetDate: ISODate;
  remainingMonths: number;
  progressPercentage: number;
  status: ProjectStatus;
  purchaseExpenseId?: EntityId | null;
  metadata: RecordMetadata;
}

export interface ProjectMovement {
  id: EntityId;
  projectId: EntityId;
  movementDate: ISODate;
  amount: MoneyAmount;
  type: 'deposit' | 'withdrawal' | 'purchase' | 'adjustment';
  notes?: string;
  metadata: RecordMetadata;
}

export interface Attachment {
  id: EntityId;
  entityType: 'expense' | 'fixedExpense' | 'project' | 'report' | 'unlinked' | string;
  entityId: EntityId;
  fileName: string;
  description?: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | string;
  sizeBytes: number;
  storageKey: string;
  fileHash: string;
  status: 'active' | 'logicallyDeleted' | 'permanentlyDeleted';
  createdAt: ISODateTime;
  deletedAt?: ISODateTime | null;
  deleteAfter?: ISODateTime | null;
  metadata: RecordMetadata;
}

export interface OCRProcess {
  id: EntityId;
  attachmentId: EntityId;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  rawText?: string;
  detectedSupplier?: string | null;
  detectedDate?: ISODate | null;
  detectedTotal?: MoneyAmount | null;
  confidence?: number | null;
  confirmationRequired: boolean;
  confirmedByUser: boolean;
  processedAt?: ISODateTime | null;
  errorMessage?: string | null;
  expenseId?: EntityId | null;
  metadata: RecordMetadata;
}

export type OCRProgressStatus =
  | 'pending'
  | 'loading_model'
  | 'processing_page'
  | 'concatenating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OCRProgress {
  sessionId: string;
  ocrProcessId?: string;
  status: OCRProgressStatus;
  currentPage: number;
  totalPages: number;
  progressPercentage: number;
  statusText?: string;
}

export type OCRLineReviewStatus = 'pending' | 'confirmed' | 'rejected' | 'modified';

export interface OCRReceiptLine {
  id: EntityId;
  ocrProcessId: EntityId;
  originalText: string;
  description: string;
  quantity: number;
  unitPrice: MoneyAmount;
  lineTotal: MoneyAmount;
  confidence: number;
  reviewStatus: OCRLineReviewStatus;
  productId?: EntityId | null;
  metadata: RecordMetadata;
}

export interface Product {
  id: EntityId;
  normalizedName: string;
  displayName: string;
  brand?: string | null;
  barcode?: string | null;
  unitOfMeasure?: string | null;
  categoryId?: EntityId | null;
  subcategoryId?: EntityId | null;
  metadata: RecordMetadata;
}

export interface ProductAlias {
  id: EntityId;
  productId: EntityId;
  supplierId?: EntityId | null;
  originalText: string;
  normalizedText: string;
  confidence: number;
  confirmedByUser: boolean;
  metadata: RecordMetadata;
}

export interface MonthlyReport {
  id: EntityId;
  month: number;
  year: number;
  status: ReportStatus;
  totalIncome: MoneyAmount;
  paidExpenses: MoneyAmount;
  plannedNotifiedExpenses: MoneyAmount;
  savingPlanTotal: MoneyAmount;
  projectQuotaTotal: MoneyAmount;
  prudentialBalance: MoneyAmount;
  extraBudgetOpening: MoneyAmount;
  extraBudgetUsed: MoneyAmount;
  extraBudgetClosing: MoneyAmount;
  uncoveredDeficit: MoneyAmount;
  contributorSummaries: Array<{
    contributorId: EntityId;
    amount: MoneyAmount;
    percentage: number;
  }>;
  categorySummaries: Array<{
    categoryId: EntityId;
    subcategoryId?: EntityId | null;
    amount: MoneyAmount;
    percentage: number;
    movementCount: number;
  }>;
  classificationSummaries: {
    necessary: MoneyAmount;
    voluntary: MoneyAmount;
    toEvaluate: MoneyAmount;
  };
  projectSummaries: Array<{
    projectId: EntityId;
    targetAmount: MoneyAmount;
    savedAmount: MoneyAmount;
    monthlyQuota: MoneyAmount;
    progressPercentage: number;
    status: ProjectStatus;
  }>;
  generatedAt: ISODateTime;
  closedAt?: ISODateTime | null;
  pdfAttachmentId?: EntityId | null;
  metadata: RecordMetadata;
}

export interface ExtraBudgetMovement {
  id: EntityId;
  movementDate: ISODate;
  month: number;
  year: number;
  type: 'monthlySurplusDeposit' | 'deficitCoverage' | 'adjustment';
  amount: MoneyAmount;
  balanceAfter: MoneyAmount;
  reportId?: EntityId | null;
  notes?: string;
  metadata: RecordMetadata;
}

export interface AuditLogEntry {
  id: EntityId;
  entityType: string;
  entityId: EntityId;
  action: 'create' | 'update' | 'logicalDelete' | 'restore' | 'permanentDelete' | 'close' | 'reopenByCorrection';
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  timestamp: ISODateTime;
}

export interface MonthlySavingsGoal {
  id: EntityId;
  year: number;
  month: number;
  targetAmount: MoneyAmount;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type DocumentType = 'receipt' | 'invoice' | 'generic';
export type DocumentSourceMode = 'singleImage' | 'overlappingImages' | 'multiplePages' | 'pdf';
export type DocumentProcessingMode =
  | 'singleReceipt'
  | 'longReceipt'
  | 'multiPageDocument'
  | 'invoice'
  | 'genericDocument'
  | 'structuredElectronicInvoice';
export type DocumentSessionStatus =
  | 'draft'
  | 'ready'
  | 'processing'
  | 'completed'
  | 'ready_for_review'
  | 'reviewed'
  | 'failed'
  | 'cancelled';

export interface DocumentSession {
  id: EntityId;
  documentType: DocumentType;
  sourceMode: DocumentSourceMode;
  processingMode: DocumentProcessingMode;
  status: DocumentSessionStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  pageCount: number;
  ocrProcessId?: EntityId | null;
  expenseId?: EntityId | null;
  metadata?: Record<string, unknown>;
}

export type SegmentMode = 'page' | 'overlappingSegment';
export type SegmentProcessingStatus = 'pending' | 'processed' | 'failed';

export interface DocumentPageSegment {
  id: EntityId;
  sessionId: EntityId;
  sequenceIndex: number;
  attachmentId: EntityId;
  originalFileName: string;
  originalMimeType: string;
  processedMimeType?: string;
  width?: number;
  height?: number;
  rotationDegrees: number;
  segmentMode: SegmentMode;
  overlapWithPrevious?: number | boolean;
  fileHash: string;
  processingStatus: SegmentProcessingStatus;
  qualityScore?: number;
  metadata?: Record<string, unknown>;
}

export interface BackupData {
  appName: string;
  version: string;
  schemaVersion: string;
  databaseName: string;
  exportedAt: ISODateTime;
  checksum: string;
  tables: {
    settings: AppSettings[];
    contributors: Contributor[];
    incomeEntries: IncomeEntry[];
    expenses: Expense[];
    expenseItems: ExpenseItem[];
    categories: Category[];
    suppliers: Supplier[];
    fixedExpenses: FixedExpense[];
    fixedExpenseOccurrences: FixedExpenseOccurrence[];
    savingPlans: SavingPlan[];
    savingMovements: SavingMovement[];
    projects: Project[];
    projectMovements: ProjectMovement[];
    attachments: Attachment[];
    ocrProcesses: OCRProcess[];
    monthlyReports: MonthlyReport[];
    extraBudgetMovements: ExtraBudgetMovement[];
    auditLogs: AuditLogEntry[];
    ocrReceiptLines?: OCRReceiptLine[];
    products?: Product[];
    productAliases?: ProductAlias[];
    documentSessions?: DocumentSession[];
    documentPageSegments?: DocumentPageSegment[];
    contactRequests?: ContactRequestDocument[];
  };
}

