import Dexie, { type EntityTable } from 'dexie';
import type {
  AppSettings,
  Contributor,
  IncomeEntry,
  Expense,
  ExpenseItem,
  Category,
  Supplier,
  FixedExpense,
  FixedExpenseOccurrence,
  SavingPlan,
  SavingMovement,
  Project,
  ProjectMovement,
  Attachment,
  OCRProcess,
  MonthlyReport,
  ExtraBudgetMovement,
  AuditLogEntry,
  AppNotification,
  MonthlySavingsGoal,
  OCRReceiptLine,
  Product,
  ProductAlias,
  DocumentSession,
  DocumentPageSegment,
} from '../types';

export class GestioneCasaDatabase extends Dexie {
  settings!: EntityTable<AppSettings, 'id'>;
  contributors!: EntityTable<Contributor, 'id'>;
  incomeEntries!: EntityTable<IncomeEntry, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;
  expenseItems!: EntityTable<ExpenseItem, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  suppliers!: EntityTable<Supplier, 'id'>;
  fixedExpenses!: EntityTable<FixedExpense, 'id'>;
  fixedExpenseOccurrences!: EntityTable<FixedExpenseOccurrence, 'id'>;
  savingPlans!: EntityTable<SavingPlan, 'id'>;
  savingMovements!: EntityTable<SavingMovement, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  projectMovements!: EntityTable<ProjectMovement, 'id'>;
  attachments!: EntityTable<Attachment, 'id'>;
  ocrProcesses!: EntityTable<OCRProcess, 'id'>;
  monthlyReports!: EntityTable<MonthlyReport, 'id'>;
  extraBudgetMovements!: EntityTable<ExtraBudgetMovement, 'id'>;
  auditLogs!: EntityTable<AuditLogEntry, 'id'>;
  notifications!: EntityTable<AppNotification, 'id'>;
  monthlySavingsGoals!: EntityTable<MonthlySavingsGoal, 'id'>;
  ocrReceiptLines!: EntityTable<OCRReceiptLine, 'id'>;
  products!: EntityTable<Product, 'id'>;
  productAliases!: EntityTable<ProductAlias, 'id'>;
  documentSessions!: EntityTable<DocumentSession, 'id'>;
  documentPageSegments!: EntityTable<DocumentPageSegment, 'id'>;

  constructor() {
    super('gestioneCasa');

    this.version(2).stores({
      settings: 'id, userMode',
      contributors: 'id, order, active, [order+active]',
      incomeEntries: 'id, contributorId, incomeDate, type, status, competenceYear, competenceMonth, [competenceYear+competenceMonth], [contributorId+competenceYear+competenceMonth]',
      expenses: 'id, expenseDate, paymentDate, status, entryMode, supplierId, projectId, fixedExpenseId, categoryId, subcategoryId, classification, notified, competenceYear, competenceMonth, [competenceYear+competenceMonth], [status+notified], [categoryId+subcategoryId]',
      expenseItems: 'id, expenseId, categoryId, subcategoryId, classification, [expenseId+classification]',
      categories: 'id, &code, parentId, type, level, enabled, [type+level], [parentId+sortOrder]',
      suppliers: 'id, name, status, defaultCategoryId',
      fixedExpenses: 'id, status, frequency, dueDay, categoryId, priority, [status+dueDay]',
      fixedExpenseOccurrences: 'id, fixedExpenseId, expenseId, dueDate, status, notified, competenceYear, competenceMonth, [competenceYear+competenceMonth], [status+dueDate]',
      savingPlans: 'id, fixedExpenseId, projectId, status, targetDate',
      savingMovements: 'id, savingPlanId, movementDate, type',
      projects: 'id, &slot, status, targetDate, [status+slot]',
      projectMovements: 'id, projectId, movementDate, type',
      attachments: 'id, entityType, entityId, status, deleteAfter, &fileHash, [entityType+entityId], [status+deleteAfter]',
      ocrProcesses: 'id, attachmentId, status, confirmedByUser',
      monthlyReports: 'id, year, month, status, &[year+month]',
      extraBudgetMovements: 'id, movementDate, type, year, month, [year+month]',
      auditLogs: 'id, entityType, entityId, action, timestamp, [entityType+entityId]',
    });

    this.version(3).stores({
      notifications: 'id, read, internalStatus, dueAt, uniqueKey, relatedEntityId, [relatedEntityType+relatedEntityId]',
    });

    this.version(4).stores({
      monthlySavingsGoals: 'id, year, month, [year+month]',
    });

    this.version(5).stores({
      ocrReceiptLines: 'id, ocrProcessId, productId, reviewStatus, [ocrProcessId+reviewStatus]',
      products: 'id, &normalizedName, displayName, brand, barcode, categoryId, subcategoryId',
      productAliases: 'id, productId, supplierId, originalText, normalizedText, [normalizedText+supplierId], [productId+supplierId]',
    });

    this.version(6).stores({
      documentSessions: 'id, documentType, sourceMode, status, createdAt, ocrProcessId, expenseId',
      documentPageSegments: 'id, sessionId, sequenceIndex, attachmentId, fileHash, processingStatus, [sessionId+sequenceIndex], [sessionId+fileHash]',
    });

    this.version(7).stores({
      documentSessions: 'id, documentType, sourceMode, processingMode, status, createdAt, ocrProcessId, expenseId',
      documentPageSegments: 'id, sessionId, sequenceIndex, attachmentId, fileHash, processingStatus, [sessionId+sequenceIndex], [sessionId+fileHash]',
    });
  }
}

export const db = new GestioneCasaDatabase();
