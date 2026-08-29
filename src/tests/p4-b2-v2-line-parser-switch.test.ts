import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../database/db';
import { receiptParserService } from '../services/ocrParser';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { ReceiptZoneSegmenter } from '../services/ocrParser/modules/ReceiptZoneSegmenter';
import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
} from '../repositories';
import { productClassificationService } from '../services/productClassification/ProductClassificationService';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';

const STANDARD_RECEIPT_TEXT = `
SUPERSTORE ESSAL
VIA ROMA 10 - MILANO
P.IVA 12345678901
DOCUMENTO COMMERCIALE
15/08/2026 10:30

DETERGENTE PIATTI     22,00%   1,89
PANE CASERECCIO        4,00%   1,20

TOTALE COMPLESSIVO             3,09
PAGAMENTO CONTANTI            10,00
`;

const QTY_MULTIPLIER_RECEIPT = `
ORTOFRUTTA BIO S.R.L.
DOCUMENTO COMMERCIALE
05/08/2026 11:20

DESCRIZIONE            IVA     EURO
MELE FUJI               4,00%
2 PZ X 1,50                    3,00
ARANCE TAROCCO          4,00%
1,500 KG X 2,00                3,00

TOTALE COMPLESSIVO             6,00
PAGAMENTO ELETTRONICO          6,00
`;

const POST_TOTAL_NOISE_RECEIPT = `
IPERCOOP
DOCUMENTO COMMERCIALE
18/08/2026

PASTA BARILLA 500G     4,00%   0,99
PASSATA MUTTI         10,00%   1,29

TOTALE COMPLESSIVO             2,28
CARTA DI CREDITO               2,28
PUNTI GUADAGNATI: 45
OFFERTA SPECIALE PER I SOCI COOP
PROMOZIONE VALIDA FINO AL 31/08
ARRIVEDERCI E GRAZIE
`;

const AMBIGUOUS_RECEIPT_TEXT = `
DISCOUNT MARKET
DOCUMENTO COMMERCIALE
20/08/2026

PRODOTTO NOTO 1        22,00%  2,50
PRODOTTO DUBBIO 189 PRA

TOTALE COMPLESSIVO             2,50
`;

const PAYMENT_PROOF_TEXT = `
BANCA NAZIONALE
CONFERMA OPERAZIONE BONIFICO
DATA ESECUTIVA: 15/08/2026
BENEFICIARIO: CONDOMINIO VERDI
IBAN: IT60X0542811101000000123456
IMPORTO: € 150,00
COMMISSIONI: € 1,00
TOTALE ADDEBITATO: € 151,00
`;

const INVOICE_TEXT = `
FATTURA ELETTRONICA N. 2026/045
FORNITORE: EDILIZIA MODERNA S.R.L.
DATA: 10/08/2026
MATERIALI EDILI VARI: € 500,00
IVA 22%: € 110,00
TOTALE FATTURA: € 610,00
`;

describe('Fase P4-B2: Switch Controllato del Parser Righe V2 per COMMERCIAL_RECEIPT', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();

    const nowStr = new Date().toISOString();
    await db.categories.add({
      id: 'cat-groceries',
      code: 'CAT_GROCERIES',
      name: 'Spesa Alimentare',
      type: 'expense',
      level: 1,
      enabled: true,
      sortOrder: 1,
      system: true,
      metadata: { createdAt: nowStr, updatedAt: nowStr, version: 1 },
    });
  });

  // 1. COMMERCIAL_RECEIPT usa V2 per ParsedReceiptDraft.lines
  it('1. COMMERCIAL_RECEIPT popola ParsedReceiptDraft.lines tramite LineItemParserV2 (legacyLines)', () => {
    const draft = receiptParserService.parseText(STANDARD_RECEIPT_TEXT);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(comparison?.isV2Official).toBe(true);
    expect(comparison?.fallbackUsed).toBe(false);
    expect(shadowResult).toBeDefined();

    // Le righe nel draft corrispondono esattamente a legacyLines di V2
    expect(draft.lines.length).toBe(shadowResult?.legacyLines.length);
    expect(draft.lines[0].normalizedDescription).toBe(shadowResult?.legacyLines[0].normalizedDescription);
    expect(draft.lines[0].lineTotal).toBe(shadowResult?.legacyLines[0].lineTotal);
  });

  // 2. V1 NON determina più l'output ufficiale delle righe per COMMERCIAL_RECEIPT
  it('2. V1 non determina più l’output ufficiale quando V2 produce risultati differenti', () => {
    const draft = receiptParserService.parseText(TODIS_REAL_RAW_TEXT);
    const comparison = receiptParserService.getLastShadowComparison();

    expect(comparison?.executed).toBe(true);
    expect(comparison?.v1Count).toBe(7); // V1 trovava 7 righe (con 3 rumori e articoli persi)
    expect(comparison?.v2Count).toBe(10); // V2 trova 10 articoli reali

    // L'output ufficiale riceve le 10 righe di V2, NON le 7 di V1
    expect(draft.lines.length).toBe(10);
    expect(draft.lines.length).not.toBe(comparison?.v1Count);
  });

  // 3. Fixture standard mantiene risultato corretto
  it('3. Fixture standard mantiene risultato corretto e parità con totale', () => {
    const draft = receiptParserService.parseText(STANDARD_RECEIPT_TEXT);

    expect(draft.lines.length).toBe(2);
    expect(draft.lines[0].normalizedDescription).toContain('DETERGENTE PIATTI');
    expect(draft.lines[0].lineTotal).toBe(1.89);
    expect(draft.lines[1].normalizedDescription).toContain('PANE CASERECCIO');
    expect(draft.lines[1].lineTotal).toBe(1.20);
    expect(draft.total.value).toBe(3.09);
  });

  // 4. Fixture Todis: rumore V1 non compare nell'output ufficiale e articoli recuperati da V2 sono presenti
  it('4. Fixture Todis: rumore V1 escluso dall’output ufficiale e articoli V2 recuperati', () => {
    const draft = receiptParserService.parseText(TODIS_REAL_RAW_TEXT);

    // Rumori di V1 NON devono essere presenti nelle descrizioni
    const descriptions = draft.lines.map((l) => l.normalizedDescription.toUpperCase());
    expect(descriptions.some((d) => d.includes('245 + LAO'))).toBe(false);
    expect(descriptions.some((d) => d.includes('O AZZ A'))).toBe(false);
    expect(descriptions.some((d) => d.includes('TI] P ARNO'))).toBe(false);

    // Articoli reali recuperati da V2 presenti
    expect(descriptions.some((d) => d.includes('SHOPPERS BIO'))).toBe(true);
    expect(descriptions.some((d) => d.includes('PATATINE KETTLE'))).toBe(true);
    expect(descriptions.some((d) => d.includes('PANE TRAMEZZINI'))).toBe(true);
    expect(descriptions.some((d) => d.includes('ESTATHE'))).toBe(true);
    expect(descriptions.some((d) => d.includes('ARROTONDAMENTO'))).toBe(true);
    expect(descriptions.some((d) => d.includes('GRANDE IMPERO'))).toBe(true);
    expect(descriptions.some((d) => d.includes('NUTELLA'))).toBe(true);
    expect(descriptions.some((d) => d.includes('OLIVE VERDI'))).toBe(true);
    expect(descriptions.some((d) => d.includes('POM.OBLUNGO PICCAD'))).toBe(true);
    expect(descriptions.some((d) => d.includes('BOCCONCINI PUGL'))).toBe(true);
  });

  // 5. Quantità / moltiplicatori preservati
  it('5. Quantità e moltiplicatori preservati e unificati', () => {
    const draft = receiptParserService.parseText(QTY_MULTIPLIER_RECEIPT);

    expect(draft.lines.length).toBe(2);

    const item1 = draft.lines[0];
    expect(item1.normalizedDescription).toContain('MELE FUJI');
    expect(item1.quantity).toBe(2);
    expect(item1.unitPrice).toBe(1.50);
    expect(item1.lineTotal).toBe(3.00);

    const item2 = draft.lines[1];
    expect(item2.normalizedDescription).toContain('ARANCE TAROCCO');
    expect(item2.quantity).toBe(1.5);
    expect(item2.unitPrice).toBe(2.00);
    expect(item2.lineTotal).toBe(3.00);
  });

  // 6. Rumore post-totale escluso
  it('6. Rumore post-totale e promozioni escluse dall’output ufficiale', () => {
    const draft = receiptParserService.parseText(POST_TOTAL_NOISE_RECEIPT);

    expect(draft.lines.length).toBe(2);
    const descriptions = draft.lines.map((l) => l.normalizedDescription.toUpperCase());
    expect(descriptions.some((d) => d.includes('PUNTI GUADAGNATI'))).toBe(false);
    expect(descriptions.some((d) => d.includes('OFFERTA SPECIALE'))).toBe(false);
    expect(descriptions.some((d) => d.includes('ARRIVEDERCI'))).toBe(false);
  });

  // 7. Riga ambigua resta conservativa (Regola Ceccotti)
  it('7. Riga ambigua resta conservativa senza inventare prezzi', () => {
    const draft = receiptParserService.parseText(AMBIGUOUS_RECEIPT_TEXT);

    expect(draft.lines.length).toBe(2);
    const ambiguousLine = draft.lines.find((l) => l.normalizedDescription.includes('PRODOTTO DUBBIO'));
    expect(ambiguousLine).toBeDefined();
    expect(ambiguousLine?.lineTotal).toBe(0); // Nessun prezzo inventato (era 189 PRA)
    expect(ambiguousLine?.reviewStatus).toBe('pending');
    expect(ambiguousLine?.warnings?.some((w) => w.includes('AMBIGUOUS_PRICE_FORMAT'))).toBe(true);
  });

  // 8. Persistenza reale in Dexie: parse(ocrProcessId) persiste legacyLines V2 in ocrReceiptLines
  it('8. parse(ocrProcessId) persiste correttamente le legacyLines V2 in Dexie ocrReceiptLines', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-p4b2-01',
      status: 'pending',
      rawText: STANDARD_RECEIPT_TEXT,
      confidence: 88,
      confirmationRequired: false,
      confirmedByUser: false,
    });

    const draft = await receiptParserService.parse(ocrProc.id);

    expect(draft.lines.length).toBe(2);

    // Verifica record salvati su Dexie
    const persistedLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(persistedLines.length).toBe(2);
    expect(persistedLines[0].description).toContain('DETERGENTE PIATTI');
    expect(persistedLines[0].lineTotal).toBe(1.89);
    expect(persistedLines[1].description).toContain('PANE CASERECCIO');
    expect(persistedLines[1].lineTotal).toBe(1.20);
  });

  // 9. Riesecuzione parser mantiene idempotenza (deleteUnconfirmedByOcrProcessId + bulkCreate)
  it('9. Riesecuzione parsing su stesso ocrProcessId mantiene idempotenza', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-p4b2-02',
      status: 'pending',
      rawText: STANDARD_RECEIPT_TEXT,
      confidence: 88,
      confirmationRequired: false,
      confirmedByUser: false,
    });

    // Prima esecuzione
    await receiptParserService.parse(ocrProc.id);
    let persistedLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(persistedLines.length).toBe(2);

    // Seconda esecuzione (riesecuzione idempotente)
    await receiptParserService.parse(ocrProc.id);
    persistedLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(persistedLines.length).toBe(2); // Nessuna duplicazione
  });

  // 10. ProductClassificationService continua a ricevere le righe e ad eseguire la classificazione
  it('10. ProductClassificationService viene invocato ed elabora le righe estratte', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-p4b2-03',
      status: 'pending',
      rawText: STANDARD_RECEIPT_TEXT,
      confidence: 90,
      confirmationRequired: false,
      confirmedByUser: false,
    });

    const classifySpy = vi.spyOn(productClassificationService, 'classifyReceiptLines');

    await receiptParserService.parse(ocrProc.id);

    expect(classifySpy).toHaveBeenCalledWith(ocrProc.id);
    classifySpy.mockRestore();
  });

  // 11. PAYMENT_PROOF non utilizza V2 line parsing
  it('11. PAYMENT_PROOF non esegue V2 e mantiene il flusso isolato', () => {
    const segmentSpy = vi.spyOn(ReceiptZoneSegmenter, 'segment');
    const parseBodySpy = vi.spyOn(LineItemParserV2, 'parseBody');

    const draft = receiptParserService.parseText(PAYMENT_PROOF_TEXT);
    expect(draft).toBeDefined();
    const comparison = receiptParserService.getLastShadowComparison();

    expect(comparison?.executed).toBe(false);
    expect(comparison?.documentCategory).toBe('PAYMENT_PROOF');
    expect(segmentSpy).not.toHaveBeenCalled();
    expect(parseBodySpy).not.toHaveBeenCalled();

    segmentSpy.mockRestore();
    parseBodySpy.mockRestore();
  });

  // 12. INVOICE_OR_BILL invariato
  it('12. INVOICE_OR_BILL non esegue V2', () => {
    const segmentSpy = vi.spyOn(ReceiptZoneSegmenter, 'segment');
    const parseBodySpy = vi.spyOn(LineItemParserV2, 'parseBody');

    const draft = receiptParserService.parseText(INVOICE_TEXT);
    expect(draft).toBeDefined();
    const comparison = receiptParserService.getLastShadowComparison();

    expect(comparison?.executed).toBe(false);
    expect(comparison?.documentCategory).toBe('INVOICE_OR_BILL');
    expect(segmentSpy).not.toHaveBeenCalled();
    expect(parseBodySpy).not.toHaveBeenCalled();

    segmentSpy.mockRestore();
    parseBodySpy.mockRestore();
  });

  // 13. UNKNOWN invariato
  it('13. Documento UNKNOWN non esegue V2', () => {
    const segmentSpy = vi.spyOn(ReceiptZoneSegmenter, 'segment');
    const parseBodySpy = vi.spyOn(LineItemParserV2, 'parseBody');

    const draft = receiptParserService.parseText('PROMEMORIA GENERICO\nAPPUNTI VARI');
    expect(draft).toBeDefined();
    const comparison = receiptParserService.getLastShadowComparison();

    expect(comparison?.executed).toBe(false);
    expect(segmentSpy).not.toHaveBeenCalled();
    expect(parseBodySpy).not.toHaveBeenCalled();

    segmentSpy.mockRestore();
    parseBodySpy.mockRestore();
  });

  // 14. Fallback V1 attivabile SOLO tramite errore tecnico runtime in V2
  it('14. Fallback V1 si attiva in caso di eccezione tecnica runtime in V2 senza far crashare la pipeline', () => {
    const parseBodySpy = vi.spyOn(LineItemParserV2, 'parseBody').mockImplementationOnce(() => {
      throw new Error('Simulated technical runtime exception in V2 parser');
    });

    const draft = receiptParserService.parseText(STANDARD_RECEIPT_TEXT);
    const comparison = receiptParserService.getLastShadowComparison();

    expect(parseBodySpy).toHaveBeenCalled();
    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(comparison?.fallbackUsed).toBe(true);
    expect(comparison?.isV2Official).toBe(false);
    expect(comparison?.fallbackReason).toContain('Simulated technical runtime exception');

    // La pipeline non crasha e usa le righe V1 di emergenza
    expect(draft.lines.length).toBe(2);
    expect(draft.warnings.some((w) => w.code === 'V2_FALLBACK_ACTIVATED')).toBe(true);

    parseBodySpy.mockRestore();
  });

  // 15. Una semplice differenza semantica o 0 righe in V2 NON attiva fallback V1 (Regola Ceccotti)
  it('15. Differenza semantica (V2 con 0 righe o righe ambigue) NON attiva fallback V1', () => {
    // Testo scontrino con solo testata commerciale e nessuna riga nel body
    const emptyBodyReceipt = `
NEGOZIO VUOTO S.R.L.
DOCUMENTO COMMERCIALE
10/08/2026
TOTALE COMPLESSIVO 0,00
`;

    const draft = receiptParserService.parseText(emptyBodyReceipt);
    const comparison = receiptParserService.getLastShadowComparison();

    expect(comparison?.executed).toBe(true);
    expect(comparison?.fallbackUsed).toBe(false); // Nessun fallback
    expect(comparison?.isV2Official).toBe(true);
    expect(draft.lines.length).toBe(0); // Resta 0, non cerca di inventare o recuperare da V1
    expect(draft.warnings.some((w) => w.code === 'V2_FALLBACK_ACTIVATED')).toBe(false);
  });
});
