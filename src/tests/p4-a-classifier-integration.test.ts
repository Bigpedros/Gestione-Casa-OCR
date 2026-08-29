import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../database/db';
import { ocrProcessRepository, attachmentRepository } from '../repositories';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { DocumentTypeClassifier } from '../services/ocrParser/modules/DocumentTypeClassifier';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';

describe('Fase P4-A: Integrazione Controllata DocumentTypeClassifier nella Pipeline OCR', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    vi.restoreAllMocks();
  });

  // A) Verifica invocazione reale del classifier nella pipeline
  describe('A) Invocazione del Classifier nella pipeline reale', () => {
    it('P4-A-01: parseText invoca DocumentTypeClassifier.classify', () => {
      const classifySpy = vi.spyOn(DocumentTypeClassifier, 'classify');
      const text = 'CONAD CITY\nVIA DEL CORSO 10\nTOTALE EURO 12,50';

      const draft = receiptParserService.parseText(text);

      expect(classifySpy).toHaveBeenCalledTimes(1);
      expect(classifySpy).toHaveBeenCalledWith(expect.any(String));
      expect(draft).toBeDefined();
      expect(draft.total.value).toBe(12.5);
    });

    it('P4-A-02: parse(ocrProcessId) invoca DocumentTypeClassifier.classify tramite flusso DB', async () => {
      const classifySpy = vi.spyOn(DocumentTypeClassifier, 'classify');

      const att = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: 'session-123',
        fileName: 'test-scontrino.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        storageKey: 'test/key',
        fileHash: 'hash123',
        status: 'active',
      });

      const proc = await ocrProcessRepository.create({
        attachmentId: att.id,
        status: 'processing',
        rawText: 'ESSELUNGA S.P.A.\nVIA RIPAMONTI 110\nTOTALE 45,20\nCONTANTI 50,00',
        confidence: 90,
        confirmationRequired: true,
        confirmedByUser: false,
      });

      const draft = await receiptParserService.parse(proc.id);

      expect(classifySpy).toHaveBeenCalledTimes(1);
      expect(draft).toBeDefined();
      expect(draft.total.value).toBe(45.2);
    });
  });

  // B) Gestione senza crash delle 4 categorie reali
  describe('B) Gestione delle quattro categorie reali senza crash', () => {
    it('P4-A-03: Elabora COMMERCIAL_RECEIPT attraverso la pipeline legacy', () => {
      const receiptText = `SUPERMERCATO PAM S.P.A.
VIA NAZIONALE 12 - ROMA
P.IVA 01234567890
DOCUMENTO COMMERCIALE di vendita
PASTA BARILLA 500G     1,20 10%
LATTE FRESCO 1L        1,60 4%
BISCOTTI MULINO        2,50 10%
TOTALE COMPLESSIVO     5,30
PAGAMENTO CONTANTI     10,00
RESTO                  4,70`;

      const draft = receiptParserService.parseText(receiptText);

      expect(draft.supplier.value).toContain('PAM');
      expect(draft.total.value).toBe(5.3);
      expect(draft.lines.length).toBeGreaterThan(0);
      expect(draft.warnings).toBeDefined();
    });

    it('P4-A-04: Elabora PAYMENT_PROOF attraverso la pipeline legacy senza crash', () => {
      const posText = `ACQUISTO
BANCOMAT
ESERCENTE: FARMACIA CENTRALE
TID: 87654321
STAN: 123456
AUT: 987654
DATA: 15/05/2026 10:30
TOTALE EUR 18,50
TRANSAZIONE ESEGUITA`;

      const draft = receiptParserService.parseText(posText);

      expect(draft).toBeDefined();
      expect(draft.total.value).toBe(18.5);
      expect(draft.warnings).toBeDefined();
    });

    it('P4-A-05: Elabora INVOICE_OR_BILL attraverso la pipeline legacy senza crash', () => {
      const billText = `ENEL ENERGIA S.P.A.
FATTURA N. 9876543210
PERIODO DI FATTURAZIONE: GENNAIO - FEBBRAIO 2026
MERCATO LIBERO DELL'ENERGIA
TOTALE DA PAGARE: 125,40 €
SCADENZA: 28/02/2026`;

      const draft = receiptParserService.parseText(billText);

      expect(draft).toBeDefined();
      expect(draft.total.value).toBe(125.4);
      expect(draft.warnings).toBeDefined();
    });

    it('P4-A-06: Elabora UNKNOWN attraverso la pipeline legacy senza crash', () => {
      const unknownText = `ACQUISTO BTC SU EXCHANGE CRYPTO.COM
ORDINE LIMITE ESEGUITO
COPPIA BTC/USDT PREZZO 65000`;

      const draft = receiptParserService.parseText(unknownText);

      expect(draft).toBeDefined();
      expect(draft.warnings).toBeDefined();
    });
  });

  // C) Preservazione e invarianza dei risultati baseline per input noti
  describe('C) Equivalenza dei risultati legacy su scontrini baseline', () => {
    it('P4-A-07: Scontrino Todis Reale (fixture permanente) produce risultati identici', () => {
      const draft = receiptParserService.parseText(TODIS_REAL_RAW_TEXT);

      expect(draft.supplier.value).toBe('T00IS');
      expect(draft.total.value).toBe(21.9);
      expect(draft.date.value).toBe('2026-08-10');
      expect(draft.paymentMethod.value).toBe('contanti');
      expect(draft.lines.length).toBeGreaterThan(0);
    });

    it('P4-A-08: Testo con rumore e linee spurie dopo il totale produce parsing consistente', () => {
      const noisyText = `SUPERSTORE ABC
10/08/2026
SHOPPERS BIO.MM320+ 0,13
TOTALE COMPLESSIVO 0,13
PAGAMENTO CONTANTE 1,00
RESTO 0,87
ATAL E ANUDEFOOTUA 5 O EEE SS
ARRIVEDERCI E GRAZIE`;

      const draft = receiptParserService.parseText(noisyText);

      expect(draft.total.value).toBe(0.13);
      expect(draft.lines.length).toBe(1);
      expect(draft.lines[0].normalizedDescription).toContain('SHOPPERS');
    });

    it('P4-A-09: Testo vuoto restituisce empty draft valido senza crash', () => {
      const draft = receiptParserService.parseText('   \n  \t ');

      expect(draft.total.value).toBeNull();
      expect(draft.lines).toEqual([]);
      expect(draft.warnings.some((w) => w.code === 'EMPTY_TEXT')).toBe(true);
    });
  });
});
