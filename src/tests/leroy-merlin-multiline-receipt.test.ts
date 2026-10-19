import { describe, it, expect } from 'vitest';
import { ReceiptZoneSegmenter } from '../services/ocrParser/modules/ReceiptZoneSegmenter';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { TextNormalizationModule } from '../services/ocrParser/modules/TextNormalizationModule';
import { receiptParserService } from '../services/ocrParser/receiptParserService';

describe('PATCH LM-1 — Leroy Merlin Multi-line Item Support & Regression Guard', () => {
  const LEROY_MERLIN_RAW = `IDRAULICA E COMPORT
Unità esterna condizionatore COMPFEE mono
J 98644099 179.00
Unità interna condizionatore COMPEE 1091
J 98644101 100.00
SUBTOTALE 279.00
TOTALE (€ ) 279.00`;

  // =========================================================================
  // TEST A: Test Diretto ReceiptZoneSegmenter
  // =========================================================================
  describe('A. Direct ReceiptZoneSegmenter multi-line pair segmentation', () => {
    it('correctly detects body start on first product description and isolates both pairs into BODY', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(LEROY_MERLIN_RAW);
      const zones = ReceiptZoneSegmenter.segment(norm);

      // 1. Il body NON deve essere vuoto
      expect(zones.body.length).toBe(4);

      // 2. L'header contiene solo la riga iniziale non-articolo
      expect(zones.header.length).toBe(1);
      expect(zones.header[0].text).toContain('IDRAULICA E COMPORT');

      // 3. Il body inizia dalla prima descrizione prodotto
      expect(zones.body[0].text).toContain('Unità esterna condizionatore COMPFEE mono');
      expect(zones.body[1].text).toContain('J 98644099 179.00');
      expect(zones.body[2].text).toContain('Unità interna condizionatore COMPEE 1091');
      expect(zones.body[3].text).toContain('J 98644101 100.00');

      // 4. SUBTOTALE e TOTALE sono confinati in TOTALS_FOOTER e non nel BODY
      expect(zones.totalsFooter.length).toBe(2);
      expect(zones.totalsFooter[0].text).toContain('SUBTOTALE 279.00');
      expect(zones.totalsFooter[1].text).toContain('TOTALE (€ ) 279.00');

      const bodyTexts = zones.body.map((b) => b.text);
      expect(bodyTexts.some((t) => t.includes('SUBTOTALE'))).toBe(false);
      expect(bodyTexts.some((t) => t.includes('TOTALE'))).toBe(false);
    });
  });

  // =========================================================================
  // TEST B: Test Parser Integrato (LineItemParserV2 & receiptParserService)
  // =========================================================================
  describe('B. Integrated Parser & Reconciliation Verification', () => {
    it('parses exactly 2 articles with correct prices and zero discrepancy via LineItemParserV2', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(LEROY_MERLIN_RAW);
      const zones = ReceiptZoneSegmenter.segment(norm);
      const v2Result = LineItemParserV2.parseBody(zones.body);

      // Conteggio articoli
      expect(v2Result.summary.articleCount).toBe(2);
      expect(v2Result.items.length).toBe(2);
      expect(v2Result.legacyLines.length).toBe(2);

      // Articolo 1: 179.00
      expect(v2Result.items[0].description).toContain('Unità esterna condizionatore COMPFEE mono');
      expect(v2Result.items[0].lineTotal).toBe(179.0);

      // Articolo 2: 100.00
      expect(v2Result.items[1].description).toContain('Unità interna condizionatore COMPEE 1091');
      expect(v2Result.items[1].lineTotal).toBe(100.0);

      // Somma articoli: 279.00
      const sum = v2Result.items.reduce((acc, it) => acc + (it.lineTotal || 0), 0);
      expect(sum).toBe(279.0);
    });

    it('reconciles end-to-end with detected total 279.00 and 0 discrepancy in receiptParserService', () => {
      const draft = receiptParserService.parseText(LEROY_MERLIN_RAW);

      expect(draft.lines.length).toBe(2);
      expect(draft.lines[0].normalizedDescription).toContain('Unità esterna condizionatore COMPFEE mono');
      expect(draft.lines[0].lineTotal).toBe(179.0);
      expect(draft.lines[1].normalizedDescription).toContain('Unità interna condizionatore COMPEE 1091');
      expect(draft.lines[1].lineTotal).toBe(100.0);

      expect(draft.total.value).toBe(279.0);

      const sum = draft.lines.reduce((acc, l) => acc + (l.lineTotal || 0), 0);
      const discrepancy = Math.abs(sum - (draft.total.value || 0));
      expect(discrepancy).toBe(0);
      expect(draft.requiresManualReview).toBe(false);
    });
  });

  // =========================================================================
  // TEST C: Negative Regression Guards
  // =========================================================================
  describe('C. Negative Regression Guards (No false positive body activations)', () => {
    it('does NOT activate body on isolated TOTALE line', () => {
      const raw = `DOCUMENTO FISCALE
TOTALE 279.00`;
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.body.length).toBe(0);
    });

    it('does NOT activate body on SUBTOTALE + TOTALE sequence', () => {
      const raw = `DOCUMENTO FISCALE
SUBTOTALE 279.00
TOTALE 279.00`;
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.body.length).toBe(0);
    });

    it('does NOT activate body on isolated SKU/price line without valid preceding description', () => {
      const raw = `LEROY MERLIN S.R.L.
P.IVA 12345678901
J 98644099 179.00
TOTALE 179.00`;
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      // P.IVA e S.R.L. sono bloccati come header e non possono formare una coppia multilinea con J 98644099
      expect(zones.body.length).toBe(0);
    });

    it('does NOT activate body on store address or fiscal metadata followed by price', () => {
      const raw = `LEROY MERLIN ITALIA S.R.L.
VIA DEI MILLE 10
P.IVA 01234567890
CASSA 01
PAGAMENTO CONTANTI 50.00
TOTALE 50.00`;
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.body.length).toBe(0);
    });
  });
});

