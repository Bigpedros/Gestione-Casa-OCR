import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { seedInitialPaymentMethods, INITIAL_PAYMENT_METHODS } from '../database/seed/seedPaymentMethods';
import { paymentMethodRepository, paymentEvidenceRepository } from '../repositories';
import { backupService } from '../services/backupService';
import type { BackupData, Expense } from '../types';

describe('BLOCCO P1 — Fondazione Dati Locale Pagamenti & PaymentEvidence', () => {
  beforeEach(async () => {
    await db.paymentMethods.clear();
    await db.paymentEvidences.clear();
    await db.expenses.clear();
  });

  describe('1. Schema Dexie v10', () => {
    it('inizializza correttamente lo schema v10 e le tabelle paymentMethods e paymentEvidences', () => {
      expect(db.verno).toBe(10);
      expect(db.paymentMethods).toBeDefined();
      expect(db.paymentEvidences).toBeDefined();
      expect(typeof db.paymentMethods.toArray).toBe('function');
      expect(typeof db.paymentEvidences.toArray).toBe('function');
    });
  });

  describe('2. Seed Metodi di Sistema', () => {
    it('crea esattamente gli 8 metodi di sistema predefiniti in modo idempotente', async () => {
      await seedInitialPaymentMethods();
      const methods = await paymentMethodRepository.getAll();

      expect(methods.length).toBe(8);
      expect(INITIAL_PAYMENT_METHODS.length).toBe(8);

      const cash = methods.find((m) => m.code === 'cash');
      expect(cash).toBeDefined();
      expect(cash?.displayName).toBe('Contanti');
      expect(cash?.macroCategory).toBe('cash');
      expect(cash?.isSystem).toBe(true);
      expect(cash?.enabled).toBe(true);

      const debit = methods.find((m) => m.code === 'debit_card');
      expect(debit).toBeDefined();
      expect(debit?.displayName).toBe('Carta di debito');
      expect(debit?.macroCategory).toBe('debitCard');

      const credit = methods.find((m) => m.code === 'credit_card');
      expect(credit).toBeDefined();
      expect(credit?.displayName).toBe('Carta di credito');
      expect(credit?.macroCategory).toBe('creditCard');

      const transfer = methods.find((m) => m.code === 'bank_transfer');
      expect(transfer).toBeDefined();
      expect(transfer?.displayName).toBe('Bonifico');
      expect(transfer?.macroCategory).toBe('bankTransfer');

      const directDebit = methods.find((m) => m.code === 'direct_debit');
      expect(directDebit).toBeDefined();
      expect(directDebit?.displayName).toBe('Addebito diretto');
      expect(directDebit?.macroCategory).toBe('directDebit');

      const wallet = methods.find((m) => m.code === 'digital_wallet');
      expect(wallet).toBeDefined();
      expect(wallet?.displayName).toBe('Wallet digitale');
      expect(wallet?.macroCategory).toBe('digitalWallet');

      const otherElec = methods.find((m) => m.code === 'other_electronic');
      expect(otherElec).toBeDefined();
      expect(otherElec?.displayName).toBe('Altro pagamento elettronico');
      expect(otherElec?.macroCategory).toBe('other');

      const crypto = methods.find((m) => m.code === 'crypto_custom');
      expect(crypto).toBeDefined();
      expect(crypto?.displayName).toBe('Criptovaluta / Altro');
      expect(crypto?.macroCategory).toBe('other');
      expect(crypto?.customTickerOrName).toBeNull();

      // Seconda esecuzione per testare l'idempotenza
      await seedInitialPaymentMethods();
      const methodsAfterSecondSeed = await paymentMethodRepository.getAll();
      expect(methodsAfterSecondSeed.length).toBe(8);
    });
  });

  describe('3. Metodi di Pagamento Custom & Criptovaluta Manuale', () => {
    it('consente la creazione e l\'aggiornamento di un metodo personalizzato non noto a priori', async () => {
      const customMethod = await paymentMethodRepository.create({
        code: 'buoni_pasto_edenred',
        displayName: 'Ticket Restaurant / Buoni Pasto',
        macroCategory: 'other',
        isSystem: false,
        enabled: true,
        customTickerOrName: null,
        aliases: ['ticket', 'buoni pasto', 'edenred', 'day'],
      });

      expect(customMethod.id).toBeDefined();
      expect(customMethod.isSystem).toBe(false);

      const retrieved = await paymentMethodRepository.getById(customMethod.id);
      expect(retrieved?.displayName).toBe('Ticket Restaurant / Buoni Pasto');

      const updated = await paymentMethodRepository.update(customMethod.id, {
        displayName: 'Buoni Pasto Elettronici',
      });
      expect(updated.displayName).toBe('Buoni Pasto Elettronici');
      expect(updated.metadata.version).toBe(2);
    });

    it('consente la gestione manuale di criptovalute generiche con ticker/nome senza logiche blockchain', async () => {
      const btcMethod = await paymentMethodRepository.create({
        code: 'crypto_btc',
        displayName: 'Bitcoin',
        macroCategory: 'other',
        isSystem: false,
        enabled: true,
        customTickerOrName: 'BTC',
        aliases: ['bitcoin', 'btc', 'sats', 'lightning'],
      });

      expect(btcMethod.customTickerOrName).toBe('BTC');
      expect(btcMethod.macroCategory).toBe('other');

      const usdtMethod = await paymentMethodRepository.create({
        code: 'crypto_usdt',
        displayName: 'Tether USD',
        macroCategory: 'other',
        isSystem: false,
        enabled: true,
        customTickerOrName: 'USDT',
        aliases: ['tether', 'usdt'],
      });

      expect(usdtMethod.customTickerOrName).toBe('USDT');

      const activeMethods = await paymentMethodRepository.getActive();
      expect(activeMethods.some((m) => m.code === 'crypto_btc')).toBe(true);
      expect(activeMethods.some((m) => m.code === 'crypto_usdt')).toBe(true);
    });
  });

  describe('4. PaymentEvidence (Non Collegata vs Collegata)', () => {
    it('crea e gestisce una PaymentEvidence non collegata (ad es. scontrino POS isolato)', async () => {
      const evidence = await paymentEvidenceRepository.create({
        documentType: 'pos_receipt',
        paymentMethodId: 'pm-debit-card',
        paymentChannel: 'POS Fisico',
        amount: 23.45,
        fee: 0,
        dateTime: '2026-08-28T10:15:00Z',
        merchantOrBeneficiary: 'SUPERMERCATO TODIS',
        transactionReference: 'STAN-882103',
        confidence: 0.95,
        userConfirmed: false,
      });

      expect(evidence.id).toBeDefined();
      expect(evidence.expenseId).toBeUndefined();
      expect(evidence.amount).toBe(23.45);
      expect(evidence.userConfirmed).toBe(false);

      const all = await paymentEvidenceRepository.getAll();
      expect(all.length).toBe(1);
    });

    it('collega molteplici PaymentEvidence a una singola Expense reale (relazione 1 -> N)', async () => {
      const now = new Date().toISOString();
      const expenseId = 'exp-pagopa-tari-2026';

      const expense: Expense = {
        id: expenseId,
        entryMode: 'manual',
        description: 'TARI 2026 - Totale Rate',
        amount: 303.00,
        expenseDate: '2026-08-28',
        paymentDate: '2026-08-28',
        competenceMonth: 8,
        competenceYear: 2026,
        categoryId: 'cat-home',
        subcategoryId: 'cat-home-utilities',
        paymentMethod: 'other',
        paymentMethodId: 'pm-other-electronic',
        paymentFee: 3.00, // Totale commissioni (1.50 + 1.50)
        status: 'paid',
        classification: 'necessary',
        notified: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };

      await db.expenses.add(expense);

      // Prima rata / prima prova di pagamento
      const evidence1 = await paymentEvidenceRepository.create({
        expenseId: expense.id,
        documentType: 'pagopa_receipt',
        paymentMethodId: 'pm-other-electronic',
        paymentChannel: 'PagoPA Web',
        amount: 151.50,
        fee: 1.50,
        dateTime: '2026-08-28T11:00:00Z',
        merchantOrBeneficiary: 'Comune di Roma - Tributi',
        transactionReference: 'IUV-3029102938491029',
        confidence: 0.98,
        userConfirmed: true,
      });

      // Seconda rata / seconda prova di pagamento
      const evidence2 = await paymentEvidenceRepository.create({
        expenseId: expense.id,
        documentType: 'pagopa_receipt',
        paymentMethodId: 'pm-other-electronic',
        paymentChannel: 'Ricevitoria Mooney',
        amount: 151.50,
        fee: 1.50,
        dateTime: '2026-08-28T16:30:00Z',
        merchantOrBeneficiary: 'Comune di Roma - Tributi',
        transactionReference: 'IUV-3029102938491030',
        confidence: 0.99,
        userConfirmed: true,
      });

      // Query tramite indice su expenseId (1 -> N)
      const linkedEvidences = await paymentEvidenceRepository.getByExpenseId(expenseId);
      expect(linkedEvidences.length).toBe(2);

      const ids = linkedEvidences.map((e) => e.id);
      expect(ids).toContain(evidence1.id);
      expect(ids).toContain(evidence2.id);

      const totalFees = linkedEvidences.reduce((sum, e) => sum + (e.fee || 0), 0);
      expect(totalFees).toBe(3.00);

      const totalPaid = linkedEvidences.reduce((sum, e) => sum + (e.amount || 0), 0);
      expect(totalPaid).toBe(303.00);

      const storedExpense = await db.expenses.get(expenseId);
      expect(storedExpense).toBeDefined();
      expect(storedExpense?.paymentFee).toBe(3.00);
      expect(storedExpense?.paymentMethodId).toBe('pm-other-electronic');
    });
  });

  describe('5. Test Reale Upgrade Dexie v9 -> v10', () => {
    it('migra un database reale con schema v9 contenente dati storici a v10 preservando ogni record e abilitando le nuove tabelle', async () => {
      const { Dexie } = await import('dexie');
      const testDbName = `gestioneCasa_upgrade_test_${Date.now()}`;
      const now = new Date().toISOString();

      // 1. Creazione e apertura database v9 puro
      const dbV9 = new Dexie(testDbName);
      dbV9.version(1).stores({
        settings: 'key',
        contributors: 'id, name, isDefault',
        incomeEntries: 'id, date, contributorId, type',
        expenses: 'id, expenseDate, competenceMonth, competenceYear, categoryId, subcategoryId, status, classification, paymentDate, entryMode, recurring, frequency, priority',
        expenseItems: 'id, expenseId, categoryId, subcategoryId, classification',
        categories: 'id, name',
        suppliers: 'id, name',
        fixedExpenses: 'id, categoryId, subcategoryId, isEstimate, active, nextDueDate',
        fixedExpenseOccurrences: 'id, fixedExpenseId, competenceMonth, competenceYear, dueDate, status',
        savingPlans: 'id, status, targetDate',
        savingMovements: 'id, savingPlanId, date, type',
        projects: 'id, status, deadline',
        projectMovements: 'id, projectId, date, type',
        attachments: 'id, entityType, entityId, date',
        ocrProcesses: 'id, status, date',
        monthlyReports: 'id, [year+month], status',
        extraBudgetMovements: 'id, year, month, date, categoryId',
        auditLogs: 'id, entityType, entityId, timestamp, action',
      });
      dbV9.version(2).stores({
        ocrProcesses: 'id, status, date, ocrEngine, processingTimeMs, rawTextLength, lineCount',
        ocrReceiptLines: 'id, processId, lineIndex, confidence',
      });
      dbV9.version(4).stores({
        settings: 'key, updatedAt',
        monthlyReports: 'id, [year+month], year, month, status, updatedAt',
      });
      dbV9.version(5).stores({
        products: 'id, name, defaultCategoryId, defaultSubcategoryId, usageCount, lastUsedAt',
        productAliases: 'id, alias, productId, usageCount',
      });
      dbV9.version(6).stores({
        expenseItems: 'id, expenseId, categoryId, subcategoryId, classification, productId',
      });
      dbV9.version(7).stores({
        notifications: 'id, type, date, isRead, isArchived, [type+isRead]',
      });
      dbV9.version(8).stores({
        documentSessions: 'id, documentType, status, createdAt, updatedAt',
        documentPageSegments: 'id, sessionId, pageIndex, segmentIndex, status',
      });
      dbV9.version(9).stores({
        localLicenses: 'id, status, lastSuccessfulOnlineValidation, updatedAt',
      });

      await dbV9.open();
      expect(dbV9.verno).toBe(9);

      // Inserimento record reali nelle tabelle v9
      const expenseV9 = {
        id: 'exp-migration-1',
        entryMode: 'manual' as const,
        description: 'Spesa Storica per Test Migrazione v9',
        amount: 84.50,
        expenseDate: '2026-03-10',
        competenceMonth: 3,
        competenceYear: 2026,
        categoryId: 'cat-groceries',
        subcategoryId: 'cat-groceries-sub',
        paymentMethod: 'debitCard' as const,
        status: 'paid' as const,
        classification: 'necessary' as const,
        notified: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
      await dbV9.table('expenses').add(expenseV9);

      const expenseItemV9 = {
        id: 'item-migration-1',
        expenseId: 'exp-migration-1',
        description: 'Pasta e Salsa',
        quantity: 2,
        unitPrice: 42.25,
        total: 84.50,
        categoryId: 'cat-groceries',
        subcategoryId: 'cat-groceries-sub',
        classification: 'necessary' as const,
        classificationSource: 'manual' as const,
      };
      await dbV9.table('expenseItems').add(expenseItemV9);

      const incomeV9 = {
        id: 'inc-migration-1',
        description: 'Stipendio Marzo 2026',
        amount: 2200.00,
        date: '2026-03-27',
        contributorId: 'contrib-1',
        type: 'salary' as const,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
      await dbV9.table('incomeEntries').add(incomeV9);

      const attachmentV9 = {
        id: 'att-migration-1',
        entityType: 'expense' as const,
        entityId: 'exp-migration-1',
        date: '2026-03-10',
        fileName: 'scontrino_marzo.jpg',
        fileType: 'image/jpeg',
        fileSize: 1024,
        data: 'data:image/jpeg;base64,...',
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
      await dbV9.table('attachments').add(attachmentV9);

      const sessionV9 = {
        id: 'session-migration-1',
        documentType: 'receipt' as const,
        sourceMode: 'camera' as const,
        processingMode: 'standard' as const,
        status: 'completed' as const,
        createdAt: now,
        updatedAt: now,
      };
      await dbV9.table('documentSessions').add(sessionV9);

      const ocrProcessV9 = {
        id: 'ocr-proc-migration-1',
        status: 'completed' as const,
        date: '2026-03-10',
        rawText: 'TOTALE 84.50',
      };
      await dbV9.table('ocrProcesses').add(ocrProcessV9);

      const licenseV9 = {
        id: 'current',
        status: 'active' as const,
        lastSuccessfulOnlineValidation: now,
        updatedAt: now,
      };
      await dbV9.table('localLicenses').add(licenseV9);

      // Chiusura database v9
      dbV9.close();

      // 2. Apertura dello stesso database fisico con schema v10
      const dbV10 = new Dexie(testDbName);
      // Riassegna le versioni 1-9 e aggiungi la 10
      dbV10.version(1).stores({
        settings: 'key',
        contributors: 'id, name, isDefault',
        incomeEntries: 'id, date, contributorId, type',
        expenses: 'id, expenseDate, competenceMonth, competenceYear, categoryId, subcategoryId, status, classification, paymentDate, entryMode, recurring, frequency, priority',
        expenseItems: 'id, expenseId, categoryId, subcategoryId, classification',
        categories: 'id, name',
        suppliers: 'id, name',
        fixedExpenses: 'id, categoryId, subcategoryId, isEstimate, active, nextDueDate',
        fixedExpenseOccurrences: 'id, fixedExpenseId, competenceMonth, competenceYear, dueDate, status',
        savingPlans: 'id, status, targetDate',
        savingMovements: 'id, savingPlanId, date, type',
        projects: 'id, status, deadline',
        projectMovements: 'id, projectId, date, type',
        attachments: 'id, entityType, entityId, date',
        ocrProcesses: 'id, status, date',
        monthlyReports: 'id, [year+month], status',
        extraBudgetMovements: 'id, year, month, date, categoryId',
        auditLogs: 'id, entityType, entityId, timestamp, action',
      });
      dbV10.version(2).stores({
        ocrProcesses: 'id, status, date, ocrEngine, processingTimeMs, rawTextLength, lineCount',
        ocrReceiptLines: 'id, processId, lineIndex, confidence',
      });
      dbV10.version(4).stores({
        settings: 'key, updatedAt',
        monthlyReports: 'id, [year+month], year, month, status, updatedAt',
      });
      dbV10.version(5).stores({
        products: 'id, name, defaultCategoryId, defaultSubcategoryId, usageCount, lastUsedAt',
        productAliases: 'id, alias, productId, usageCount',
      });
      dbV10.version(6).stores({
        expenseItems: 'id, expenseId, categoryId, subcategoryId, classification, productId',
      });
      dbV10.version(7).stores({
        notifications: 'id, type, date, isRead, isArchived, [type+isRead]',
      });
      dbV10.version(8).stores({
        documentSessions: 'id, documentType, status, createdAt, updatedAt',
        documentPageSegments: 'id, sessionId, pageIndex, segmentIndex, status',
      });
      dbV10.version(9).stores({
        localLicenses: 'id, status, lastSuccessfulOnlineValidation, updatedAt',
      });
      dbV10.version(10).stores({
        paymentMethods: 'id, &code, macroCategory, isSystem, enabled',
        paymentEvidences: 'id, expenseId, documentType, paymentMethodId, dateTime, [expenseId+documentType]',
      });

      await dbV10.open();

      // 3. Verifiche di integrità post-migrazione v10
      expect(dbV10.verno).toBe(10);

      const restoredExpense = await dbV10.table('expenses').get('exp-migration-1');
      expect(restoredExpense).toBeDefined();
      expect(restoredExpense.description).toBe('Spesa Storica per Test Migrazione v9');
      expect(restoredExpense.amount).toBe(84.50);

      const restoredItem = await dbV10.table('expenseItems').get('item-migration-1');
      expect(restoredItem).toBeDefined();
      expect(restoredItem.description).toBe('Pasta e Salsa');

      const restoredIncome = await dbV10.table('incomeEntries').get('inc-migration-1');
      expect(restoredIncome).toBeDefined();
      expect(restoredIncome.amount).toBe(2200.00);

      const restoredAttachment = await dbV10.table('attachments').get('att-migration-1');
      expect(restoredAttachment).toBeDefined();
      expect(restoredAttachment.fileName).toBe('scontrino_marzo.jpg');

      const restoredSession = await dbV10.table('documentSessions').get('session-migration-1');
      expect(restoredSession).toBeDefined();
      expect(restoredSession.status).toBe('completed');

      const restoredOcr = await dbV10.table('ocrProcesses').get('ocr-proc-migration-1');
      expect(restoredOcr).toBeDefined();
      expect(restoredOcr.rawText).toBe('TOTALE 84.50');

      const restoredLicense = await dbV10.table('localLicenses').get('current');
      expect(restoredLicense).toBeDefined();
      expect(restoredLicense.status).toBe('active');

      // 4. Verifica funzionalità nuove tabelle v10
      const testPaymentMethod = {
        id: 'pm-test-mig-1',
        code: 'test_pay',
        displayName: 'Test Payment Post Migrazione',
        macroCategory: 'other' as const,
        isSystem: false,
        enabled: true,
        aliases: ['test'],
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
      await dbV10.table('paymentMethods').add(testPaymentMethod);

      const testEvidence = {
        id: 'pe-test-mig-1',
        expenseId: 'exp-migration-1',
        documentType: 'pos_receipt',
        paymentMethodId: 'pm-test-mig-1',
        amount: 84.50,
        userConfirmed: true,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
      await dbV10.table('paymentEvidences').add(testEvidence);

      const queriedMethods = await dbV10.table('paymentMethods').toArray();
      expect(queriedMethods.length).toBe(1);

      const queriedEvidences = await dbV10.table('paymentEvidences').where('expenseId').equals('exp-migration-1').toArray();
      expect(queriedEvidences.length).toBe(1);
      expect(queriedEvidences[0].amount).toBe(84.50);

      // Cleanup
      dbV10.close();
      await Dexie.delete(testDbName);
    });
  });

  describe('6. Retrocompatibilità Backup / Export / Import', () => {
    it('A. importa correttamente un backup legacy v9 privo delle tabelle paymentMethods/paymentEvidences', async () => {
      const now = new Date().toISOString();
      const legacyBackupPayload: Omit<BackupData, 'checksum'> = {
        appName: 'Gestione Casa',
        version: '1.0.0',
        schemaVersion: '2.0.0',
        databaseName: 'gestioneCasa',
        exportedAt: now,
        tables: {
          settings: [],
          contributors: [],
          incomeEntries: [],
          expenses: [
            {
              id: 'exp-legacy-1',
              entryMode: 'manual',
              description: 'Spesa Storica v9',
              amount: 50.00,
              expenseDate: '2026-01-15',
              competenceMonth: 1,
              competenceYear: 2026,
              categoryId: 'cat-food',
              subcategoryId: 'cat-food-supermarket',
              paymentMethod: 'cash',
              status: 'paid',
              classification: 'necessary',
              notified: false,
              metadata: { createdAt: now, updatedAt: now, version: 1 },
            },
          ],
          expenseItems: [],
          categories: [],
          suppliers: [],
          fixedExpenses: [],
          fixedExpenseOccurrences: [],
          savingPlans: [],
          savingMovements: [],
          projects: [],
          projectMovements: [],
          attachments: [],
          ocrProcesses: [],
          monthlyReports: [],
          extraBudgetMovements: [],
          auditLogs: [],
          // paymentMethods e paymentEvidences intenzionalmente OMESSI come in v9
        },
      };

      const payloadStr = JSON.stringify(legacyBackupPayload);
      const checksum = backupService.generateChecksum(payloadStr);
      const fullLegacyBackup: BackupData = {
        ...legacyBackupPayload,
        checksum,
      };

      const jsonStr = JSON.stringify(fullLegacyBackup, null, 2);
      const validation = backupService.validateBackup(jsonStr);
      expect(validation.isValid).toBe(true);
      expect(validation.data).toBeDefined();

      if (validation.data) {
        await backupService.importBackup(validation.data);
      }

      const expenses = await db.expenses.toArray();
      expect(expenses.length).toBe(1);
      expect(expenses[0].description).toBe('Spesa Storica v9');
      expect(expenses[0].paymentMethodId).toBeUndefined();

      const paymentMethods = await db.paymentMethods.toArray();
      expect(paymentMethods.length).toBe(0); // Nessun errore durante import da v9
    });

    it('B. esegue export e import roundtrip con schema v10 preservando paymentMethods e paymentEvidences', async () => {
      await seedInitialPaymentMethods();

      const customMethod = await paymentMethodRepository.create({
        code: 'satispay_pers',
        displayName: 'Satispay Privato',
        macroCategory: 'digitalWallet',
        isSystem: false,
        enabled: true,
        aliases: ['satispay'],
      });

      const evidence = await paymentEvidenceRepository.create({
        documentType: 'pos_receipt',
        paymentMethodId: customMethod.id,
        amount: 88.90,
        userConfirmed: true,
      });

      const exportedJson = await backupService.exportBackup();
      const validation = backupService.validateBackup(exportedJson);
      expect(validation.isValid).toBe(true);
      expect(validation.data).toBeDefined();

      const backupObj = validation.data!;
      expect(backupObj.tables.paymentMethods).toBeDefined();
      expect(backupObj.tables.paymentEvidences).toBeDefined();
      expect(backupObj.tables.paymentMethods?.length).toBe(9); // 8 system + 1 custom
      expect(backupObj.tables.paymentEvidences?.length).toBe(1);

      // Reset db e re-import
      await db.paymentMethods.clear();
      await db.paymentEvidences.clear();

      await backupService.importBackup(backupObj);

      const restoredMethods = await paymentMethodRepository.getAll();
      const restoredEvidences = await paymentEvidenceRepository.getAll();

      expect(restoredMethods.length).toBe(9);
      expect(restoredMethods.find((m) => m.code === 'satispay_pers')?.displayName).toBe('Satispay Privato');
      expect(restoredEvidences.length).toBe(1);
      expect(restoredEvidences[0].id).toBe(evidence.id);
      expect(restoredEvidences[0].amount).toBe(88.90);
    });

    it('C. verifica che il calcolo del checksum sia integro e coerente', async () => {
      const exportedJson = await backupService.exportBackup();
      const parsed = JSON.parse(exportedJson) as BackupData;
      const { checksum, ...payload } = parsed;

      const recomputed = backupService.generateChecksum(JSON.stringify(payload));
      expect(checksum).toBe(recomputed);
    });
  });
});
