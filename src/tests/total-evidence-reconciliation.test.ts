import { describe, it, expect } from 'vitest';
import { receiptParserService } from '../services/ocrParser';
import { EUROSPIN_REAL_RAW_TEXT } from './fixtures/real-receipts/eurospin.fixture';

describe('Block 2 - Total Evidence Reconciliation & Other Amounts (Famiglie A + I)', () => {
  // =========================================================================
  // A. Due fonti indipendenti concordano contro una singola discordante
  // =========================================================================
  it('A. due fonti indipendenti concordano contro una singola discordante', () => {
    const raw = `
DOCUMENTO COMMERCIALE
di vendita o prestazione
DESCRIZIONE PREZZO
ARTICOLO 1 25,00
SUBTOTALE 25,00
PAGAMENTO ELETTRONICO 25,00
POS BANCOMAT 25,50
`;
    const draft = receiptParserService.parseText(raw);
    expect(draft.total.value).toBe(25.00);
  });

  // =========================================================================
  // B. Una sola evidenza ad alto score NON viene battuta da duplicati artificiali della stessa fonte
  // =========================================================================
  it('B. una sola evidenza ad alto score non viene battuta da duplicati artificiali della stessa fonte', () => {
    const raw = `
DOCUMENTO COMMERCIALE
DESCRIZIONE PREZZO
ARTICOLO 1 50,00
TOTALE COMPLESSIVO 50,00
SUBTOTALE 30,00
SUB-TOTALE 30,00
SUBTOTAL 30,00
`;
    const draft = receiptParserService.parseText(raw);
    // Il totale complessivo (score 95) non deve soccombere di fronte a 3 righe subtotale duplicate
    expect(draft.total.value).toBe(50.00);
  });

  // =========================================================================
  // C. Fiscal total corretto + POS discordante
  // =========================================================================
  it('C. fiscal total corretto + POS discordante', () => {
    const raw = `
DOCUMENTO COMMERCIALE
DESCRIZIONE PREZZO
SERVIZIO 35,00
TOTALE COMPLESSIVO 35,00
di cui IVA 3,50
POS BANCOMAT 35,50
`;
    const draft = receiptParserService.parseText(raw);
    expect(draft.total.value).toBe(35.00);
  });

  // =========================================================================
  // D. EUROSPIN: 14,46 vs 14,48 usando dati realmente disponibili
  // =========================================================================
  it('D. EUROSPIN 14,46 vs 14,48 usando dati realmente disponibili dal raw text', () => {
    const draft = receiptParserService.parseText(EUROSPIN_REAL_RAW_TEXT);
    // Nel raw text reale Eurospin:
    // Riga 38: SUBTOTAL 14,46
    // Riga 44: PAGAMENTO ELETTRONICO 14,46
    // Riga 45: 14,48
    // Riga 54: POS BANCOMAT 14,48
    // 14,46 è supportato da due fonti semantiche distinte (subtotale carrello + pagamento elettronico)
    expect(draft.total.value).toBe(14.46);
  });

  // =========================================================================
  // E. I QUADRI: 142,60 vs 142,50
  // =========================================================================
  it('E. I QUADRI 142,60 vs 142,50: cluster corroborato vince su evidenza discordante', () => {
    const rawIQuadri = `
I QUADRI
I BERGANTARI S.R.L.
DOCUMENTO COMMERCIALE di vendita o prestazione
24-08-2026 15:24
DOCUMENTO N. 0016-0027
RT 99IEB152710
PASTO COMPLETO 142,60
TOTALE COMPLESSIVO 142,60
di cui IVA 12,96
Pagamento elettronico 142,50
POS DETTAGLIO FORME di PAGAMENTO 142,60
`;
    const draft = receiptParserService.parseText(rawIQuadri);
    expect(draft.total.value).toBe(142.60);
  });

  // =========================================================================
  // F. other_amounts con triangolazione valida (D.E. Caffè A pattern)
  // =========================================================================
  it('F. other_amounts con triangolazione valida: F (37,40) + O (11,00) = P (48,40)', () => {
    const rawDeCaffeA = `
D.E. CAFFE' S.R.L.
DOCUMENTO COMMERCIALE di vendita o prestazione
18-08-2026 11:42
CAFFE ESPRESSO 2,40
CAPPUCCINO 4,50
TOTALE COMPLESSIVO 37,40
ALTRI IMPORTI 11,00
IMPORTO PAGATO 48,40
PAGAMENTO ELETTRONICO 48,40
`;
    const draft = receiptParserService.parseText(rawDeCaffeA);
    // Triangolazione riuscita: fiscal total 37,40 + altri importi 11,00 = pagamento 48,40
    expect(draft.total.value).toBe(48.40);
  });

  // =========================================================================
  // G. other_amounts SENZA terza evidenza: NON comporre
  // =========================================================================
  it('G. other_amounts SENZA terza evidenza: NON comporre, mantiene il totale fiscale 37,40', () => {
    const rawNoThird = `
D.E. CAFFE' S.R.L.
DOCUMENTO COMMERCIALE di vendita o prestazione
TOTALE COMPLESSIVO 37,40
ALTRI IMPORTI 11,00
`;
    const draft = receiptParserService.parseText(rawNoThird);
    // Senza una terza evidenza (pagamento o POS di 48,40) NON si compone
    expect(draft.total.value).toBe(37.40);
  });

  // =========================================================================
  // H. Anti-regola: MAI sommare IVA + Totale
  // =========================================================================
  it('H. anti IVA + total: non compone IVA e Totale anche se esiste un importo matematicamente pari alla somma', () => {
    const rawIva = `
DOCUMENTO COMMERCIALE
TOTALE COMPLESSIVO 100,00
DI CUI IVA 22,00
PUNTI ACCUMULATI 122,00
`;
    const draft = receiptParserService.parseText(rawIva);
    expect(draft.total.value).toBe(100.00);
  });

  // =========================================================================
  // I. Anti-regola: MAI sommare Subtotale + Totale
  // =========================================================================
  it('I. anti subtotal + total: non compone Subtotale e Totale', () => {
    const rawSubtotal = `
DOCUMENTO COMMERCIALE
SUBTOTALE 50,00
TOTALE COMPLESSIVO 50,00
NUMERO ARTICOLI 100,00
`;
    const draft = receiptParserService.parseText(rawSubtotal);
    expect(draft.total.value).toBe(50.00);
  });

  // =========================================================================
  // J. Anti-regola: MAI sommare Contanti + Resto
  // =========================================================================
  it('J. anti cash/change: contanti meno resto determina il netto, mai la somma contanti + resto', () => {
    const rawCash = `
DOCUMENTO COMMERCIALE
TOTALE COMPLESSIVO 18,00
PAGAMENTO CONTANTE 20,00
RESTO 2,00
CASSA 22,00
`;
    const draft = receiptParserService.parseText(rawCash);
    expect(draft.total.value).toBe(18.00);
  });

  // =========================================================================
  // K. Anti-regola: MAI sommare doppio pagamento senza anchor "altri importi"
  // =========================================================================
  it('K. anti doppio payment: non somma due righe di pagamento distinte senza anchor esplicito altri importi', () => {
    const rawDoublePay = `
DOCUMENTO COMMERCIALE
TOTALE COMPLESSIVO 30,00
PAGAMENTO CONTANTE 10,00
PAGAMENTO ELETTRONICO 20,00
IMPORTO 30,00
`;
    const draft = receiptParserService.parseText(rawDoublePay);
    expect(draft.total.value).toBe(30.00);
  });

  // =========================================================================
  // L. Valori casuali che sommano ma non hanno semantic roles corretti: NON comporre
  // =========================================================================
  it('L. valori casuali che matematicamente sommano ma non hanno semantic roles: NON comporre', () => {
    const rawRandom = `
DOCUMENTO COMMERCIALE
CODICE ARTICOLO 12,00
QUANTITA 8,00
TOTALE COMPLESSIVO 45,00
NUMERO OPERATORE 20,00
`;
    const draft = receiptParserService.parseText(rawRandom);
    expect(draft.total.value).toBe(45.00);
  });

  // =========================================================================
  // POSITIVE CONTROLS REALI
  // =========================================================================
  describe('Positive Controls Reali (Nessuna Regressione)', () => {
    it('Positive Control: TODIS_001 -> 21.90 €', () => {
      const todisRaw = `
TODIS
DOCUMENTO COMMERCIALE
10/08/2026 12:35
NUMERO ARTICOLI 9
TOTALE COMPLESSIVO 21,90
PAGAMENTO CONTANTE 25,00
RESTO 3,10
`;
      const draft = receiptParserService.parseText(todisRaw);
      expect(draft.total.value).toBe(21.90);
    });

    it('Positive Control: PANIFICIO_PANZIERI_DOC_A_001 -> 2.00 €', () => {
      const panzieriRaw = `
PANIFICIO PANZIERI
DA.MA. SRL
DOCUMENTO COMMERCIALE
di vendita 0 prestazione
DESCRIZIONE IVA Prezzole)
REPARTO 47% da 2,00
[OLE COMPLESSIVO 2,00
di cui IVA Ù,08
Pagamento contante 2,00
Importo pagato 2,00
03-08-2026 12:06
`;
      const draft = receiptParserService.parseText(panzieriRaw);
      expect(draft.total.value).toBe(2.00);
    });

    it('Positive Control: R_STORE_001 -> 19.00 €', () => {
      const rStoreRaw = `
R-STORE
DOCUMENTO COMMERCIALE di vendita o prestazione
ACCESSORIO APPLE / IT 19,00
TOTALE COMPLESSIVO 19,00
PAGAMENTO ELETTRONICO 19,00
`;
      const draft = receiptParserService.parseText(rStoreRaw);
      expect(draft.total.value).toBe(19.00);
    });

    it('Positive Control: LEROY_MERLIN_001 -> 68.45 €', () => {
      const leroyRaw = `
LEROY MERLIN
DOCUMENTO COMMERCIALE
SUBTOTALE 68,45
IVA 22% : 12,34 TOT IMP : 56,11
SERVER RT: S3SNS30236
C.CREDITO 68,45
`;
      const draft = receiptParserService.parseText(leroyRaw);
      expect(draft.total.value).toBe(68.45);
    });
  });

  describe('Block 2 Recovery A: Anti-Lookahead on Degraded Tax-Breakdown', () => {
    it('1. D.E. CAFFÈ — raw degradato reale iPhone: selects 37.40, NOT 3.40 or 48.40', () => {
      const deCaffeIphoneRaw = `
D.E. CAFFE'
BAR RISTORANTE
DOCUMENTO COMMERCIALE
di vendita o prestazione

TOTALE COMPLESSIVO SLA
DI ue 3,40
Pagamento elettronico 37,40
Importo pagato AO :
A Carta di Credito ... 37,40
`;
      const draft = receiptParserService.parseText(deCaffeIphoneRaw);
      expect(draft.total.value).toBe(37.40);
      expect(draft.total.value).not.toBe(3.40);
      expect(draft.total.value).not.toBe(48.40);
    });

    it('2. Anti-lookahead breakdown pulito: TOTALE COMPLESSIVO + DI CUI IVA 2,00 + Pagamento 20,00 -> 20.00 €', () => {
      const raw = `
BAR CENTRALE
DOCUMENTO COMMERCIALE
TOTALE COMPLESSIVO
DI CUI IVA 2,00
Pagamento elettronico 20,00
`;
      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBe(20.00);
      expect(draft.total.value).not.toBe(2.00);
    });

    it('3. Anti-lookahead breakdown degradato: TOTALE COMPLESSIVO SLA + DI UE 3,40 + Pagamento 37,40 -> 37.40 €', () => {
      const raw = `
RISTORANTE PIZZERIA
TOTALE COMPLESSIVO SLA
DI UE 3,40
Pagamento elettronico 37,40
`;
      const draft = receiptParserService.parseText(raw);
      expect(draft.total.value).toBe(37.40);
      expect(draft.total.value).not.toBe(3.40);
    });

    it('4. Varianti conservative di breakdown OCR: non vengono usate come continuation amount', () => {
      const breakdownVariants = [
        'DI CUI 1,50',
        'DI UE 1,50',
        'DI CU I 1,50',
        'DI CVI 1,50',
        'IVA 22% 1,50',
        'IMPOSTA 1,50',
        'ALIQUOTA 10% 1,50',
        'VENTILAZIONE 1,50',
        'RESTO 5,00',
        'ALTRI IMPORTI 4,00',
      ];

      for (const variant of breakdownVariants) {
        const raw = `
ESERCENTE TEST
TOTALE COMPLESSIVO
${variant}
PAGAMENTO ELETTRONICO 25,00
`;
        const draft = receiptParserService.parseText(raw);
        expect(draft.total.value).toBe(25.00);
      }
    });

    it('5. Conservazione lookahead valido su due righe: TOTALE EURO + 12,50 -> 12.50 €', () => {
      const validTwoLinesRaw = `
BAR DEL CORSO
DOCUMENTO COMMERCIALE
TOTALE EURO
12,50
PAGAMENTO CONTANTE 12,50
`;
      const draft = receiptParserService.parseText(validTwoLinesRaw);
      expect(draft.total.value).toBe(12.50);
    });

    it('6. Conservazione paid_amount/subtotal lookahead validi', () => {
      const validSubtotalTwoLinesRaw = `
ALIMENTARI TEST
DOCUMENTO COMMERCIALE
SUBTOTALE
15,80
PAGAMENTO ELETTRONICO 15,80
`;
      const draft = receiptParserService.parseText(validSubtotalTwoLinesRaw);
      expect(draft.total.value).toBe(15.80);
    });
  });
});
