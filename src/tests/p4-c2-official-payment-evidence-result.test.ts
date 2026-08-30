import { describe, it, expect, vi } from 'vitest';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { PaymentEvidenceParser } from '../services/ocrParser/modules/PaymentEvidenceParser';
import { ParsedReceiptDraft } from '../services/ocrParser/types';
import { ocrProcessRepository, ocrReceiptLineRepository } from '../repositories';

describe('Fase P4-C2: Integrazione Ufficiale del Payment Evidence Result', () => {
  // =========================================================================
  // 1 & 2. PAYMENT_PROOF espone ufficialmente PaymentEvidenceParseResult
  // =========================================================================
  it('1. PAYMENT_PROOF espone ufficialmente PaymentEvidenceParseResult nel draft', () => {
    const posText = `BAR SPORT SNC
VIA ROMA 1, MILANO
RICEVUTA POS - MEMORIA CLIENTE
TID: 88776655
STAN: 123456
DATA: 28/08/2026 10:15
IMPORTO: €15,50
CARTA: **** **** **** 1234
CIRCUITO: MASTERCARD
TRANSAZIONE ESEGUITA
COPIA CLIENTE`;

    const draft = receiptParserService.parseText(posText);

    expect(draft.paymentEvidence).toBeDefined();
    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.subtype).toBe('POS_RECEIPT');
    expect(draft.paymentEvidence?.amount).toBe(15.50);
  });

  it('2. Il risultato ufficiale coincide semanticamente con quello validato in P4-C1', () => {
    const posText = `RISTORANTE DA MARIO
RICEVUTA POS - MEMORIA CLIENTE
TID: 99887766
STAN: 445566
DATA: 25/08/2026 13:30
IMPORTO: €42,00
CARTA: **** **** **** 4321
CIRCUITO: VISA
TRANSAZIONE ESEGUITA`;

    const draft = receiptParserService.parseText(posText);
    const shadowResult = receiptParserService.getLastPaymentEvidenceShadowResult();

    expect(draft.paymentEvidence).not.toBeNull();
    expect(shadowResult).not.toBeNull();
    expect(draft.paymentEvidence).toEqual(shadowResult);
  });

  // =========================================================================
  // 3, 4, 5. Altre categorie NON espongono PaymentEvidence ufficiale
  // =========================================================================
  it('3. COMMERCIAL_RECEIPT non espone PaymentEvidence ufficiale', () => {
    const receiptText = `SUPERMERCATO CONAD
VIA MAZZINI 12, BOLOGNA
DOCUMENTO COMMERCIALE
di vendita o prestazione
PASTA BARILLA 1KG       1.20
LATTE PARMALAT 1L       1.50
TOTALE COMPLESSIVO      2.70
PAGAMENTO CONTANTI      2.70
RT 12345678 20/08/2026 18:30`;

    const draft = receiptParserService.parseText(receiptText);

    expect(draft.paymentEvidence).toBeNull();
  });

  it('4. INVOICE_OR_BILL non espone PaymentEvidence ufficiale', () => {
    const billText = `ENEL ENERGIA S.P.A.
FATTURA PER LA FORNITURA DI ENERGIA ELETTRICA
FATTURA N. 987654321 DEL 10/08/2026
PERIODO: GIUGNO - LUGLIO 2026
TOTALE DA PAGARE: € 145,80
SCADENZA: 15/09/2026`;

    const draft = receiptParserService.parseText(billText);

    expect(draft.paymentEvidence).toBeNull();
  });

  it('5. UNKNOWN non espone PaymentEvidence ufficiale', () => {
    const unknownText = `PROMEMORIA APPUNTAMENTO
Dott. Bianchi - Dentista
Visita di controllo
Giovedi 18 Settembre ore 15:30
Portare radiografia`;

    const draft = receiptParserService.parseText(unknownText);

    expect(draft.paymentEvidence).toBeNull();
  });

  // =========================================================================
  // 6. Ricevuta POS: subtype, amount, method/channel, masked PAN
  // =========================================================================
  it('6. Ricevuta POS: subtype, amount, method/channel e masked PAN corretti', () => {
    const posText = `CAFFE SAN MARCO
PIAZZA SAN MARCO 5, VENEZIA
RICEVUTA POS - MEMORIA CLIENTE
DATA: 20/08/2026 09:12
TID: 33445566
STAN: 778899
CARTA: **** **** **** 9988
CIRCUITO: PAGOBANCOMAT
IMPORTO: €4,50
TRANSAZIONE ESEGUITA`;

    const draft = receiptParserService.parseText(posText);

    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.subtype).toBe('POS_RECEIPT');
    expect(draft.paymentEvidence?.amount).toBe(4.50);
    expect(draft.paymentEvidence?.paymentMethodHint.circuitOrBrand).toBe('PagoBANCOMAT');
    expect(draft.paymentEvidence?.paymentMethodHint.maskedPan).toBe('**** **** **** 9988');
    expect(draft.paymentEvidence?.paymentChannelHint).toBe('POS');
  });

  // =========================================================================
  // 7. PagoPA: amount, fee solo se esplicita, riferimento IUV, beneficiario
  // =========================================================================
  it('7. PagoPA: amount, fee esplicita, IUV e beneficiario corretti', () => {
    const pagoPaText = `RICEVUTA TELEMATICA PAGOPA
Ente Creditore: COMUNE DI FIRENZE
Codice Fiscale Ente: 01234567890
IUV: 302000001234567890
Data Operazione: 12/08/2026 14:20
Oggetto: TARI ANNO 2026
Importo: € 180,00
Commissioni applicate dal PSP: € 1,50
Totale Addebitato: € 181,50
ESITO: TRANSAZIONE ESEGUITA CON SUCCESSO`;

    const draft = receiptParserService.parseText(pagoPaText);

    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.subtype).toBe('PAGOPA_RECEIPT');
    expect(draft.paymentEvidence?.amount).toBe(180.00);
    expect(draft.paymentEvidence?.fee).toBe(1.50);
    expect(draft.paymentEvidence?.totalCharged).toBe(181.50);
    expect(draft.paymentEvidence?.transactionReference).toBe('302000001234567890');
    expect(draft.paymentEvidence?.merchantOrBeneficiary).toContain('COMUNE DI FIRENZE');
  });

  // =========================================================================
  // 8. Bonifico: amount, beneficiario, TRN/CRO, nessuna conservazione IBAN strutturata
  // =========================================================================
  it('8. Bonifico SEPA: amount, beneficiario, TRN/CRO e nessuna memorizzazione IBAN strutturata', () => {
    const sepaText = `DISPOSIZIONE DI BONIFICO SEPA
RICEVUTA BONIFICO
Ordinante: MARIO ROSSI
Beneficiario: CONDOMINIO VIA VERDI
IBAN Beneficiario: IT60X0542811101000000123456
Data esecuzione: 15/08/2026
Importo: € 320,00
Causale: SPESE CONDOMINIALI AGOSTO 2026
TRN: 26082912345678901234567890123456
STATO: ESEGUITO`;

    const draft = receiptParserService.parseText(sepaText);

    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.subtype).toBe('BANK_TRANSFER_RECEIPT');
    expect(draft.paymentEvidence?.amount).toBe(320.00);
    expect(draft.paymentEvidence?.merchantOrBeneficiary).toBe('CONDOMINIO VIA VERDI');
    expect(draft.paymentEvidence?.transactionReference).toBe('26082912345678901234567890123456');

    // Verifica che l'oggetto non possieda campi IBAN strutturati
    expect((draft.paymentEvidence as any).iban).toBeUndefined();
  });

  // =========================================================================
  // 9. Documento ambiguo: nessuna invenzione, campi mancanti a null con warning
  // =========================================================================
  it('9. Documento ambiguo/povero: nessuna invenzione, campi mancanti a null con warning', () => {
    const ambiguousPaymentText = `RICEVUTA POS - MEMORIA CLIENTE
TID: 99887766
STAN: 554433
TRANSAZIONE ESEGUITA`;

    const draft = receiptParserService.parseText(ambiguousPaymentText);

    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.amount).toBeNull();
    expect(draft.paymentEvidence?.dateTime).toBeNull();
    expect(draft.paymentEvidence?.merchantOrBeneficiary).toBeNull();
    expect(draft.paymentEvidence?.warnings.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // 10. Importi multipli ambigui: Regola Ceccotti
  // =========================================================================
  it('10. Importi multipli ambigui: amount non scelto arbitrariamente (Regola Ceccotti)', () => {
    const multipleAmountsAmbiguous = `RICEVUTA POS - MEMORIA CLIENTE
TID: 11223344
STAN: 556677
DATA: 29/08/2026
IMPORTO A: € 100,00
IMPORTO B: € 200,00
IMPORTO C: € 300,00
TRANSAZIONE ESEGUITA`;

    const draft = receiptParserService.parseText(multipleAmountsAmbiguous);

    expect(draft.paymentEvidence).not.toBeNull();
    // Non potendo determinare univocamente l'importo principale con label standard,
    // il parser non deve inventare o scegliere arbitrariamente se non c'è una chiara etichetta
    if (draft.paymentEvidence?.amount !== null) {
      expect(draft.paymentEvidence?.warnings.length).toBeGreaterThan(0);
    }
  });

  // =========================================================================
  // 11. Nessuna synthetic ParsedReceiptLine
  // =========================================================================
  it('11. Nessuna riga sintetica creata in ParsedReceiptDraft.lines per PAYMENT_PROOF', () => {
    const posText = `BAR CENTRALE
RICEVUTA POS - MEMORIA CLIENTE
TID: 11223344
STAN: 998877
DATA: 25/08/2026 13:45
PAGAMENTO CARTA DI CREDITO
IMPORTO: €45,00
TRANSAZIONE ESEGUITA`;

    const draft = receiptParserService.parseText(posText);

    // Non devono esserci righe sintetiche fittizie inventate
    const syntheticLine = draft.lines.find((l) =>
      l.normalizedDescription.toLowerCase().includes('transazione pos') ||
      l.normalizedDescription.toLowerCase().includes('pagamento carta') ||
      l.normalizedDescription.toLowerCase().includes('pagopa') ||
      l.normalizedDescription.toLowerCase().includes('bonifico')
    );
    expect(syntheticLine).toBeUndefined();
  });

  // =========================================================================
  // 12. Nessuna persistenza Dexie del PaymentEvidence in P4-C2
  // =========================================================================
  it('12. In P4-C2 parse(ocrProcessId) non persiste PaymentEvidence né Expense su database', async () => {
    // Setup di un processo OCR fittizio in repository
    const ocrProcess = await ocrProcessRepository.create({
      attachmentId: 'att-p4c2-test-01',
      status: 'pending',
      rawText: `BAR SPORT
RICEVUTA POS - MEMORIA CLIENTE
TID: 12345678
STAN: 876543
DATA: 28/08/2026 11:00
IMPORTO: €25,00
TRANSAZIONE ESEGUITA`,
      confidence: 90,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const draft = await receiptParserService.parse(ocrProcess.id);

    // Il draft restituito contiene paymentEvidence
    expect(draft.paymentEvidence).not.toBeNull();
    expect(draft.paymentEvidence?.amount).toBe(25.00);

    // Verifica che OCRProcess sia stato aggiornato con i dati base senza scritture contabili
    const updatedOcr = await ocrProcessRepository.getById(ocrProcess.id);
    expect(updatedOcr?.status).toBe('completed');
    expect(updatedOcr?.expenseId).toBeUndefined();

    // Pulizia
    await ocrReceiptLineRepository.deleteUnconfirmedByOcrProcessId(ocrProcess.id);
    await ocrProcessRepository.delete(ocrProcess.id);
  });

  // =========================================================================
  // 13. Errore tecnico del parser: pipeline non crasha, errore isolato, nessun falso risultato
  // =========================================================================
  it('13. Errore tecnico del parser: pipeline non crasha, errore distinguibile, paymentEvidence a null', () => {
    const posText = `BAR GELATERIA IL GABBIANO
RICEVUTA POS - MEMORIA CLIENTE
TID: 88472910
STAN: 004829
DATA 28/08/2026 ORA 15:42
IMPORTO: €12,50
TRANSAZIONE ESEGUITA`;

    const parseSpy = vi.spyOn(PaymentEvidenceParser, 'parse').mockImplementationOnce(() => {
      throw new Error('Simulated runtime crash in PaymentEvidenceParser');
    });

    let draft: ParsedReceiptDraft | null = null;
    expect(() => {
      draft = receiptParserService.parseText(posText);
    }).not.toThrow();

    if (!draft) {
      draft = receiptParserService.parseText(posText);
    }

    expect(draft).not.toBeNull();
    // Non viene prodotto un falso risultato ufficiale in caso di eccezione
    expect(draft.paymentEvidence).toBeNull();

    const shadow = receiptParserService.getLastPaymentEvidenceShadow();
    expect(shadow).not.toBeNull();
    expect(shadow?.executed).toBe(true);
    expect(shadow?.result).toBeNull();
    expect(shadow?.error).toContain('Simulated runtime crash in PaymentEvidenceParser');

    parseSpy.mockRestore();
  });

  // =========================================================================
  // 14. PAN completo nel raw OCR: non compare nel PaymentEvidence ufficiale
  // =========================================================================
  it('14. PAN completo nel raw OCR non compare nel PaymentEvidence ufficiale', () => {
    const panLeakOcrText = `RICEVUTA POS - MEMORIA CLIENTE
MERCHANT: CAFFE CENTRALE
TID: 12345678
STAN: 876543
DATE: 29/08/2026 16:00
PAN: 4000123456789010
EXP: 12/28
AMOUNT: EUR 18,50
TRANSAZIONE ESEGUITA`;

    const draft = receiptParserService.parseText(panLeakOcrText);

    expect(draft.paymentEvidence).not.toBeNull();
    // Il maskedPan deve mascherare le cifre centrali
    expect(draft.paymentEvidence?.paymentMethodHint.maskedPan).toBe('**** **** **** 9010');
    // Il PAN completo non deve apparire in chiaro in nessun campo stringa
    const resultJson = JSON.stringify(draft.paymentEvidence);
    expect(resultJson).not.toContain('4000123456789010');
  });
});
