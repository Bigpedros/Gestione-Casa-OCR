import { describe, it, expect } from 'vitest';
import { ReceiptParserService } from '../services/ocrParser/receiptParserService';
import { SupplierParser } from '../services/ocrParser/modules/SupplierParser';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import {
  OCR_CONFIDENCE_MIN_RELIABLE,
  OCR_QUALITY_SCORE_MIN_RELIABLE,
  OCR_QUALITY_SCORE_CRITICAL_LOW,
  MAX_CONFIDENCE_UNKNOWN_CATEGORY,
  MAX_CONFIDENCE_CRITICAL_OCR_QUALITY,
  MAX_CONFIDENCE_NO_RELIABLE_LINES,
  MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
} from '../services/ocrParser/constants';

describe('P4-D1-R1 — OCR Quality Safety Gate & Noise Suppression Suite', () => {
  const parserService = new ReceiptParserService();

  // Testo reale estratto da OCR-REAL-COLOR-01 (con bande rosse fine rotolo)
  const COLOR_01_RAW_TEXT = `(A AQUILE DELL BELLEZA 8 A DI BARCO oi
PARTI ZA DNA 12011
‘DOCUMENTO COMMERCIALE
‘di vendita o prestazione
DescrzIne IVA Pragzol
PEDICURE 22,00% 25,00
‘TOTALE COMPLESSIVO 25,00
di cui IVA 4,51
‘Pagamento elettronico 25,00
‘Non fiscale
‘28-08-2026 15:24
‘DOCUMENTO N. 0939-0009
‘RT 99MEY807185`;

  // Testo reale estratto da OCR-REAL-FADED-01 (scontrino fortemente sbiadito/degradato)
  const FADED_01_RAW_TEXT = `ri 1% po
LA RON
DOCIMENTO MPa
L. vauita U ‘UilE
DESTZINE TM Pragzol
IC 2 Eue omo Adii TA LI
02-09-2028`;

  describe('1. Documento OCR-REAL-COLOR-01 (Commercial Receipt con rumore moderato)', () => {
    it('classifica correttamente come COMMERCIAL_RECEIPT e estrae dati strutturati', () => {
      const draft = parserService.parseText(COLOR_01_RAW_TEXT, {
        overallOcrConfidence: 50.8,
        ocrQualityScore: 38.3,
      });

      expect(draft.supplier.value).toBeTruthy();
      expect(draft.supplier.value).toContain('BELLEZA');
      // La confidenza del fornitore è prudenziale con warning
      expect(draft.supplier.confidence).toBeLessThanOrEqual(85);

      // Totale e IVA
      expect(draft.total.value).toBe(25.0);
      expect(draft.vat.value).toBe(4.51);

      // Metodo di pagamento elettronico (ripulito da apici sporchi)
      expect(draft.paymentMethod.value).toBe('carta');
      expect(draft.paymentMethod.confidence).toBeGreaterThanOrEqual(70);

      // Data e ora
      expect(draft.date.value).toBe('2026-08-28');
      expect(draft.time.value).toBe('15:24');

      // Righe estratte: PEDICURE da 25.00 €
      expect(draft.lines.length).toBe(1);
      expect(draft.lines[0].normalizedDescription).toContain('PEDICURE');
      expect(draft.lines[0].lineTotal).toBe(25.0);
      expect(draft.lines[0].unitPrice).toBe(25.0);
    });
  });

  describe('2. Documento OCR-REAL-FADED-01 (Qualità Critica / Sbiadito)', () => {
    it('Safety Gate: sopprime fornitore fittizio, sopprime righe da rumore e impone requiresManualReview', () => {
      const draft = parserService.parseText(FADED_01_RAW_TEXT, {
        overallOcrConfidence: 45.0,
        ocrQualityScore: 8.0, // Qualità gravemente compromessa
      });

      // Fornitore: NESSUNA allucinazione (value: null)
      expect(draft.supplier.value).toBeNull();
      expect(draft.supplier.warnings).toContain('qualita_ocr_insufficiente');

      // Righe: i frammenti spuri (es. "ri 1% po", "DESTZINE TM Pragzol") sono soppressi come rumore
      expect(draft.lines.length).toBe(0);

      // OverallConfidence bloccata sotto il cap di sicurezza per UNKNOWN / Qualità critica (<= 30%)
      expect(draft.overallConfidence).toBeLessThanOrEqual(MAX_CONFIDENCE_CRITICAL_OCR_QUALITY);
      expect(draft.overallConfidence).toBeLessThanOrEqual(MAX_CONFIDENCE_UNKNOWN_CATEGORY);

      // Flag di revisione manuale obbligatorio
      expect(draft.requiresManualReview).toBe(true);

      // Warning di qualità critica presente
      const warningCodes = draft.warnings.map((w) => w.code);
      expect(warningCodes).toContain('CRITICAL_OCR_QUALITY');
      expect(warningCodes).toContain('UNKNOWN_DOCUMENT_CATEGORY');
    });

    it('SupplierParser isolato rifiuta testi privi di validità societaria/strutturale in bassa qualità', () => {
      const supplierParser = new SupplierParser();
      const result = supplierParser.parse({
        rawText: FADED_01_RAW_TEXT,
        normalizedText: FADED_01_RAW_TEXT,
        lines: FADED_01_RAW_TEXT.split('\n'),
        normalizedLines: FADED_01_RAW_TEXT.split('\n'),
        overallOcrConfidence: 40,
        ocrQualityScore: 8,
        documentType: 'UNKNOWN',
      });

      expect(result.value).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.warnings).toContain('qualita_ocr_insufficiente');
    });
  });

  describe('3. Noise Suppression & Regola Ceccotti Preservation', () => {
    it('sopprime rumore isolato senza prezzo ma preserva articoli legittimi privi di prezzo con PRICE_NOT_DETECTED', () => {
      const legitUnpricedText = `SUPERMERCATO BELLO SRL
VIA ROMA 10, MILANO
P.IVA 01234567890
DOCUMENTO COMMERCIALE
DESCRIZIONE IVA EURO
YOGURT GRECO NATURALE
TOTALE 10,00`;

      const draft = parserService.parseText(legitUnpricedText, {
        overallOcrConfidence: 85,
        ocrQualityScore: 80,
      });

      // L'articolo legittimo "YOGURT GRECO NATURALE" deve essere preservato ma con warning PRICE_NOT_DETECTED
      expect(draft.lines.length).toBe(1);
      expect(draft.lines[0].normalizedDescription).toBe('YOGURT GRECO NATURALE');
      expect(draft.lines[0].lineTotal).toBe(0);
      expect(draft.lines[0].warnings).toContain('PRICE_NOT_DETECTED');

      // Regola Ceccotti: attiva la richiesta di revisione manuale
      expect(draft.requiresManualReview).toBe(true);
      const warningCodes = draft.warnings.map((w) => w.code);
      expect(warningCodes).toContain('UNRESOLVED_PRICE_WARNING');
    });

    it('LineItemParserV2 categorizza come rumore sequenze di simboli e frammenti non alfabetici', () => {
      const noiseBody = [
        {
          index: 0,
          rawIndex: 0,
          rawText: 'ri 1% po',
          text: 'ri 1% po',
          zone: 'BODY' as const,
          confidence: 0.3,
          reasons: ['body_line'],
        },
        {
          index: 1,
          rawIndex: 1,
          rawText: 'DOCIMENTO MPa',
          text: 'DOCIMENTO MPa',
          zone: 'BODY' as const,
          confidence: 0.3,
          reasons: ['body_line'],
        },
        {
          index: 2,
          rawIndex: 2,
          rawText: 'DESTZINE TM Pragzol',
          text: 'DESTZINE TM Pragzol',
          zone: 'BODY' as const,
          confidence: 0.3,
          reasons: ['body_line'],
        },
      ];

      const result = LineItemParserV2.parseBody(noiseBody);
      expect(result.items.length).toBe(0);
      expect(result.legacyLines.length).toBe(0);
      expect(result.unparsedNoiseLines.length).toBe(3);
    });
  });

  describe('4. Safety Gate Thresholds & Constants Integrity', () => {
    it('verifica i valori delle soglie di sicurezza centralizzate', () => {
      expect(OCR_CONFIDENCE_MIN_RELIABLE).toBe(60);
      expect(OCR_QUALITY_SCORE_MIN_RELIABLE).toBe(35);
      expect(OCR_QUALITY_SCORE_CRITICAL_LOW).toBe(20);
      expect(MAX_CONFIDENCE_UNKNOWN_CATEGORY).toBe(35);
      expect(MAX_CONFIDENCE_CRITICAL_OCR_QUALITY).toBe(30);
      expect(MAX_CONFIDENCE_NO_RELIABLE_LINES).toBe(50);
      expect(MANUAL_REVIEW_CONFIDENCE_THRESHOLD).toBe(70);
    });
  });
});
