import { describe, it, expect, vi } from 'vitest';
import { receiptParserService } from '../services/ocrParser';
import { ReceiptZoneSegmenter } from '../services/ocrParser/modules/ReceiptZoneSegmenter';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';

describe('Fase P4-B1: Shadow Mode ReceiptZoneSegmenter + LineItemParserV2', () => {
  // Test 1: Shadow V2 viene eseguito SOLO per COMMERCIAL_RECEIPT
  it('P4-B1-01: Shadow V2 viene eseguito per documenti classificati COMMERCIAL_RECEIPT', () => {
    const commercialReceiptText = `
ESSELUNGA S.P.A.
VIA RIPAMONTI 110 - MILANO
DOCUMENTO COMMERCIALE di vendita o prestazione
10/08/2026 14:30 DOC. 0123-4567

DESCRIZIONE             IVA      EURO
LATTE PARZ. SCREM.      4,00%    1,20
BISCOTTI FROLLINI      10,00%    2,50

TOTALE COMPLESSIVO               3,70
PAGAMENTO CONTANTE              10,00
RESTO                            6,30
NUMERO ARTICOLI 2
`;

    const draft = receiptParserService.parseText(commercialReceiptText);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(comparison?.documentCategory).toBe('COMMERCIAL_RECEIPT');
    expect(shadowResult).not.toBeNull();
    expect(shadowResult?.items.length).toBe(2);
    expect(comparison?.v1Count).toBe(2);
    expect(comparison?.v2Count).toBe(2);
    expect(draft.lines.length).toBe(2);
  });

  // Test 2: PAYMENT_PROOF non attiva ReceiptZoneSegmenter/LineItemParserV2
  it('P4-B1-02: PAYMENT_PROOF non attiva il percorso Shadow V2', () => {
    const segmentSpy = vi.spyOn(ReceiptZoneSegmenter, 'segment');
    const parseBodySpy = vi.spyOn(LineItemParserV2, 'parseBody');

    const paymentProofText = `
BANCA SELLA S.P.A.
MEMORANDUM DI PAGAMENTO POS
COMMERCIANTE: SUPERMERCATO ALFA
DATA: 15/08/2026 18:45
STAN: 123456 AUTH: 987654
CIRCUITO: MASTERCARD
IMPORTO: EUR 45,90
OPERAZIONE ESEGUITA CON SUCCESSO
`;

    const draft = receiptParserService.parseText(paymentProofText);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    expect(draft).toBeDefined();
    expect(comparison?.executed).toBe(false);
    expect(comparison?.documentCategory).toBe('PAYMENT_PROOF');
    expect(shadowResult).toBeNull();
    expect(segmentSpy).not.toHaveBeenCalled();
    expect(parseBodySpy).not.toHaveBeenCalled();

    segmentSpy.mockRestore();
    parseBodySpy.mockRestore();
  });

  // Test 3: INVOICE_OR_BILL non attiva il percorso V2
  it('P4-B1-03: INVOICE_OR_BILL non attiva il percorso Shadow V2', () => {
    const segmentSpy = vi.spyOn(ReceiptZoneSegmenter, 'segment');
    const parseBodySpy = vi.spyOn(LineItemParserV2, 'parseBody');

    const invoiceText = `
ENEL ENERGIA S.P.A.
FATTURA ELETTRONICA PER LA FORNITURA DI ENERGIA ELETTRICA
FATTURA N. 2026/EE-98765 DEL 01/08/2026
C.F. ENEL: 00934061003
PERIODO DI FATTURAZIONE: LUGLIO 2026
TOTALE DA PAGARE: 124,50 €
SCADENZA: 25/08/2026
`;

    const draft = receiptParserService.parseText(invoiceText);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    expect(draft).toBeDefined();
    expect(comparison?.executed).toBe(false);
    expect(comparison?.documentCategory).toBe('INVOICE_OR_BILL');
    expect(shadowResult).toBeNull();
    expect(segmentSpy).not.toHaveBeenCalled();
    expect(parseBodySpy).not.toHaveBeenCalled();

    segmentSpy.mockRestore();
    parseBodySpy.mockRestore();
  });

  // Test 4: UNKNOWN non attiva il percorso V2
  it('P4-B1-04: UNKNOWN non attiva il percorso Shadow V2', () => {
    const segmentSpy = vi.spyOn(ReceiptZoneSegmenter, 'segment');
    const parseBodySpy = vi.spyOn(LineItemParserV2, 'parseBody');

    const unknownText = `
IL MIO CANE E' ANDATO AL PARCO
OGGI C'E' IL SOLE
NESSUNA INFORMAZIONE COMMERCIALE
`;

    const draft = receiptParserService.parseText(unknownText);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    expect(draft).toBeDefined();
    expect(comparison?.executed).toBe(false);
    expect(comparison?.documentCategory).toBe('UNKNOWN');
    expect(shadowResult).toBeNull();
    expect(segmentSpy).not.toHaveBeenCalled();
    expect(parseBodySpy).not.toHaveBeenCalled();

    segmentSpy.mockRestore();
    parseBodySpy.mockRestore();
  });

  // Test 5: ParsedReceiptDraft ufficiale resta identico alla baseline V1
  it('P4-B1-05: ParsedReceiptDraft ufficiale continua a restituire rigorosamente il risultato di LineItemParser V1', () => {
    const sampleReceipt = `
SUPERSTORE S.R.L.
DOCUMENTO COMMERCIALE
12/08/2026

DETERGENTE PIATTI     22,00%   1,89
PANE CASERECCIO        4,00%   1,20

TOTALE COMPLESSIVO             3,09
PAGAMENTO CONTANTI            10,00
`;

    const draft = receiptParserService.parseText(sampleReceipt);

    // L'output ufficiale deve essere conforme al contratto standard legacy
    expect(draft.lines).toBeDefined();
    expect(draft.lines.length).toBe(2);
    expect(draft.lines[0].normalizedDescription).toContain('DETERGENTE PIATTI');
    expect(draft.lines[0].lineTotal).toBe(1.89);
    expect(draft.lines[1].normalizedDescription).toContain('PANE CASERECCIO');
    expect(draft.lines[1].lineTotal).toBe(1.20);
    expect(draft.total.value).toBe(3.09);
  });

  // Test 6: Il confronto V1/V2 è disponibile e deterministico
  it('P4-B1-06: Il confronto V1/V2 produce metriche e strutture deterministiche', () => {
    const sampleReceipt = `
SUPERSTORE S.R.L.
DOCUMENTO COMMERCIALE
12/08/2026

DETERGENTE PIATTI     22,00%   1,89
PANE CASERECCIO        4,00%   1,20

TOTALE COMPLESSIVO             3,09
PAGAMENTO CONTANTI            10,00
`;

    const draft = receiptParserService.parseText(sampleReceipt);
    const comparison = receiptParserService.getLastShadowComparison();

    expect(draft.total.value).toBe(3.09);
    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(comparison?.v1Count).toBe(2);
    expect(comparison?.v2Count).toBe(2);
    expect(comparison?.matchedCount).toBe(2);
    expect(comparison?.lostInV2Count).toBe(0);
    expect(comparison?.addedInV2Count).toBe(0);
    expect(comparison?.zones?.bodyCount).toBeGreaterThanOrEqual(2);
  });

  // Test 7: Caso Todis reale confrontato V1 vs V2
  it('P4-B1-07: Caso reale TODIS confrontato accuratamente V1 vs V2 senza alterazione del risultato ufficiale', () => {
    const draft = receiptParserService.parseText(TODIS_REAL_RAW_TEXT);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    // Output ufficiale V2 (10 righe estratte da V2 senza artefatti ocr)
    expect(draft.lines.length).toBe(10);
    expect(draft.total.value).toBe(21.90);
    expect(draft.supplier.value).toBeTruthy();

    // Risultato Shadow V2 e confronto diagnostico con V1
    expect(shadowResult).toBeDefined();
    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(comparison?.v1Count).toBe(7);
    expect(comparison?.v2Count).toBe(10);
    expect(comparison?.matchedCount).toBe(4);
    expect(comparison?.lostInV2Count).toBe(3); // 3 righe rumore di V1 escluse da V2
    expect(comparison?.addedInV2Count).toBe(6); // 6 articoli reali recuperati da V2
    expect(comparison?.v2Summary?.articleCount).toBe(9);
    expect(comparison?.v2Summary?.discountCount).toBe(1); // ARROTONDAMENTO
  });

  // Test 8: Caso con quantità / moltiplicatore / prezzo unitario
  it('P4-B1-08: Caso con quantità e moltiplicatore gestito in Shadow Mode', () => {
    const receiptWithQty = `
ORTOFRUTTA BIO S.R.L.
DOCUMENTO COMMERCIALE
05/08/2026 11:20

DESCRIZIONE            IVA     EURO
MELE FUJI               4,00%
2 PZ X 1,50                    3,00
ARANCE TAROCCO          4,00%
1,500 KG X 2,00                3,00

TOTALE COMPLESSIVO             6,00
`;

    const draft = receiptParserService.parseText(receiptWithQty);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(shadowResult).toBeDefined();
    expect(shadowResult?.items.length).toBe(2);

    // V2 unifica la continuazione con la quantità
    const v2Item1 = shadowResult?.items[0];
    expect(v2Item1?.description).toContain('MELE FUJI');
    expect(v2Item1?.quantity).toBe(2);
    expect(v2Item1?.unitPrice).toBe(1.50);
    expect(v2Item1?.lineTotal).toBe(3.00);

    // L'output ufficiale draft.lines resta intatto
    expect(draft.total.value).toBe(6.00);
  });

  // Test 9: Caso con rumore e footer dopo il totale
  it('P4-B1-09: Gestione zone di rumore e footer trailing dopo il totale', () => {
    const receiptWithNoise = `
IPERCOOP
DOCUMENTO COMMERCIALE
18/08/2026

PASTA BARILLA 500G     4,00%   0,99
PASSATA MUTTI         10,00%   1,29

TOTALE EURO                    2,28
CONTANTI                       5,00
RESTO                          2,72

SALDI E PROMOZIONI ATTIVE
PUNTI FEDELTA' MATURATI: 150
GRAZIE PER AVER SCELTO COOP
ARRIVEDERCI
`;

    const draft = receiptParserService.parseText(receiptWithNoise);
    const comparison = receiptParserService.getLastShadowComparison();

    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(comparison?.zones?.totalsFooterCount).toBeGreaterThanOrEqual(1);
    expect(comparison?.zones?.trailingMetadataCount).toBeGreaterThanOrEqual(1);
    expect(draft.lines.length).toBe(2);
    expect(draft.lines[0].normalizedDescription).toContain('PASTA BARILLA');
    expect(draft.lines[1].normalizedDescription).toContain('PASSATA MUTTI');
  });

  // Test 10: Caso con riga ambigua (Regola Ceccotti - non forzare prezzi a zero o a valori inventati)
  it('P4-B1-10: Caso con token ambiguo classificato correttamente senza speculazioni', () => {
    const receiptWithAmbiguousLine = `
DISCOUNT MARKET
DOCUMENTO COMMERCIALE

LATTE INTERO 1L       4,00%    1,45
PRODOTTO SPECIALE 189 PRA      4,00%

TOTALE EURO                    3,34
`;

    const draft = receiptParserService.parseText(receiptWithAmbiguousLine);
    const comparison = receiptParserService.getLastShadowComparison();
    const shadowResult = receiptParserService.getLastShadowResult();

    expect(draft.total.value).toBe(3.34);
    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(shadowResult?.items.length).toBe(2);

    const ambiguousItem = shadowResult?.items[1];
    expect(ambiguousItem?.description).toContain('PRODOTTO SPECIALE');
    expect(ambiguousItem?.monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');
    expect(ambiguousItem?.lineTotal).toBeNull(); // Nessun dato inventato (Regola Ceccotti)
  });
});
