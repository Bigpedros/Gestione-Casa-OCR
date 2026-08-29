import { describe, it, expect } from 'vitest';
import { receiptParserService } from '../services/ocrParser';

describe('OCR Receipt Parser - TODIS & 3-Column Receipts Regression Test', () => {
  it('correctly parses the real TODIS receipt (COLL-OCR-01) without errors or misinterpretations', () => {
    // Testo reale completo dello scontrino TODIS
    const todisReceiptText = `
TODIS
CASCI S.r.l.
VIA APPIA NUOVA 123 - ROMA
P.IVA 01234567890
DOCUMENTO COMMERCIALE
di vendita o prestazione

10/08/2026 12:35 DOC. N. 0045-0012

DESCRIZIONE                         IVA       EURO
SHOPPERS BIO.MM320+                22,00%     0,13
PATATINE KETTLE                    10,00%     2,49
PANE TRAMEZZINI                     4,00%     1,99
ESTATHE' PESCA 3X20                22,00%     1,89
SCONTO ARROTONDAMENTO              22,00%    -0,02
GRANDE IMPERO 1000GR                4,00%     1,56
NUTELLA 950G                       10,00%     6,99
OLIVE VERDI C/ACCIUG               10,00%     1,89
POM. OBLUNGO PICCAD.                4,00%     1,99
BOCCONCINI PUGL. TAKE               4,00%     2,99

NUMERO ARTICOLI 9
TOTALE COMPLESSIVO                           21,90
PAGAMENTO CONTANTE                           25,00
RESTO                                         3,10

ARRIVEDERCI E GRAZIE
`;

    const draft = receiptParserService.parseText(todisReceiptText);

    // 1. Verifica Fornitore (riconosciuto da ragione sociale fiscale o insegna generica senza hardcoding)
    expect(draft.supplier.value).toBeDefined();
    expect(draft.supplier.value).toBeTruthy();
    expect(draft.supplier.confidence).toBeGreaterThan(50);

    // 2. Verifica Data
    expect(draft.date.value).toBe('2026-08-10');

    // 3. Verifica Totale Complessivo
    expect(draft.total.value).toBe(21.90);

    // 4. Verifica Metodo di Pagamento (Contanti)
    expect(draft.paymentMethod.value).toBe('contanti');

    // 5. Verifica Righe estratte (9 articoli + 1 sconto arrotondamento = 10 righe)
    expect(draft.lines.length).toBe(10);

    // Righe specifiche:
    // Riga 1: SHOPPERS BIO.MM320+ (0.13 €)
    expect(draft.lines[0].normalizedDescription).toContain('SHOPPERS BIO.MM320+');
    expect(draft.lines[0].lineTotal).toBe(0.13);
    expect(draft.lines[0].quantity).toBe(1);

    // Riga 2: PATATINE KETTLE (2.49 €)
    expect(draft.lines[1].normalizedDescription).toContain('PATATINE KETTLE');
    expect(draft.lines[1].lineTotal).toBe(2.49);

    // Riga 3: PANE TRAMEZZINI (1.99 €)
    expect(draft.lines[2].normalizedDescription).toContain('PANE TRAMEZZINI');
    expect(draft.lines[2].lineTotal).toBe(1.99);

    // Riga 4: ESTATHE' PESCA 3X20 (1.89 €) -> 3X20 NON deve essere interpretato come quantità 3 o moltiplicatore!
    expect(draft.lines[3].normalizedDescription).toContain("ESTATHE' PESCA 3X20");
    expect(draft.lines[3].quantity).toBe(1);
    expect(draft.lines[3].unitPrice).toBe(1.89);
    expect(draft.lines[3].lineTotal).toBe(1.89);

    // Riga 5: SCONTO ARROTONDAMENTO (-0.02 €) -> non deve diventare -22!
    expect(draft.lines[4].normalizedDescription).toContain('SCONTO ARROTONDAMENTO');
    expect(draft.lines[4].lineTotal).toBe(-0.02);
    expect(draft.lines[4].isNegative).toBe(true);

    // Riga 6: GRANDE IMPERO 1000GR (1.56 €) -> 1000GR rimane nel nome
    expect(draft.lines[5].normalizedDescription).toContain('GRANDE IMPERO 1000GR');
    expect(draft.lines[5].lineTotal).toBe(1.56);

    // Riga 7: NUTELLA 950G (6.99 €) -> 950G rimane nel nome
    expect(draft.lines[6].normalizedDescription).toContain('NUTELLA 950G');
    expect(draft.lines[6].lineTotal).toBe(6.99);

    // Riga 8: OLIVE VERDI C/ACCIUG (1.89 €)
    expect(draft.lines[7].normalizedDescription).toContain('OLIVE VERDI C/ACCIUG');
    expect(draft.lines[7].lineTotal).toBe(1.89);

    // Riga 9: POM. OBLUNGO PICCAD. (1.99 €)
    expect(draft.lines[8].normalizedDescription).toContain('POM. OBLUNGO PICCAD');
    expect(draft.lines[8].lineTotal).toBe(1.99);

    // Riga 10: BOCCONCINI PUGL. TAKE (2.99 €)
    expect(draft.lines[9].normalizedDescription).toContain('BOCCONCINI PUGL. TAKE');
    expect(draft.lines[9].lineTotal).toBe(2.99);

    // 6. Verifica Somma Matematica Perfetta (Quadratura Contabile)
    const sumLines = draft.lines.reduce((sum, l) => sum + l.lineTotal, 0);
    expect(Math.round(sumLines * 100) / 100).toBe(21.90);
    expect(draft.total.value).toBe(21.90);
  });

  it('handles noisy OCR variations (e.g. negative discount formats and no cross-line bleeding)', () => {
    const noisyReceipt = `
SUPERMERCATO MODERNO
CASCI SRL
10/08/2026
SHOPPERS BIO 22,00% 0,13
ESTATHE PESCA 3X20 22,00% 1,89
SCONTO ARROTONDAMENTO 22,00 -0,02
GRANDE IMPERO 1000GR 4,00% 1.56
NUTELLA 950G 10,00% 6.99
TOTALE COMPLESSIVO 11.55
CONTANTI 20,00
RESTO 8,45
`;
    const draft = receiptParserService.parseText(noisyReceipt);
    expect(draft.paymentMethod.value).toBe('contanti');
    expect(draft.lines.length).toBe(5);

    // Sconto arrotondamento must be -0.02, NOT -22
    const discount = draft.lines.find(l => l.normalizedDescription.includes('ARROTONDAMENTO'));
    expect(discount).toBeDefined();
    expect(discount?.lineTotal).toBe(-0.02);

    // Nutella line must have 6.99 and Nutella description
    const nutella = draft.lines.find(l => l.normalizedDescription.includes('NUTELLA'));
    expect(nutella).toBeDefined();
    expect(nutella?.normalizedDescription).toContain('NUTELLA 950G');
    expect(nutella?.lineTotal).toBe(6.99);

    // Grande impero must have 1.56
    const pane = draft.lines.find(l => l.normalizedDescription.includes('GRANDE IMPERO'));
    expect(pane).toBeDefined();
    expect(pane?.lineTotal).toBe(1.56);
  });

  it('handles corrupted OCR rawText safely without inventing prices or merging distinct products (Level B)', () => {
    // Simulazione del rawText reale corrotto dove alcuni prezzi sono mancanti o garbati
    const corruptedRaw = `
SUPERMERCATO TEST
10/08/2026
SHOPPERS BIO.MM320+ 0,13
PATATINE KETTLE
PANE TRAMEZZINI
SCONTO ARROTONDAMENTO 22,00
GRANDE IMPERO 1000GR
NUTELLA 950G
TOTALE 21,90
`;
    const draft = receiptParserService.parseText(corruptedRaw);

    // 1. Nessun dato inventato: le righe senza prezzo devono avere unitPrice 0 e warning
    const patatine = draft.lines.find(l => l.normalizedDescription.includes('PATATINE KETTLE'));
    expect(patatine).toBeDefined();
    expect(patatine?.unitPrice).toBe(0);
    expect(patatine?.lineTotal).toBe(0);
    expect(patatine?.warnings).toContain('PRICE_NOT_DETECTED');
    expect(patatine?.confidence).toBeLessThan(50);

    // 2. Non deve fondere GRANDE IMPERO e NUTELLA: devono essere due righe separate
    const grandeImpero = draft.lines.find(l => l.normalizedDescription.includes('GRANDE IMPERO'));
    const nutella = draft.lines.find(l => l.normalizedDescription.includes('NUTELLA'));
    expect(grandeImpero).toBeDefined();
    expect(nutella).toBeDefined();
    expect(grandeImpero?.normalizedDescription).not.toContain('NUTELLA');
    expect(nutella?.normalizedDescription).not.toContain('GRANDE IMPERO');

    // 3. Lo sconto arrotondamento con solo '22,00' IVA senza centesimi NON deve diventare -22.00 €
    const discount = draft.lines.find(l => l.normalizedDescription.includes('ARROTONDAMENTO'));
    expect(discount).toBeDefined();
    expect(discount?.lineTotal).toBe(0);
    expect(discount?.warnings).toContain('DISCOUNT_VALUE_NOT_DETECTED');
    expect(discount?.confidence).toBeLessThan(50);
  });

  it('handles VAT column ambiguity without using VAT as price (Requirement 6)', () => {
    const rawWithVatAmbiguity = `
NEGOZIO ALIMENTARI
10/08/2026
SHOPPERS BIO.MM320+ 0,13
PANE CASERECCIO 22,00 002 A
ESTATHE PESCA 1,89
TOTALE 2,02
`;
    const draft = receiptParserService.parseText(rawWithVatAmbiguity);
    const pane = draft.lines.find(l => l.normalizedDescription.includes('PANE CASERECCIO'));
    expect(pane).toBeDefined();
    // 22.00 must NOT be treated as price because it occupies the VAT column with department code "002 A"
    expect(pane?.unitPrice).toBe(0);
    expect(pane?.warnings).toContain('VAT_PRICE_AMBIGUOUS');
    expect(pane?.warnings).toContain('PRICE_NOT_DETECTED');
  });

  it('excludes footer noise and corrupt trailing lines from items (Requirement 8)', () => {
    const rawWithNoise = `
SUPERSTORE ABC
10/08/2026
SHOPPERS BIO.MM320+ 0,13
TOTALE COMPLESSIVO 0,13
PAGAMENTO CONTANTE 1,00
RESTO 0,87
ATAL E ANUDEFOOTUA 5 O EEE SS
ARRIVEDERCI E GRAZIE
`;
    const draft = receiptParserService.parseText(rawWithNoise);
    expect(draft.lines.length).toBe(1);
    expect(draft.lines[0].normalizedDescription).toContain('SHOPPERS');
    expect(draft.total.value).toBe(0.13);
  });

  it('strictly stops extraction after SUBTOTALE even if TOTALE COMPLESSIVO is broken or missing (Requirement 4)', () => {
    const receiptWithBrokenFooterAfterSubtotal = `
MINIMARKET GENERICO
10/08/2026
PASTA DI SEMOLA 1,20
PASSATA DI POMODORO 0,80
SUBTOTALE 2,00
IMPORTO CORROTTO TOTALE XX
PUNTI FEDELTA GUADAGNATI 15
ARRIVEDERCI E GRAZIE
`;
    const draft = receiptParserService.parseText(receiptWithBrokenFooterAfterSubtotal);
    // Deve contenere solo i 2 prodotti prima del subtotale
    expect(draft.lines.length).toBe(2);
    expect(draft.lines[0].normalizedDescription).toContain('PASTA DI SEMOLA');
    expect(draft.lines[0].lineTotal).toBe(1.20);
    expect(draft.lines[1].normalizedDescription).toContain('PASSATA DI POMODORO');
    expect(draft.lines[1].lineTotal).toBe(0.80);

    // Nessuna riga successiva a SUBTOTALE (punti fedeltà, testo corrotto) deve diventare articolo
    const suspectItems = draft.lines.filter(l =>
      l.normalizedDescription.includes('PUNTI') ||
      l.normalizedDescription.includes('ARRIVEDERCI') ||
      l.normalizedDescription.includes('IMPORTO')
    );
    expect(suspectItems.length).toBe(0);
  });

  it('correctly calculates consensus total when direct total is missing or obscured (Requirement 5)', () => {
    const rawMissingDirectTotal = `
SUPERMERCATO XYZ
10/08/2026
ACQUA MINERALE 1,50
BISCOTTI 2,50
IMPORTO PAGATO 4,00
PAGAMENTO CONTANTE 10,00
RESTO 6,00
`;
    const draft = receiptParserService.parseText(rawMissingDirectTotal);
    // Consensus from importo pagato (4.00) and cash - change (10 - 6 = 4.00)
    expect(draft.total.value).toBe(4.00);
  });

  it('safely handles pure price lines without coordinate proof by attaching price to preceding incomplete item (Requirement 3)', () => {
    const columnSplitReceipt = `
STORE ITALIA
10/08/2026
DESCRIZIONE IVA EURO
SHOPPERS BIO.MM320+
22,00% 0,13
PATATINE KETTLE
10,00% 2,49
GRANDE IMPERO 1000GR
NUTELLA 950G 6,99
SUBTOTALE 9,61
TOTALE COMPLESSIVO 9,61
`;
    const draft = receiptParserService.parseText(columnSplitReceipt);
    expect(draft.lines.length).toBe(4);

    // V2 associa la riga di continuazione prezzo 0,13 all'articolo incompleto SHOPPERS
    expect(draft.lines[0].normalizedDescription).toContain('SHOPPERS');
    expect(draft.lines[0].lineTotal).toBe(0.13);

    // V2 associa la riga di continuazione prezzo 2,49 all'articolo incompleto PATATINE
    expect(draft.lines[1].normalizedDescription).toContain('PATATINE');
    expect(draft.lines[1].lineTotal).toBe(2.49);

    // GRANDE IMPERO non avendo riga prezzo successiva resta isolato a 0 con warning PRICE_NOT_DETECTED (non ruba Nutella)
    expect(draft.lines[2].normalizedDescription).toContain('GRANDE IMPERO');
    expect(draft.lines[2].lineTotal).toBe(0);
    expect(draft.lines[2].warnings).toContain('PRICE_NOT_DETECTED');

    // NUTELLA mantiene il suo 6,99
    expect(draft.lines[3].normalizedDescription).toContain('NUTELLA');
    expect(draft.lines[3].lineTotal).toBe(6.99);

    // Strict stop at SUBTOTALE / TOTALE (no footer items)
    expect(draft.total.value).toBe(9.61);
  });
});
