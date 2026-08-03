import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  expenseRepository,
  auditLogRepository,
  reportRepository,
  ocrProcessRepository,
  attachmentRepository,
} from '../repositories';
import { lateExpenseService } from '../services/lateExpenseService';
import { deriveCompetenceFromDate } from '../utils/expenseCompetenceUtils';
import { reportService } from '../services/reportService';

describe('Gestione Spese OCR Tardive e Mesi Chiusi (TEST-LATE-OCR-EXPENSE)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST-OCR-001: Coerenza tra expenseDate, competenceMonth e competenceYear', () => {
    const period1 = deriveCompetenceFromDate('2025-12-31');
    expect(period1.competenceYear).toBe(2025);
    expect(period1.competenceMonth).toBe(12);

    const period2 = deriveCompetenceFromDate('2026-01-15T14:30:00Z');
    expect(period2.competenceYear).toBe(2026);
    expect(period2.competenceMonth).toBe(1);

    const period3 = deriveCompetenceFromDate('2026-05-04');
    expect(period3.competenceYear).toBe(2026);
    expect(period3.competenceMonth).toBe(5);
  });

  it('TEST-OCR-002: Registrazione spesa del mese corrente', async () => {
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;
    const expenseDateStr = `${curYear}-${String(curMonth).padStart(2, '0')}-05`;

    const res = await lateExpenseService.registerOcrExpense({
      description: 'Spesa alimentari mese corrente',
      amount: 45.50,
      expenseDate: expenseDateStr,
      categoryId: 'cat-supermarket',
      subcategoryId: 'sub-food',
      paymentMethod: 'debitCard',
    });

    expect(res.expense).toBeDefined();
    expect(res.expense.competenceYear).toBe(curYear);
    expect(res.expense.competenceMonth).toBe(curMonth);
    expect(res.expense.expenseDate).toBe(expenseDateStr);

    const auditLogs = await auditLogRepository.getByEntity('expense', res.expense.id);
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].newValues?.source).toBe('OCR');
  });

  it('TEST-OCR-003: Registrazione spesa del mese precedente ancora aperto', async () => {
    // Ipotizziamo che Maggio 2026 sia un mese non ancora chiuso con report in stato provisional
    await reportRepository.save({
      month: 5,
      year: 2026,
      status: 'provisional',
      totalIncome: 2000,
      paidExpenses: 300,
      plannedNotifiedExpenses: 0,
      savingPlanTotal: 0,
      projectQuotaTotal: 0,
      prudentialBalance: 1700,
      extraBudgetOpening: 0,
      extraBudgetUsed: 0,
      extraBudgetClosing: 0,
      uncoveredDeficit: 0,
      contributorSummaries: [],
      categorySummaries: [],
      classificationSummaries: { necessary: 300, voluntary: 0, toEvaluate: 0 },
      projectSummaries: [],
      generatedAt: new Date().toISOString(),
    });

    const res = await lateExpenseService.registerOcrExpense({
      description: 'Scontrino Maggio 2026',
      amount: 60.00,
      expenseDate: '2026-05-18',
      categoryId: 'cat-supermarket',
      subcategoryId: 'sub-food',
    });

    expect(res.expense.competenceYear).toBe(2026);
    expect(res.expense.competenceMonth).toBe(5);

    // Controlla il record spesa
    const expDb = await expenseRepository.getById(res.expense.id);
    expect(expDb?.amount).toBe(60.00);

    // Verifichiamo che l'audit log sia creato correttamente
    const auditLogs = await auditLogRepository.getByEntity('expense', res.expense.id);
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].newValues?.receiptDate).toBe('2026-05-18');
  });

  it('TEST-OCR-004: Registrazione spesa di un mese già chiuso (aggiorna snapshot storico senza riaprire la UI)', async () => {
    // 1. Inizializziamo un mese chiuso in precedenza (Aprile 2026) con uno snapshot iniziale
    const initialReport = await reportService.generateMonthlyReport(2026, 4, true);
    expect(initialReport.status).toBe('final');
    const initialPaidExpenses = initialReport.paidExpenses;

    // 2. Creazione allegato ed ocrProcess
    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'scontrino_vecchio_aprile.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 12000,
      storageKey: 'data:image/jpeg;base64,dummy',
      fileHash: 'hash-aprile-001',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: attachment.id,
      status: 'pending',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    // 3. Registrazione della spesa tardiva del 12 Aprile 2026
    const res = await lateExpenseService.registerOcrExpense({
      ocrProcessId: ocrProc.id,
      attachmentId: attachment.id,
      description: 'Farmacia scontrino Aprile tardivo',
      amount: 35.00,
      expenseDate: '2026-04-12',
      categoryId: 'cat-health',
      subcategoryId: 'sub-pharmacy',
      acquisitionDate: '2026-08-01T10:00:00Z',
    });

    expect(res.isLateRegistration).toBe(true);
    expect(res.reportUpdated).toBe(true);

    // 4. Verifichiamo che il report mensile di Aprile 2026 sia ancora 'final'
    const updatedReport = await reportRepository.getByMonthYear(2026, 4);
    expect(updatedReport).toBeDefined();
    expect(updatedReport?.status).toBe('final');

    // 5. Verifichiamo che i totali dello snapshot di Aprile siano stati aggiornati con i 35€ aggiuntivi
    expect(updatedReport?.paidExpenses).toBe(initialPaidExpenses + 35.00);

    // 6. Verifichiamo il log di audit
    const auditLogs = await auditLogRepository.getByEntity('expense', res.expense.id);
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].newValues?.isLateRegistration).toBe(true);
    expect(auditLogs[0].newValues?.receiptDate).toBe('2026-04-12');
    expect(auditLogs[0].newValues?.ocrProcessId).toBe(ocrProc.id);

    // 7. Verifica aggiornamento stato OCRProcess
    const updatedOcr = await ocrProcessRepository.getById(ocrProc.id);
    expect(updatedOcr?.status).toBe('completed');
    expect(updatedOcr?.confirmedByUser).toBe(true);
  });

  it('TEST-OCR-005: Impedisce il doppio salvataggio dello stesso scontrino OCR (idempotenza)', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-123',
      status: 'pending',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    // Primo salvataggio
    const res1 = await lateExpenseService.registerOcrExpense({
      ocrProcessId: ocrProc.id,
      description: 'Ristorante Pizzeria',
      amount: 40.00,
      expenseDate: '2026-08-01',
      categoryId: 'cat-food',
      subcategoryId: 'sub-restaurant',
    });
    expect(res1.expense.id).toBeDefined();

    // Secondo salvataggio con lo stesso ocrProcessId -> deve sollevare errore
    await expect(
      lateExpenseService.registerOcrExpense({
        ocrProcessId: ocrProc.id,
        description: 'Ristorante Pizzeria',
        amount: 40.00,
        expenseDate: '2026-08-01',
        categoryId: 'cat-food',
        subcategoryId: 'sub-restaurant',
      })
    ).rejects.toThrow('Spesa già contabilizzata per questo scontrino');

    // Verifica che nel DB sia rimasta 1 sola spesa
    const allExpenses = await expenseRepository.getAll();
    const matching = allExpenses.filter((e) => (e.metadata as any)?.ocrProcessId === ocrProc.id);
    expect(matching.length).toBe(1);
  });
});
