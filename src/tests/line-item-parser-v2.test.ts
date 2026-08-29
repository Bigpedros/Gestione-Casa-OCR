import { describe, it, expect } from 'vitest';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { ReceiptZoneSegmenter } from '../services/ocrParser/modules/ReceiptZoneSegmenter';
import { TextNormalizationModule } from '../services/ocrParser/modules/TextNormalizationModule';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';
import { SegmentedReceiptLine } from '../services/ocrParser/types';

/**
 * Utility helper per creare SegmentedReceiptLine per test unitari generici
 */
function createTestBodyLines(lines: string[], startRawIndex = 0): SegmentedReceiptLine[] {
  return lines.map((text, idx) => ({
    index: idx,
    rawIndex: startRawIndex + idx,
    rawText: text,
    text: text,
    zone: 'BODY',
    confidence: 1.0,
    reasons: ['unit_test_fixture'],
  }));
}

describe('LineItemParserV2 (Ceccotti Architecture - Block 2 Tests)', () => {
  // =========================================================================
  // SCENARIO A: BODY Reale TODIS Canonica (Documento_27-08-2026_016)
  // =========================================================================
  describe('A. Real TODIS Raw OCR Body Parsing', () => {
    const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
    const zones = ReceiptZoneSegmenter.segment(norm);
    const result = LineItemParserV2.parseBody(zones.body);

    it('parses exactly 10 total line items from the real TODIS body zone', () => {
      expect(result.items.length).toBe(10);
    });

    it('classifies exactly 9 ARTICLE items and 1 ROUNDING/DISCOUNT item', () => {
      expect(result.summary.articleCount).toBe(9);
      expect(result.summary.discountCount).toBe(1);

      const types = result.items.map(it => it.type);
      const articleCount = types.filter(t => t === 'ARTICLE').length;
      const discountOrRoundingCount = types.filter(t => t === 'DISCOUNT' || t === 'ROUNDING').length;

      expect(articleCount).toBe(9);
      expect(discountOrRoundingCount).toBe(1);
    });

    it('preserves the exact original line sequence without dropping or inventing items', () => {
      const descriptions = result.items.map(it => it.description);
      expect(descriptions[0]).toContain('SHOPPERS BIO .MM320+');
      expect(descriptions[1]).toContain('PATATINE KETTLE');
      expect(descriptions[2]).toContain('PANE TRAMEZZINI');
      expect(descriptions[3]).toContain("ESTATHE' PESCA 3X20");
      expect(descriptions[4]).toContain('ARROTONDAMENTO');
      expect(descriptions[5]).toContain('GRANDE IMPERO 1000GR');
      expect(descriptions[6]).toContain('NUTELLA');
      expect(descriptions[7]).toContain('OLIVE VERDI C/ACCIUG');
      expect(descriptions[8]).toContain('POM.OBLUNGO PICCAD');
      expect(descriptions[9]).toContain('BOCCONCINI PUGL.TAKE');
    });

    it('correctly maps certain vs uncertain prices adhering to Ceccotti conservative rule', () => {
      // PATATINE KETTLE -> 1.99 (CERTAIN)
      expect(result.items[1].lineTotal).toBe(1.99);
      expect(result.items[1].monetaryEvidence.lineTotalEvidence).toBe('CERTAIN');

      // GRANDE IMPERO 1000GR -> 6.99 (CERTAIN)
      expect(result.items[5].lineTotal).toBe(6.99);
      expect(result.items[5].monetaryEvidence.lineTotalEvidence).toBe('CERTAIN');

      // NUTELLA -> 1.89 (PLAUSIBLE da 1’89)
      expect(result.items[6].lineTotal).toBe(1.89);
      expect(result.items[6].monetaryEvidence.lineTotalEvidence).toBe('PLAUSIBLE');

      // PANE TRAMEZZINI -> 189 PRA O -> null (AMBIGUOUS)
      expect(result.items[2].lineTotal).toBeNull();
      expect(result.items[2].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');

      // ESTATHE' PESCA -> 002 PERA -> null (AMBIGUOUS)
      expect(result.items[3].lineTotal).toBeNull();
      expect(result.items[3].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');

      // Sconto ARROTONDAMENTO -> 156 BC -> null (AMBIGUOUS)
      expect(result.items[4].lineTotal).toBeNull();
      expect(result.items[4].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');

      // SHOPPERS BIO -> null (MISSING)
      expect(result.items[0].lineTotal).toBeNull();
      expect(result.items[0].monetaryEvidence.lineTotalEvidence).toBe('MISSING');
      expect(result.items[0].warnings).toContain('PRICE_NOT_DETECTED');
    });
  });

  // =========================================================================
  // SCENARIO B: Nessuna Contaminazione da Header / Footer
  // =========================================================================
  describe('B. No Contamination from Header or Footer', () => {
    it('only parses the provided BODY lines and ignores external receipt elements', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);
      const result = LineItemParserV2.parseBody(zones.body);

      // Assenza di testata fiscale (T00IS, CASCI, VIA CARLO ALBIZZATI)
      const allText = result.items.map(i => i.rawText).join(' ');
      expect(allText).not.toContain('T00IS');
      expect(allText).not.toContain('CASCI S.r.]');
      expect(allText).not.toContain('DOCUMENTO COMMERCIALE');

      // Assenza di totali o forme di pagamento da footer (SUBTOTALE 21,90, Contanti 25,00, Resto 3,10)
      expect(allText).not.toContain('SUBTOTALE');
      expect(allText).not.toContain('TOTALE COMPLESSIVO');
      expect(allText).not.toContain('Pagamento contante');
      expect(allText).not.toContain('DETTAGLIO FORME di PAGAMENTO');
    });
  });

  // =========================================================================
  // SCENARIO C: Provenienza Immutabile (rawIndex, rawIndices, rawLines, rawText)
  // =========================================================================
  describe('C. Provenance and Immutability', () => {
    it('preserves accurate rawIndices matching the source raw document lines', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);
      const result = LineItemParserV2.parseBody(zones.body);

      // In TODIS, il BODY corrisponde esattamente alle righe raw 10..19
      expect(result.items[0].rawIndices).toEqual([10]);
      expect(result.items[1].rawIndices).toEqual([11]);
      expect(result.items[2].rawIndices).toEqual([12]);
      expect(result.items[3].rawIndices).toEqual([13]);
      expect(result.items[4].rawIndices).toEqual([14]);
      expect(result.items[5].rawIndices).toEqual([15]);
      expect(result.items[6].rawIndices).toEqual([16]);
      expect(result.items[7].rawIndices).toEqual([17]);
      expect(result.items[8].rawIndices).toEqual([18]);
      expect(result.items[9].rawIndices).toEqual([19]);

      // rawLines preservation
      result.items.forEach(item => {
        expect(item.rawLines.length).toBeGreaterThanOrEqual(1);
        expect(item.rawLines[0].rawIndex).toBe(item.rawIndices[0]);
        expect(typeof item.rawLines[0].rawText).toBe('string');
      });
    });
  });

  // =========================================================================
  // SCENARIO D: Prezzo Mancante -> null con Warning (Non €0 certo)
  // =========================================================================
  describe('D. Missing Price Handling (Unknown != €0.00)', () => {
    it('returns lineTotal as null with PRICE_NOT_DETECTED warning and does not invent zero', () => {
      const lines = createTestBodyLines(['ARTICOLO SENZA PREZZO 22,00%']);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.description).toBe('ARTICOLO SENZA PREZZO');
      expect(item.vatRate).toBe(22);
      expect(item.lineTotal).toBeNull();
      expect(item.monetaryEvidence.lineTotalEvidence).toBe('MISSING');
      expect(item.warnings).toContain('PRICE_NOT_DETECTED');
      expect(item.confidence.lineTotal).toBe(0.0);
    });
  });

  // =========================================================================
  // SCENARIO E: Prezzo Chiaramente Leggibile (CERTAIN)
  // =========================================================================
  describe('E. Clearly Readable Price (Certain Evidence)', () => {
    it('correctly extracts standard decimal prices with high confidence', () => {
      const lines = createTestBodyLines(['BISCOTTI AI CEREALI 10,00% 3,49']);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.description).toBe('BISCOTTI AI CEREALI');
      expect(item.vatRate).toBe(10);
      expect(item.lineTotal).toBe(3.49);
      expect(item.monetaryEvidence.lineTotalEvidence).toBe('CERTAIN');
      expect(item.confidence.lineTotal).toBeGreaterThanOrEqual(0.9);
      expect(item.warnings.length).toBe(0);
    });
  });

  // =========================================================================
  // SCENARIO F: Token Ambiguo (Regola Ceccotti)
  // =========================================================================
  describe('F. Ambiguous Token Handling (Candidate != Certain)', () => {
    it('classifies 3-4 digit unpunctuated tokens as AMBIGUOUS and does not force them to certain prices', () => {
      const lines = createTestBodyLines([
        'PRODOTTO ALFA 4,00% 189 PRA',
        'PRODOTTO BETA 22,00% 002 PERA',
        'PRODOTTO GAMMA 22,00% 156 BC',
      ]);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(3);

      // Alfa: 189 -> evidence AMBIGUOUS, lineTotal null, warning present, low confidence
      expect(result.items[0].lineTotal).toBeNull();
      expect(result.items[0].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');
      expect(result.items[0].confidence.lineTotal).toBeLessThanOrEqual(0.3);
      expect(result.items[0].warnings.some(w => w.includes('AMBIGUOUS_PRICE_FORMAT'))).toBe(true);

      // Beta: 002 -> evidence AMBIGUOUS, lineTotal null, warning present, low confidence
      expect(result.items[1].lineTotal).toBeNull();
      expect(result.items[1].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');
      expect(result.items[1].confidence.lineTotal).toBeLessThanOrEqual(0.3);
      expect(result.items[1].warnings.some(w => w.includes('AMBIGUOUS_PRICE_FORMAT'))).toBe(true);

      // Gamma: 156 -> evidence AMBIGUOUS, lineTotal null, warning present, low confidence
      expect(result.items[2].lineTotal).toBeNull();
      expect(result.items[2].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');
      expect(result.items[2].confidence.lineTotal).toBeLessThanOrEqual(0.3);
      expect(result.items[2].warnings.some(w => w.includes('AMBIGUOUS_PRICE_FORMAT'))).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO G: Descrizione + Prezzo su Riga Successiva
  // =========================================================================
  describe('G. Description with Price on Next Line', () => {
    it('attaches a price-only continuation line to the preceding incomplete article', () => {
      const lines = createTestBodyLines([
        'PRODOTTO SPECIALITA',
        '2,99 10%',
      ]);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.description).toBe('PRODOTTO SPECIALITA');
      expect(item.lineTotal).toBe(2.99);
      expect(item.vatRate).toBe(10);
      expect(item.rawIndices).toEqual([0, 1]);
      expect(item.rawLines.length).toBe(2);
    });
  });

  // =========================================================================
  // SCENARIO H: Moltiplicatore (es. 2 X 3,00 6,00)
  // =========================================================================
  describe('H. Multiplier Line Item Parsing', () => {
    it('correctly extracts quantity, unit price, and line total on a single line', () => {
      const lines = createTestBodyLines(['BIRRA MORETTI 2 X 3,00 6,00 22%']);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.description).toBe('BIRRA MORETTI');
      expect(item.quantity).toBe(2);
      expect(item.unitPrice).toBe(3.00);
      expect(item.lineTotal).toBe(6.00);
      expect(item.vatRate).toBe(22);
      expect(item.confidence.quantity).toBeGreaterThanOrEqual(0.9);
      expect(item.confidence.unitPrice).toBeGreaterThanOrEqual(0.9);
    });
  });

  // =========================================================================
  // SCENARIO I: Peso / Quantità con Unità di Misura (Multi-line e Single-line)
  // =========================================================================
  describe('I. Weight and Unit of Measure Parsing', () => {
    it('extracts weight and tariff on single line (0,500 KG X 12,00 6,00)', () => {
      const lines = createTestBodyLines(['PARMIGIANO REGGIANO 0,500 KG X 12,00 6,00 4%']);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.description).toBe('PARMIGIANO REGGIANO');
      expect(item.quantity).toBe(0.5);
      expect(item.unitOfMeasure).toBe('KG');
      expect(item.unitPrice).toBe(12.00);
      expect(item.lineTotal).toBe(6.00);
      expect(item.vatRate).toBe(4);
    });

    it('extracts weight across distributed consecutive lines', () => {
      const lines = createTestBodyLines([
        'PROSCIUTTO DI PARMA',
        '0,250 KG',
        'X 24,00 6,00',
      ]);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.description).toBe('PROSCIUTTO DI PARMA');
      expect(item.quantity).toBe(0.25);
      expect(item.unitOfMeasure).toBe('KG');
      expect(item.unitPrice).toBe(24.00);
      expect(item.lineTotal).toBe(6.00);
      expect(item.rawIndices).toEqual([0, 1, 2]);
    });
  });

  // =========================================================================
  // SCENARIO J: Sconto Negativo Leggibile
  // =========================================================================
  describe('J. Readable Negative Discount', () => {
    it('classifies DISCOUNT type with negative semantics when explicit amount is present', () => {
      const lines = createTestBodyLines(['BUONO SCONTO PROMO -2,50 22%']);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.type).toBe('DISCOUNT');
      expect(item.isNegative).toBe(true);
      expect(item.lineTotal).toBe(-2.50);
      expect(item.vatRate).toBe(22);
    });
  });

  // =========================================================================
  // SCENARIO K: Sconto con Importo Illeggibile
  // =========================================================================
  describe('K. Discount with Unreadable Amount', () => {
    it('identifies DISCOUNT type correctly while marking lineTotal as null/unknown', () => {
      const lines = createTestBodyLines(['SCONTO FEDELTA CARD 22,00%']);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.type).toBe('DISCOUNT');
      expect(item.isNegative).toBe(true);
      expect(item.lineTotal).toBeNull();
      expect(item.warnings).toContain('PRICE_NOT_DETECTED');
    });
  });

  // =========================================================================
  // SCENARIO L: Reso / Storno con Semantica Negativa
  // =========================================================================
  describe('L. Return and Void (Storno / Reso) Handling', () => {
    it('classifies RETURN type with negative sign for returns and voids', () => {
      const lines = createTestBodyLines(['STORNO ARTICOLO ERRATO 4,50 22%']);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.type).toBe('RETURN_STORNO');
      expect(item.isNegative).toBe(true);
      expect(item.lineTotal).toBe(-4.50);
    });
  });

  // =========================================================================
  // SCENARIO M: Descrizione Multilinea
  // =========================================================================
  describe('M. Multiline Description Merge', () => {
    it('merges consecutive description lines into a single line item preserving all rawIndices', () => {
      const lines = createTestBodyLines([
        'DETERGENTE LAVATRICE',
        'LIQUIDO CLASSICO 40LAV 5,99 22%',
      ]);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(1);
      const item = result.items[0];
      expect(item.description).toBe('DETERGENTE LAVATRICE LIQUIDO CLASSICO 40LAV');
      expect(item.lineTotal).toBe(5.99);
      expect(item.vatRate).toBe(22);
      expect(item.rawIndices).toEqual([0, 1]);
      expect(item.rawLines.length).toBe(2);
    });
  });

  // =========================================================================
  // SCENARIO N: Rumore Isolato nel BODY (Non diventa articolo)
  // =========================================================================
  describe('N. Body Noise Rejection', () => {
    it('filters out isolated non-article noise lines into unparsedNoiseLines', () => {
      const lines = createTestBodyLines([
        'PASTA DI SEMOLA 500G 0,89 4%',
        '*** * *',
        'SUGO AL BASILICO 1,49 10%',
      ]);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(2);
      expect(result.items[0].description).toBe('PASTA DI SEMOLA 500G');
      expect(result.items[1].description).toBe('SUGO AL BASILICO');
      expect(result.unparsedNoiseLines.length).toBe(1);
      expect(result.unparsedNoiseLines[0].text).toBe('*** * *');
    });
  });

  // =========================================================================
  // SCENARIO O: Assenza Assoluta di Hardcoding (Generalizzazione Multi-Insegna)
  // =========================================================================
  describe('O. Generalization across Diverse Store Formats (No Hardcoding)', () => {
    it('correctly processes a generic Coop/Conad/Esselunga style receipt body', () => {
      const lines = createTestBodyLines([
        'ACQUA MINERALE NAT 6X1.5L 1,80 22%',
        'FARINA TIPO 00 1KG 0,95 4%',
        'YOGURT GRECO BIANCO 2 X 1,10 2,20 10%',
        'MELE GOLDEN',
        '1,250 KG X 1,60 2,00 4%',
        'SCONTO CARTA SOCIO -1,00',
      ]);
      const result = LineItemParserV2.parseBody(lines);

      expect(result.items.length).toBe(5);

      // Acqua
      expect(result.items[0].description).toBe('ACQUA MINERALE NAT 6X1.5L');
      expect(result.items[0].lineTotal).toBe(1.80);
      expect(result.items[0].vatRate).toBe(22);

      // Farina
      expect(result.items[1].description).toBe('FARINA TIPO 00 1KG');
      expect(result.items[1].lineTotal).toBe(0.95);
      expect(result.items[1].vatRate).toBe(4);

      // Yogurt con moltiplicatore
      expect(result.items[2].description).toBe('YOGURT GRECO BIANCO');
      expect(result.items[2].quantity).toBe(2);
      expect(result.items[2].unitPrice).toBe(1.10);
      expect(result.items[2].lineTotal).toBe(2.20);
      expect(result.items[2].vatRate).toBe(10);

      // Mele pesate multiriga
      expect(result.items[3].description).toBe('MELE GOLDEN');
      expect(result.items[3].quantity).toBe(1.25);
      expect(result.items[3].unitOfMeasure).toBe('KG');
      expect(result.items[3].unitPrice).toBe(1.60);
      expect(result.items[3].lineTotal).toBe(2.00);
      expect(result.items[3].rawIndices).toEqual([3, 4]);

      // Sconto
      expect(result.items[4].type).toBe('DISCOUNT');
      expect(result.items[4].lineTotal).toBe(-1.00);
      expect(result.items[4].isNegative).toBe(true);
    });
  });

  // =========================================================================
  // TEST CONFIDENCE: Differenziazione per Campo (Ceccotti Contract)
  // =========================================================================
  describe('Confidence Scoring by Field', () => {
    it('produces distinct confidence scores for description, quantity, unitPrice, lineTotal, and vat', () => {
      const lines = createTestBodyLines([
        'PRODOTTO COMPLETO 2 X 5,00 10,00 22%',
        'PRODOTTO PARZIALE 22%',
      ]);
      const result = LineItemParserV2.parseBody(lines);

      const complete = result.items[0];
      expect(complete.confidence.description).toBeGreaterThanOrEqual(0.8);
      expect(complete.confidence.quantity).toBeGreaterThanOrEqual(0.9);
      expect(complete.confidence.unitPrice).toBeGreaterThanOrEqual(0.9);
      expect(complete.confidence.lineTotal).toBeGreaterThanOrEqual(0.9);
      expect(complete.confidence.vat).toBeGreaterThanOrEqual(0.9);
      expect(complete.confidence.overall).toBeGreaterThanOrEqual(0.9);

      const partial = result.items[1];
      expect(partial.confidence.description).toBeGreaterThanOrEqual(0.8);
      expect(partial.confidence.lineTotal).toBe(0.0);
      expect(partial.confidence.vat).toBeGreaterThanOrEqual(0.9);
      expect(partial.confidence.overall).toBeLessThan(complete.confidence.overall);
    });
  });
});
