import { describe, it, expect } from 'vitest';
import { PaymentEvidenceParser } from '../services/ocrParser/modules/PaymentEvidenceParser';
import { DocumentTypeClassifier } from '../services/ocrParser/modules/DocumentTypeClassifier';

describe('PaymentEvidenceParser (Blocco P3)', () => {
  describe('Scenari Fondamentali (A-O)', () => {
    it('A. POS completo: estrae importo, esercente, data/ora, STAN, AuthCode, TID, circuito e masked PAN', () => {
      const rawPosText = `BAR GELATERIA IL GABBIANO
VIA ROMA 45, 00100 ROMA
DATA 28/08/2026 ORA 15:42
TID: 88472910
STAN: 004829
AUT. CODE: 938210
CARTA: **** **** **** 4821
CIRCUITO: MASTERCARD
IMPORTO: €12,50
TRANSAZIONE ESEGUITA
COPIA CLIENTE`;

      const result = PaymentEvidenceParser.parse(rawPosText);

      expect(result.subtype).toBe('POS_RECEIPT');
      expect(result.amount).toBe(12.50);
      expect(result.fee).toBeNull();
      expect(result.totalCharged).toBe(12.50);
      expect(result.dateTime).toBe('2026-08-28T15:42:00');
      expect(result.merchantOrBeneficiary).toContain('IL GABBIANO');
      expect(result.transactionReference).toBe('004829'); // STAN preferito
      expect(result.paymentMethodHint.circuitOrBrand).toBe('Mastercard');
      expect(result.paymentMethodHint.macroCategoryHint).toBe('creditCard');
      expect(result.paymentMethodHint.maskedPan).toBe('**** **** **** 4821');
      expect(result.paymentChannelHint).toBe('POS');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.warnings).not.toContain('AMOUNT_NOT_DETECTED');
    });

    it('B. POS con importo ma riferimento mancante (STAN/AuthCode assenti)', () => {
      const posWithoutRef = `PIZZERIA BELLA NAPOLI
DATA: 15/07/2026 21:30
PAGAMENTO CARTA
IMPORTO: €34,00
TRANSAZIONE APPROVATA
MEMORIA CLIENTE`;

      const result = PaymentEvidenceParser.parse(posWithoutRef);

      expect(result.subtype).toBe('POS_RECEIPT');
      expect(result.amount).toBe(34.00);
      expect(result.dateTime).toBe('2026-07-15T21:30:00');
      expect(result.merchantOrBeneficiary).toContain('PIZZERIA BELLA NAPOLI');
      expect(result.transactionReference).toBeNull();
      expect(result.warnings).toContain('REFERENCE_NOT_DETECTED');
      expect(result.confidence).toBeLessThan(0.85);
      expect(result.confidence).toBeGreaterThanOrEqual(0.60);
    });

    it('C. PagoPA con IUV e commissione separata', () => {
      const pagopaWithFee = `RICEVUTA TELEMATICA PAGOPA
Ente Creditore: COMUNE DI FIRENZE
Codice Avviso: 302000001234567890
IUV: 000000012345678
Data Operazione: 10/05/2026 10:15
Importo: €85,00
Commissione applicata dal PSP: €1,30
Totale addebitato: €86,30
Esito: Pagamento eseguito con successo`;

      const result = PaymentEvidenceParser.parse(pagopaWithFee);

      expect(result.subtype).toBe('PAGOPA_RECEIPT');
      expect(result.amount).toBe(85.00);
      expect(result.fee).toBe(1.30);
      expect(result.totalCharged).toBe(86.30);
      expect(result.dateTime).toBe('2026-05-10T10:15:00');
      expect(result.merchantOrBeneficiary).toBe('COMUNE DI FIRENZE');
      expect(result.transactionReference).toBe('000000012345678');
      expect(result.paymentChannelHint).toBe('PagoPA');
      expect(result.confidence).toBeGreaterThanOrEqual(0.90);
    });

    it('D. PagoPA senza commissione (fee null, non 0)', () => {
      const pagopaNoFee = `QUIETANZA PAGOPA
Ente Creditore: REGIONE LOMBARDIA - TASSA AUTO
IUV: 998877665544332
Data Pagamento: 02/03/2026 16:20
Importo dovuto: €142,50
Esito: Eseguito`;

      const result = PaymentEvidenceParser.parse(pagopaNoFee);

      expect(result.subtype).toBe('PAGOPA_RECEIPT');
      expect(result.amount).toBe(142.50);
      expect(result.fee).toBeNull(); // Principio Ceccotti: fee null se non rilevata
      expect(result.totalCharged).toBe(142.50);
      expect(result.merchantOrBeneficiary).toBe('REGIONE LOMBARDIA - TASSA AUTO');
      expect(result.transactionReference).toBe('998877665544332');
    });

    it('E. Bonifico con TRN', () => {
      const bonificoTrn = `RICEVUTA BONIFICO SEPA
Data esecuzione: 18/06/2026 09:30
Beneficiario: IMMOBILIARE SAN MARCO S.R.L.
IBAN: IT60X0542811101000000123456
TRN: 2606180930SEPA12345678901234567
Causale: Canone locazione mese Giugno 2026
Importo: €650,00
Commissione: €1,00
Totale addebitato: €651,00
Stato: Eseguito`;

      const result = PaymentEvidenceParser.parse(bonificoTrn);

      expect(result.subtype).toBe('BANK_TRANSFER_RECEIPT');
      expect(result.amount).toBe(650.00);
      expect(result.fee).toBe(1.00);
      expect(result.totalCharged).toBe(651.00);
      expect(result.dateTime).toBe('2026-06-18T09:30:00');
      expect(result.merchantOrBeneficiary).toBe('IMMOBILIARE SAN MARCO S.R.L.');
      expect(result.transactionReference).toBe('2606180930SEPA12345678901234567');
      expect(result.paymentMethodHint.macroCategoryHint).toBe('bankTransfer');
      expect(result.paymentChannelHint).toBe('SEPA_TRANSFER');
      expect(result.unparsedRelevantLines.some((l) => l.includes('IBAN'))).toBe(true);
    });

    it('F. Bonifico con CRO', () => {
      const bonificoCro = `DISPOSIZIONE DI BONIFICO BANCARIO
Data: 22/04/2026
Beneficiario: MARIO ROSSI
CRO: 12345678901
Importo: €120,00`;

      const result = PaymentEvidenceParser.parse(bonificoCro);

      expect(result.subtype).toBe('BANK_TRANSFER_RECEIPT');
      expect(result.amount).toBe(120.00);
      expect(result.fee).toBeNull();
      expect(result.dateTime).toBe('2026-04-22T00:00:00');
      expect(result.merchantOrBeneficiary).toBe('MARIO ROSSI');
      expect(result.transactionReference).toBe('12345678901');
    });

    it('G. Punto autorizzato / Ricevitoria con commissione', () => {
      const sisalText = `PUNTO SISALPAY / MOONEY
Tabacchi N. 12
Servizio: PAGAMENTO BOLLETTA UTENZE
Data: 14/08/2026 11:25
ID Transazione: MOON-98371892
Importo: €48,20
Commissione servizio: €2,00
Totale pagato: €50,20
Operazione completata`;

      const result = PaymentEvidenceParser.parse(sisalText);

      expect(result.subtype).toBe('SISAL_OR_AUTHORIZED_POINT');
      expect(result.amount).toBe(48.20);
      expect(result.fee).toBe(2.00);
      expect(result.totalCharged).toBe(50.20);
      expect(result.dateTime).toBe('2026-08-14T11:25:00');
      expect(result.transactionReference).toBe('MOON-98371892');
      expect(result.paymentChannelHint).toBe('SISAL_POINT');
    });

    it('H. Crypto payment BTC con TxID e controvalore FIAT', () => {
      const cryptoBtcPayment = `PAGAMENTO ESEGUITO
Beneficiario: NEGOZIO ALFA
Importo: 0,000250 BTC
Controvalore: €15,00
Commissione rete: €0,40
Transaction ID: 0x8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b
Data/Ora: 28/08/2026 17:42`;

      const result = PaymentEvidenceParser.parse(cryptoBtcPayment);

      expect(result.subtype).toBe('CRYPTO_PAYMENT');
      expect(result.amount).toBe(15.00); // Controvalore FIAT come amount principale
      expect(result.fee).toBe(0.40);
      expect(result.totalCharged).toBe(15.40);
      expect(result.dateTime).toBe('2026-08-28T17:42:00');
      expect(result.merchantOrBeneficiary).toBe('NEGOZIO ALFA');
      expect(result.transactionReference).toBe('0x8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b');
      expect(result.cryptoDetails?.cryptoAmount).toBe(0.00025);
      expect(result.cryptoDetails?.cryptoAsset).toBe('BTC');
      expect(result.cryptoDetails?.txHash).toBe('0x8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b');
    });

    it('I. Crypto payment con asset non precablato (SOL)', () => {
      const cryptoSolPayment = `PAGAMENTO CONFERMATO
Esercente: SUPERMERCATO BETA S.R.L.
Importo: 0,185 SOL
Controvalore: €24,90
Commissioni blockchain: €0,02
TxID: 4k8m9p2w5x7z1a3b5c7d9e1f3a5b7c9d
Data: 28/08/2026 19:10`;

      const result = PaymentEvidenceParser.parse(cryptoSolPayment);

      expect(result.subtype).toBe('CRYPTO_PAYMENT');
      expect(result.amount).toBe(24.90);
      expect(result.fee).toBe(0.02);
      expect(result.totalCharged).toBe(24.92);
      expect(result.merchantOrBeneficiary).toBe('SUPERMERCATO BETA S.R.L.');
      expect(result.transactionReference).toBe('4k8m9p2w5x7z1a3b5c7d9e1f3a5b7c9d');
      expect(result.cryptoDetails?.cryptoAmount).toBe(0.185);
      expect(result.cryptoDetails?.cryptoAsset).toBe('SOL');
    });

    it('J. Importo + commissione + totale addebitato correttamente distinti', () => {
      const distinctAmounts = `QUIETANZA DI PAGAMENTO
Importo: €100,00
Commissione: €1,50
Totale addebitato: €101,50
Data: 11/02/2026`;

      const result = PaymentEvidenceParser.parse(distinctAmounts);

      expect(result.amount).toBe(100.00);
      expect(result.fee).toBe(1.50);
      expect(result.totalCharged).toBe(101.50);
    });

    it('K. Solo totale pagato: scomposizione non possibile (non inventa fee)', () => {
      const onlyTotal = `RICEVUTA DI PAGAMENTO
Totale pagato: €101,50
Data: 11/02/2026`;

      const result = PaymentEvidenceParser.parse(onlyTotal);

      expect(result.amount).toBe(101.50);
      expect(result.fee).toBeNull();
      expect(result.totalCharged).toBe(101.50);
    });

    it('L. Documento PAYMENT_PROOF povero -> campi null conservativi', () => {
      const poorPaymentText = `RICEVUTA PAGAMENTO`;

      const result = PaymentEvidenceParser.parse(poorPaymentText);

      expect(result.amount).toBeNull();
      expect(result.fee).toBeNull();
      expect(result.dateTime).toBeNull();
      expect(result.merchantOrBeneficiary).toBeNull();
      expect(result.transactionReference).toBeNull();
      expect(result.warnings).toContain('AMOUNT_NOT_DETECTED');
      expect(result.warnings).toContain('DATE_NOT_DETECTED');
      expect(result.warnings).toContain('BENEFICIARY_NOT_DETECTED');
      expect(result.warnings).toContain('REFERENCE_NOT_DETECTED');
      expect(result.confidence).toBeLessThan(0.50);
    });

    it('M. Più numeri senza etichetta certa -> non sceglie arbitrariamente quello sbagliato', () => {
      const ambiguousNumbers = `RICEVUTA PAGAMENTO
45,00
12,50
89,00
Data: 28/08/2026`;

      const result = PaymentEvidenceParser.parse(ambiguousNumbers);

      // In assenza di label come "Importo:" o "Totale:", non tira a indovinare
      expect(result.amount).toBeNull();
      expect(result.warnings).toContain('AMBIGUOUS_AMOUNT');
    });

    it('N. Nessun hardcoding di esercente / banca / PSP', () => {
      const genericBankText = `ATTESTAZIONE BONIFICO BANCARIO
Beneficiario: STUDIO MEDICO DELFINO S.T.P.
Data esecuzione: 05/04/2026 14:10
TRN: 8839201928472910394857291029384
Importo: €150,00`;

      const result = PaymentEvidenceParser.parse(genericBankText);

      expect(result.merchantOrBeneficiary).toBe('STUDIO MEDICO DELFINO S.T.P.');
      expect(result.transactionReference).toBe('8839201928472910394857291029384');
      expect(result.amount).toBe(150.00);
    });

    it('O. PAN completo eventualmente presente nel testo: NON viene propagato integralmente', () => {
      const textWithFullPan = `RICEVUTA POS
ESERCENTE: LIBRERIA CENTRALE
PAN: 5412751234567890
DATA: 12/09/2026 18:00
AUT: 482910
IMPORTO: €22,00`;

      const result = PaymentEvidenceParser.parse(textWithFullPan);

      // Il PAN non deve comparire in chiaro da nessuna parte
      expect(result.paymentMethodHint.maskedPan).toBe('**** **** **** 7890');
      expect(result.paymentMethodHint.maskedPan).not.toContain('541275123456');
      expect(result.transactionReference).toBe('482910');
      expect(result.transactionReference).not.toBe('5412751234567890');
      expect(result.unparsedRelevantLines.every((l) => !l.includes('5412751234567890'))).toBe(true);
    });
  });

  describe('Integrazione Logica Classifier + Parser', () => {
    it('Flusso Integrato POS: Classifier -> PAYMENT_PROOF -> PaymentEvidenceParser', () => {
      const posText = `SCONTRINO POS
FARMACIA SAN CARLO
DATA: 20/08/2026 10:20
STAN: 001928
AUT. CODE: 839201
CARTA: **** 9912
IMPORTO: €18,90
TRANSAZIONE ESEGUITA`;

      const classification = DocumentTypeClassifier.classify(posText);
      expect(classification.category).toBe('PAYMENT_PROOF');

      const parsedEvidence = PaymentEvidenceParser.parse(posText, classification);
      expect(parsedEvidence.subtype).toBe('POS_RECEIPT');
      expect(parsedEvidence.amount).toBe(18.90);
      expect(parsedEvidence.merchantOrBeneficiary).toContain('SAN CARLO');
      expect(parsedEvidence.transactionReference).toBe('001928');
    });

    it('Flusso Integrato PagoPA: Classifier -> PAYMENT_PROOF -> PaymentEvidenceParser', () => {
      const pagopaText = `AVVISO DI PAGAMENTO PAGOPA
Ente Creditore: UNIVERSITÀ DEGLI STUDI
IUV: 849201847291029
Data: 15/01/2026 12:00
Importo: €250,00
Commissione: €1,50
Totale addebitato: €251,50`;

      const classification = DocumentTypeClassifier.classify(pagopaText);
      expect(classification.category).toBe('PAYMENT_PROOF');

      const parsedEvidence = PaymentEvidenceParser.parse(pagopaText, classification);
      expect(parsedEvidence.subtype).toBe('PAGOPA_RECEIPT');
      expect(parsedEvidence.amount).toBe(250.00);
      expect(parsedEvidence.fee).toBe(1.50);
      expect(parsedEvidence.totalCharged).toBe(251.50);
      expect(parsedEvidence.transactionReference).toBe('849201847291029');
    });

    it('Flusso Integrato Bonifico: Classifier -> PAYMENT_PROOF -> PaymentEvidenceParser', () => {
      const bonificoText = `RICEVUTA BONIFICO BANCARIO
Beneficiario: PALESTRA FIT LIFE
Data: 01/09/2026 08:30
TRN: TRN9928102948102938471928471928
Importo: €50,00`;

      const classification = DocumentTypeClassifier.classify(bonificoText);
      expect(classification.category).toBe('PAYMENT_PROOF');

      const parsedEvidence = PaymentEvidenceParser.parse(bonificoText, classification);
      expect(parsedEvidence.subtype).toBe('BANK_TRANSFER_RECEIPT');
      expect(parsedEvidence.amount).toBe(50.00);
      expect(parsedEvidence.merchantOrBeneficiary).toBe('PALESTRA FIT LIFE');
      expect(parsedEvidence.transactionReference).toBe('TRN9928102948102938471928471928');
    });

    it('Flusso Integrato Crypto Payment: Classifier -> PAYMENT_PROOF -> PaymentEvidenceParser', () => {
      const cryptoPaymentText = `PAGAMENTO ESEGUITO
Beneficiario: CAFFE LETTERARIO
Importo: 0,000100 BTC
Controvalore: €6,50
Commissione rete: €0,20
TxID: 0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e
Data: 28/08/2026 14:00`;

      const classification = DocumentTypeClassifier.classify(cryptoPaymentText);
      expect(classification.category).toBe('PAYMENT_PROOF');

      const parsedEvidence = PaymentEvidenceParser.parse(cryptoPaymentText, classification);
      expect(parsedEvidence.subtype).toBe('CRYPTO_PAYMENT');
      expect(parsedEvidence.amount).toBe(6.50);
      expect(parsedEvidence.fee).toBe(0.20);
      expect(parsedEvidence.merchantOrBeneficiary).toBe('CAFFE LETTERARIO');
      expect(parsedEvidence.transactionReference).toBe('0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e');
    });

    it('Flusso Crypto Trade (Coinbase / Binance): Classifier -> UNKNOWN e NON viene trattato come PaymentEvidence valida', () => {
      const cryptoTradeText = `ACQUISTO ZRX
5,79381719 ZRX
Totale €8,00
Prezzo €1,21
Commissione €0,99
Portafoglio EUR
Completato
Codice di riferimento 9A2B3C4D`;

      const classification = DocumentTypeClassifier.classify(cryptoTradeText);
      expect(classification.category).toBe('UNKNOWN'); // Bloccato dal classifier!
      expect(classification.category).not.toBe('PAYMENT_PROOF');
    });
  });
});
