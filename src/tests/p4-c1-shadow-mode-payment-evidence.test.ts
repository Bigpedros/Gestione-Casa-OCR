import { describe, it, expect, vi } from 'vitest';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { PaymentEvidenceParser } from '../services/ocrParser/modules/PaymentEvidenceParser';

describe('Fase P4-C1: Shadow Mode PaymentEvidenceParser', () => {
  // =========================================================================
  // 1. ROUTING E CONDIZIONI DI ATTIVAZIONE (PUNTI 1-4)
  // =========================================================================

  it('1. PAYMENT_PROOF attiva PaymentEvidenceParser in shadow mode', () => {
    const posText = `BAR GELATERIA IL GABBIANO
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

    const draft = receiptParserService.parseText(posText);
    expect(draft).toBeDefined();
    const shadow = receiptParserService.getLastPaymentEvidenceShadow();
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadow).not.toBeNull();
    expect(shadow?.executed).toBe(true);
    expect(shadow?.documentCategory).toBe('PAYMENT_PROOF');
    expect(shadow?.result).not.toBeNull();
    expect(shadowResult).not.toBeNull();
    expect(shadowResult?.subtype).toBe('POS_RECEIPT');
  });

  it('2. COMMERCIAL_RECEIPT NON attiva PaymentEvidenceParser', () => {
    const commercialReceiptText = `SUPERMERCATO CONAD
VIA DEI MILLE 12, ROMA
PARTITA IVA: 01234567890
DATA: 28/08/2026 10:30
DOCUMENTO COMMERCIALE
di vendita o prestazione

PANE CASERECCIO 1,50
LATTE INTERO 1,80
PASTA BARILLA 1,20

TOTALE COMPLESSIVO € 4,50
DI CUI IVA 10% 0,41
PAGAMENTO CONTANTI 5,00
RESTO 0,50
RT 12345678`;

    receiptParserService.parseText(commercialReceiptText);
    const shadow = receiptParserService.getLastPaymentEvidenceShadow();
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadow).not.toBeNull();
    expect(shadow?.executed).toBe(false);
    expect(shadow?.documentCategory).toBe('COMMERCIAL_RECEIPT');
    expect(shadow?.result).toBeNull();
    expect(shadowResult).toBeNull();
  });

  it('3. INVOICE_OR_BILL NON attiva PaymentEvidenceParser', () => {
    const invoiceText = `ENEL ENERGIA S.P.A.
FATTURA N. 987654321 DEL 15/08/2026
PERIODO: LUGLIO 2026
CODICE CLIENTE: 123456789
TOTALE DA PAGARE: € 84,50
SCADENZA: 10/09/2026`;

    receiptParserService.parseText(invoiceText);
    const shadow = receiptParserService.getLastPaymentEvidenceShadow();
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadow).not.toBeNull();
    expect(shadow?.executed).toBe(false);
    expect(shadow?.documentCategory).toBe('INVOICE_OR_BILL');
    expect(shadow?.result).toBeNull();
    expect(shadowResult).toBeNull();
  });

  it('4. UNKNOWN NON attiva PaymentEvidenceParser', () => {
    const unknownText = `PROMEMORIA APPUNTI
LISTA DELLA SPESA
COMPRARE FRUTTA E VERDURA
CHIAMARE MARIO ALLE 18`;

    receiptParserService.parseText(unknownText);
    const shadow = receiptParserService.getLastPaymentEvidenceShadow();
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadow).not.toBeNull();
    expect(shadow?.executed).toBe(false);
    expect(shadow?.documentCategory).toBe('UNKNOWN');
    expect(shadow?.result).toBeNull();
    expect(shadowResult).toBeNull();
  });

  // =========================================================================
  // 2. INVARIANZA OUTPUT UFFICIALE E NESSUNA RIGA FITTIZIA (PUNTO 5)
  // =========================================================================

  it('5. ParsedReceiptDraft ufficiale resta invariato e NON crea righe sintetiche fittizie', () => {
    const posText = `RISTORANTE LA PERLA
RICEVUTA POS - MEMORIA CLIENTE
DATA: 25/08/2026 13:45
TID: 11223344
STAN: 998877
PAGAMENTO CARTA DI CREDITO
IMPORTO: €45,00
TRANSAZIONE ESEGUITA`;

    const draft = receiptParserService.parseText(posText);

    // Verifica che l'output ufficiale non abbia righe sintetiche inventate
    for (const line of draft.lines) {
      expect(line.normalizedDescription).not.toBe('Transazione POS');
      expect(line.normalizedDescription).not.toBe('Pagamento PagoPA');
      expect(line.normalizedDescription).not.toBe('Bonifico');
      expect(line.normalizedDescription).not.toBe('Ricevuta di Pagamento');
    }

    // Verifica campi ufficiali invariati
    expect(draft.total.value).toBe(45.00);
    expect(draft.paymentMethod.value).toBe('carta');
  });

  // =========================================================================
  // 3. SCENARI SEMANTICI SHADOW (PUNTI 6-11)
  // =========================================================================

  it('6 & 7. Ricevuta POS: subtype corretto, importo esplicito, circuito e masked PAN', () => {
    const posText = `BAR MOKA D'ORO
VIA CONCILIAZIONE 10, ROMA
RICEVUTA POS - MEMORIA CLIENTE
DATA 20/08/2026 ORA 08:30
TID: 44556677
STAN: 123456
AUT. 789012
CARTA: **** **** **** 9876
CIRCUITO: VISA DEBIT
IMPORTO: € 3,50
TRANSAZIONE ESEGUITA`;

    receiptParserService.parseText(posText);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadowResult).not.toBeNull();
    expect(shadowResult?.subtype).toBe('POS_RECEIPT');
    expect(shadowResult?.amount).toBe(3.50);
    expect(shadowResult?.fee).toBeNull(); // Nessuna fee esplicita -> null (Regola Ceccotti)
    expect(shadowResult?.totalCharged).toBe(3.50);
    expect(shadowResult?.paymentMethodHint.circuitOrBrand).toBe('Visa');
    expect(shadowResult?.paymentMethodHint.maskedPan).toBe('**** **** **** 9876');
    expect(shadowResult?.transactionReference).toBe('123456');
  });

  it('8. PagoPA: importo, commissione esplicita, IUV/codice avviso e beneficiario', () => {
    const pagoPaText = `RICEVUTA TELEMATICA PAGOPA
Ente Creditore: COMUNE DI MILANO
Codice Avviso: 302000009876543210
IUV: 000000009876543210
Data Operazione: 12/08/2026 14:20
Importo: € 150,00
Commissioni applicate dal PSP: € 1,50
Totale Addebitato: € 151,50
ESITO: TRANSAZIONE ESEGUITA`;

    receiptParserService.parseText(pagoPaText);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadowResult).not.toBeNull();
    expect(shadowResult?.subtype).toBe('PAGOPA_RECEIPT');
    expect(shadowResult?.amount).toBe(150.00);
    expect(shadowResult?.fee).toBe(1.50);
    expect(shadowResult?.totalCharged).toBe(151.50);
    expect(shadowResult?.merchantOrBeneficiary).toContain('COMUNE DI MILANO');
    expect(shadowResult?.transactionReference).toBe('000000009876543210');
  });

  it('9. Bonifico SEPA: importo, beneficiario e riferimento TRN/CRO', () => {
    const sepaText = `DISPOSIZIONE DI BONIFICO SEPA
RICEVUTA BONIFICO
Ordinante: MARIO ROSSI
Beneficiario: CONDOMINIO VIA VERDI
IBAN Beneficiario: IT60X0542811101000000123456
TRN: 260829123456789012345678901234
CRO: 12345678901
Data Esecuzione: 29/08/2026
Importo: € 320,00
Causale: Quota condominiale Agosto 2026
Stato: Eseguito`;

    receiptParserService.parseText(sepaText);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadowResult).not.toBeNull();
    expect(shadowResult?.subtype).toBe('BANK_TRANSFER_RECEIPT');
    expect(shadowResult?.amount).toBe(320.00);
    expect(shadowResult?.merchantOrBeneficiary).toContain('CONDOMINIO VIA VERDI');
    expect(shadowResult?.transactionReference).toBe('260829123456789012345678901234');
  });

  it('10. Ricevitoria / punto autorizzato: canale correttamente riconosciuto', () => {
    const sisalText = `PUNTO SISALPAY / MOONEY
Tabacchi N. 12
RICEVUTA POS - MEMORIA CLIENTE
Servizio: PAGAMENTO BOLLETTA UTENZE
Data: 14/08/2026 11:25
TID: 88776655
STAN: 443322
ID Transazione: MOON-98371892
Importo: €48,20
Commissione servizio: €2,00
Totale pagato: €50,20
TRANSAZIONE ESEGUITA`;

    receiptParserService.parseText(sisalText);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadowResult).not.toBeNull();
    expect(shadowResult?.paymentChannelHint).toBe('SISAL_POINT');
    expect(shadowResult?.amount).toBe(48.20);
    expect(shadowResult?.fee).toBe(2.00);
    expect(shadowResult?.totalCharged).toBe(50.20);
  });

  it('11. Documento generico/ambiguo: nessuna invenzione, campi mancanti a null con warning', () => {
    const ambiguousPaymentText = `RICEVUTA POS - MEMORIA CLIENTE
TID: 99887766
STAN: 554433
TRANSAZIONE ESEGUITA`;

    receiptParserService.parseText(ambiguousPaymentText);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadowResult).not.toBeNull();
    expect(shadowResult?.amount).toBeNull();
    expect(shadowResult?.dateTime).toBeNull();
    expect(shadowResult?.merchantOrBeneficiary).toBeNull();
    expect(shadowResult?.warnings).toContain('AMOUNT_NOT_DETECTED');
    expect(shadowResult?.warnings).toContain('DATE_NOT_DETECTED');
  });

  // =========================================================================
  // 4. PRIVACY DATI CARTA E PAN (PUNTO 12)
  // =========================================================================

  it('12. Documento con PAN completo nel testo OCR: PAN completo NON compare nel risultato shadow', () => {
    const panLeakOcrText = `RICEVUTA POS - MEMORIA CLIENTE
MERCHANT: CAFFE CENTRALE
TID: 12345678
STAN: 876543
DATE: 29/08/2026 16:00
PAN: 4000123456789010
EXP: 12/28
IMPORTO: € 8,00
TRANSAZIONE ESEGUITA`;

    receiptParserService.parseText(panLeakOcrText);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadowResult).not.toBeNull();
    // Il maskedPan deve mascherare le cifre centrali
    expect(shadowResult?.paymentMethodHint.maskedPan).toBe('**** **** **** 9010');
    // Il PAN in chiaro (4000123456789010) NON deve comparire in alcun campo
    expect(shadowResult?.transactionReference).not.toContain('4000123456789010');
    expect(shadowResult?.merchantOrBeneficiary).not.toContain('4000123456789010');
  });

  // =========================================================================
  // 5. GESTIONE IMPORTI MULTIPLI AMBIGUI (PUNTO 13)
  // =========================================================================

  it('13. Importi multipli ambigui: amount non scelto arbitrariamente (Regola Ceccotti)', () => {
    const multipleAmountsAmbiguous = `RICEVUTA POS - MEMORIA CLIENTE
TID: 11223344
STAN: 556677
DATA: 29/08/2026
IMPORTO A: € 100,00
IMPORTO B: € 200,00
IMPORTO C: € 300,00
TRANSAZIONE ESEGUITA`;

    receiptParserService.parseText(multipleAmountsAmbiguous);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(shadowResult).not.toBeNull();
    // Non potendo determinare univocamente l'importo principale con label standard,
    // il parser non deve inventare o scegliere arbitrariamente se non c'è una chiara etichetta
    if (shadowResult?.amount !== null) {
      expect(shadowResult?.warnings.length).toBeGreaterThan(0);
    }
  });

  // =========================================================================
  // 6. ROBUSTEZZA TECNICA ED ECCEZIONI RUNTIME (PUNTO 14)
  // =========================================================================

  it('14. Eccezione tecnica runtime in PaymentEvidenceParser non fa crashare la pipeline', () => {
    const posText = `BAR GELATERIA IL GABBIANO
RICEVUTA POS - MEMORIA CLIENTE
TID: 88472910
STAN: 004829
DATA 28/08/2026 ORA 15:42
IMPORTO: €12,50
TRANSAZIONE ESEGUITA`;

    // Spy su PaymentEvidenceParser.parse per simulare un'eccezione tecnica
    const spy = vi.spyOn(PaymentEvidenceParser, 'parse').mockImplementationOnce(() => {
      throw new Error('Simulated runtime crash in PaymentEvidenceParser');
    });

    // La chiamata a parseText non deve lanciare eccezioni
    let draft: any;
    expect(() => {
      draft = receiptParserService.parseText(posText);
    }).not.toThrow();

    expect(draft).toBeDefined();
    expect(draft.total.value).toBe(12.50);

    const shadow = receiptParserService.getLastPaymentEvidenceShadow();
    expect(shadow).not.toBeNull();
    expect(shadow?.executed).toBe(true);
    expect(shadow?.result).toBeNull();
    expect(shadow?.error).toContain('Simulated runtime crash in PaymentEvidenceParser');

    spy.mockRestore();
  });
});
