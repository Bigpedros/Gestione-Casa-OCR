import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../database/db';
import {
  ocrProcessRepository,
} from '../repositories';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { PaymentEvidenceParser } from '../services/ocrParser/modules/PaymentEvidenceParser';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('FASE P4-D1-E2E-R2-F3 — Propagazione PaymentMethodHint e Persistenza', () => {
  const POS_CREDIT_TEXT = `BAR SPORT SNC
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

  const POS_DEBIT_TEXT = `CAFFE SAN MARCO
PIAZZA SAN MARCO 5, VENEZIA
RICEVUTA POS - MEMORIA CLIENTE
DATA: 20/08/2026 09:12
TID: 33445566
STAN: 778899
CARTA: **** **** **** 9988
CIRCUITO: PAGOBANCOMAT
IMPORTO: €4,50
TRANSAZIONE ESEGUITA`;

  const BANK_TRANSFER_TEXT = `DISPOSIZIONE DI BONIFICO SEPA
RICEVUTA BONIFICO
Ordinante: MARIO ROSSI
Beneficiario: CONDOMINIO VIA VERDI
IBAN Beneficiario: IT60X0542811101000000123456
Data esecuzione: 15/08/2026
Importo: € 320,00
Causale: SPESE CONDOMINIALI AGOSTO 2026
TRN: 26082912345678901234567890123456
STATO: ESEGUITO`;

  const PAGOPA_TEXT = `RICEVUTA TELEMATICA PAGOPA
Ente Creditore: COMUNE DI FIRENZE
Codice Fiscale Ente: 01234567890
IUV: 302000001234567890
Data Operazione: 12/08/2026 14:20
Oggetto: TARI ANNO 2026
Importo: € 180,00
Commissioni applicate dal PSP: € 1,50
Totale Addebitato: € 181,50
ESITO: TRANSAZIONE ESEGUITA CON SUCCESSO`;

  const COMMERCIAL_RECEIPT_TEXT = `CONAD NORD OVEST S.R.L.
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE PREZZO
PANE INTEGRALE 1.80
LATTE INTERO 1.50
TOTALE COMPLESSIVO 3.30
DI CUI IVA 0.40
PAGAMENTO CONTANTI 3.30
RT 12345678`;

  beforeEach(async () => {
    vi.restoreAllMocks();

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

  // =========================================================================
  // TEST 1 — POS CREDIT CARD
  // =========================================================================
  it('TEST 1 — Ricevuta POS Credit Card produce macroCategoryHint creditCard e paymentMethod.value creditCard', () => {
    const draft = receiptParserService.parseText(POS_CREDIT_TEXT);

    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.paymentMethodHint.macroCategoryHint).toBe('creditCard');
    expect(draft.paymentMethod.value).toBe('creditCard');
    // Il vecchio valore legacy 'carta' non deve restare come valore ufficiale
    expect(draft.paymentMethod.value).not.toBe('carta');
  });

  // =========================================================================
  // TEST 2 — POS DEBIT CARD
  // =========================================================================
  it('TEST 2 — Ricevuta POS Debit Card produce macroCategoryHint debitCard e paymentMethod.value debitCard', () => {
    const draft = receiptParserService.parseText(POS_DEBIT_TEXT);

    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.paymentMethodHint.macroCategoryHint).toBe('debitCard');
    expect(draft.paymentMethod.value).toBe('debitCard');
    // Non deve restare il valore legacy bancomat
    expect(draft.paymentMethod.value).not.toBe('bancomat');
  });

  // =========================================================================
  // TEST 3 — BONIFICO
  // =========================================================================
  it('TEST 3 — Ricevuta Bonifico produce macroCategoryHint bankTransfer e paymentMethod.value bankTransfer', () => {
    const draft = receiptParserService.parseText(BANK_TRANSFER_TEXT);

    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.subtype).toBe('BANK_TRANSFER_RECEIPT');
    expect(draft.paymentEvidence?.paymentMethodHint.macroCategoryHint).toBe('bankTransfer');
    expect(draft.paymentMethod.value).toBe('bankTransfer');
  });

  // =========================================================================
  // TEST 4 — PAGOPA
  // =========================================================================
  it('TEST 4 — Ricevuta PagoPA produce macroCategoryHint other e paymentMethod.value other', () => {
    const draft = receiptParserService.parseText(PAGOPA_TEXT);

    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.subtype).toBe('PAGOPA_RECEIPT');
    expect(draft.paymentEvidence?.paymentMethodHint.macroCategoryHint).toBe('other');
    expect(draft.paymentMethod.value).toBe('other');
  });

  // =========================================================================
  // TEST 5 — PERSISTENZA POS
  // =========================================================================
  it('TEST 5 — Persistenza reale end-to-end: parse() salva metadata.detectedPaymentMethod creditCard in DB', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-f3',
      rawText: POS_CREDIT_TEXT,
      status: 'pending',
      confidence: 90,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await receiptParserService.parse(ocrProc.id);

    const freshProc = await ocrProcessRepository.getById(ocrProc.id);
    expect(freshProc).not.toBeNull();
    expect((freshProc?.metadata as any)?.documentCategory).toBe('PAYMENT_PROOF');
    expect((freshProc?.metadata as any)?.detectedPaymentMethod).toBe('creditCard');
  });

  // =========================================================================
  // TEST 6 — PERSISTENZA BONIFICO
  // =========================================================================
  it('TEST 6 — Persistenza reale end-to-end: Bonifico salva metadata.detectedPaymentMethod bankTransfer in DB', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-bonifico-f3',
      rawText: BANK_TRANSFER_TEXT,
      status: 'pending',
      confidence: 88,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await receiptParserService.parse(ocrProc.id);

    const freshProc = await ocrProcessRepository.getById(ocrProc.id);
    expect(freshProc).not.toBeNull();
    expect((freshProc?.metadata as any)?.documentCategory).toBe('PAYMENT_PROOF');
    expect((freshProc?.metadata as any)?.detectedPaymentMethod).toBe('bankTransfer');
  });

  // =========================================================================
  // TEST 7 — PRESERVAZIONE METADATA F1/F2
  // =========================================================================
  it('TEST 7 — Preservazione metadata preesistenti, version incrementata e detectedPaymentMethod canonico', async () => {
    // Inizializzazione processo con metadata personalizzati (senza inserire detectedPaymentMethod a mano)
    const initialProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-meta-f3',
      rawText: POS_CREDIT_TEXT,
      status: 'pending',
      confidence: 92,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    // Aggiunta chiavi custom tramite aggiornamento DB
    await db.ocrProcesses.update(initialProc.id, {
      metadata: {
        ...initialProc.metadata,
        selectedVariant: 'contrast_high',
        variantScores: { v1: 0.95, v2: 0.88 },
        customMarker: 'test_marker_f3',
      } as any,
    });

    await receiptParserService.parse(initialProc.id);

    const freshProc = await ocrProcessRepository.getById(initialProc.id);
    expect(freshProc).not.toBeNull();
    const meta = freshProc?.metadata as any;

    // Preservazione metadati F1/F2
    expect(meta?.selectedVariant).toBe('contrast_high');
    expect(meta?.variantScores?.v1).toBe(0.95);
    expect(meta?.customMarker).toBe('test_marker_f3');
    expect(meta?.documentCategory).toBe('PAYMENT_PROOF');
    expect(meta?.detectedPaymentMethod).toBe('creditCard');
    expect(Array.isArray(meta?.normalizedLines)).toBe(true);
    expect(meta?.normalizedLines?.length).toBeGreaterThan(0);
    expect(meta?.version).toBe(2);
  });

  // =========================================================================
  // TEST 8 — HINT ASSENTE
  // =========================================================================
  it('TEST 8 — Se macroCategoryHint è undefined, preserva il valore legacy senza cancellarlo', () => {
    const originalParse = PaymentEvidenceParser.parse;
    vi.spyOn(PaymentEvidenceParser, 'parse').mockImplementation((input, classification) => {
      const real = originalParse.call(PaymentEvidenceParser, input, classification);
      return {
        ...real,
        paymentMethodHint: {
          macroCategoryHint: undefined,
          circuitOrBrand: undefined,
          maskedPan: undefined,
        },
      };
    });

    const draft = receiptParserService.parseText(POS_CREDIT_TEXT);

    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.paymentMethodHint.macroCategoryHint).toBeUndefined();
    // Il valore legacy ('carta') estratto da PaymentMethodParser deve essere preservato
    expect(draft.paymentMethod.value).toBe('carta');
    expect(draft.paymentMethod.value).not.toBeNull();
    expect(draft.paymentMethod.value).not.toBeUndefined();
  });

  // =========================================================================
  // TEST 9 — DOCUMENTI NON PAYMENT_PROOF
  // =========================================================================
  it('TEST 9 — Documenti COMMERCIAL_RECEIPT mantengono comportamento legacy invariato', () => {
    const draft = receiptParserService.parseText(COMMERCIAL_RECEIPT_TEXT);

    expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');
    expect(draft.paymentEvidence).toBeNull();
    // Mantiene il valore legacy 'contanti'
    expect(draft.paymentMethod.value).toBe('contanti');
  });

  // =========================================================================
  // TEST 10 — ERRORE TECNICO PAYMENTEVIDENCE
  // =========================================================================
  it('TEST 10 — Eccezione tecnica in PaymentEvidenceParser non fa crashare parseText e preserva fallback legacy', () => {
    vi.spyOn(PaymentEvidenceParser, 'parse').mockImplementation(() => {
      throw new Error('Simulated runtime error in PaymentEvidenceParser');
    });

    const draft = receiptParserService.parseText(POS_CREDIT_TEXT);

    expect(draft).toBeDefined();
    expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft.paymentEvidence).toBeNull();
    // Preserva il valore legacy estratto da PaymentMethodParser
    expect(draft.paymentMethod.value).toBe('carta');
  });
});
