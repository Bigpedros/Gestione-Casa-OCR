import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
  expenseRepository,
  supplierRepository,
} from '../repositories';
import {
  receiptParserService,
  TextNormalizationModule,
  SupplierParser,
  AddressParser,
  TaxIdentifierParser,
  DateTimeParser,
  TotalParser,
  SubtotalParser,
  VatParser,
  DiscountParser,
  PaymentMethodParser,
  LineItemParser,
  ReceiptConsistencyValidator,
  ReceiptParserContext,
} from '../services/ocrParser';

describe('Parser Locale Modulare OCR (TEST-OCR-PARSER)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  // 1. VERIFICA SINGOLI MODULI (UNIT TESTS)
  describe('Moduli di estrazione individuali', () => {
    it('TextNormalizationModule - pulizia caratteri invisibili e trattini', () => {
      const raw = 'DESPAR\u200B  S.R.L.\n\nVIA  ROMA\u201410\nTOTALE  €  15,00';
      const norm = TextNormalizationModule.normalize(raw);

      expect(norm.normalizedText).toContain('DESPAR S.R.L.');
      expect(norm.normalizedText).toContain('VIA ROMA-10');
      expect(norm.normalizedLines.length).toBe(3);
      expect(norm.transformations).toContain('removed_invisible_chars');
    });

    it('SupplierParser - identifica fornitore ed esclude intestazioni generiche', () => {
      const context: ReceiptParserContext = {
        rawText: 'DOCUMENTO COMMERCIALE\nDESPAR SUPERMERCATO S.R.L.\nVIA TORINO 45\nP.IVA 01234567890',
        normalizedText: 'DOCUMENTO COMMERCIALE\nDESPAR SUPERMERCATO S.R.L.\nVIA TORINO 45\nP.IVA 01234567890',
        lines: ['DOCUMENTO COMMERCIALE', 'DESPAR SUPERMERCATO S.R.L.', 'VIA TORINO 45', 'P.IVA 01234567890'],
        normalizedLines: ['DOCUMENTO COMMERCIALE', 'DESPAR SUPERMERCATO S.R.L.', 'VIA TORINO 45', 'P.IVA 01234567890'],
        overallOcrConfidence: 90,
      };

      const supplierParser = new SupplierParser();
      const res = supplierParser.parse(context);

      expect(res.value).toBe('DESPAR SUPERMERCATO S.R.L.');
      expect(res.confidence).toBeGreaterThan(70);
    });

    it('AddressParser - riconosce via, CAP, città e provincia', () => {
      const context: ReceiptParserContext = {
        rawText: 'ESSELUNGA S.P.A.\nVIA RIPAMONTI 110\n20141 MILANO (MI)',
        normalizedText: 'ESSELUNGA S.P.A.\nVIA RIPAMONTI 110\n20141 MILANO (MI)',
        lines: ['ESSELUNGA S.P.A.', 'VIA RIPAMONTI 110', '20141 MILANO (MI)'],
        normalizedLines: ['ESSELUNGA S.P.A.', 'VIA RIPAMONTI 110', '20141 MILANO (MI)'],
        overallOcrConfidence: 88,
      };

      const addressParser = new AddressParser();
      const res = addressParser.parse(context);

      expect(res.value).toContain('VIA RIPAMONTI 110');
      expect(res.value).toContain('20141 MILANO (MI)');
      expect(res.confidence).toBeGreaterThan(60);
    });

    it('TaxIdentifierParser - valida algoritmo Partita IVA italiana', () => {
      const taxParser = new TaxIdentifierParser();
      // Partita IVA valida (es. 01234567897 ha checksum valido)
      expect(taxParser.validateItalianPIva('01234567897')).toBe(true);
      expect(taxParser.validateItalianPIva('12345678901')).toBe(false);

      const context: ReceiptParserContext = {
        rawText: 'CONAD\nP.IVA 01234567897\nTEL 02123456',
        normalizedText: 'CONAD\nP.IVA 01234567897\nTEL 02123456',
        lines: ['CONAD', 'P.IVA 01234567897', 'TEL 02123456'],
        normalizedLines: ['CONAD', 'P.IVA 01234567897', 'TEL 02123456'],
        overallOcrConfidence: 90,
      };

      const res = taxParser.parse(context);
      expect(res.value).toBe('P.IVA 01234567897');
      expect(res.confidence).toBe(95);
    });

    it('DateTimeParser - distingue la data del documento dalle date promozionali', () => {
      const context: ReceiptParserContext = {
        rawText: 'VOLANTINO VALIDO DAL 01/01/2026 AL 15/01/2026\nSCONTRINO N. 45\nDATA 12/05/2026 ORE 14:30',
        normalizedText: 'VOLANTINO VALIDO DAL 01/01/2026 AL 15/01/2026\nSCONTRINO N. 45\nDATA 12/05/2026 ORE 14:30',
        lines: ['VOLANTINO VALIDO DAL 01/01/2026 AL 15/01/2026', 'SCONTRINO N. 45', 'DATA 12/05/2026 ORE 14:30'],
        normalizedLines: ['VOLANTINO VALIDO DAL 01/01/2026 AL 15/01/2026', 'SCONTRINO N. 45', 'DATA 12/05/2026 ORE 14:30'],
        overallOcrConfidence: 90,
      };

      const dtParser = new DateTimeParser();
      const res = dtParser.parse(context);

      expect(res.date.value).toBe('2026-05-12');
      expect(res.time.value).toBe('14:30');
      expect(res.date.confidence).toBeGreaterThan(70);
    });

    it('SubtotalParser, VatParser, DiscountParser e PaymentMethodParser - estrazione moduli ausiliari', () => {
      const context: ReceiptParserContext = {
        rawText: 'SUBTOTALE 15,00\nSCONTO TOTALE 2,00\nTOTALE IVA 2,20\nPAGAMENTO CONTANTI',
        normalizedText: 'SUBTOTALE 15,00\nSCONTO TOTALE 2,00\nTOTALE IVA 2,20\nPAGAMENTO CONTANTI',
        lines: ['SUBTOTALE 15,00', 'SCONTO TOTALE 2,00', 'TOTALE IVA 2,20', 'PAGAMENTO CONTANTI'],
        normalizedLines: ['SUBTOTALE 15,00', 'SCONTO TOTALE 2,00', 'TOTALE IVA 2,20', 'PAGAMENTO CONTANTI'],
        overallOcrConfidence: 90,
      };

      const subtotalRes = new SubtotalParser().parse(context);
      expect(subtotalRes.value).toBe(15.0);

      const discountRes = new DiscountParser().parse(context);
      expect(discountRes.value).toBe(2.0);

      const vatRes = new VatParser().parse(context);
      expect(vatRes.value).toBe(2.2);

      const payRes = new PaymentMethodParser().parse(context);
      expect(payRes.value).toBe('contanti');
    });

    it('TotalParser - privilegia TOTALE EURO distinguendolo da contanti e resto', () => {
      const context: ReceiptParserContext = {
        rawText: 'SUBTOTALE 25,00\nSCONTO 5,00\nTOTALE EURO 20,00\nCONTANTI 50,00\nRESTO 30,00',
        normalizedText: 'SUBTOTALE 25,00\nSCONTO 5,00\nTOTALE EURO 20,00\nCONTANTI 50,00\nRESTO 30,00',
        lines: ['SUBTOTALE 25,00', 'SCONTO 5,00', 'TOTALE EURO 20,00', 'CONTANTI 50,00', 'RESTO 30,00'],
        normalizedLines: ['SUBTOTALE 25,00', 'SCONTO 5,00', 'TOTALE EURO 20,00', 'CONTANTI 50,00', 'RESTO 30,00'],
        overallOcrConfidence: 90,
      };

      const totalParser = new TotalParser();
      const res = totalParser.parse(context);

      expect(res.value).toBe(20.0);
      expect(res.confidence).toBeGreaterThan(80);
    });

    it('LineItemParser - estrae righe con quantità multiple, peso, sconti e resi', () => {
      const context: ReceiptParserContext = {
        rawText: 'DOCUMENTO COMMERCIALE\nPASTA RUMMO 1,20\n2 x 1,50 3,00\nLATTE SCREMATO\nMELE GOLDEN 0,750 kg x 2,00 1,50\nRESO PANE -1,00\nTOTALE 4,70',
        normalizedText: 'DOCUMENTO COMMERCIALE\nPASTA RUMMO 1,20\n2 x 1,50 3,00\nLATTE SCREMATO\nMELE GOLDEN 0,750 kg x 2,00 1,50\nRESO PANE -1,00\nTOTALE 4,70',
        lines: [
          'DOCUMENTO COMMERCIALE',
          'PASTA RUMMO 1,20',
          '2 x 1,50 3,00',
          'LATTE SCREMATO',
          'MELE GOLDEN 0,750 kg x 2,00 1,50',
          'RESO PANE -1,00',
          'TOTALE 4,70',
        ],
        normalizedLines: [
          'DOCUMENTO COMMERCIALE',
          'PASTA RUMMO 1,20',
          '2 x 1,50 3,00',
          'LATTE SCREMATO',
          'MELE GOLDEN 0,750 kg x 2,00 1,50',
          'RESO PANE -1,00',
          'TOTALE 4,70',
        ],
        overallOcrConfidence: 90,
      };

      const lineParser = new LineItemParser();
      const lines = lineParser.parse(context);

      expect(lines.length).toBeGreaterThanOrEqual(3);

      const rummo = lines.find((l) => l.normalizedDescription.includes('PASTA RUMMO'));
      expect(rummo).toBeDefined();
      expect(rummo?.lineTotal).toBe(1.2);

      const mele = lines.find((l) => l.normalizedDescription.includes('MELE GOLDEN'));
      expect(mele).toBeDefined();
      expect(mele?.quantity).toBe(0.75);

      const reso = lines.find((l) => l.isNegative || l.lineTotal < 0);
      expect(reso).toBeDefined();
      expect(reso?.lineTotal).toBe(-1.0);
    });

    it('ReceiptConsistencyValidator - rileva discrepanze somma righe vs totale', () => {
      const draft = receiptParserService.parseText(
        'DESPAR\nDOCUMENTO COMMERCIALE\nPASTA 1,00\nPANE 1,00\nTOTALE EURO 10,00'
      );

      const validation = ReceiptConsistencyValidator.validate(draft);
      expect(validation.warnings.some((w) => w.code === 'LINE_SUM_MISMATCH')).toBe(true);
      expect(validation.adjustedConfidence).toBeLessThan(draft.overallConfidence);
    });
  });

  // 2. SCENARI COMPLETI (SUPERMERCATO, FARMACIA, RISTORANTE, SCONTRINO LUNGO)
  describe('Scenari reali di scontrino', () => {
    it('Scontrino Supermercato completo', () => {
      const rawText = `
        SUPERMERCATO DESPAR S.R.L.
        VIA MAZZINI 12 - 20100 MILANO
        P.IVA 01234567890 TEL. 02/987654

        DOCUMENTO COMMERCIALE
        di vendita

        PASTA BARILLA 500G      1,10 A
        2 x 1,50
        LATTE FRESCO 1L         3,00 A
        CEREALI KELLOGG SCONTO -0,50 2,50 A
        0,500 kg x 4,00
        PROSCIUTTO COTTO        2,00 A

        SUBTOTALE               8,60
        TOTALE EURO             8,60

        CONTANTI                10,00
        RESTO                   1,40

        PAGAMENTO CONTANTI
        DATA 15/06/2026 ORE 17:45
        GRAZIE E ARRIVEDERCI
      `;

      const draft = receiptParserService.parseText(rawText);

      expect(draft.supplier.value).toContain('DESPAR');
      expect(draft.taxIdentifier.value).toBe('P.IVA 01234567890');
      expect(draft.date.value).toBe('2026-06-15');
      expect(draft.time.value).toBe('17:45');
      expect(draft.total.value).toBe(8.6);
      expect(draft.paymentMethod.value).toBe('contanti');
      expect(draft.lines.length).toBeGreaterThanOrEqual(3);
    });

    it('Scontrino Farmacia con sconti', () => {
      const rawText = `
        FARMACIA CENTRALE S.N.C.
        VIA DANTE 5 - MILANO
        P.IVA 01234567890

        TACHIPIRINA 1000MG       6,50
        ASPIRINA C              4,50
        BUONO SCONTO           -1,00

        TOTALE €               10,00
        CARTA DI CREDITO
        10/05/2026 10:15
      `;

      const draft = receiptParserService.parseText(rawText);

      expect(draft.supplier.value).toContain('FARMACIA');
      expect(draft.date.value).toBe('2026-05-10');
      expect(draft.total.value).toBe(10.0);
      expect(draft.paymentMethod.value).toBe('carta');
    });

    it('Scontrino Bar / Ristorante con pagamento POS', () => {
      const rawText = `
        BAR RISTORANTE DA GIOVANNI
        PIAZZA DUOMO 1
        C.F. GVN00A01H501Z

        2 x 1,20
        CAFFE ESPRESSO          2,40
        BRIOCHE VEGANA          1,60

        TOTALE EURO             4,00
        PAGAMENTO CONTACTLESS / POS
        02/08/2026 08:30
      `;

      const draft = receiptParserService.parseText(rawText);

      expect(draft.supplier.value).toContain('BAR RISTORANTE DA GIOVANNI');
      expect(draft.total.value).toBe(4.0);
      expect(draft.paymentMethod.value).toBe('carta');
    });
  });

  // 3. PERSISTENZA IDEMPOTENTE E VINCOLI ARCHITETTURALI
  describe('Persistenza idempotente e vincoli di non-modifica contabile', () => {
    it('Persistenza via ReceiptParserService.parse() e idempotenza su ri-esecuzione', async () => {
      const proc = await ocrProcessRepository.create({
        attachmentId: 'att-100',
        status: 'processing',
        rawText: 'DESPAR\nDATA 10/04/2026\nPASTA 1,50\nTOTALE 1,50',
        confirmationRequired: true,
        confirmedByUser: false,
      });

      // 1. Prima esecuzione del parser
      const draft1 = await receiptParserService.parse(proc.id);
      expect(draft1.supplier.value).toContain('DESPAR');

      const linesAfterFirstRun = await ocrReceiptLineRepository.getByOcrProcessId(proc.id);
      expect(linesAfterFirstRun.length).toBe(1);
      expect(linesAfterFirstRun[0].description).toContain('PASTA');
      expect(linesAfterFirstRun[0].reviewStatus).toBe('pending');

      // Modifica manuale simulata dell utente su una riga (reviewStatus = 'confirmed')
      await ocrReceiptLineRepository.update(linesAfterFirstRun[0].id, {
        reviewStatus: 'confirmed',
        description: 'PASTA RUMMO CONFERMATA',
      });

      // 2. Seconda esecuzione del parser sullo stesso ocrProcessId
      await receiptParserService.parse(proc.id);

      const linesAfterSecondRun = await ocrReceiptLineRepository.getByOcrProcessId(proc.id);
      // La riga confermata non deve essere stata cancellata o sovrascritta!
      const confirmedLine = linesAfterSecondRun.find((l) => l.reviewStatus === 'confirmed');
      expect(confirmedLine).toBeDefined();
      expect(confirmedLine?.description).toBe('PASTA RUMMO CONFERMATA');
    });

    it('TASSATIVO: Nessuna entità Expense, Product, ProductAlias o Supplier viene creata', async () => {
      const proc = await ocrProcessRepository.create({
        attachmentId: 'att-200',
        status: 'processing',
        rawText: 'ESSELUNGA\nDATA 01/01/2026\nMELE 2,00\nTOTALE 2,00',
        confirmationRequired: true,
        confirmedByUser: false,
      });

      await receiptParserService.parse(proc.id);

      // Verifiche tassative
      const expenses = await expenseRepository.getAll();
      expect(expenses.length).toBe(0);

      const suppliers = await supplierRepository.getAll();
      expect(suppliers.length).toBe(0);

      const products = await db.products.toArray();
      expect(products.length).toBe(0);

      const aliases = await db.productAliases.toArray();
      expect(aliases.length).toBe(0);
    });
  });
});
