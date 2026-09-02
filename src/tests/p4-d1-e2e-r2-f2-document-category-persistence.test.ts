import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  ocrProcessRepository,
  documentSessionRepository,
  ocrReceiptLineRepository,
} from '../repositories';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { productClassificationService } from '../services/productClassification';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('FASE P4-D1-E2E-R2-F2 — Persistenza DocumentCategory OCRProcess', () => {
  const POS_RAW_TEXT = `BAR SPORT SNC
VIA ROMA 1, MILANO
RICEVUTA POS - MEMORIA CLIENTE
TID: 88776655
STAN: 123456
DATA: 28/08/2026 10:15
IMPORTO: €15,50
CARTA: **** **** **** 1234
CIRCUITO: MASTERCARD
TRANSAZIONE ESEGUITA
COPIA CLIENTE`;

  const COMMERCIAL_RAW_TEXT = `CONAD NORD OVEST S.R.L.
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE PREZZO
PANE INTEGRALE 1.80
LATTE INTERO 1.50
TOTALE COMPLESSIVO 3.30
DI CUI IVA 0.40
PAGAMENTO CONTANTI 3.30
RT 12345678`;

  const INVOICE_RAW_TEXT = `ENEL ENERGIA S.P.A.
FATTURA PER LA FORNITURA DI ENERGIA ELETTRICA
NUMERO FATTURA: 2026/00123
DATA EMISSIONE: 10/01/2026
TOTALE DA PAGARE: EUR 120.00
SCADENZA: 28/02/2026
C.F. / P.IVA: 00934061003`;

  const UNKNOWN_RAW_TEXT = `testo casuale senza contesto
alcun elemento riconoscibile
123456789`;

  beforeEach(async () => {
    await db.products.clear();
    await db.productAliases.clear();
    await db.suppliers.clear();
    await db.ocrProcesses.clear();
    await db.ocrReceiptLines.clear();
    await db.documentSessions.clear();
    await db.expenses.clear();
    await db.expenseItems.clear();

    await seedInitialCategoriesAndSettings();
  });

  it('TEST 1 — DRAFT PAYMENT_PROOF: un testo POS produce draft.documentCategory === PAYMENT_PROOF', () => {
    const draft = receiptParserService.parseText(POS_RAW_TEXT);
    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
  });

  it('TEST 2 — DRAFT COMMERCIAL_RECEIPT: uno scontrino commerciale produce draft.documentCategory === COMMERCIAL_RECEIPT', () => {
    const draft = receiptParserService.parseText(COMMERCIAL_RAW_TEXT);
    expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');
  });

  it('TEST 3 — DRAFT INVOICE_OR_BILL: una fattura o bolletta produce draft.documentCategory === INVOICE_OR_BILL', () => {
    const draft = receiptParserService.parseText(INVOICE_RAW_TEXT);
    expect(draft.documentCategory).toBe('INVOICE_OR_BILL');
  });

  it('TEST 4 — DRAFT UNKNOWN: un testo privo di evidenze sufficienti produce draft.documentCategory === UNKNOWN', () => {
    const draft = receiptParserService.parseText(UNKNOWN_RAW_TEXT);
    expect(draft.documentCategory).toBe('UNKNOWN');
  });

  it('TEST 5 — PERSISTENZA PAYMENT_PROOF: parse(ocrProcessId) persiste metadata.documentCategory === PAYMENT_PROOF nel database', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-pos-1',
      status: 'pending',
      rawText: POS_RAW_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const draft = await receiptParserService.parse(created.id);
    expect(draft.documentCategory).toBe('PAYMENT_PROOF');

    const inDb = await ocrProcessRepository.getById(created.id);
    expect(inDb).not.toBeNull();
    const meta = inDb!.metadata as Record<string, any>;
    expect(meta.documentCategory).toBe('PAYMENT_PROOF');
  });

  it('TEST 6 — PRESERVAZIONE METADATA F1: preserva selectedVariant, variantScores, customMarker e incrementa version', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-pos-f1',
      status: 'pending',
      rawText: POS_RAW_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const initialDate = '2026-01-01T00:00:00.000Z';
    await db.ocrProcesses.update(created.id, {
      metadata: {
        createdAt: initialDate,
        updatedAt: initialDate,
        version: 2,
        selectedVariant: 'sharpened_high_contrast',
        variantScores: { original: 45, sharpened_high_contrast: 88 },
        customMarker: 'marker_f1_test',
      } as any,
    });

    await receiptParserService.parse(created.id);

    const saved = await ocrProcessRepository.getById(created.id);
    expect(saved).not.toBeNull();
    const meta = saved!.metadata as Record<string, any>;

    expect(meta.documentCategory).toBe('PAYMENT_PROOF');
    expect(meta.selectedVariant).toBe('sharpened_high_contrast');
    expect(meta.variantScores).toEqual({ original: 45, sharpened_high_contrast: 88 });
    expect(meta.customMarker).toBe('marker_f1_test');
    expect(meta.version).toBe(3);
    expect(meta.updatedAt).not.toBe(initialDate);
  });

  it('TEST 7 — PERSISTENZA COMMERCIAL_RECEIPT: parse() su scontrino commerciale scrive metadata.documentCategory === COMMERCIAL_RECEIPT in DB', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-comm-1',
      status: 'pending',
      rawText: COMMERCIAL_RAW_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const draft = await receiptParserService.parse(created.id);
    expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');

    const inDb = await ocrProcessRepository.getById(created.id);
    expect(inDb).not.toBeNull();
    const meta = inDb!.metadata as Record<string, any>;
    expect(meta.documentCategory).toBe('COMMERCIAL_RECEIPT');
  });

  it('TEST 8 — PAYMENT_PROOF SENZA CATEGORIA NELLA SESSIONE: fallback su metadata.documentCategory permette registrazione contabile senza righe', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-session',
      status: 'pending',
      rawText: POS_RAW_TEXT,
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
      // Nessun detectedDocumentCategory nella sessione
      metadata: { title: 'Sessione POS senza categoria', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });

    // Eseguiamo il parsing reale
    await receiptParserService.parse(ocrProc.id);

    // Come specificato nei requisiti: zero ocrReceiptLines per PAYMENT_PROOF
    await ocrReceiptLineRepository.deleteUnconfirmedByOcrProcessId(ocrProc.id);

    // Verifichiamo che la sessione non contenga detectedDocumentCategory
    const freshSession = await documentSessionRepository.getById(session.id);
    expect(freshSession?.detectedDocumentCategory).toBeUndefined();

    // Verifichiamo che OCRProcess abbia confirmedByUser === false e metadata.documentCategory === PAYMENT_PROOF
    const freshProc = await ocrProcessRepository.getById(ocrProc.id);
    expect(freshProc).not.toBeNull();
    expect(freshProc!.confirmedByUser).toBe(false);
    expect((freshProc?.metadata as any)?.documentCategory).toBe('PAYMENT_PROOF');

    // Verifichiamo zero righe articolo prima della registrazione
    const linesBefore = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(linesBefore.length).toBe(0);

    // Creiamo la registrazione contabile: per PAYMENT_PROOF, l'assenza di righe articolo non deve bloccare la registrazione
    // anche con confirmedByUser: false e senza decisions
    const expense = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      supplierName: 'BAR SPORT SNC',
      expenseDate: '2026-08-28',
      documentTotal: 15.5,
    });

    expect(expense).toBeDefined();
    expect(expense.id).toBeTruthy();
    expect(expense.amount).toBe(15.5);

    const checkInDb = await db.expenses.get(expense.id);
    expect(checkInDb).toBeDefined();
  });

  it('TEST 9 — NON PAYMENT_PROOF RESTA BLOCCATO: commerciale senza conferma e senza righe/decisioni blocca createAccountingRegistration', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-comm-blocked',
      status: 'pending',
      rawText: COMMERCIAL_RAW_TEXT,
      confirmationRequired: true,
      confirmedByUser: false, // NON confermato dall'utente
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      pageCount: 1,
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
      metadata: { title: 'Sessione Commerciale', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });

    await receiptParserService.parse(ocrProc.id);

    const freshProc = await ocrProcessRepository.getById(ocrProc.id);
    expect((freshProc?.metadata as any)?.documentCategory).toBe('COMMERCIAL_RECEIPT');

    // Senza conferme dell'utente, createAccountingRegistration deve fallire/essere bloccato
    await expect(
      productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
      })
    ).rejects.toThrow();
  });

  it('TEST 10 — PARSING RIPETUTO: esecuzioni multiple mantengono categoria, incrementano version e non duplicano dati', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-repeat-1',
      status: 'pending',
      rawText: POS_RAW_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await db.ocrProcesses.update(created.id, {
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        initialCustomKey: 'preserved_across_runs',
      } as any,
    });

    // Prima esecuzione
    const draft1 = await receiptParserService.parse(created.id);
    expect(draft1.documentCategory).toBe('PAYMENT_PROOF');

    const dbState1 = await ocrProcessRepository.getById(created.id);
    expect((dbState1?.metadata as any)?.documentCategory).toBe('PAYMENT_PROOF');
    expect((dbState1?.metadata as any)?.initialCustomKey).toBe('preserved_across_runs');
    expect(dbState1?.metadata.version).toBe(2);

    const linesAfterFirst = await ocrReceiptLineRepository.getByOcrProcessId(created.id);
    const expensesAfterFirst = await db.expenses.count();

    // Seconda esecuzione
    const draft2 = await receiptParserService.parse(created.id);
    expect(draft2.documentCategory).toBe('PAYMENT_PROOF');

    const dbState2 = await ocrProcessRepository.getById(created.id);
    expect((dbState2?.metadata as any)?.documentCategory).toBe('PAYMENT_PROOF');
    expect((dbState2?.metadata as any)?.initialCustomKey).toBe('preserved_across_runs');
    expect(dbState2?.metadata.version).toBe(3);

    const linesAfterSecond = await ocrReceiptLineRepository.getByOcrProcessId(created.id);
    const expensesAfterSecond = await db.expenses.count();

    // Verifiche non duplicazione e coerenza
    expect(linesAfterSecond.length).toBe(linesAfterFirst.length);
    expect(expensesAfterSecond).toBe(expensesAfterFirst);
    expect(draft1.documentCategory).toBe(draft2.documentCategory);
    expect((dbState1?.metadata as any)?.documentCategory).toBe((dbState2?.metadata as any)?.documentCategory);
  });
});
