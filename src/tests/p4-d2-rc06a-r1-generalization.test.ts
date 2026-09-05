import { describe, it, expect } from 'vitest';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { SegmentedReceiptLine } from '../services/ocrParser/types';
import { EUROSPIN_REAL_RAW_TEXT } from './p4-d2-rc06a-eurospin-product-identity.test';

describe('FASE P4-D2-RC-06A-R1 — Generalizzazione Identità Articoli e Rimozione Hardcoding', () => {
  // TEST A — ARTICOLO POST-SUBTOTAL GENERICO
  // Non contiene SHOPPER, BUSTA, SACCHETTO, EUROSPIN
  it('TEST A — Riconosce un articolo generico post-subtotale intermedio tra due subtotali senza keyword dedicate', () => {
    const rawGenericReceipt = `SUPERMERCATO MODERNO
DOCUMENTO COMMERCIALE
DESCRIZIONE PREZZO IVA
PRODOTTO A 10,00 22%
SUBTOTAL 10,00
PRODOTTO SPECIALE
SUBTOTAL 12,00
PAGAMENTO ELETTRONICO 12,00`;

    const draft = receiptParserService.parseText(rawGenericReceipt);

    // 1. PRODOTTO A presente con prezzo 10,00
    const prodA = draft.lines.find((l) => l.normalizedDescription.includes('PRODOTTO') || l.originalText.includes('PRODOTTO A'));
    expect(prodA, 'PRODOTTO A deve essere estratto tra le linee').toBeDefined();
    expect(prodA?.lineTotal).toBe(10);

    // 2. PRODOTTO SPECIALE presente post-subtotale intermedio
    const prodSpeciale = draft.lines.find((l) => l.normalizedDescription.includes('PRODOTTO SPECIALE'));
    expect(prodSpeciale, 'PRODOTTO SPECIALE deve essere estratto tra le linee').toBeDefined();
    expect(prodSpeciale?.warnings).toContain('PRICE_NOT_DETECTED');

    // 3. Totale articoli = 2
    expect(draft.lines.length).toBe(2);

    // 4. Nessun elemento footer o di pagamento trasformato in articolo
    const pagamentoLine = draft.lines.find((l) =>
      l.normalizedDescription.includes('PAGAMENTO') || l.normalizedDescription.includes('ELETTRONICO')
    );
    expect(pagamentoLine, 'Le righe del footer non devono diventare articoli').toBeUndefined();

    const subtotalLine = draft.lines.find((l) => l.normalizedDescription.includes('SUBTOTAL'));
    expect(subtotalLine, 'Le righe di subtotale non devono diventare articoli').toBeUndefined();
  });

  // TEST B — ARTICOLO MONOPAROLA SENZA PREZZO: PANE
  it('TEST B — Riconosce "PANE" come singolo articolo monoparola senza prezzo (PRICE_NOT_DETECTED)', () => {
    const paneLine: SegmentedReceiptLine = {
      index: 0,
      rawIndex: 1,
      text: 'PANE',
      rawText: 'PANE',
      zone: 'BODY',
      confidence: 0.8,
      reasons: ['contained_in_body_zone'],
    };

    const parsed = LineItemParserV2.parseBody([paneLine]);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].description).toBe('PANE');
    expect(parsed.items[0].lineTotal).toBeNull();
    expect(parsed.items[0].warnings).toContain('PRICE_NOT_DETECTED');
    expect(parsed.unparsedNoiseLines.length).toBe(0);

    // Verifica end-to-end tramite parseText in contesto scontrino
    const rawReceipt = `ALIMENTARI
DOC COMMERCIALE
LATTE INTERO 1,80
PANE
SUBTOTAL 1,80
TOTALE 1,80
CONTANTI 2,00`;
    const draft = receiptParserService.parseText(rawReceipt);
    const draftPane = draft.lines.find((l) => l.normalizedDescription === 'PANE');
    expect(draftPane).toBeDefined();
    expect(draftPane?.warnings).toContain('PRICE_NOT_DETECTED');
  });

  // TEST C — ALTRO ARTICOLO MONOPAROLA SENZA PREZZO: LATTE
  it('TEST C — Riconosce "LATTE" come singolo articolo monoparola senza prezzo (PRICE_NOT_DETECTED)', () => {
    const latteLine: SegmentedReceiptLine = {
      index: 0,
      rawIndex: 2,
      text: 'LATTE',
      rawText: 'LATTE',
      zone: 'BODY',
      confidence: 0.8,
      reasons: ['contained_in_body_zone'],
    };

    const parsed = LineItemParserV2.parseBody([latteLine]);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].description).toBe('LATTE');
    expect(parsed.items[0].lineTotal).toBeNull();
    expect(parsed.items[0].warnings).toContain('PRICE_NOT_DETECTED');
    expect(parsed.unparsedNoiseLines.length).toBe(0);
  });

  // TEST D — RUMORE REALE: ZARE |
  it('TEST D — Esclude categoricamente frammenti OCR orfani come "ZARE |" dalla draft line', () => {
    const zareLine: SegmentedReceiptLine = {
      index: 0,
      rawIndex: 25,
      text: 'ZARE  |',
      rawText: 'ZARE  |',
      zone: 'BODY',
      confidence: 0.5,
      reasons: ['body_candidate'],
    };

    const parsed = LineItemParserV2.parseBody([zareLine]);
    expect(parsed.items.length).toBe(0);
    expect(parsed.unparsedNoiseLines.length).toBe(1);
    expect(parsed.unparsedNoiseLines[0].text).toBe('ZARE  |');
  });

  // TEST E — CAMPIONE REALE EUROSPIN
  it('TEST E — Continua a certificare il campione reale Eurospin con 11 articoli, SHOPPER inclusa e ZARE esclusa', () => {
    const draft = receiptParserService.parseText(EUROSPIN_REAL_RAW_TEXT);

    expect(draft.lines.length).toBe(11);

    // SHOPPER presente con PRICE_NOT_DETECTED
    const shopper = draft.lines.find((l) => l.normalizedDescription.includes('SHOPPER'));
    expect(shopper).toBeDefined();
    expect(shopper?.warnings).toContain('PRICE_NOT_DETECTED');

    // ZARE assente
    const zare = draft.lines.find((l) => l.normalizedDescription.includes('ZARE'));
    expect(zare).toBeUndefined();

    // Nessun footer
    const totals = draft.lines.find((l) => l.normalizedDescription.includes('PAGAMENTO') || l.normalizedDescription.includes('VENTILAZIONE'));
    expect(totals).toBeUndefined();
  });

  // TEST F — MULTILINEA (Scenari M, G, O)
  it('TEST F — Preserva gli invarianti multilinea legittimi (Scenari M, G, O)', () => {
    // Scenario M: Descrizione multilinea unita con evidenza fiscale positiva
    const linesM: SegmentedReceiptLine[] = [
      {
        index: 0,
        rawIndex: 10,
        text: 'DETERGENTE LAVATRICE',
        rawText: 'DETERGENTE LAVATRICE',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test'],
      },
      {
        index: 1,
        rawIndex: 11,
        text: 'LIQUIDO CLASSICO 40LAV 5,99 22%',
        rawText: 'LIQUIDO CLASSICO 40LAV 5,99 22%',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test'],
      },
    ];
    const resultM = LineItemParserV2.parseBody(linesM);
    expect(resultM.items.length).toBe(1);
    expect(resultM.items[0].description).toBe('DETERGENTE LAVATRICE LIQUIDO CLASSICO 40LAV');
    expect(resultM.items[0].lineTotal).toBe(5.99);
    expect(resultM.items[0].vatRate).toBe(22);

    // Scenario G: Descrizione con prezzo e IVA su riga successiva
    const linesG: SegmentedReceiptLine[] = [
      {
        index: 0,
        rawIndex: 20,
        text: 'PRODOTTO SPECIALITA',
        rawText: 'PRODOTTO SPECIALITA',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test'],
      },
      {
        index: 1,
        rawIndex: 21,
        text: '2,99 10%',
        rawText: '2,99 10%',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test'],
      },
    ];
    const resultG = LineItemParserV2.parseBody(linesG);
    expect(resultG.items.length).toBe(1);
    expect(resultG.items[0].description).toBe('PRODOTTO SPECIALITA');
    expect(resultG.items[0].lineTotal).toBe(2.99);
    expect(resultG.items[0].vatRate).toBe(10);

    // Scenario O: Prodotto senza prezzo seguito da riga di peso / moltiplicatore
    const linesO: SegmentedReceiptLine[] = [
      {
        index: 0,
        rawIndex: 30,
        text: 'MELE GOLDEN',
        rawText: 'MELE GOLDEN',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test'],
      },
      {
        index: 1,
        rawIndex: 31,
        text: '1,250 KG X 1,60 2,00 4%',
        rawText: '1,250 KG X 1,60 2,00 4%',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test'],
      },
    ];
    const resultO = LineItemParserV2.parseBody(linesO);
    expect(resultO.items.length).toBe(1);
    expect(resultO.items[0].description).toBe('MELE GOLDEN');
    expect(resultO.items[0].lineTotal).toBe(2.0);
    expect(resultO.items[0].quantity).toBe(1.25);
    expect(resultO.items[0].unitOfMeasure).toBe('KG');
    expect(resultO.items[0].vatRate).toBe(4);
  });
});
