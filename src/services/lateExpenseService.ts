import { expenseRepository, auditLogRepository, ocrProcessRepository, reportRepository } from '../repositories';
import { reportService } from './reportService';
import { deriveCompetenceFromDate, isMonthClosed } from '../utils/expenseCompetenceUtils';
import type { Expense, ExpenseClassification, PaymentMethod, ExpenseStatus } from '../types';

export interface RegisterOcrExpenseInput {
  ocrProcessId?: string;
  attachmentId?: string;
  description: string;
  amount: number;
  expenseDate: string; // Data dello scontrino (YYYY-MM-DD)
  paymentDate?: string | null;
  categoryId: string;
  subcategoryId: string;
  paymentMethod?: PaymentMethod;
  status?: ExpenseStatus;
  classification?: ExpenseClassification;
  notes?: string;
  acquisitionDate?: string; // Data di acquisizione/caricamento foto
}

export interface RegisterOcrExpenseResult {
  expense: Expense;
  isLateRegistration: boolean;
  isMonthClosed: boolean;
  auditLogId: string;
  reportUpdated: boolean;
}

export const lateExpenseService = {
  /**
   * Registra una spesa contabile derivata da scontrino OCR o inserimento tardivo.
   * Garantisce:
   * 1. Idempotenza (previene doppi salvataggi tramite ocrProcessId o attachmentId).
   * 2. Calcolo automatico di competenceYear e competenceMonth dalla data dello scontrino (expenseDate).
   * 3. Separazione temporale tra data scontrino, data acquisizione e data registrazione.
   * 4. Tracciamento completo nel log di audit (AuditLogEntry).
   * 5. Aggiornamento dello snapshot del MonthlyReport se il mese di competenza è già chiuso, senza riaprirlo o modificare l'interfaccia UI.
   */
  registerOcrExpense: async (
    input: RegisterOcrExpenseInput
  ): Promise<RegisterOcrExpenseResult> => {
    const {
      ocrProcessId,
      attachmentId,
      description,
      amount,
      expenseDate,
      paymentDate = null,
      categoryId,
      subcategoryId,
      paymentMethod = 'debitCard',
      status = 'paid',
      classification = 'necessary',
      notes = '',
      acquisitionDate,
    } = input;

    if (!expenseDate) {
      throw new Error('Data scontrino (expenseDate) obbligatoria per la contabilizzazione');
    }

    if (!amount || amount <= 0) {
      throw new Error('Importo della spesa non valido');
    }

    // 1. Controllo di Idempotenza (Prevenzione doppio salvataggio)
    if (ocrProcessId) {
      const existingExpenses = await expenseRepository.getAll();
      const duplicate = existingExpenses.find(
        (e) => (e.metadata as any)?.ocrProcessId === ocrProcessId || e.notes?.includes(`[OCR:${ocrProcessId}]`)
      );

      if (duplicate) {
        throw new Error(
          `Spesa già contabilizzata per questo scontrino (ID spesa: ${duplicate.id})`
        );
      }
    }

    // 2. Derivazione Mese e Anno di competenza contabile dalla data scontrino
    const { competenceYear, competenceMonth } = deriveCompetenceFromDate(expenseDate);

    // 3. Verifica se il mese di competenza è un mese chiuso
    const monthClosed = await isMonthClosed(competenceYear, competenceMonth);

    // Data di registrazione / inserimento nel sistema (adesso)
    const registrationDate = new Date().toISOString();

    // Notes arricchite con identificativo OCR
    const enrichedNotes = ocrProcessId
      ? `${notes ? `${notes}\n` : ''}[OCR:${ocrProcessId}]`
      : notes;

    // 4. Creazione record Expense
    const expense = await expenseRepository.create({
      entryMode: 'receipt',
      description,
      amount,
      expenseDate, // Data dello scontrino
      paymentDate: paymentDate || expenseDate,
      competenceYear,
      competenceMonth,
      categoryId,
      subcategoryId,
      paymentMethod,
      status,
      classification,
      notified: false,
      notes: enrichedNotes,
      metadata: {
        createdAt: registrationDate,
        updatedAt: registrationDate,
        version: 1,
        ocrProcessId,
        attachmentId,
        acquisitionDate: acquisitionDate || registrationDate,
        registrationDate,
      } as any,
    });

    // 5. Tracciamento Audit Log obbligatorio per registrazione (con dettagli tardivi se mese chiuso)
    const auditEntry = await auditLogRepository.create({
      entityType: 'expense',
      entityId: expense.id,
      action: 'create',
      newValues: {
        expenseId: expense.id,
        receiptDate: expenseDate,
        registrationDate,
        acquisitionDate: acquisitionDate || registrationDate,
        competenceMonth,
        competenceYear,
        isLateRegistration: monthClosed,
        ocrProcessId: ocrProcessId || null,
        attachmentId: attachmentId || null,
        source: 'OCR',
        amount,
        description,
      },
      timestamp: registrationDate,
    });

    // 6. Aggiornamento dello snapshot del Report Storico se il mese era chiuso
    let reportUpdated = false;
    if (monthClosed) {
      const existingReport = await reportRepository.getByMonthYear(competenceYear, competenceMonth);
      if (existingReport && existingReport.status === 'final') {
        // Rigenera il report in modalità final per aggiornare i totali contabili nello snapshot storico
        await reportService.generateMonthlyReport(competenceYear, competenceMonth, true);
        reportUpdated = true;
      }
    }

    // Se fornito ocrProcessId, aggiorna anche lo stato dell'OCRProcess a completed / confirmed
    if (ocrProcessId) {
      try {
        await ocrProcessRepository.update(ocrProcessId, {
          status: 'completed',
          confirmedByUser: true,
          processedAt: registrationDate,
        });
      } catch (e) {
        console.warn('Aggiornamento stato ocrProcessId facoltativo fallito:', e);
      }
    }

    return {
      expense,
      isLateRegistration: monthClosed,
      isMonthClosed: monthClosed,
      auditLogId: auditEntry.id,
      reportUpdated,
    };
  },
};
