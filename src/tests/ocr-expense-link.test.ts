import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
  categoryRepository,
  documentSessionRepository,
  expenseRepository,
  productRepository,
} from '../repositories';
import { productClassificationService } from '../services/productClassification';
import { budgetService } from '../services/budgetService';
import { reportService } from '../services/reportService';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('Punto 12 — Collegamento Definitivo dello Scontrino alle Uscite (TEST-OCR-EXPENSE-LINK)', () => {
  beforeEach(async () => {
    // Reset database per test isolati
    await db.products.clear();
    await db.productAliases.clear();
    await db.suppliers.clear();
    await db.ocrProcesses.clear();
    await db.ocrReceiptLines.clear();
    await db.expenses.clear();
    await db.expenseItems.clear();
    await db.documentSessions.clear();
    await db.auditLogs.clear();
    await db.incomeEntries.clear();

    await seedInitialCategoriesAndSettings();
  });

  it('1. Una sola Expense per DocumentSession e OCRProcess (Idempotenza & Anti-duplicazione)', async () => {
    const session = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-idemp-1',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: 'SUPERMERCATO CONAD',
      detectedTotal: 25.50,
      detectedDate: '2026-03-10',
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE BIANCO 2.50',
      description: 'PANE BIANCO',
      quantity: 1,
      unitPrice: 2.50,
      lineTotal: 2.50,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    // Prima esecuzione
    const exp1 = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      expenseDate: '2026-03-10',
      documentTotal: 2.50,
    });

    // Seconda esecuzione (idempotente)
    const exp2 = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      expenseDate: '2026-03-10',
      documentTotal: 2.50,
    });

    expect(exp1.id).toBe(exp2.id);

    const totalExpensesInDb = await db.expenses.toArray();
    expect(totalExpensesInDb.length).toBe(1);
  });

  it('2. Corretta valorizzazione di competenceYear e competenceMonth', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-2',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedDate: '2026-08-15',
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ARTICOLO 10.00',
      description: 'ARTICOLO',
      quantity: 1,
      unitPrice: 10.0,
      lineTotal: 10.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-08-15',
      documentTotal: 10.0,
    });

    expect(exp.competenceYear).toBe(2026);
    expect(exp.competenceMonth).toBe(8);
  });

  it('3. Corretta valorizzazione dello stato iniziale (paid)', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-3',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ARTICOLO 12.00',
      description: 'ARTICOLO',
      quantity: 1,
      unitPrice: 12.0,
      lineTotal: 12.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-12',
      documentTotal: 12.0,
    });

    expect(exp.status).toBe('paid');
    expect(exp.entryMode).toBe('receipt');
  });

  it('4. Corretta gestione di paymentDate', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-4',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ARTICOLO 15.00',
      description: 'ARTICOLO',
      quantity: 1,
      unitPrice: 15.0,
      lineTotal: 15.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-04-20',
      documentTotal: 15.0,
    });

    expect(exp.paymentDate).toBe('2026-04-20');
  });

  it('5. Corretta categoria e sottocategoria dell Uscita', async () => {
    const categories = await categoryRepository.getAll();
    const foodCat = categories.find((c) => c.code === 'CAT_FOOD') || categories[0];

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-5',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'FRUTTA 5.00',
      description: 'FRUTTA',
      quantity: 1,
      unitPrice: 5.0,
      lineTotal: 5.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      categoryId: foodCat.id,
      expenseDate: '2026-03-01',
      documentTotal: 5.0,
    });

    expect(exp.categoryId).toBe(foodCat.id);
  });

  it('6. Categorie e sottocategorie distinte sulle singole ExpenseItem', async () => {
    const categories = await categoryRepository.getAll();
    const cat1 = categories[0];
    const cat2 = categories[1] || categories[0];

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-6',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    const line1 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'CIBO 10.00',
      description: 'CIBO',
      quantity: 1,
      unitPrice: 10.0,
      lineTotal: 10.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const line2 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'DETERGENTE 5.00',
      description: 'DETERGENTE',
      quantity: 1,
      unitPrice: 5.0,
      lineTotal: 5.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-01',
      documentTotal: 15.0,
      decisions: [
        {
          lineId: line1.id,
          originalText: 'CIBO 10.00',
          description: 'CIBO',
          quantity: 1,
          unitPrice: 10.0,
          lineTotal: 10.0,
          action: 'unlinked',
          categoryId: cat1.id,
        },
        {
          lineId: line2.id,
          originalText: 'DETERGENTE 5.00',
          description: 'DETERGENTE',
          quantity: 1,
          unitPrice: 5.0,
          lineTotal: 5.0,
          action: 'unlinked',
          categoryId: cat2.id,
        },
      ],
    });

    const items = await db.expenseItems.where('expenseId').equals(exp.id).toArray();
    expect(items.length).toBe(2);

    const item1 = items.find((i) => i.description === 'CIBO');
    const item2 = items.find((i) => i.description === 'DETERGENTE');

    expect(item1?.categoryId).toBe(cat1.id);
    expect(item2?.categoryId).toBe(cat2.id);
  });

  it('7. Importo Expense uguale al totale confermato dello scontrino', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-7',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PRODOTTO 42.99',
      description: 'PRODOTTO',
      quantity: 1,
      unitPrice: 42.99,
      lineTotal: 42.99,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      documentTotal: 42.99,
      expenseDate: '2026-03-01',
    });

    expect(exp.amount).toBe(42.99);
  });

  it('8. Le ExpenseItem non vengono conteggiate come Uscite autonome nei KPI e nei totali', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-8',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ITEM 1 10.00',
      description: 'ITEM 1',
      quantity: 1,
      unitPrice: 10.0,
      lineTotal: 10.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ITEM 2 20.00',
      description: 'ITEM 2',
      quantity: 1,
      unitPrice: 20.0,
      lineTotal: 20.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      documentTotal: 30.0,
      expenseDate: '2026-03-10',
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 3);
    // Totale spese deve essere esattamente 30.0, non 30 + 10 + 20 = 60!
    expect(summary.totalExpenses).toBe(30.0);
  });

  it('9. Comparsa della Expense nei dati usati dalla pagina Uscite', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-9',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'CIBO 18.50',
      description: 'CIBO',
      quantity: 1,
      unitPrice: 18.5,
      lineTotal: 18.5,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const created = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-05',
      documentTotal: 18.5,
    });

    const expensesForMonth = await expenseRepository.getByMonthYear(2026, 3);
    expect(expensesForMonth.some((e) => e.id === created.id)).toBe(true);
  });

  it('10. Aggiornamento del totale mensile delle Uscite via budgetService', async () => {
    const initialSummary = await budgetService.calculateMonthlySummary(2026, 3);
    expect(initialSummary.totalExpenses).toBe(0);

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-10',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'CIBO 50.00',
      description: 'CIBO',
      quantity: 1,
      unitPrice: 50.0,
      lineTotal: 50.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-02',
      documentTotal: 50.0,
    });

    const updatedSummary = await budgetService.calculateMonthlySummary(2026, 3);
    expect(updatedSummary.totalExpenses).toBe(50.0);
    expect(updatedSummary.paidExpenses).toBe(50.0);
  });

  it('11. Aggiornamento del bilancio Home tramite budgetService', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-11',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'SPESA 100.00',
      description: 'SPESA',
      quantity: 1,
      unitPrice: 100.0,
      lineTotal: 100.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-15',
      documentTotal: 100.0,
    });

    const homeSummary = await budgetService.calculateMonthlySummary(2026, 3);
    expect(homeSummary.totalExpenses).toBe(100.0);
    expect(homeSummary.prudentialBalance).toBe(-100.0);
  });

  it('12. Aggiornamento del budget disponibile via budgetService', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-12',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'BENZINA 40.00',
      description: 'BENZINA',
      quantity: 1,
      unitPrice: 40.0,
      lineTotal: 40.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-20',
      documentTotal: 40.0,
    });

    const periodSummary = await budgetService.calculatePeriodSummary(2026, 3, 2026, 3);
    expect(periodSummary.totalExpenses).toBe(40.0);
    expect(periodSummary.paidExpenses).toBe(40.0);
  });

  it('13. Aggiornamento del Report mensile via reportService', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-13',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ALIMENTARI 75.00',
      description: 'ALIMENTARI',
      quantity: 1,
      unitPrice: 75.0,
      lineTotal: 75.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-22',
      documentTotal: 75.0,
    });

    const report = await reportService.generateMonthlyReport(2026, 3);
    expect(report.paidExpenses).toBe(75.0);
  });

  it('14. Nessun doppio conteggio dei totali', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-14',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE 3.00',
      description: 'PANE',
      quantity: 1,
      unitPrice: 3.0,
      lineTotal: 3.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-10',
      documentTotal: 3.0,
    });

    const summary1 = await budgetService.calculateMonthlySummary(2026, 3);
    const summary2 = await budgetService.calculateMonthlySummary(2026, 3);

    expect(summary1.totalExpenses).toBe(3.0);
    expect(summary2.totalExpenses).toBe(3.0);
  });

  it('15. Blocco in caso di discrepanza non approvata tra totale scontrino e somma righe', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-15',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'RIGA 1 20.00',
      description: 'RIGA 1',
      quantity: 1,
      unitPrice: 20.0,
      lineTotal: 20.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    // Totale scontrino = 30.00, somma righe = 20.00, allowDiscrepancy non passato (false)
    await expect(
      productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        expenseDate: '2026-03-01',
        documentTotal: 30.0,
        allowDiscrepancy: false,
      })
    ).rejects.toThrow(/Discrepanza/);
  });

  it('16. Approvazione esplicita della discrepanza', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-16',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'RIGA 1 20.00',
      description: 'RIGA 1',
      quantity: 1,
      unitPrice: 20.0,
      lineTotal: 20.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    // Totale scontrino = 30.00, somma righe = 20.00, allowDiscrepancy: true
    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-01',
      documentTotal: 30.0,
      allowDiscrepancy: true,
    });

    expect(exp.amount).toBe(30.0);
  });

  it('17. Nessun AuditLog duplicato su esecuzioni ripetute', async () => {
    const session = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-17',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ARTICOLO 10.00',
      description: 'ARTICOLO',
      quantity: 1,
      unitPrice: 10.0,
      lineTotal: 10.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      expenseDate: '2026-03-01',
      documentTotal: 10.0,
    });

    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      expenseDate: '2026-03-01',
      documentTotal: 10.0,
    });

    const logs = await db.auditLogs.filter((l) => l.entityType === 'expense').toArray();
    expect(logs.length).toBe(1);
  });

  it('18. Collegamento bidirezionale tra Expense, DocumentSession, OCRProcess e AuditLog', async () => {
    const session = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-18',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'SPESA 15.00',
      description: 'SPESA',
      quantity: 1,
      unitPrice: 15.0,
      lineTotal: 15.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      expenseDate: '2026-03-10',
      documentTotal: 15.0,
    });

    const updatedSession = await documentSessionRepository.getById(session.id);
    const updatedProc = await ocrProcessRepository.getById(ocrProc.id);

    expect(updatedSession?.expenseId).toBe(exp.id);
    expect(updatedProc?.expenseId).toBe(exp.id);
    expect((exp.metadata as any)?.documentSessionId).toBe(session.id);
    expect((exp.metadata as any)?.ocrProcessId).toBe(ocrProc.id);
  });

  it('19. Integrità dei prodotti e alias associati durante la creazione dell Uscita', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-19',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'NUOVO SNACK GOURMET 2.50',
      description: 'NUOVO SNACK GOURMET',
      quantity: 1,
      unitPrice: 2.5,
      lineTotal: 2.5,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      expenseDate: '2026-03-10',
      documentTotal: 2.5,
      decisions: [
        {
          lineId: line.id,
          originalText: 'NUOVO SNACK GOURMET 2.50',
          description: 'NUOVO SNACK GOURMET',
          quantity: 1,
          unitPrice: 2.5,
          lineTotal: 2.5,
          action: 'create_new',
          newProductDetails: {
            displayName: 'Snack Gourmet Classico 50g',
          },
        },
      ],
    });

    const items = await db.expenseItems.where('expenseId').equals(exp.id).toArray();
    expect(items.length).toBe(1);
    expect(items[0].productId).not.toBeNull();

    const createdProd = await productRepository.getById(items[0].productId!);
    expect(createdProd?.displayName).toBe('Snack Gourmet Classico 50g');
  });

  it('20. Gestione atomica con Rollback in caso di errore simulato', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-20',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PRODOTTO ERRATO 10.00',
      description: 'PRODOTTO ERRATO',
      quantity: 1,
      unitPrice: 10.0,
      lineTotal: 10.0,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    // Simulazione errore passando un ID processo inesistente
    await expect(
      productClassificationService.createAccountingRegistration({
        ocrProcessId: 'non-existent-id',
        expenseDate: '2026-03-10',
        documentTotal: 10.0,
      })
    ).rejects.toThrow();

    // Verifichiamo che nessuna spesa o elemento sia stato creato nel DB
    const expenses = await db.expenses.toArray();
    const items = await db.expenseItems.toArray();
    expect(expenses.length).toBe(0);
    expect(items.length).toBe(0);
  });
});
