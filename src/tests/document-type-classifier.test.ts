import { describe, it, expect } from 'vitest';
import { DocumentTypeClassifier } from '../services/ocrParser/modules/DocumentTypeClassifier';
import { TextNormalizationModule } from '../services/ocrParser/modules/TextNormalizationModule';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';

describe('BLOCCO P2 — DocumentTypeClassifier (Modulo Puro e Isolato)', () => {
  describe('Scenario A: Scontrino commerciale reale TODIS canonico', () => {
    it('classifica lo scontrino reale TODIS come COMMERCIAL_RECEIPT con alta confidenza', () => {
      const normalized = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const result = DocumentTypeClassifier.classify(normalized);

      expect(result.category).toBe('COMMERCIAL_RECEIPT');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('EXPLICIT_HEADER_COMMERCIAL_DOCUMENT');
      expect(signalNames).toContain('ITEM_COUNT_INDICATOR');
      expect(signalNames).toContain('MULTIPLE_VAT_RATE_LINES');
      expect(signalNames).toContain('SUBTOTAL_KEYWORD');
      expect(result.categoryScores.commercialReceipt).toBeGreaterThan(60);
    });
  });

  describe('Scenario B: Ricevuta POS generica', () => {
    it('classifica uno scontrino POS isolato come PAYMENT_PROOF', () => {
      const posText = `BAR PASTICCERIA CENTRALE
Via Nazionale 42, Roma
RICEVUTA POS - MEMORIA CLIENTE
TID: 88291039  STAN: 491029
DATA: 28/08/2026 10:14
CARTA: MASTERCARD
PAN: **** **** **** 4912
AUT. CODE: 938102
IMPORTO: EUR 14,50
TRANSAZIONE ESEGUITA
ESITO: OK - APPROVED
GRAZIE E ARRIVEDERCI`;

      const result = DocumentTypeClassifier.classify(posText);

      expect(result.category).toBe('PAYMENT_PROOF');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('POS_RECEIPT_HEADER');
      expect(signalNames).toContain('POS_CLIENT_COPY_KEYWORD');
      expect(signalNames).toContain('POS_STAN_OR_TID');
      expect(signalNames).toContain('POS_AUTH_CODE');
      expect(signalNames).toContain('MASKED_PAN_CARD_NUMBER');
      expect(signalNames).toContain('PAYMENT_TRANSACTION_OUTCOME_OK');
      expect(result.categoryScores.paymentProof).toBeGreaterThan(60);
    });
  });

  describe('Scenario C: Ricevuta PagoPA', () => {
    it('classifica una ricevuta telematica PagoPA come PAYMENT_PROOF', () => {
      const pagoPaText = `RICEVUTA TELEMATICA PAGOPA
Ente Creditore: COMUNE DI FIRENZE - POLIZIA MUNICIPALE
CF Ente: 01307110484
Soggetto Pagatore: MARIO ROSSI
Codice Avviso: 302001928391029384
IUV: 302001928391029384
Data e ora pagamento: 28/08/2026 15:30:22
PSP: BANCA SELLA S.P.A.
Importo pagato: € 42,00
Commissioni applicate: € 1,30
Totale addebitato: € 43,30
Transazione eseguita con successo
Operazione completata`;

      const result = DocumentTypeClassifier.classify(pagoPaText);

      expect(result.category).toBe('PAYMENT_PROOF');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('PAGOPA_KEYWORD');
      expect(signalNames).toContain('PAGOPA_IUV_IDENTIFIER');
      expect(signalNames).toContain('CREDITOR_ENTITY_KEYWORD');
      expect(signalNames).toContain('PAYMENT_FEE_KEYWORD');
      expect(result.categoryScores.paymentProof).toBeGreaterThan(60);
    });
  });

  describe('Scenario D: Ricevuta Bonifico Bancario', () => {
    it('classifica una ricevuta di bonifico SEPA come PAYMENT_PROOF', () => {
      const bonificoText = `CONFERMA OPERAZIONE
RICEVUTA BONIFICO SEPA
Ordinante: GIUSEPPE VERDI
IBAN Ordinante: IT60X0542811101000000123456
Beneficiario: CONDOMINIO VIA ROMA 12
IBAN Beneficiario: IT99Z0306905020100000098765
TRN: 2608280001928391829381928391
Data Esecuzione: 28/08/2026
Data Valuta: 28/08/2026
Importo: 185,00 EUR
Causale: Quota condominiale Agosto 2026 Int. 4
Disposizione eseguita`;

      const result = DocumentTypeClassifier.classify(bonificoText);

      expect(result.category).toBe('PAYMENT_PROOF');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('BANK_TRANSFER_RECEIPT_HEADER');
      expect(signalNames).toContain('BANK_TRANSFER_TRN_CRO');
      expect(signalNames).toContain('IBAN_IDENTIFIER');
      expect(signalNames).toContain('BENEFICIARY_FIELD');
      expect(signalNames).toContain('EXECUTION_OR_VALUE_DATE');
    });
  });

  describe('Scenario E: Scontrino commerciale pagato con Carta (Body articoli + POS nel footer)', () => {
    it('mantiene la categoria COMMERCIAL_RECEIPT nonostante la presenza di metadati di pagamento carta nel footer', () => {
      const mixedReceiptText = `CONAD CITY
Via dei Mille 15, Bologna
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE            IVA   PREZZO
LATTE PARZ. SCREM.     10%     1,49
BISCOTTI FROLLINI      10%     2,89
DETERSIVO PIATTI       22%     1,99
MELA FUJI 1.2 KG        4%     2,15
SUBTOTALE                      8,52
TOTALE COMPLESSIVO             8,52
di cui IVA                     0,82
-----------------------------------
PAGAMENTO ELETTRONICO          8,52
CARTA DI CREDITO MASTERCARD
PAN: **** **** **** 8831
AUT. 491029  STAN 002910
TRANSAZIONE ESEGUITA
-----------------------------------
NUMERO ARTICOLI: 4
RT 99MEY012948
14-08-2026 18:40 DOCUMENTO N. 1024-0012`;

      const result = DocumentTypeClassifier.classify(mixedReceiptText);

      expect(result.category).toBe('COMMERCIAL_RECEIPT');
      expect(result.confidence).toBeGreaterThanOrEqual(0.70);
      expect(result.categoryScores.commercialReceipt).toBeGreaterThan(result.categoryScores.paymentProof);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('EXPLICIT_HEADER_COMMERCIAL_DOCUMENT');
      expect(signalNames).toContain('MULTIPLE_VAT_RATE_LINES');
      expect(signalNames).toContain('ITEM_COUNT_INDICATOR');
      expect(signalNames).toContain('SUBTOTAL_KEYWORD');
      expect(signalNames).toContain('FISCAL_REGISTER_METADATA');
    });
  });

  describe('Scenario F: Bolletta / Fattura Utenze', () => {
    it('classifica una fattura/bolletta energetica con periodo e consumi come INVOICE_OR_BILL', () => {
      const invoiceText = `ENEL ENERGIA S.P.A.
FATTURA ELETTRONICA N. 4920192849
Fornitura Energia Elettrica Mercato Libero
Periodo di fatturazione: 01/06/2026 - 31/07/2026
Data emissione: 05/08/2026
Data scadenza pagamento: 25/08/2026
Dati Fornitura:
POD: IT001E00129481920
Potenza impegnata: 3.0 kW
Consumi fatturati: 240 kWh
Totale imponibile: € 78,50
IVA 10%: € 7,85
Canone TV: € 18,00
TOTALE BOLLETTA: € 104,35`;

      const result = DocumentTypeClassifier.classify(invoiceText);

      expect(result.category).toBe('INVOICE_OR_BILL');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('EXPLICIT_INVOICE_OR_BILL_HEADER');
      expect(signalNames).toContain('BILLING_PERIOD_KEYWORD');
      expect(signalNames).toContain('DUE_DATE_KEYWORD');
      expect(signalNames).toContain('UTILITY_SUPPLY_SPECIFICS');
      expect(signalNames).toContain('CONSUMPTION_ENERGY_METRICS');
      expect(signalNames).toContain('INVOICE_ACCOUNTING_BREAKDOWN');
      expect(result.categoryScores.invoiceOrBill).toBeGreaterThan(60);
    });
  });

  describe('Scenario G: Documento povero di dati (data + importo)', () => {
    it('classifica come UNKNOWN con confidenza bassa un testo con solo data e importo', () => {
      const poorText = `12/08/2026
45,00 €`;

      const result = DocumentTypeClassifier.classify(poorText);

      expect(result.category).toBe('UNKNOWN');
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('gestisce testo vuoto restituendo UNKNOWN', () => {
      const result = DocumentTypeClassifier.classify('');
      expect(result.category).toBe('UNKNOWN');
      expect(result.confidence).toBe(0.0);
    });
  });

  describe('Scenario H: Documento ambiguo o conflittuale', () => {
    it('classifica come UNKNOWN quando sono presenti segnali sparsi e non strutturati', () => {
      const conflictingText = `Nota generica
Fattura o ricevuta non specificata
POS transazione forse
Totale indicativo 10,00`;

      const result = DocumentTypeClassifier.classify(conflictingText);

      expect(result.category).toBe('UNKNOWN');
      expect(result.confidence).toBeLessThan(0.65);
    });
  });

  describe('Scenario I: Test anti-hardcoding su molteplici marchi e fornitori', () => {
    it('classifica correttamente scontrini di diverse catene (Esselunga, Coop, Carrefour)', () => {
      const esselunga = `ESSELUNGA S.P.A.
DOCUMENTO COMMERCIALE
PASTA BARILLA 500G   4,00%   0,99
OLIO EXTRAVERGINE   10,00%   7,49
SUBTOTALE                    8,48
TOTALE COMPLESSIVO           8,48
NUMERO PEZZI: 2
RT 12345678`;

      const res = DocumentTypeClassifier.classify(esselunga);
      expect(res.category).toBe('COMMERCIAL_RECEIPT');
    });

    it('classifica correttamente bollette di diversi fornitori (A2A, Hera, Servizio Elettrico)', () => {
      const a2a = `A2A ENERGIA
BOLLETTA FORNITURA GAS NATURALE
Fattura n. 88291039
Periodo di consumo: Maggio - Giugno 2026
PDR: 01294819203910
Consumi: 120 SMC
Scadenza: 15/09/2026
Totale da pagare: 94,20 €`;

      const res = DocumentTypeClassifier.classify(a2a);
      expect(res.category).toBe('INVOICE_OR_BILL');
    });

    it('classifica correttamente bonifici di diversi istituti bancari (Intesa Sanpaolo, UniCredit, Poste)', () => {
      const unicredit = `UNICREDIT BANCA
DISPOSIZIONE BONIFICO
Beneficiario: MARIO BIANCHI
IBAN: IT02L0200801100000019283746
TRN: 020082608280001928
Data Esecuzione: 28/08/2026
Importo: 500,00 EUR`;

      const res = DocumentTypeClassifier.classify(unicredit);
      expect(res.category).toBe('PAYMENT_PROOF');
    });
  });

  describe('Scenario J: Operazioni di compravendita Crypto / Exchange Trading vs Pagamento Crypto Reale', () => {
    it('classifica come UNKNOWN il caso concettuale Coinbase (Acquisto ZRX con prezzo unitario, commissione, portafoglio EUR)', () => {
      const coinbaseZrxText = `ACQUISTO ZRX
5,79381719 ZRX
Totale €8,00
Prezzo €1,21
Commissione €0,99
Portafoglio EUR
Completato
Codice di riferimento 9A2B3C4D`;

      const result = DocumentTypeClassifier.classify(coinbaseZrxText);

      expect(result.category).toBe('UNKNOWN');
      expect(result.evidences.some((e) => e.signal === 'EXCHANGE_TRADING_DETECTED')).toBe(true);
      expect(result.warnings.some((w) => w.includes('compravendita finanziaria/crypto'))).toBe(true);
    });

    it('classifica come UNKNOWN un acquisto spot Binance BTC', () => {
      const cryptoTradeText = `BINANCE SPOT TRADE CONFIRMATION
Pair: BTC/EUR
Order Type: MARKET BUY
Trade ID: TR-99201928
Amount: 0.05 BTC
Price: 58,400.00 EUR
Total Spent: 2,920.00 EUR
Trading Fee: 0.00005 BTC
Status: FILLED`;

      const result = DocumentTypeClassifier.classify(cryptoTradeText);

      expect(result.category).toBe('UNKNOWN');
      expect(result.warnings.some((w) => w.includes('exchange'))).toBe(true);
      expect(result.evidences.some((e) => e.signal === 'EXCHANGE_TRADING_DETECTED')).toBe(true);
    });

    it('classifica come UNKNOWN un acquisto su exchange senza brand con token fittizio (anti-hardcoding trading)', () => {
      const unknownExchangeText = `CONFERMA OPERAZIONE
ACQUISTO TOKEN_NOVA
Quantità: 125,50 NOVA
Prezzo Unitario: €0,45
Totale: €56,48
Commissione di trading: €0,50
Portafoglio EUR
Stato: Completato
Trade ID: TR-88492019`;

      const result = DocumentTypeClassifier.classify(unknownExchangeText);

      expect(result.category).toBe('UNKNOWN');
      expect(result.evidences.some((e) => e.signal === 'EXCHANGE_TRADING_DETECTED')).toBe(true);
    });

    it('classifica come PAYMENT_PROOF un pagamento reale di spesa eseguito in crypto a favore di un esercente/beneficiario', () => {
      const cryptoPaymentText = `PAGAMENTO ESEGUITO
Beneficiario: NEGOZIO ALFA
Importo: 0,000250 BTC
Controvalore: €15,00
Commissione rete: €0,40
Transaction ID: 0x8a9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b
Data/Ora: 28/08/2026 17:42`;

      const result = DocumentTypeClassifier.classify(cryptoPaymentText);

      expect(result.category).toBe('PAYMENT_PROOF');
      expect(result.confidence).toBeGreaterThanOrEqual(0.70);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('BENEFICIARY_FIELD');
      expect(signalNames).toContain('CRYPTO_TRANSACTION_HASH_OR_ID');
      expect(signalNames).toContain('CRYPTO_NETWORK_FEE');
      expect(signalNames).toContain('CRYPTO_COUNTERVALUE_EUR');
    });

    it('classifica come PAYMENT_PROOF un secondo pagamento crypto reale con asset diverso (SOL) ed esercente diverso', () => {
      const secondCryptoPaymentText = `PAGAMENTO CONFERMATO
Esercente: SUPERMERCATO BETA S.R.L.
Importo: 0,185 SOL
Controvalore: €24,90
Commissioni blockchain: €0,02
TxID: 4k8m9p2w5x7z1a3b5c7d9e1f3a5b7c9d
Data operazione: 28/08/2026 19:10
Esito: Transazione eseguita con successo`;

      const result = DocumentTypeClassifier.classify(secondCryptoPaymentText);

      expect(result.category).toBe('PAYMENT_PROOF');
      expect(result.confidence).toBeGreaterThanOrEqual(0.70);

      const signalNames = result.evidences.map((e) => e.signal);
      expect(signalNames).toContain('CRYPTO_TRANSACTION_HASH_OR_ID');
      expect(signalNames).toContain('CRYPTO_COUNTERVALUE_EUR');
      expect(signalNames).toContain('PAYMENT_TRANSACTION_OUTCOME_OK');
    });
  });
});
