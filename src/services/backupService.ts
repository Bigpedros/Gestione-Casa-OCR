import { db } from '../database/db';
import type { BackupData } from '../types';

export const backupService = {
  generateChecksum: (dataStr: string): string => {
    let hash = 0;
    for (let i = 0; i < dataStr.length; i++) {
      const char = dataStr.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  },

  exportBackup: async (): Promise<string> => {
    const settings = await db.settings.toArray();
    const contributors = await db.contributors.toArray();
    const incomeEntries = await db.incomeEntries.toArray();
    const expenses = await db.expenses.toArray();
    const expenseItems = await db.expenseItems.toArray();
    const categories = await db.categories.toArray();
    const suppliers = await db.suppliers.toArray();
    const fixedExpenses = await db.fixedExpenses.toArray();
    const fixedExpenseOccurrences = await db.fixedExpenseOccurrences.toArray();
    const savingPlans = await db.savingPlans.toArray();
    const savingMovements = await db.savingMovements.toArray();
    const projects = await db.projects.toArray();
    const projectMovements = await db.projectMovements.toArray();
    const attachments = await db.attachments.toArray();
    const ocrProcesses = await db.ocrProcesses.toArray();
    const monthlyReports = await db.monthlyReports.toArray();
    const extraBudgetMovements = await db.extraBudgetMovements.toArray();
    const auditLogs = await db.auditLogs.toArray();
    const ocrReceiptLines = await db.ocrReceiptLines.toArray();
    const products = await db.products.toArray();
    const productAliases = await db.productAliases.toArray();
    const documentSessions = await db.documentSessions.toArray();
    const documentPageSegments = await db.documentPageSegments.toArray();

    const backupPayload: Omit<BackupData, 'checksum'> = {
      appName: 'Gestione Casa',
      version: '1.0.0',
      schemaVersion: '2.0.0',
      databaseName: 'gestioneCasa',
      exportedAt: new Date().toISOString(),
      tables: {
        settings,
        contributors,
        incomeEntries,
        expenses,
        expenseItems,
        categories,
        suppliers,
        fixedExpenses,
        fixedExpenseOccurrences,
        savingPlans,
        savingMovements,
        projects,
        projectMovements,
        attachments,
        ocrProcesses,
        monthlyReports,
        extraBudgetMovements,
        auditLogs,
        ocrReceiptLines,
        products,
        productAliases,
        documentSessions,
        documentPageSegments,
      },
    };

    const payloadString = JSON.stringify(backupPayload);
    const checksum = backupService.generateChecksum(payloadString);

    const fullBackup: BackupData = {
      ...backupPayload,
      checksum,
    };

    return JSON.stringify(fullBackup, null, 2);
  },

  validateBackup: (jsonString: string): { isValid: boolean; error?: string; data?: BackupData } => {
    try {
      const data = JSON.parse(jsonString) as BackupData;
      if (!data.appName || data.appName !== 'Gestione Casa') {
        return { isValid: false, error: 'File di backup non valido: Nome applicazione errato.' };
      }
      if (!data.databaseName || data.databaseName !== 'gestioneCasa') {
        return { isValid: false, error: 'File di backup non valido: Nome database errato.' };
      }
      if (!data.tables) {
        return { isValid: false, error: 'File di backup corrotto: Sezione tabelle mancante.' };
      }
      return { isValid: true, data };
    } catch (err) {
      return { isValid: false, error: `JSON non valido: ${(err as Error).message}` };
    }
  },

  importBackup: async (backupData: BackupData): Promise<void> => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));

      if (backupData.tables.settings) await db.settings.bulkAdd(backupData.tables.settings);
      if (backupData.tables.contributors) await db.contributors.bulkAdd(backupData.tables.contributors);
      if (backupData.tables.incomeEntries) await db.incomeEntries.bulkAdd(backupData.tables.incomeEntries);
      if (backupData.tables.expenses) await db.expenses.bulkAdd(backupData.tables.expenses);
      if (backupData.tables.expenseItems) await db.expenseItems.bulkAdd(backupData.tables.expenseItems);
      if (backupData.tables.categories) await db.categories.bulkAdd(backupData.tables.categories);
      if (backupData.tables.suppliers) await db.suppliers.bulkAdd(backupData.tables.suppliers);
      if (backupData.tables.fixedExpenses) await db.fixedExpenses.bulkAdd(backupData.tables.fixedExpenses);
      if (backupData.tables.fixedExpenseOccurrences) await db.fixedExpenseOccurrences.bulkAdd(backupData.tables.fixedExpenseOccurrences);
      if (backupData.tables.savingPlans) await db.savingPlans.bulkAdd(backupData.tables.savingPlans);
      if (backupData.tables.savingMovements) await db.savingMovements.bulkAdd(backupData.tables.savingMovements);
      if (backupData.tables.projects) await db.projects.bulkAdd(backupData.tables.projects);
      if (backupData.tables.projectMovements) await db.projectMovements.bulkAdd(backupData.tables.projectMovements);
      if (backupData.tables.attachments) await db.attachments.bulkAdd(backupData.tables.attachments);
      if (backupData.tables.ocrProcesses) await db.ocrProcesses.bulkAdd(backupData.tables.ocrProcesses);
      if (backupData.tables.monthlyReports) await db.monthlyReports.bulkAdd(backupData.tables.monthlyReports);
      if (backupData.tables.extraBudgetMovements) await db.extraBudgetMovements.bulkAdd(backupData.tables.extraBudgetMovements);
      if (backupData.tables.auditLogs) await db.auditLogs.bulkAdd(backupData.tables.auditLogs);
      if (backupData.tables.ocrReceiptLines) await db.ocrReceiptLines.bulkAdd(backupData.tables.ocrReceiptLines);
      if (backupData.tables.products) await db.products.bulkAdd(backupData.tables.products);
      if (backupData.tables.productAliases) await db.productAliases.bulkAdd(backupData.tables.productAliases);
      if (backupData.tables.documentSessions) await db.documentSessions.bulkAdd(backupData.tables.documentSessions);
      if (backupData.tables.documentPageSegments) await db.documentPageSegments.bulkAdd(backupData.tables.documentPageSegments);
    });
  },
};
