import { db } from '../database/db';
import {
  ContactRequestValidator,
  type ContactRequestDocument,
  type ContactRequestStatus,
} from '@gestione-casa/shared-sdk/contact-requests';
import type {
  Contributor,
  IncomeEntry,
  Expense,
  ExpenseItem,
  FixedExpense,
  FixedExpenseOccurrence,
  SavingPlan,
  Project,
  MonthlyReport,
  ExtraBudgetMovement,
  Supplier,
  Attachment,
  AppSettings,
  AppNotification,
  MonthlySavingsGoal,
  OCRProcess,
  AuditLogEntry,
  DocumentSession,
  DocumentPageSegment,
  DocumentProcessingMode,
  OCRReceiptLine,
  RecordMetadata,
  Product,
  ProductAlias,
} from '../types';

export const contributorRepository = {
  getAll: () => db.contributors.orderBy('order').toArray(),
  getActive: async () => {
    const all = await db.contributors.orderBy('order').toArray();
    return all.filter((c) => Boolean(c.active));
  },
  getById: (id: string) => db.contributors.get(id),
  create: async (data: Omit<Contributor, 'id' | 'metadata'>) => {
    const count = await db.contributors.count();
    if (count >= 3) {
      throw new Error('Massimo tre contribuenti consentiti');
    }
    const id = `contrib-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: Contributor = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    await db.contributors.add(item);
    return item;
  },
  update: async (id: string, data: Partial<Contributor>) => {
    const now = new Date().toISOString();
    const existing = await db.contributors.get(id);
    if (!existing) throw new Error(`Contributor ${id} non trovato`);
    const updated: Contributor = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.contributors.put(updated);
    return updated;
  },
  delete: (id: string) => db.contributors.delete(id),
  saveAll: async (contributorsList: Contributor[]) => {
    if (contributorsList.length > 3) {
      throw new Error('Massimo tre contribuenti consentiti');
    }
    const now = new Date().toISOString();
    const existingAll = await db.contributors.toArray();
    const existingIds = existingAll.map((c) => c.id);
    const newIds = new Set(contributorsList.map((c) => c.id));
    const toDelete = existingIds.filter((id) => !newIds.has(id));

    await db.transaction('rw', db.contributors, async () => {
      if (toDelete.length > 0) {
        await db.contributors.bulkDelete(toDelete);
      }
      for (const item of contributorsList) {
        const existing = await db.contributors.get(item.id);
        const updatedItem: Contributor = {
          ...item,
          metadata: existing
            ? { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 }
            : { createdAt: now, updatedAt: now, version: 1 },
        };
        await db.contributors.put(updatedItem);
      }
    });
  },
};

export const incomeRepository = {
  getAll: () => db.incomeEntries.toArray(),
  getById: (id: string) => db.incomeEntries.get(id),
  getByMonthYear: (year: number, month: number) =>
    db.incomeEntries.where('[competenceYear+competenceMonth]').equals([year, month]).toArray(),
  getByRange: async (startYear: number, startMonth: number, endYear: number, endMonth: number) => {
    const startYM = startYear * 12 + startMonth;
    const endYM = endYear * 12 + endMonth;
    const all = await db.incomeEntries.toArray();
    return all.filter((i) => {
      const ym = i.competenceYear * 12 + i.competenceMonth;
      return ym >= startYM && ym <= endYM;
    });
  },
  create: (data: Omit<IncomeEntry, 'id' | 'metadata'>) => {
    const id = `inc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: IncomeEntry = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    return db.incomeEntries.add(item).then(() => item);
  },
  update: async (id: string, data: Partial<IncomeEntry>) => {
    const now = new Date().toISOString();
    const existing = await db.incomeEntries.get(id);
    if (!existing) throw new Error(`Entrata ${id} non trovata`);
    const updated: IncomeEntry = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.incomeEntries.put(updated);
    return updated;
  },
  delete: (id: string) => db.incomeEntries.delete(id),
};

export const expenseRepository = {
  getAll: () => db.expenses.toArray(),
  getByMonthYear: (year: number, month: number) =>
    db.expenses.where('[competenceYear+competenceMonth]').equals([year, month]).toArray(),
  getByRange: async (startYear: number, startMonth: number, endYear: number, endMonth: number) => {
    const startYM = startYear * 12 + startMonth;
    const endYM = endYear * 12 + endMonth;
    const all = await db.expenses.toArray();
    return all.filter((e) => {
      const ym = e.competenceYear * 12 + e.competenceMonth;
      return ym >= startYM && ym <= endYM;
    });
  },
  getById: (id: string) => db.expenses.get(id),
  create: (data: Omit<Expense, 'id' | 'metadata'> & { metadata?: Record<string, any> }) => {
    const id = `exp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: Expense = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1, ...(data.metadata || {}) },
    };
    return db.expenses.add(item).then(() => item);
  },
  update: async (id: string, data: Partial<Expense>) => {
    const now = new Date().toISOString();
    const existing = await db.expenses.get(id);
    if (!existing) throw new Error(`Spesa ${id} non trovata`);
    const updated: Expense = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.expenses.put(updated);
    return updated;
  },
  delete: (id: string) => db.expenses.delete(id),
};

export const expenseItemRepository = {
  getAll: () => db.expenseItems.toArray(),
  getByExpenseId: (expenseId: string) =>
    db.expenseItems.where('expenseId').equals(expenseId).toArray(),
  getById: (id: string) => db.expenseItems.get(id),
  create: async (data: Omit<ExpenseItem, 'id' | 'metadata'>) => {
    const id = `exp-item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: ExpenseItem = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    await db.expenseItems.add(item);
    return item;
  },
  bulkCreate: async (items: Array<Omit<ExpenseItem, 'id' | 'metadata'>>) => {
    const now = new Date().toISOString();
    const formattedItems: ExpenseItem[] = items.map((item, index) => ({
      ...item,
      id: `exp-item-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    }));
    await db.expenseItems.bulkAdd(formattedItems);
    return formattedItems;
  },
  update: async (id: string, updates: Partial<ExpenseItem>) => {
    const existing = await db.expenseItems.get(id);
    if (!existing) throw new Error(`ExpenseItem ${id} non trovato`);
    const now = new Date().toISOString();
    const updated: ExpenseItem = {
      ...existing,
      ...updates,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.expenseItems.put(updated);
    return updated;
  },
  delete: (id: string) => db.expenseItems.delete(id),
};

export const fixedExpenseRepository = {
  getAll: () => db.fixedExpenses.toArray(),
  getActive: () => db.fixedExpenses.where('status').equals('active').toArray(),
  getById: (id: string) => db.fixedExpenses.get(id),
  create: (data: Omit<FixedExpense, 'id' | 'metadata'>) => {
    const id = `fe-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: FixedExpense = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    return db.fixedExpenses.add(item).then(() => item);
  },
  update: async (id: string, data: Partial<FixedExpense>) => {
    const now = new Date().toISOString();
    const existing = await db.fixedExpenses.get(id);
    if (!existing) throw new Error(`Spesa fissa ${id} non trovata`);
    const updated: FixedExpense = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.fixedExpenses.put(updated);
    return updated;
  },
  delete: async (id: string) => {
    await db.transaction('rw', [db.fixedExpenses, db.fixedExpenseOccurrences, db.expenses, db.savingPlans], async () => {
      await db.fixedExpenseOccurrences.where('fixedExpenseId').equals(id).delete();
      const linkedExpenses = await db.expenses.where('fixedExpenseId').equals(id).toArray();
      for (const exp of linkedExpenses) {
        await db.expenses.update(exp.id, { fixedExpenseId: null });
      }
      const linkedSavingPlans = await db.savingPlans.where('fixedExpenseId').equals(id).toArray();
      for (const sp of linkedSavingPlans) {
        await db.savingPlans.update(sp.id, { fixedExpenseId: null });
      }
      await db.fixedExpenses.delete(id);
    });
  },
  getOccurrencesByMonthYear: (year: number, month: number) =>
    db.fixedExpenseOccurrences.where('[competenceYear+competenceMonth]').equals([year, month]).toArray(),
  addOccurrence: (data: Omit<FixedExpenseOccurrence, 'id' | 'metadata'>) => {
    const id = `feo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: FixedExpenseOccurrence = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    return db.fixedExpenseOccurrences.add(item).then(() => item);
  },
};

export const savingPlanRepository = {
  getAll: () => db.savingPlans.toArray(),
  getActive: () => db.savingPlans.where('status').equals('active').toArray(),
  create: (data: Omit<SavingPlan, 'id' | 'metadata'>) => {
    const id = `sp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: SavingPlan = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    return db.savingPlans.add(item).then(() => item);
  },
  update: async (id: string, data: Partial<SavingPlan>) => {
    const now = new Date().toISOString();
    const existing = await db.savingPlans.get(id);
    if (!existing) throw new Error(`Piano risparmio ${id} non trovato`);
    const updated: SavingPlan = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.savingPlans.put(updated);
    return updated;
  },
};

export const projectRepository = {
  getAll: () => db.projects.toArray(),
  getActive: () => db.projects.where('status').equals('active').toArray(),
  getActiveCount: () => db.projects.where('status').equals('active').count(),
  create: async (data: Omit<Project, 'id' | 'metadata'>) => {
    const activeCount = await db.projects.where('status').equals('active').count();
    if (data.status === 'active' && activeCount >= 3) {
      throw new Error('Limite massimo di 3 progetti attivi raggiunto');
    }
    const id = `proj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: Project = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    await db.projects.add(item);
    return item;
  },
  update: async (id: string, data: Partial<Project>) => {
    const now = new Date().toISOString();
    const existing = await db.projects.get(id);
    if (!existing) throw new Error(`Progetto ${id} non trovato`);

    if (data.status === 'active' && existing.status !== 'active') {
      const activeCount = await db.projects.where('status').equals('active').count();
      if (activeCount >= 3) {
        throw new Error('Limite massimo di 3 progetti attivi raggiunto');
      }
    }

    const updated: Project = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.projects.put(updated);
    return updated;
  },
};

export const reportRepository = {
  getAll: () => db.monthlyReports.toArray(),
  getByMonthYear: (year: number, month: number) =>
    db.monthlyReports.where('[year+month]').equals([year, month]).first(),
  save: async (report: Omit<MonthlyReport, 'id' | 'metadata'> & { id?: string }) => {
    const now = new Date().toISOString();
    const id = report.id || `rep-${report.year}-${report.month}`;
    const existing = await db.monthlyReports.get(id);

    const item: MonthlyReport = {
      ...report,
      id,
      metadata: existing
        ? { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 }
        : { createdAt: now, updatedAt: now, version: 1 },
    };

    await db.monthlyReports.put(item);
    return item;
  },
};

export const extraBudgetRepository = {
  getAllMovements: () => db.extraBudgetMovements.orderBy('movementDate').toArray(),
  getCurrentBalance: async (): Promise<number> => {
    const movements = await db.extraBudgetMovements.toArray();
    if (movements.length === 0) return 0;
    const last = movements.reduce((acc, curr) =>
      new Date(curr.movementDate) > new Date(acc.movementDate) ? curr : acc,
    );
    return last.balanceAfter;
  },
  addMovement: async (
    data: Omit<ExtraBudgetMovement, 'id' | 'balanceAfter' | 'metadata'>,
  ): Promise<ExtraBudgetMovement> => {
    const currentBalance = await extraBudgetRepository.getCurrentBalance();
    let newBalance = currentBalance;

    if (data.type === 'monthlySurplusDeposit') {
      newBalance += data.amount;
    } else if (data.type === 'deficitCoverage') {
      newBalance -= data.amount;
    } else if (data.type === 'adjustment') {
      newBalance = data.amount;
    }

    const now = new Date().toISOString();
    const id = `eb-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const movement: ExtraBudgetMovement = {
      ...data,
      id,
      balanceAfter: Math.max(0, Math.round(newBalance * 100) / 100),
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await db.extraBudgetMovements.add(movement);
    return movement;
  },
};

export const supplierRepository = {
  getAll: () => db.suppliers.toArray(),
  getById: (id: string) => db.suppliers.get(id),
  getByNameOrAlias: async (nameOrAlias: string) => {
    const suppliers = await db.suppliers.toArray();
    const normalized = nameOrAlias.trim().toLowerCase();
    return (
      suppliers.find((s) => {
        if (s.name.trim().toLowerCase() === normalized) return true;
        if (s.aliases && s.aliases.some((a) => a.trim().toLowerCase() === normalized)) return true;
        return false;
      }) || null
    );
  },
  create: (data: Omit<Supplier, 'id' | 'metadata'>) => {
    const id = `sup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: Supplier = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    return db.suppliers.add(item).then(() => item);
  },
  update: async (id: string, data: Partial<Supplier>) => {
    const now = new Date().toISOString();
    const existing = await db.suppliers.get(id);
    if (!existing) throw new Error(`Fornitore ${id} non trovato`);
    const updated: Supplier = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.suppliers.put(updated);
    return updated;
  },
  delete: (id: string) => db.suppliers.delete(id),
};

export const productRepository = {
  getAll: () => db.products.toArray(),
  getById: (id: string) => db.products.get(id),
  getByNormalizedName: (name: string) => db.products.where('normalizedName').equals(name).first(),
  getByBarcode: (barcode: string) => db.products.where('barcode').equals(barcode).toArray(),
  create: async (data: Omit<Product, 'id' | 'metadata'>) => {
    const id = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: Product = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    await db.products.add(item);
    return item;
  },
  update: async (id: string, updates: Partial<Product>) => {
    const existing = await db.products.get(id);
    if (!existing) throw new Error(`Product ${id} non trovato`);
    const now = new Date().toISOString();
    const updated: Product = {
      ...existing,
      ...updates,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.products.put(updated);
    return updated;
  },
  delete: (id: string) => db.products.delete(id),
};

export const productAliasRepository = {
  getAll: () => db.productAliases.toArray(),
  getById: (id: string) => db.productAliases.get(id),
  getByNormalizedText: (normalizedText: string) =>
    db.productAliases.where('normalizedText').equals(normalizedText).toArray(),
  getByProduct: (productId: string) =>
    db.productAliases.filter((a) => a.productId === productId).toArray(),
  create: async (data: Omit<ProductAlias, 'id' | 'metadata'>) => {
    const id = `alias-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: ProductAlias = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    await db.productAliases.add(item);
    return item;
  },
  update: async (id: string, updates: Partial<ProductAlias>) => {
    const existing = await db.productAliases.get(id);
    if (!existing) throw new Error(`ProductAlias ${id} non trovato`);
    const now = new Date().toISOString();
    const updated: ProductAlias = {
      ...existing,
      ...updates,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.productAliases.put(updated);
    return updated;
  },
  delete: (id: string) => db.productAliases.delete(id),
};

export const categoryRepository = {
  getAll: async () => {
    const categories = await db.categories.toArray();
    return categories.sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  },
  getParents: async () => {
    const categories = await db.categories.where('level').equals(1).toArray();
    return categories.sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  },
  getSubcategories: async (parentId: string) => {
    const categories = await db.categories.where('parentId').equals(parentId).toArray();
    return categories.sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  },
};

export const attachmentRepository = {
  getAll: () => db.attachments.where('status').equals('active').reverse().sortBy('createdAt'),
  getById: (id: string) => db.attachments.get(id),
  create: (data: Omit<Attachment, 'id' | 'metadata' | 'createdAt'>) => {
    const id = `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: Attachment = {
      ...data,
      id,
      createdAt: now,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    return db.attachments.add(item).then(() => item);
  },
  update: async (id: string, updates: Partial<Attachment>) => {
    const existing = await db.attachments.get(id);
    if (!existing) throw new Error('Allegato non trovato');
    const now = new Date().toISOString();
    const updated: Attachment = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        updatedAt: now,
        version: existing.metadata.version + 1,
      },
    };
    await db.attachments.put(updated);
    return updated;
  },
  delete: async (id: string) => {
    await db.attachments.delete(id);
  },
};

export const settingsRepository = {
  get: async (): Promise<AppSettings> => {
    const settings = await db.settings.get('default-settings');
    if (!settings) {
      const now = new Date().toISOString();
      const defaultSettings: AppSettings = {
        id: 'default-settings',
        userMode: 'single',
        contributorsCount: 1,
        currency: 'EUR',
        language: 'it-IT',
        budgetMode: 'prudential',
        monthlyBudgetSource: 'manualContributorIncome',
        includePaidExpensesInBudget: true,
        includeNotifiedPlannedExpensesInBudget: true,
        includeSavingPlansInBudget: true,
        includeProjectQuotasInBudget: true,
        extraBudgetUsage: 'coverDeficitOnly',
        reportClosingMode: 'automaticEndOfMonth',
        reportClosingTime: '23:59',
        attachmentRetentionMonths: 12,
        theme: 'light',
        notificationsEnabled: true,
        notificationAdvanceDays: 3,
        homeAddress: { address: '', streetNumber: '', postalCode: '' },
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
      return defaultSettings;
    }
    return settings;
  },
  update: async (data: Partial<AppSettings>) => {
    const existing = await settingsRepository.get();
    const now = new Date().toISOString();
    const updated: AppSettings = {
      ...existing,
      ...data,
      metadata: { ...existing.metadata, updatedAt: now, version: existing.metadata.version + 1 },
    };
    await db.settings.put(updated);
    return updated;
  },
};

export const notificationRepository = {
  getAll: async () => {
    const items = await db.notifications.toArray();
    return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },
  getUnreadCount: async () => {
    const all = await db.notifications.toArray();
    return all.filter((n) => !n.read).length;
  },
  getById: (id: string) => db.notifications.get(id),
  markAsRead: async (id: string) => {
    await db.notifications.update(id, { read: true, internalStatus: 'read' });
  },
  markAsUnread: async (id: string) => {
    await db.notifications.update(id, { read: false, internalStatus: 'unread' });
  },
  markAllAsRead: async () => {
    const all = await db.notifications.toArray();
    const unreadIds = all.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await db.transaction('rw', db.notifications, async () => {
      for (const id of unreadIds) {
        await db.notifications.update(id, { read: true, internalStatus: 'read' });
      }
    });
  },
  delete: (id: string) => db.notifications.delete(id),
  create: async (data: Omit<AppNotification, 'id'>) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const item: AppNotification = {
      ...data,
      id,
    };
    await db.notifications.add(item);
    return item;
  },
  findByUniqueKey: async (uniqueKey: string) => {
    const all = await db.notifications.toArray();
    return all.find((n) => n.uniqueKey === uniqueKey);
  },
};

export const monthlySavingsGoalRepository = {
  getByMonthYear: (year: number, month: number) =>
    db.monthlySavingsGoals.where('[year+month]').equals([year, month]).first(),

  setGoal: async (year: number, month: number, targetAmount: number) => {
    const existing = await db.monthlySavingsGoals.where('[year+month]').equals([year, month]).first();
    const now = new Date().toISOString();
    if (existing) {
      const updated: MonthlySavingsGoal = {
        ...existing,
        targetAmount,
        updatedAt: now,
      };
      await db.monthlySavingsGoals.put(updated);
      return updated;
    } else {
      const id = `goal-${year}-${String(month).padStart(2, '0')}`;
      const newGoal: MonthlySavingsGoal = {
        id,
        year,
        month,
        targetAmount,
        createdAt: now,
        updatedAt: now,
      };
      await db.monthlySavingsGoals.add(newGoal);
      return newGoal;
    }
  },

  deleteGoal: async (year: number, month: number) => {
    const existing = await db.monthlySavingsGoals.where('[year+month]').equals([year, month]).first();
    if (existing && existing.id) {
      await db.monthlySavingsGoals.delete(existing.id);
    }
  },
};

export const ocrProcessRepository = {
  getAll: () => db.ocrProcesses.toArray(),
  getById: (id: string) => db.ocrProcesses.get(id),
  getByAttachmentId: (attachmentId: string) =>
    db.ocrProcesses.where('attachmentId').equals(attachmentId).first(),
  create: async (data: Omit<OCRProcess, 'id' | 'metadata'>) => {
    const id = `ocr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: OCRProcess = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    await db.ocrProcesses.add(item);
    return item;
  },
  update: async (id: string, updates: Partial<OCRProcess>) => {
    const existing = await db.ocrProcesses.get(id);
    if (!existing) throw new Error('Processo OCR non trovato');
    const now = new Date().toISOString();
    const updated: OCRProcess = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        updatedAt: now,
        version: existing.metadata.version + 1,
      },
    };
    await db.ocrProcesses.put(updated);
    return updated;
  },
  delete: (id: string) => db.ocrProcesses.delete(id),
};

export const ocrReceiptLineRepository = {
  getByOcrProcessId: (ocrProcessId: string) =>
    db.ocrReceiptLines.where('ocrProcessId').equals(ocrProcessId).toArray(),
  getById: (id: string) => db.ocrReceiptLines.get(id),
  create: async (data: Omit<OCRReceiptLine, 'id' | 'metadata'> & { metadata?: Record<string, any> }) => {
    const id = `ocr-line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const item: OCRReceiptLine = {
      ...data,
      id,
      metadata: { createdAt: now, updatedAt: now, version: 1, ...(data.metadata || {}) },
    };
    await db.ocrReceiptLines.add(item);
    return item;
  },
  bulkCreate: async (lines: Array<Omit<OCRReceiptLine, 'id' | 'metadata'> & { metadata?: Record<string, any> }>) => {
    const now = new Date().toISOString();
    const items: OCRReceiptLine[] = lines.map((line, index) => ({
      ...line,
      id: `ocr-line-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
      metadata: { createdAt: now, updatedAt: now, version: 1, ...(line.metadata || {}) },
    }));
    await db.ocrReceiptLines.bulkAdd(items);
    return items;
  },
  update: async (
    id: string,
    updates: Partial<Omit<OCRReceiptLine, 'metadata'>> & { metadata?: Partial<RecordMetadata> & Record<string, any> }
  ) => {
    const existing = await db.ocrReceiptLines.get(id);
    if (!existing) throw new Error('Linea OCR non trovata');
    const now = new Date().toISOString();
    const updated: OCRReceiptLine = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        ...(updates.metadata || {}),
        updatedAt: now,
        version: existing.metadata.version + 1,
      },
    };
    await db.ocrReceiptLines.put(updated);
    return updated;
  },
  delete: (id: string) => db.ocrReceiptLines.delete(id),
  deleteUnconfirmedByOcrProcessId: async (ocrProcessId: string) => {
    const lines = await db.ocrReceiptLines.where('ocrProcessId').equals(ocrProcessId).toArray();
    const toDelete = lines.filter((l) => l.reviewStatus === 'pending' || l.reviewStatus === 'rejected');
    const idsToDelete = toDelete.map((l) => l.id);
    if (idsToDelete.length > 0) {
      await db.ocrReceiptLines.bulkDelete(idsToDelete);
    }
    return idsToDelete.length;
  },
};

export const auditLogRepository = {
  getAll: () => db.auditLogs.reverse().sortBy('timestamp'),
  getById: (id: string) => db.auditLogs.get(id),
  getByEntity: (entityType: string, entityId: string) =>
    db.auditLogs.where('[entityType+entityId]').equals([entityType, entityId]).toArray(),
  create: async (data: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string }) => {
    const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = data.timestamp || new Date().toISOString();
    const entry: AuditLogEntry = {
      ...data,
      id,
      timestamp,
    };
    await db.auditLogs.add(entry);
    return entry;
  },
};

export const documentSessionRepository = {
  getAll: () => db.documentSessions.orderBy('createdAt').reverse().toArray(),
  getDraftSessions: async () => {
    const drafts = await db.documentSessions.where('status').equals('draft').toArray();
    return drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },
  getById: (id: string) => db.documentSessions.get(id),
  findActiveSessionByFileHash: async (fileHash: string, excludeSessionId?: string): Promise<DocumentSession | null> => {
    if (!fileHash) return null;
    const segments = await db.documentPageSegments.where('fileHash').equals(fileHash).toArray();
    for (const seg of segments) {
      if (excludeSessionId && seg.sessionId === excludeSessionId) continue;
      const sess = await db.documentSessions.get(seg.sessionId);
      if (
        sess &&
        sess.status !== 'reviewed' &&
        sess.status !== 'failed' &&
        (sess.status as string) !== 'cancelled'
      ) {
        return sess;
      }
    }
    return null;
  },
  create: async (
    data: Omit<DocumentSession, 'id' | 'createdAt' | 'updatedAt' | 'pageCount' | 'processingMode'> & {
      pageCount?: number;
      processingMode?: DocumentProcessingMode;
    }
  ) => {
    const id = `doc-sess-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const session: DocumentSession = {
      ...data,
      id,
      processingMode: data.processingMode ?? 'singleReceipt',
      createdAt: now,
      updatedAt: now,
      pageCount: data.pageCount ?? 0,
    };
    await db.documentSessions.add(session);
    return session;
  },
  update: async (id: string, updates: Partial<DocumentSession>) => {
    const existing = await db.documentSessions.get(id);
    if (!existing) throw new Error('Sessione documentale non trovata');
    const now = new Date().toISOString();
    const updated: DocumentSession = {
      ...existing,
      ...updates,
      updatedAt: now,
    };
    await db.documentSessions.put(updated);
    return updated;
  },
  delete: async (id: string) => {
    await db.transaction(
      'rw',
      [db.documentSessions, db.documentPageSegments, db.attachments, db.ocrProcesses],
      async () => {
        const session = await db.documentSessions.get(id);
        const segments = await db.documentPageSegments.where('sessionId').equals(id).toArray();
        for (const seg of segments) {
          if (seg.attachmentId) {
            await db.attachments.delete(seg.attachmentId);
          }
        }
        if (session?.ocrProcessId) {
          await db.ocrProcesses.delete(session.ocrProcessId);
        }
        await db.documentPageSegments.where('sessionId').equals(id).delete();
        await db.documentSessions.delete(id);
      }
    );
  },
};

export const documentPageSegmentRepository = {
  getBySessionId: async (sessionId: string) => {
    const segments = await db.documentPageSegments.where('sessionId').equals(sessionId).toArray();
    return segments.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  },
  getById: (id: string) => db.documentPageSegments.get(id),
  getByHash: async (sessionId: string, fileHash: string) => {
    return db.documentPageSegments.where('[sessionId+fileHash]').equals([sessionId, fileHash]).first();
  },
  create: async (data: Omit<DocumentPageSegment, 'id'>) => {
    // Controllo prevenzione duplicato sequenza nella stessa sessione
    const existingSeq = await db.documentPageSegments
      .where('[sessionId+sequenceIndex]')
      .equals([data.sessionId, data.sequenceIndex])
      .first();

    if (existingSeq) {
      throw new Error(
        `Impossibile inserire il segmento: indice di sequenza ${data.sequenceIndex} già presente nella sessione`
      );
    }

    // Controllo prevenzione duplicato hash nella stessa sessione
    const existingHash = await db.documentPageSegments
      .where('[sessionId+fileHash]')
      .equals([data.sessionId, data.fileHash])
      .first();

    if (existingHash) {
      throw new Error(
        `Impossibile inserire il segmento: documento/immagine con stesso hash già presente nella sessione`
      );
    }

    const id = `doc-seg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const segment: DocumentPageSegment = {
      ...data,
      id,
    };

    await db.transaction('rw', [db.documentSessions, db.documentPageSegments], async () => {
      await db.documentPageSegments.add(segment);
      const count = await db.documentPageSegments.where('sessionId').equals(data.sessionId).count();
      const session = await db.documentSessions.get(data.sessionId);
      if (session) {
        await db.documentSessions.update(data.sessionId, {
          pageCount: count,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    return segment;
  },
  update: async (id: string, updates: Partial<DocumentPageSegment>) => {
    const existing = await db.documentPageSegments.get(id);
    if (!existing) throw new Error('Segmento di pagina non trovato');
    const updated: DocumentPageSegment = {
      ...existing,
      ...updates,
    };
    await db.documentPageSegments.put(updated);
    return updated;
  },
  delete: async (id: string) => {
    const segment = await db.documentPageSegments.get(id);
    if (!segment) return;

    const { sessionId, attachmentId } = segment;

    await db.transaction('rw', [db.documentSessions, db.documentPageSegments, db.attachments], async () => {
      await db.documentPageSegments.delete(id);
      if (attachmentId) {
        await db.attachments.delete(attachmentId);
      }

      // Re-indicizza i segmenti rimanenti per garantire sequenzialità contigua 0..N-1
      const remaining = await db.documentPageSegments
        .where('sessionId')
        .equals(sessionId)
        .toArray();

      remaining.sort((a, b) => a.sequenceIndex - b.sequenceIndex);

      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].sequenceIndex !== i) {
          remaining[i].sequenceIndex = i;
          await db.documentPageSegments.put(remaining[i]);
        }
      }

      const session = await db.documentSessions.get(sessionId);
      if (session) {
        await db.documentSessions.update(sessionId, {
          pageCount: remaining.length,
          updatedAt: new Date().toISOString(),
        });
      }
    });
  },
  reorder: async (sessionId: string, orderedSegmentIds: string[]) => {
    await db.transaction('rw', [db.documentPageSegments, db.documentSessions], async () => {
      const segments = await db.documentPageSegments
        .where('sessionId')
        .equals(sessionId)
        .toArray();

      const segmentMap = new Map(segments.map((s) => [s.id, s]));

      // Assegna temporaneamente un indice negativo per evitare collisioni sull'indice univoco durante l'update
      for (let i = 0; i < orderedSegmentIds.length; i++) {
        const seg = segmentMap.get(orderedSegmentIds[i]);
        if (seg) {
          seg.sequenceIndex = -(i + 1);
          await db.documentPageSegments.put(seg);
        }
      }

      // Applica la nuova sequenza definitiva 0..N-1
      for (let i = 0; i < orderedSegmentIds.length; i++) {
        const seg = segmentMap.get(orderedSegmentIds[i]);
        if (seg) {
          seg.sequenceIndex = i;
          await db.documentPageSegments.put(seg);
        }
      }

      const session = await db.documentSessions.get(sessionId);
      if (session) {
        await db.documentSessions.update(sessionId, {
          updatedAt: new Date().toISOString(),
        });
      }
    });
  },
};

export type RemoteRecordApplicationStatus =
  | 'applied'
  | 'equivalent'
  | 'conflict'
  | 'missing_local_record';

export interface ApplyRemoteRecordResult {
  status: RemoteRecordApplicationStatus;
  requestId: string;
  document?: ContactRequestDocument;
  message?: string;
}

const TERMINAL_CONTACT_REQUEST_STATUSES: ContactRequestStatus[] = [
  'converted_to_customer',
  'rejected',
  'closed',
];

function areContactRequestBusinessFieldsEqual(
  a: ContactRequestDocument,
  b: ContactRequestDocument
): boolean {
  return (
    a.requestType === b.requestType &&
    a.status === b.status &&
    a.displayName === b.displayName &&
    a.firstName === b.firstName &&
    (a.lastName ?? null) === (b.lastName ?? null) &&
    (a.companyName ?? null) === (b.companyName ?? null) &&
    a.email === b.email &&
    (a.phone ?? null) === (b.phone ?? null) &&
    a.preferredContactChannel === b.preferredContactChannel &&
    a.subject === b.subject &&
    a.message === b.message &&
    a.privacyAcceptedAt === b.privacyAcceptedAt &&
    (a.linkedCustomerId ?? null) === (b.linkedCustomerId ?? null) &&
    (a.linkedLicenseId ?? null) === (b.linkedLicenseId ?? null) &&
    (a.reviewedAt ?? null) === (b.reviewedAt ?? null) &&
    (a.closedAt ?? null) === (b.closedAt ?? null)
  );
}

export const contactRequestRepository = {
  getAll: () => db.contactRequests.toArray(),
  getById: (id: string) => db.contactRequests.get(id),
  count: () => db.contactRequests.count(),
  clear: () => db.contactRequests.clear(),

  getBySyncStatus: (status: 'pending' | 'synced' | 'conflict'): Promise<ContactRequestDocument[]> => {
    return db.contactRequests.where('syncStatus').equals(status).toArray();
  },

  getPending: (): Promise<ContactRequestDocument[]> => {
    return contactRequestRepository.getBySyncStatus('pending');
  },

  getConflicts: (): Promise<ContactRequestDocument[]> => {
    return contactRequestRepository.getBySyncStatus('conflict');
  },

  markSynced: async (id: string): Promise<ContactRequestDocument> => {
    const existing = await db.contactRequests.get(id);
    if (!existing) {
      throw new Error(`Richiesta di contatto "${id}" non trovata`);
    }
    await db.contactRequests.update(id, { syncStatus: 'synced' });
    const updated = await db.contactRequests.get(id);
    return updated!;
  },

  markConflict: async (id: string): Promise<ContactRequestDocument> => {
    const existing = await db.contactRequests.get(id);
    if (!existing) {
      throw new Error(`Richiesta di contatto "${id}" non trovata`);
    }
    await db.contactRequests.update(id, { syncStatus: 'conflict' });
    const updated = await db.contactRequests.get(id);
    return updated!;
  },

  applyRemoteRecord: async (
    remoteDoc: ContactRequestDocument
  ): Promise<ApplyRemoteRecordResult> => {
    if (!remoteDoc || !remoteDoc.id || typeof remoteDoc.id !== 'string') {
      throw new Error("L'ID della richiesta remota è obbligatorio");
    }

    const existing = await db.contactRequests.get(remoteDoc.id);
    if (!existing) {
      return {
        status: 'missing_local_record',
        requestId: remoteDoc.id,
        message: `Richiesta locale "${remoteDoc.id}" non trovata. Nessun inserimento automatico.`,
      };
    }

    if (areContactRequestBusinessFieldsEqual(existing, remoteDoc)) {
      if (existing.syncStatus !== 'synced') {
        await db.contactRequests.update(existing.id, { syncStatus: 'synced' });
        const updated = await db.contactRequests.get(existing.id);
        return {
          status: 'equivalent',
          requestId: existing.id,
          document: updated!,
          message: 'Contenuto business già equivalente. Stato impostato a synced.',
        };
      }
      return {
        status: 'equivalent',
        requestId: existing.id,
        document: existing,
        message: 'Contenuto business già equivalente e sincronizzato.',
      };
    }

    const isRemoteTerminal = TERMINAL_CONTACT_REQUEST_STATUSES.includes(remoteDoc.status);

    if (isRemoteTerminal) {
      const mergedDoc: ContactRequestDocument = {
        ...existing,
        status: remoteDoc.status,
        linkedCustomerId: remoteDoc.linkedCustomerId ?? null,
        linkedLicenseId: remoteDoc.linkedLicenseId ?? null,
        reviewedAt: remoteDoc.reviewedAt ?? null,
        closedAt: remoteDoc.closedAt ?? null,
        updatedAt: remoteDoc.updatedAt || new Date().toISOString(),
        syncStatus: 'synced',
        sourceDeviceId: existing.sourceDeviceId || remoteDoc.sourceDeviceId,
        sourceAppVersion: existing.sourceAppVersion || remoteDoc.sourceAppVersion,
        schemaVersion: 1,
      };

      const validation = ContactRequestValidator.validate(mergedDoc);
      if (!validation.isValid || !validation.value) {
        const issueDetails = validation.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
        throw new Error(`Ricostruzione documento con stato terminale LM non valida: ${issueDetails}`);
      }

      const docToSave = validation.value;
      await db.contactRequests.put(docToSave);

      return {
        status: 'applied',
        requestId: existing.id,
        document: docToSave,
        message: `Stato terminale LM "${remoteDoc.status}" applicato con successo.`,
      };
    }

    const isLocalPendingWithNewerUpdate =
      existing.syncStatus === 'pending' &&
      new Date(existing.updatedAt).getTime() > new Date(remoteDoc.updatedAt).getTime();

    if (isLocalPendingWithNewerUpdate) {
      await db.contactRequests.update(existing.id, { syncStatus: 'conflict' });
      const conflictDoc = await db.contactRequests.get(existing.id);
      return {
        status: 'conflict',
        requestId: existing.id,
        document: conflictDoc!,
        message: 'Conflitto di sincronizzazione: modifiche locali pending più recenti della risposta non terminale LM.',
      };
    }

    const mergedDoc: ContactRequestDocument = {
      ...existing,
      status: remoteDoc.status,
      linkedCustomerId: remoteDoc.linkedCustomerId ?? null,
      linkedLicenseId: remoteDoc.linkedLicenseId ?? null,
      reviewedAt: remoteDoc.reviewedAt ?? null,
      closedAt: remoteDoc.closedAt ?? null,
      updatedAt: remoteDoc.updatedAt || new Date().toISOString(),
      syncStatus: 'synced',
      sourceDeviceId: existing.sourceDeviceId || remoteDoc.sourceDeviceId,
      sourceAppVersion: existing.sourceAppVersion || remoteDoc.sourceAppVersion,
      schemaVersion: 1,
    };

    const validation = ContactRequestValidator.validate(mergedDoc);
    if (!validation.isValid || !validation.value) {
      const issueDetails = validation.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
      throw new Error(`Ricostruzione documento con stato LM non valida: ${issueDetails}`);
    }

    const docToSave = validation.value;
    await db.contactRequests.put(docToSave);

    return {
      status: 'applied',
      requestId: existing.id,
      document: docToSave,
      message: `Risposta LM con stato "${remoteDoc.status}" applicata con successo.`,
    };
  },

  create: async (data: ContactRequestDocument): Promise<ContactRequestDocument> => {
    if (!data || !data.id || typeof data.id !== 'string' || data.id.trim() === '') {
      throw new Error("L'ID della richiesta di contatto è obbligatorio e non può essere vuoto");
    }

    const existing = await db.contactRequests.get(data.id);
    if (existing) {
      throw new Error(`Richiesta di contatto con ID "${data.id}" già esistente`);
    }

    if (
      data.metadata === undefined ||
      data.metadata === null ||
      typeof data.metadata !== 'object' ||
      Array.isArray(data.metadata)
    ) {
      throw new Error('I metadata della richiesta sono obbligatori e devono essere un oggetto');
    }

    const validation = ContactRequestValidator.validate(data);
    if (!validation.isValid || !validation.value) {
      const issueDetails = validation.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
      throw new Error(`Documento ContactRequest non valido: ${issueDetails}`);
    }

    const docToSave = validation.value;
    await db.contactRequests.add(docToSave);
    return docToSave;
  },

  update: async (id: string, updates: Partial<ContactRequestDocument>): Promise<ContactRequestDocument> => {
    const existing = await db.contactRequests.get(id);
    if (!existing) {
      throw new Error(`Richiesta di contatto "${id}" non trovata`);
    }

    const nowISO = new Date().toISOString();
    const createdAtTime = new Date(existing.createdAt).getTime();
    const nowTime = new Date(nowISO).getTime();
    const fallbackUpdatedAt = nowTime >= createdAtTime ? nowISO : existing.createdAt;

    const updatedCandidate: ContactRequestDocument = {
      ...existing,
      ...updates,
      id,
      syncStatus: updates.syncStatus || 'pending',
      schemaVersion: 1,
      updatedAt: updates.updatedAt || fallbackUpdatedAt,
    };

    if (
      updatedCandidate.metadata === undefined ||
      updatedCandidate.metadata === null ||
      typeof updatedCandidate.metadata !== 'object' ||
      Array.isArray(updatedCandidate.metadata)
    ) {
      throw new Error('I metadata della richiesta sono obbligatori e devono essere un oggetto');
    }

    const validation = ContactRequestValidator.validate(updatedCandidate);
    if (!validation.isValid || !validation.value) {
      const issueDetails = validation.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
      throw new Error(`Aggiornamento ContactRequest non valido: ${issueDetails}`);
    }

    const docToSave = validation.value;
    await db.contactRequests.put(docToSave);
    return docToSave;
  },

  delete: (id: string) => db.contactRequests.delete(id),
};



