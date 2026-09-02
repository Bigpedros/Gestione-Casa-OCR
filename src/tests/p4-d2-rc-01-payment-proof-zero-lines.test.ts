import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../database/db';
import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
  documentSessionRepository,
} from '../repositories';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { productClassificationService } from '../services/productClassification/ProductClassificationService';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

const REAL_POS_TEXT = `BANCOMAT C-LESS
ACQUISTO
EUROSPIN
MARINO
DATA 30/07/26 ORA 12:44
14,46 ER
Transazione eseguita
Eser. 486424400004
A.T.I.C. 00000033155
TML 38054463 STAN 001349
AUT. 703161 OPER. 001601
APPL PagoBANCOMAT
Grazie e arrivederci
NEXI`;

const COMMERCIAL_RECEIPT_TEXT = `CONAD NORD OVEST S.R.L.
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE PREZZO
PANE CASERECCIO 1,50
LATTE INTERO 1L 1,80
PASTA BARILLA 500G 1,10
TOTALE COMPLESSIVO 4,40
DI CUI IVA 0,40
PAGAMENTO CONTANTI
RT 12345678`;

const INVOICE_TEXT = `FATTURA N. 102/2026
EMESSA DA: STUDIO TECNICO BIANCHI
P.IVA 09876543211
DATA: 15/08/2026
CONSULENZA TECNICA SPECIALISTICA 150,00
TOTALE FATTURA 150,00`;

describe('FASE P4-D2-RC-01: PAYMENT_PROOF senza righe articolo sintetiche', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-26T10:00:00.000Z'));

    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TEST 1 — Il testo POS reale viene classificato come PAYMENT_PROOF', () => {
    const draft = receiptParserService.parseText(REAL_POS_TEXT);
    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
  });

  it('TEST 2 — La data resta 2026-07-30', () => {
    const draft = receiptParserService.parseText(REAL_POS_TEXT);
    expect(draft.date.value).toBe('2026-07-30');
  });

  it('TEST 3 — Il totale resta 14.46', () => {
    const draft = receiptParserService.parseText(REAL_POS_TEXT);
    expect(draft.total.value).toBe(14.46);
  });

  it('TEST 4 — paymentMethod.value resta debitCard', () => {
    const draft = receiptParserService.parseText(REAL_POS_TEXT);
    expect(draft.paymentMethod.value).toBe('debitCard');
  });

  it('TEST 5 — La riga monetaria "14,46 ER" non compare in draft.lines', () => {
    const draft = receiptParserService.parseText(REAL_POS_TEXT);
    const foundLine = draft.lines.find(
      (l) => l.originalText.includes('14,46') || l.normalizedDescription.includes('14,46')
    );
    expect(foundLine).toBeUndefined();
  });

  it('TEST 6 — Per PAYMENT_PROOF, draft.lines è esattamente un array vuoto', () => {
    const draft = receiptParserService.parseText(REAL_POS_TEXT);
    expect(draft.lines).toEqual([]);
    expect(draft.lines.length).toBe(0);
  });

  it('TEST 7 — Dopo parse(), nel database esistono zero ocrReceiptLines per quel processo OCR', async () => {
    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-rc01',
      status: 'pending',
      rawText: REAL_POS_TEXT,
      confidence: 88,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const draft = await receiptParserService.parse(proc.id);
    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.lines.length).toBe(0);

    const dbLines = await ocrReceiptLineRepository.getByOcrProcessId(proc.id);
    expect(dbLines).toHaveLength(0);
    expect(dbLines).toEqual([]);
  });

  it('TEST 8 — La persistenza conserva metadata.documentCategory, metadata.detectedPaymentMethod e normalizedLines', async () => {
    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-rc01-meta',
      status: 'pending',
      rawText: REAL_POS_TEXT,
      confidence: 90,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await db.ocrProcesses.update(proc.id, {
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        customExistingField: 'preserved_value',
        ocrQualityScore: 85,
      } as any,
    });

    await receiptParserService.parse(proc.id);

    const freshProc = await ocrProcessRepository.getById(proc.id);
    expect(freshProc).not.toBeNull();
    const meta = freshProc!.metadata as any;
    expect(meta.documentCategory).toBe('PAYMENT_PROOF');
    expect(meta.detectedPaymentMethod).toBe('debitCard');
    expect(Array.isArray(meta.normalizedLines)).toBe(true);
    expect(meta.normalizedLines.length).toBeGreaterThan(0);
    expect(meta.customExistingField).toBe('preserved_value');
    expect(meta.ocrQualityScore).toBe(85);
  });

  it('TEST 9 — Il parsing ripetuto dello stesso PAYMENT_PROOF continua a lasciare zero righe e non crea duplicati', async () => {
    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-rc01-repeat',
      status: 'pending',
      rawText: REAL_POS_TEXT,
      confidence: 89,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    // Primo parse
    const draft1 = await receiptParserService.parse(proc.id);
    expect(draft1.lines).toHaveLength(0);
    const dbLinesAfterFirst = await ocrReceiptLineRepository.getByOcrProcessId(proc.id);
    expect(dbLinesAfterFirst).toHaveLength(0);

    // Secondo parse sullo stesso id
    const draft2 = await receiptParserService.parse(proc.id);
    expect(draft2.lines).toHaveLength(0);
    const dbLinesAfterSecond = await ocrReceiptLineRepository.getByOcrProcessId(proc.id);
    expect(dbLinesAfterSecond).toHaveLength(0);
  });

  it('TEST 10 — Un normale COMMERCIAL_RECEIPT continua a produrre le proprie righe articolo: nessuna regressione', () => {
    const draft = receiptParserService.parseText(COMMERCIAL_RECEIPT_TEXT);
    expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');
    expect(draft.lines.length).toBeGreaterThan(0);
    expect(draft.lines.some((l) => l.normalizedDescription.includes('PANE'))).toBe(true);
    expect(draft.lines.some((l) => l.normalizedDescription.includes('LATTE'))).toBe(true);
    expect(draft.lines.some((l) => l.normalizedDescription.includes('PASTA'))).toBe(true);
  });

  it('TEST 11 — La registrazione contabile di PAYMENT_PROOF continua a riuscire senza righe e senza decisioni', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-rc01-reg',
      status: 'pending',
      rawText: REAL_POS_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      pageCount: 1,
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
      metadata: {
        title: 'Ricevuta POS Eurospin Marino',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    });

    // Parsing reale attraverso il service
    const draft = await receiptParserService.parse(ocrProc.id);
    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.lines).toHaveLength(0);

    // Verifichiamo OCRProcess in DB
    const freshProc = await ocrProcessRepository.getById(ocrProc.id);
    expect(freshProc!.confirmedByUser).toBe(false);
    expect((freshProc!.metadata as any)?.documentCategory).toBe('PAYMENT_PROOF');

    // Verifichiamo che non ci siano righe nel DB prima della registrazione
    const linesInDb = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(linesInDb).toHaveLength(0);

    // Registrazione contabile: per PAYMENT_PROOF riesce con 0 righe e 0 decisioni
    const expense = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      supplierName: 'EUROSPIN MARINO',
      expenseDate: '2026-07-30',
      documentTotal: 14.46,
    });

    expect(expense).toBeDefined();
    expect(expense.id).toBeTruthy();
    expect(expense.amount).toBe(14.46);

    const expenseInDb = await db.expenses.get(expense.id);
    expect(expenseInDb).toBeDefined();
    expect(expenseInDb?.amount).toBe(14.46);
  });

  it('TEST 12 — Un documento non PAYMENT_PROOF non viene svuotato indiscriminatamente e mantiene il comportamento precedente', () => {
    const commercialDraft = receiptParserService.parseText(COMMERCIAL_RECEIPT_TEXT);
    expect(commercialDraft.documentCategory).toBe('COMMERCIAL_RECEIPT');
    expect(commercialDraft.lines.length).toBeGreaterThan(0);

    const invoiceDraft = receiptParserService.parseText(INVOICE_TEXT);
    expect(invoiceDraft.documentCategory).toBe('INVOICE_OR_BILL');
    expect(invoiceDraft.lines.length).toBeGreaterThan(0);
  });
});
