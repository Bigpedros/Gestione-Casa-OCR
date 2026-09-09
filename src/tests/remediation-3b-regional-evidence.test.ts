import { describe, it, expect, beforeEach } from 'vitest';
import {
  findHighConfidenceBodyTotalCandidate,
  findHighConfidenceFooterTotalCandidate,
} from '../services/ocrParser/regional/shadowOrchestrator';
import { regionalEvidenceStore } from '../services/ocrParser/regional/regionalEvidenceStore';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { RegionalMonetaryToken, RegionalOcrEvidence } from '../services/ocrParser/regional/types';
import { ParsedReceiptDraft } from '../services/ocrParser/types';

describe('Remediation 3B & 3B-R1: Optical Regional Evidence Recovery & Store Lifecycle', () => {
  beforeEach(() => {
    regionalEvidenceStore.clear();
  });

  describe('1. findHighConfidenceBodyTotalCandidate & findHighConfidenceFooterTotalCandidate', () => {
    it('Rule 1: recovers total matching the sum of parsed receipt line items (min 2 items)', () => {
      const mockDraft: Partial<ParsedReceiptDraft> = {
        lines: [
          { originalText: 'ITEM A 10.00', normalizedDescription: 'ITEM A', quantity: 1, unitPrice: 10, lineTotal: 10, confidence: 90, reviewStatus: 'pending' as any, warnings: [] },
          { originalText: 'ITEM B 9.00', normalizedDescription: 'ITEM B', quantity: 1, unitPrice: 9, lineTotal: 9, confidence: 90, reviewStatus: 'pending' as any, warnings: [] },
        ],
      };

      const tokens: RegionalMonetaryToken[] = [
        { rawToken: '10,00', parsedValue: 10.0, lineIndex: 2, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '9,00', parsedValue: 9.0, lineIndex: 3, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '19,00', parsedValue: 19.0, lineIndex: 5, confidence: 90, classification: 'exact_monetary' },
      ];

      const candidate = findHighConfidenceBodyTotalCandidate(tokens, mockDraft);
      expect(candidate).not.toBeNull();
      expect(candidate?.parsedValue).toBe(19.0);
      expect(candidate?.confidence).toBe(95);
    });

    it('Rule 2: recovers total from fiscal duplication (Totale & Pagato) at end of list', () => {
      const mockDraft: Partial<ParsedReceiptDraft> = {
        lines: [],
      };

      const tokens: RegionalMonetaryToken[] = [
        { rawToken: '2,50', parsedValue: 2.5, lineIndex: 8, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '3,90', parsedValue: 3.9, lineIndex: 13, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '3,90', parsedValue: 3.9, lineIndex: 14, confidence: 90, classification: 'exact_monetary' },
      ];

      const candidate = findHighConfidenceBodyTotalCandidate(tokens, mockDraft);
      expect(candidate).not.toBeNull();
      expect(candidate?.parsedValue).toBe(3.9);
      expect(candidate?.confidence).toBe(90);
    });

    it('Ceccotti Rule: returns null if no high-confidence mathematical or fiscal match exists', () => {
      const mockDraft: Partial<ParsedReceiptDraft> = {
        lines: [],
      };

      const tokens: RegionalMonetaryToken[] = [
        { rawToken: '1,20', parsedValue: 1.2, lineIndex: 2, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '8,00', parsedValue: 8.0, lineIndex: 3, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '31,40', parsedValue: 31.4, lineIndex: 8, confidence: 90, classification: 'exact_monetary' },
      ];

      const candidate = findHighConfidenceBodyTotalCandidate(tokens, mockDraft);
      expect(candidate).toBeNull();
    });

    it('R1: candidate regional 29.00 from doc ID or article count without fiscal corroboration is NOT promoted', () => {
      const footerRawText = `NUMERO DI ARTICOLI: 9
Neg-lera Cassiera -Hum
27004-003-6000131-6077
AT 99MEY032908`;

      const tokens: RegionalMonetaryToken[] = [
        { rawToken: '29', parsedValue: 29.0, lineIndex: 2, confidence: 70, classification: 'exact_monetary' },
      ];

      const candidate = findHighConfidenceFooterTotalCandidate(footerRawText, tokens);
      expect(candidate).toBeNull();
    });

    it('R2: candidate from tender/payment/change (CONTANTI / RESTO) is NOT promoted as fiscal total', () => {
      const footerRawText = `DI FIAGLIO FORME di PAGAMENTO
Contanti 25,00
Resto 3,10
DOCUMENTO N. 2692`;

      const tokens: RegionalMonetaryToken[] = [
        { rawToken: '25,00', parsedValue: 25.0, lineIndex: 1, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '3,10', parsedValue: 3.1, lineIndex: 2, confidence: 90, classification: 'exact_monetary' },
      ];

      const candidate = findHighConfidenceFooterTotalCandidate(footerRawText, tokens);
      expect(candidate).toBeNull();
    });

    it('R3: mathematical corroboration with incomplete lines (< 2 items) is NOT sufficient on its own', () => {
      const mockDraft: Partial<ParsedReceiptDraft> = {
        lines: [
          { originalText: 'ARROTONDAMENTO 1.89', normalizedDescription: 'ARROTONDAMENTO', quantity: 1, unitPrice: 1.89, lineTotal: 1.89, confidence: 70, reviewStatus: 'pending' as any, warnings: [] },
        ],
      };

      const tokens: RegionalMonetaryToken[] = [
        { rawToken: '1,89', parsedValue: 1.89, lineIndex: 1, confidence: 90, classification: 'exact_monetary' },
        { rawToken: '21,90', parsedValue: 21.9, lineIndex: 5, confidence: 90, classification: 'exact_monetary' },
      ];

      // Single item matching itself does not validate the total of a multi-item receipt
      const candidate = findHighConfidenceBodyTotalCandidate(tokens, mockDraft);
      expect(candidate).toBeNull();
    });
  });

  describe('2. regionalEvidenceStore Lifecycle', () => {
    it('stores, consumes, and automatically clears evidence to prevent crosstalk', () => {
      const mockEvidence: RegionalOcrEvidence = {
        executed: true,
        triggerReason: 'missing_total',
        totalRecovered: 34.53,
        durationMs: 15,
      };

      regionalEvidenceStore.set(mockEvidence);
      expect(regionalEvidenceStore.get()).toBe(mockEvidence);

      const consumed = regionalEvidenceStore.consume();
      expect(consumed).toBe(mockEvidence);
      expect(regionalEvidenceStore.get()).toBeNull();
    });
  });

  describe('3. receiptParserService Regional Evidence Reconciliation & Guardrails (B1-B10, R1-R7)', () => {
    it('B1, B3 & R5: EURORISPARMIO high-confidence total 5.90 is recovered when full-page total is missing', () => {
      regionalEvidenceStore.set({
        executed: true,
        triggerReason: 'missing_total',
        totalRecovered: 5.90,
      });

      const rawText = `EURORISPARMIO CASA
DOCUMENTO COMMERCIALE
di vendita o prestazione
ARTICOLO CASA 5,90
TOTALE COMPLESSIVO d,9)
DOCUMENTO N. 1234
RT 991EB031114`;

      const draft = receiptParserService.parseText(rawText);
      expect(draft.total.value).toBe(5.90);
      expect(draft.total.confidence).toBe(90);
      expect(regionalEvidenceStore.get()).toBeNull();
    });

    it('B2, B8 & R7: when evidence is insufficient everywhere (e.g. TODIS), document total remains null + requiresManualReview', () => {
      regionalEvidenceStore.set({
        executed: true,
        triggerReason: 'missing_total',
        totalRecovered: null,
      });

      const rawText = `TODIS - BUONGIORNO CONVENIENZA
DOCUMENTO COMMERCIALE
di vendita o prestazione
SHOPPERS BIO
PATATINE KETTLE
TOTALE COMP! ESSIVO
di cui IVA
Pagamento c
Resto
Importo paoat
0-08-2026
IUCUMENTO N
AT 99MEY032908
DI FIAGLIO FORME di PAGAMENTO
Contanti
NUMERO DI AKTICOLI :9
Neg-lera Cassiera -Hum
27004-003-6000131-6077`;

      const draft = receiptParserService.parseText(rawText);
      expect(draft.total.value).toBeNull();
      expect(draft.requiresManualReview).toBe(true);
    });

    it('B4 & R2: regional footer with only payment method or tender does not fabricate fiscal total', () => {
      regionalEvidenceStore.set({
        executed: true,
        triggerReason: 'missing_total',
        footerEvidence: {
          executed: true,
          variantUsed: 'gentle_contrast',
          totalCandidate: null,
          paymentMethodCandidate: {
            rawText: 'POS BANCOMAT CARTA',
            method: 'carta',
            confidence: 85,
          },
          cropBox: { xPct: 0, yPct: 0.7, widthPct: 1, heightPct: 0.3 },
          rawText: 'POS BANCOMAT CARTA',
        },
        totalRecovered: null,
      });

      const rawText = `BAR CENTRALE
DOCUMENTO COMMERCIALE
di vendita o prestazione
CAFFE
DOCUMENTO N. 1234
RT 991EB031114`;

      const draft = receiptParserService.parseText(rawText);
      expect(draft.total.value).toBeNull();
      expect(draft.requiresManualReview).toBe(true);
    });

    it('B5: weak/ambiguous regional evidence does not overwrite existing strong primary total', () => {
      regionalEvidenceStore.set({
        executed: true,
        triggerReason: 'low_price_density',
        totalRecovered: 10.00,
      });

      const rawText = `SUPERMERCATO XYZ
DOCUMENTO COMMERCIALE
di vendita o prestazione
PANE 2,50
LATTE 1,50
TOTALE COMPLESSIVO 4,00
DOCUMENTO N. 1234
RT 991EB031114`;

      const draft = receiptParserService.parseText(rawText);
      // Primary total 4.00 perfectly matches line sum 4.00, so regional 10.00 does not overwrite
      expect(draft.total.value).toBe(4.00);
    });

    it('B6 & R6: rawText remains byte-for-byte immutable', () => {
      regionalEvidenceStore.set({
        executed: true,
        triggerReason: 'missing_total',
        totalRecovered: 34.53,
      });

      const rawText = `PEWEX SUPERMERCATI
DOCUMENTO COMMERCIALE
di vendita o prestazione
PANE 12,44
PANE 12,20
TOTALE COMPLESSIVO
DOCUMENTO N. 0972-0042
RT 991EB065409`;

      const originalRawTextCopy = rawText.slice();
      const draft = receiptParserService.parseText(rawText);
      expect(rawText).toBe(originalRawTextCopy);
      expect(draft.total.value).toBe(34.53);
    });

    it('R4: PEWEX high-confidence 34.53 continues to be recovered correctly', () => {
      regionalEvidenceStore.set({
        executed: true,
        triggerReason: 'missing_total',
        totalRecovered: 34.53,
      });

      const rawText = `PEWEX SUPERMERCATI
MGDR S.R.L.
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE Prezzo(E)
PANE 12,44
PANE 12,20
PEWEX SHOP 0,10
SAN BENED 0,69
SAN BENED 0,69
PANE 2,93
DOLCE 2,49
CLROMA 2,99
TOTALE COMPLESSIVO
31-07-2026 12:10
DOCUMENTO N. 0972-0042
RT 991EB065409`;

      const draft = receiptParserService.parseText(rawText);
      expect(draft.total.value).toBe(34.53);
    });

    it('B7: does not invent line prices if evidence is not present in body tokens', () => {
      const mockDraft: Partial<ParsedReceiptDraft> = {
        lines: [
          { originalText: 'PRODOTTO NO PREZZO', normalizedDescription: 'PRODOTTO NO PREZZO', quantity: 1, unitPrice: 0, lineTotal: 0, confidence: 50, reviewStatus: 'pending' as any, warnings: [] }
        ],
      };
      const candidate = findHighConfidenceBodyTotalCandidate([], mockDraft);
      expect(candidate).toBeNull();
    });

    it('B9: PAYMENT_PROOF documents are preserved without regression', () => {
      const rawText = `SCONTRINO POS
TRANSAZIONE BANCARIA
BANCOMAT
IMPORTO: 15,00 EUR
AUT: 123456
STAN: 987654`;

      const draft = receiptParserService.parseText(rawText);
      expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    });

    it('B10: already PASS documents (e.g. Eurospin) retain exact parsing results', () => {
      const rawText = `GRUPPO CAUCCI SRL
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE PREZZO(E) IVA
VASCH LIMONE 500G 2,69
SALSA YOGURT 1,39
TOTALE COMPLESSIVO 4,08
DOCUMENTO N. 0021-0195
RT 961KN022623`;

      const draft = receiptParserService.parseText(rawText);
      expect(draft.total.value).toBe(4.08);
      expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');
    });
  });
});
