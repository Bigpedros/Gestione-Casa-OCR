import { describe, it, expect } from 'vitest';
import { DocumentTypeClassifier } from '../services/ocrParser/modules/DocumentTypeClassifier';
import { TotalParser } from '../services/ocrParser/modules/TotalParser';
import { receiptParserService } from '../services/ocrParser';
import { ReceiptParserContext } from '../services/ocrParser/types';

function createMockContext(rawText: string): ReceiptParserContext {
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return {
    rawText,
    normalizedText: rawText.toUpperCase(),
    lines,
    normalizedLines: lines.map((l) => l.toUpperCase()),
    overallOcrConfidence: 0.85,
  };
}

describe('BLOCCO 3 — Remediation 3A Compliance & Regression Suite', () => {
  // =========================================================================
  // 2. REGRESSION TEST OBBLIGATORI — CLASSIFIER (C1 - C6)
  // =========================================================================
  describe('2. Classifier Regression Tests (C1 - C6)', () => {
    /**
     * C1 — Commercial receipt + POS slip
     * Struttura retail reale, articoli/prezzi multipli, elementi fiscali,
     * seguita da sezione POS con TID/STAN/AUTH.
     * Deve classificare COMMERCIAL_RECEIPT senza farsi convertire in PAYMENT_PROOF.
     */
    it('C1 — Commercial receipt + POS slip mantiene la classificazione COMMERCIAL_RECEIPT', () => {
      const input = `SUPERMERCATO MODERNO S.R.L.
VIA DEI CONDOTTI 10 - ROMA
P.IVA 01234567890
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE            IVA     PREZZO
PANE CASERECCIO         4%       1,80
LATTE INTERO 1L        10%       1,59
PROSCIUTTO COTTO 150G  10%       3,40
SUBTOTALE                        6,79
TOTALE COMPLESSIVO               6,79
DI CUI IVA                       0,55
PAGAMENTO ELETTRONICO            6,79
NUMERO ARTICOLI: 3
RT 99MEY1029384
DOC. N. 0123-0045

RICEVUTA POS - MEMORIA CLIENTE
TID: 88291039  STAN: 491029
AUT. CODE: 938102
CARTA: MASTERCARD  PAN: ************4912
IMPORTO: EUR 6,79
TRANSAZIONE ESEGUITA - APPROVED
GRAZIE E ARRIVEDERCI`;

      const result = DocumentTypeClassifier.classify(input);
      expect(result.category).toBe('COMMERCIAL_RECEIPT');
      expect(result.categoryScores.commercialReceipt).toBeGreaterThan(result.categoryScores.paymentProof);

      // Verifica via pipeline completa
      const draft = receiptParserService.parseText(input);
      expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');
    });

    /**
     * C2 — Pure POS
     * Ricevuta POS pura isolata (TID, STAN, AUTH, circuito, PAN mascherato, importo, esito approvato,
     * nessuna struttura articoli retail).
     * Deve classificare PAYMENT_PROOF.
     */
    it('C2 — Pure POS classifica come PAYMENT_PROOF', () => {
      const input = `RICEVUTA POS - MEMORIA CLIENTE
TID: 99401293  STAN: 002914
DATA: 09/09/2026 14:30
CIRCUITO: PAGOBANCOMAT
PAN: **** **** **** 8821
AUT. CODE: 049182
IMPORTO: EUR 45,50
TRANSAZIONE ESEGUITA
ESITO: OK - APPROVED
ARRIVEDERCI`;

      const result = DocumentTypeClassifier.classify(input);
      expect(result.category).toBe('PAYMENT_PROOF');
      expect(result.confidence).toBeGreaterThanOrEqual(0.70);

      const draft = receiptParserService.parseText(input);
      expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    });

    /**
     * C3 — Degraded commercial header
     * Header OCR degradato compatibile con frammenti tipo DOCUMENTO COMMERC... / COMMEE... / COMMERI...
     * accompagnato da robuste evidenze retail indipendenti (righe articoli, aliquote IVA, subtotale, RT).
     * Deve classificare COMMERCIAL_RECEIPT.
     */
    it('C3 — Degraded commercial header con corroborazione retail robusta classifica COMMERCIAL_RECEIPT', () => {
      const input = `MINIMARKET CENTRALE
VIA ROMA 25 - MILANO
DOCUMENTO COMMERC...
di vendita o prestazione
DESCRIZIONE            IVA     PREZZO
BISCOTTI FROLLINI      10%       2,50
SUCCO D ARANCIA        22%       1,90
MELE GOLDEN 1KG         4%       1,99
SUBTOTALE                        6,39
TOTALE COMPLESSIVO               6,39
NUMERO ARTICOLI: 3
RT 99ABC1234567`;

      const result = DocumentTypeClassifier.classify(input);
      expect(result.category).toBe('COMMERCIAL_RECEIPT');
      expect(result.evidences.some((e) => e.signal === 'CORROBORATED_DEGRADED_HEADER_COMMERCIAL_DOCUMENT')).toBe(true);

      const draft = receiptParserService.parseText(input);
      expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');
    });

    /**
     * C4 — Generic noisy text
     * Testo con parola/frammento generico "COMM" e alcuni numeri/importi,
     * ma nessuna vera struttura fiscale retail.
     * NON deve essere promosso automaticamente a COMMERCIAL_RECEIPT.
     */
    it('C4 — Generic noisy text con token COMM e numeri NON viene promosso a COMMERCIAL_RECEIPT', () => {
      const input = `NOTE VARIE E APPUNTI COMM
PROGETTO COMM 2026
NUMERI INDICATIVI 10,00 E 25,00
RIFERIMENTO DOC 456
VERIFICARE CON UFFICIO COMM`;

      const result = DocumentTypeClassifier.classify(input);
      expect(result.category).not.toBe('COMMERCIAL_RECEIPT');
      expect(result.category).toBe('UNKNOWN');

      const draft = receiptParserService.parseText(input);
      expect(draft.documentCategory).not.toBe('COMMERCIAL_RECEIPT');
    });

    /**
     * C5 — Invoice/Bill protection
     * Documento con importi multipli, POD/PDR o periodo/scadenza, elementi tipici bolletta/fattura.
     * Deve classificare INVOICE_OR_BILL e non farsi scavalcare da regole retail.
     */
    it('C5 — Invoice/Bill protection: elementi di utenza o fattura prevalgono su retail', () => {
      const input = `SERVIZIO ENERGIA NAZIONALE S.P.A.
FATTURA ELETTRONICA N. 2026-994819
Periodo di fatturazione: 01/07/2026 - 31/08/2026
Data scadenza: 28/09/2026
POD: IT001E123456789
Potenza impegnata: 3 kW
Consumi fatturati: 180 kWh
Quota fissa energia: 15,00 €
Quota energia: 45,50 €
Imposte erariali: 8,20 €
Totale imponibile: 68,70 €
IVA 10%: 6,87 €
TOTALE DA PAGARE: 75,57 €`;

      const result = DocumentTypeClassifier.classify(input);
      expect(result.category).toBe('INVOICE_OR_BILL');
      expect(result.categoryScores.invoiceOrBill).toBeGreaterThan(60);

      const draft = receiptParserService.parseText(input);
      expect(draft.documentCategory).toBe('INVOICE_OR_BILL');
    });

    /**
     * C6 — Payment proof with generic commercial-looking noise
     * Ricevuta POS pura contenente accidentalmente termini come COMM, CASSA, DOCUMENT,
     * ma senza corroborazione retail sufficiente.
     * Deve rimanere PAYMENT_PROOF.
     */
    it('C6 — Payment proof con rumore generico COMM / CASSA / DOCUMENT rimane PAYMENT_PROOF', () => {
      const input = `RICEVUTA POS - MEMORIA CLIENTE
DOCUMENT POS CASSA 02
COMM NETWORK PSP
TID: 88491029  STAN: 001928
AUT. CODE: 481920
CARTA MASTERCARD PAN ************9102
IMPORTO EUR 32,00
TRANSAZIONE ESEGUITA - APPROVED`;

      const result = DocumentTypeClassifier.classify(input);
      expect(result.category).toBe('PAYMENT_PROOF');

      const draft = receiptParserService.parseText(input);
      expect(draft.documentCategory).toBe('PAYMENT_PROOF');
    });
  });

  // =========================================================================
  // 3. REGRESSION TEST OBBLIGATORI — TOTALPARSER (T1 - T7)
  // =========================================================================
  describe('3. TotalParser Regression Tests (T1 - T7)', () => {
    const totalParser = new TotalParser();

    /**
     * T1 — Explicit fiscal total
     * Input: TOTALE 21,90
     * Expected: 21.90
     */
    it('T1 — Explicit fiscal total estrae esattamente il totale indicato', () => {
      const raw = `DOCUMENTO COMMERCIALE
di vendita o prestazione
ARTICOLO A 10,00
ARTICOLO B 11,90
TOTALE 21,90`;

      const context = createMockContext(raw);
      const parsed = totalParser.parse(context);
      expect(parsed.value).toBe(21.90);

      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBe(21.90);
    });

    /**
     * T2 — Degraded total + isolated payment amount
     * TOTALE COMPLESSIVO d,9 ... CARTA 25,00 senza altra corroborazione fiscale.
     * Expected: null con warning TOTALE_PRESENTE_MA_ILLEGGIBILE.
     */
    it('T2 — Degraded total con importo pagamento isolato restituisce null e TOTALE_PRESENTE_MA_ILLEGGIBILE', () => {
      const raw = `DOCUMENTO COMMERCIALE
di vendita o prestazione
ARTICOLO X 12,00
TOTALE COMPLESSIVO d,9)
PAGAMENTO ELETTRONICO
CARTA 25,00`;

      const context = createMockContext(raw);
      const parsed = totalParser.parse(context);
      expect(parsed.value).toBeNull();
      expect(parsed.warnings).toContain('TOTALE_PRESENTE_MA_ILLEGGIBILE');

      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBeNull();
      expect(draft.total.warnings).toContain('TOTALE_PRESENTE_MA_ILLEGGIBILE');
    });

    /**
     * T3 — Explicit fiscal total vs payment
     * TOTALE 21,90, CONTANTI 25,00, RESTO 3,10
     * Expected: 21.90. Mai 25.00 o 3.10.
     */
    it('T3 — Explicit fiscal total prevale su contanti e resto', () => {
      const raw = `DOCUMENTO COMMERCIALE
PRODOTTO ALIMENTARE 21,90
TOTALE 21,90
CONTANTI 25,00
RESTO 3,10`;

      const context = createMockContext(raw);
      const parsed = totalParser.parse(context);
      expect(parsed.value).toBe(21.90);
      expect(parsed.value).not.toBe(25.00);
      expect(parsed.value).not.toBe(3.10);

      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBe(21.90);
    });

    /**
     * T4 — POS corroboration legitimately equal to total
     * Il totale fiscale e le evidenze POS concordano legittimamente sullo stesso importo.
     * Expected: valore corretto preservato con confidenza elevata.
     */
    it('T4 — POS corroboration legittima preserva il valore concordato', () => {
      const raw = `DOCUMENTO COMMERCIALE
di vendita o prestazione
PRODOTTO 18,50
TOTALE COMPLESSIVO 18,50
PAGAMENTO ELETTRONICO 18,50
POS BANCOMAT 18,50`;

      const context = createMockContext(raw);
      const parsed = totalParser.parse(context);
      expect(parsed.value).toBe(18.50);
      expect(parsed.confidence).toBeGreaterThanOrEqual(90);

      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBe(18.50);
    });

    /**
     * T5 — ALTRI IMPORTI isolation
     * La sezione ALTRI IMPORTI non deve assorbire o promuovere il suo importo come totale generale.
     */
    it('T5 — ALTRI IMPORTI isolation: importi in altri addebiti non diventano il totale', () => {
      const raw = `DOCUMENTO COMMERCIALE
SPESA GENERALE 40,00
TOTALE COMPLESSIVO 40,00
ALTRI IMPORTI 4,50
SERVIZIO ACCESSORIO 4,50`;

      const context = createMockContext(raw);
      const parsed = totalParser.parse(context);
      expect(parsed.value).toBe(40.00);
      expect(parsed.value).not.toBe(4.50);

      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBe(40.00);
    });

    /**
     * T6 — SUBTOTALE vs TOTALE
     * Entrambi presenti: il totale fiscale ha priorità secondo le regole del cluster.
     */
    it('T6 — SUBTOTALE vs TOTALE: TOTALE COMPLESSIVO ha priorità su SUBTOTALE', () => {
      const raw = `DOCUMENTO COMMERCIALE
ARTICOLO 1 20,00
SPESE ACCESSORIE 5,00
SUBTOTALE 20,00
TOTALE COMPLESSIVO 25,00`;

      const context = createMockContext(raw);
      const parsed = totalParser.parse(context);
      expect(parsed.value).toBe(25.00);

      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBe(25.00);
    });

    /**
     * T7 — Total label degraded but no safe monetary evidence
     * Etichetta di totale degradata senza alcuna evidenza monetaria sicura.
     * Expected: null + manual review / warning, mai una cifra inventata.
     */
    it('T7 — Total label degraded senza evidenze monetarie sicure restituisce null e warning', () => {
      const raw = `DOCUMENTO COMMERCIALE
DESCRIZIONE ARTICOLI
TOTALE COMPLESSIVO d,.--
FINE DOCUMENTO`;

      const context = createMockContext(raw);
      const parsed = totalParser.parse(context);
      expect(parsed.value).toBeNull();
      expect(parsed.warnings).toBeDefined();

      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBeNull();
    });
  });
});
