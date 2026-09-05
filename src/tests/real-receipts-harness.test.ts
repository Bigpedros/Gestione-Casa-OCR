import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  evaluateReceiptDraftAgainstGroundTruth,
} from './harness/evaluator';
import { runBatch, executeRawFixture, executeFixture, hasImageSources } from './harness/runner';
import { generateFrozenFixtureSource } from './harness/freeze';
import {
  formatDocumentTable,
  formatFailureDetails,
  formatPartialDetails,
  formatBatchSummary,
} from './harness/reporter';
import { RealReceiptFixture } from './harness/types';
import { ParsedReceiptDraft } from '../services/ocrParser/types';

describe('REAL RECEIPTS BATCH HARNESS — TEST DI UNITÀ DELL\'INFRASTRUTTURA', () => {
  const mockDraftPass: ParsedReceiptDraft = {
    documentCategory: 'COMMERCIAL_RECEIPT',
    overallConfidence: 90,
    supplier: {
      value: 'SUPERMERCATO ALFA',
      sourceText: 'SUPERMERCATO ALFA SPA',
      confidence: 95,
    },
    address: { value: 'Via Roma 1', sourceText: 'Via Roma 1', confidence: 90 },
    taxIdentifier: { value: '12345678901', sourceText: '12345678901', confidence: 90 },
    date: {
      value: '2026-09-01',
      sourceText: '01/09/2026',
      confidence: 90,
    },
    time: { value: '10:00', sourceText: '10:00', confidence: 90 },
    total: {
      value: 15.50,
      sourceText: '15,50',
      confidence: 98,
    },
    subtotal: { value: 15.50, confidence: 95, sourceText: '15,50' },
    vat: { value: 2.50, confidence: 85, sourceText: '2,50' },
    discounts: { value: 0, confidence: 90, sourceText: '0' },
    paymentMethod: {
      value: 'CONTANTI',
      sourceText: 'CONTANTI',
      confidence: 90,
    },
    lines: [
      {
        originalText: 'PANE FRESCO 2,50',
        normalizedDescription: 'PANE FRESCO',
        quantity: 1,
        unitPrice: 2.50,
        lineTotal: 2.50,
        confidence: 90,
        reviewStatus: 'pending',
        warnings: [],
      },
      {
        originalText: 'LATTE INTERO 1,00',
        normalizedDescription: 'LATTE INTERO',
        quantity: 1,
        unitPrice: 1.00,
        lineTotal: 1.00,
        confidence: 90,
        reviewStatus: 'pending',
        warnings: [],
      },
      {
        originalText: 'CAFFE ESPRESSO 12,00',
        normalizedDescription: 'CAFFE ESPRESSO',
        quantity: 1,
        unitPrice: 12.00,
        lineTotal: 12.00,
        confidence: 90,
        reviewStatus: 'pending',
        warnings: [],
      },
    ],
    warnings: [],
  };

  const fixtureBase: RealReceiptFixture = {
    id: 'TEST_SAMPLE_01',
    label: 'Test Sample Alfa',
    rawText: 'DUMMY RAW TEXT',
    groundTruth: {
      id: 'TEST_SAMPLE_01',
      expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      expectedMerchant: 'SUPERMERCATO ALFA',
      expectedLineCount: 3,
      expectedTotal: 15.50,
      expectedPaymentMethod: 'CONTANTI',
      expectedProducts: [
        { descriptionContains: 'PANE FRESCO', price: 2.50 },
        { descriptionContains: 'LATTE INTERO', price: 1.00 },
      ],
    },
  };

  it('1. PASS completo: tutti i campi ground truth disponibili corrispondono', () => {
    const report = evaluateReceiptDraftAgainstGroundTruth(
      fixtureBase,
      mockDraftPass,
      'RAW_FIXTURE',
      12
    );

    expect(report.status).toBe('PASS');
    expect(report.categoryMatch).toBe(true);
    expect(report.merchantMatch).toBe(true);
    expect(report.totalMatch).toBe(true);
    expect(report.lineCountMatch).toBe(true);
    expect(report.paymentMethodMatch).toBe(true);
    expect(report.unfoundExpectedProducts).toHaveLength(0);
    expect(report.failureReasons).toHaveLength(0);
    expect(report.partialReasons).toHaveLength(0);
  });

  it('2. PARTIAL: discrepanza non critica (es. 1 prodotto atteso con prezzo leggermente discorde o line count)', () => {
    const fixtureWithExtraExpected: RealReceiptFixture = {
      ...fixtureBase,
      groundTruth: {
        ...fixtureBase.groundTruth,
        expectedLineCount: 4, // 4 attese invece di 3
        expectedPaymentMethod: 'BANCOMAT', // contanti rilevati
      },
    };

    const report = evaluateReceiptDraftAgainstGroundTruth(
      fixtureWithExtraExpected,
      mockDraftPass,
      'RAW_FIXTURE',
      15
    );

    expect(report.status).toBe('PARTIAL');
    expect(report.failureReasons).toHaveLength(0);
    expect(report.partialReasons.length).toBeGreaterThan(0);
    expect(report.lineCountMatch).toBe(false);
  });

  it('3. FAIL: errore strutturale importante su categoria', () => {
    const draftWrongCategory: ParsedReceiptDraft = {
      ...mockDraftPass,
      documentCategory: 'INVOICE_OR_BILL',
    };

    const report = evaluateReceiptDraftAgainstGroundTruth(
      fixtureBase,
      draftWrongCategory,
      'RAW_FIXTURE',
      10
    );

    expect(report.status).toBe('FAIL');
    expect(report.categoryMatch).toBe(false);
    expect(report.failureReasons.some((r) => r.includes('Categoria errata'))).toBe(true);
  });

  it('4. FAIL: errore strutturale importante su totale non corrispondente', () => {
    const draftWrongTotal: ParsedReceiptDraft = {
      ...mockDraftPass,
      total: { value: 99.99, confidence: 90, sourceText: '99,99' },
    };

    const report = evaluateReceiptDraftAgainstGroundTruth(
      fixtureBase,
      draftWrongTotal,
      'RAW_FIXTURE',
      10
    );

    expect(report.status).toBe('FAIL');
    expect(report.totalMatch).toBe(false);
    expect(report.failureReasons.some((r) => r.includes('Totale errato'))).toBe(true);
  });

  it('5. Campi ground truth opzionali: valori undefined non generano falsi FAIL', () => {
    const fixtureMinimal: RealReceiptFixture = {
      id: 'MINIMAL_01',
      label: 'Minimal Sample',
      rawText: 'DUMMY',
      groundTruth: {
        id: 'MINIMAL_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
        // Nessun expectedMerchant, expectedTotal, expectedLineCount specificato
      },
    };

    const report = evaluateReceiptDraftAgainstGroundTruth(
      fixtureMinimal,
      mockDraftPass,
      'RAW_FIXTURE',
      5
    );

    expect(report.status).toBe('PASS');
    expect(report.categoryMatch).toBe(true);
    expect(report.merchantMatch).toBeUndefined();
    expect(report.totalMatch).toBeUndefined();
    expect(report.lineCountMatch).toBeUndefined();
    expect(report.failureReasons).toHaveLength(0);
  });

  it('6. PRICE_NOT_DETECTED non causa automaticamente FAIL', () => {
    const draftWithPriceNotDetected: ParsedReceiptDraft = {
      ...mockDraftPass,
      lines: [
        {
          originalText: 'PRODOTTO SENZA PREZZO OTTICO',
          normalizedDescription: 'PRODOTTO SENZA PREZZO',
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
          confidence: 80,
          reviewStatus: 'pending',
          warnings: ['PRICE_NOT_DETECTED'],
        },
      ],
    };

    const fixtureSingleLine: RealReceiptFixture = {
      ...fixtureBase,
      groundTruth: {
        id: 'TEST_PND',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
        expectedLineCount: 1,
        expectedTotal: 15.50,
      },
    };

    const report = evaluateReceiptDraftAgainstGroundTruth(
      fixtureSingleLine,
      draftWithPriceNotDetected,
      'RAW_FIXTURE',
      8
    );

    expect(report.linesPriceNotDetected).toBe(1);
    expect(report.linesWithPrice).toBe(0);
    // Non deve essere dichiarato FAIL a causa del solo PRICE_NOT_DETECTED
    expect(report.failureReasons.some((r) => r.includes('PRICE_NOT_DETECTED'))).toBe(false);
  });

  it('7. Isolamento rigoroso: nessun modulo di runtime in src/services importa dai test fixture', () => {
    const servicesDir = path.resolve('src/services');
    const files = fs.readdirSync(servicesDir, { recursive: true }) as string[];

    const tsFiles = files.filter((f) => typeof f === 'string' && f.endsWith('.ts'));

    for (const relPath of tsFiles) {
      const fullPath = path.join(servicesDir, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Verifica che nessun file runtime importi ground truth o fixture
      expect(content).not.toContain('/fixtures/');
      expect(content).not.toContain('RealReceiptGroundTruth');
      expect(content).not.toContain('RealReceiptFixture');
      expect(content).not.toContain('real-receipts');
      expect(content).not.toContain('INITIAL_REAL_RECEIPTS_CORPUS');
      expect(content).not.toContain('groundTruth');
    }
  });

  it('8. Freeze utility: genera sorgente TypeScript fedele con hash sha256 e metadata', () => {
    const source = generateFrozenFixtureSource({
      id: 'FROZEN_01',
      label: 'Sample Frozen',
      rawText: 'RIGA 1\nRIGA 2 CON ERRORE 0CR\nTOTALE 10,00',
      groundTruth: {
        id: 'FROZEN_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
        expectedTotal: 10.00,
      },
      ocrEngineVersion: 'Tesseract.js v7.0.0 (ita)',
    });

    expect(source).toContain('REAL RECEIPTS BATCH HARNESS — FROZEN RAW OCR FIXTURE');
    expect(source).toContain('FROZEN_01_FIXTURE');
    expect(source).toContain('SHA-256');
    expect(source).toContain('Line Count: 3');
    expect(source).toContain('RIGA 2 CON ERRORE 0CR');
  });

  it('9. Formattazione report: tabella, dettagli FAIL/PARTIAL e sommario statistico', async () => {
    const dummyFixturePass: RealReceiptFixture = { ...fixtureBase, id: 'DUMMY_P', label: 'Pass Item' };
    const dummyFixtureFail: RealReceiptFixture = {
      ...fixtureBase,
      id: 'DUMMY_F',
      label: 'Fail Item',
      groundTruth: {
        ...fixtureBase.groundTruth,
        expectedTotal: 999.99, // Forza FAIL
      },
    };

    const repPass = evaluateReceiptDraftAgainstGroundTruth(dummyFixturePass, mockDraftPass, 'RAW_FIXTURE', 10);
    const repFail = evaluateReceiptDraftAgainstGroundTruth(dummyFixtureFail, mockDraftPass, 'RAW_FIXTURE', 12);

    const batchResult = await runBatch([dummyFixturePass, dummyFixtureFail], {
      // In questo test usiamo i report già generati per testare la generazione
    });
    expect(batchResult.summary).toBeDefined();

    const table = formatDocumentTable([repPass, repFail]);
    expect(table).toContain('REAL RECEIPTS BATCH HARNESS');
    expect(table).toContain('DUMMY_P');
    expect(table).toContain('DUMMY_F');

    const failDetails = formatFailureDetails([repPass, repFail]);
    expect(failDetails).toContain('[FAIL] DUMMY_F');
    expect(failDetails).toContain('Totale errato');

    const partialDetails = formatPartialDetails([repPass, repFail]);
    expect(partialDetails).toContain('NESSUN PARTIAL');

    const sumReport = formatBatchSummary({
      totalDocuments: 2,
      passCount: 1,
      partialCount: 0,
      failCount: 1,
      skippedCount: 0,
      categoryAccuracyPct: 100,
      merchantAccuracyPct: 100,
      totalAccuracyPct: 50,
      lineCountAccuracyPct: 100,
      paymentMethodAccuracyPct: 100,
      totalDurationMs: 22,
    });
    expect(sumReport).toContain('TOTAL ACCURACY               : 50%');
  });

  it('10. Campione senza rawText: viene classificato come SKIPPED senza generare un falso FAIL', async () => {
    const unacquiredFixture: RealReceiptFixture = {
      id: 'PENDING_01',
      label: 'Sample Pending Acquisition',
      rawText: undefined,
      groundTruth: {
        id: 'PENDING_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    const report = await executeRawFixture(unacquiredFixture);
    expect(report.status).toBe('SKIPPED');
    expect(report.failureReasons).toHaveLength(0);
  });

  it('11. Multi-image dispatch: fixture con imagePath viene instradata verso IMAGE_E2E (status SKIPPED con warning MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE)', async () => {
    const fixtureWithPath: RealReceiptFixture = {
      id: 'IMG_PATH_01',
      label: 'Single imagePath fixture',
      imagePath: 'sample.jpg',
      groundTruth: {
        id: 'IMG_PATH_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    expect(hasImageSources(fixtureWithPath)).toBe(true);

    const report = await executeFixture(fixtureWithPath);
    expect(report.mode).toBe('IMAGE_E2E');
    expect(report.status).toBe('SKIPPED');
    expect(report.warnings.some((w) => w.includes('MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE'))).toBe(true);
  });

  it('12. Multi-image dispatch: fixture con imageDataUrl viene instradata verso IMAGE_E2E (status SKIPPED con warning corretto)', async () => {
    const fixtureWithDataUrl: RealReceiptFixture = {
      id: 'IMG_DATAURL_01',
      label: 'Single imageDataUrl fixture',
      imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...',
      groundTruth: {
        id: 'IMG_DATAURL_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    expect(hasImageSources(fixtureWithDataUrl)).toBe(true);

    const report = await executeFixture(fixtureWithDataUrl);
    expect(report.mode).toBe('IMAGE_E2E');
    expect(report.status).toBe('SKIPPED');
    expect(report.warnings.some((w) => w.includes('MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE'))).toBe(true);
  });

  it('13. Multi-image dispatch: fixture con SOLO imagePaths[] non cade in RAW_FIXTURE, viene instradata a IMAGE_E2E', async () => {
    const fixtureMultiPath: RealReceiptFixture = {
      id: 'MULTI_PATH_01',
      label: 'Multi imagePaths fixture',
      imagePaths: ['RR-010_ORIZZONTE_p01.jpg', 'RR-010_ORIZZONTE_p02.jpg'],
      groundTruth: {
        id: 'MULTI_PATH_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    expect(hasImageSources(fixtureMultiPath)).toBe(true);

    const report = await executeFixture(fixtureMultiPath);
    expect(report.mode).toBe('IMAGE_E2E');
    expect(report.status).toBe('SKIPPED');
    expect(report.warnings.some((w) => w.includes('MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('RAW_TEXT_MISSING'))).toBe(false);
  });

  it('14. Multi-image dispatch: fixture con SOLO imageDataUrls[] non cade in RAW_FIXTURE, viene instradata a IMAGE_E2E', async () => {
    const fixtureMultiDataUrl: RealReceiptFixture = {
      id: 'MULTI_DATAURL_01',
      label: 'Multi imageDataUrls fixture',
      imageDataUrls: ['data:image/jpeg;base64,page1...', 'data:image/jpeg;base64,page2...'],
      groundTruth: {
        id: 'MULTI_DATAURL_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    expect(hasImageSources(fixtureMultiDataUrl)).toBe(true);

    const report = await executeFixture(fixtureMultiDataUrl);
    expect(report.mode).toBe('IMAGE_E2E');
    expect(report.status).toBe('SKIPPED');
    expect(report.warnings.some((w) => w.includes('MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('RAW_TEXT_MISSING'))).toBe(false);
  });

  it('15. Multi-image dispatch: array vuoti imagePaths: [] e imageDataUrls: [] non attivano IMAGE_E2E', async () => {
    const fixtureEmptyArrays: RealReceiptFixture = {
      id: 'EMPTY_ARRAYS_01',
      label: 'Empty arrays fixture',
      imagePaths: [],
      imageDataUrls: [],
      groundTruth: {
        id: 'EMPTY_ARRAYS_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    expect(hasImageSources(fixtureEmptyArrays)).toBe(false);

    // Senza rawText, cade in RAW_FIXTURE con status SKIPPED e RAW_TEXT_MISSING, NON in IMAGE_E2E
    const report = await executeFixture(fixtureEmptyArrays);
    expect(report.mode).toBe('RAW_FIXTURE');
    expect(report.status).toBe('SKIPPED');
    expect(report.warnings.some((w) => w.includes('RAW_TEXT_MISSING'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE'))).toBe(false);
  });

  it('16. Multi-image dispatch: fixture RAW con rawText e senza immagini mantiene esecuzione RAW_FIXTURE invariata', async () => {
    const rawOnlyFixture: RealReceiptFixture = {
      id: 'RAW_ONLY_01',
      label: 'Raw text only fixture',
      rawText: 'RIGA 1 10,00\nTOTALE 10,00',
      groundTruth: {
        id: 'RAW_ONLY_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
        expectedTotal: 10.00,
      },
    };

    expect(hasImageSources(rawOnlyFixture)).toBe(false);

    const report = await executeFixture(rawOnlyFixture);
    expect(report.mode).toBe('RAW_FIXTURE');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.status).not.toBe('SKIPPED');
  });

  it('17. Multi-image dispatch: fixture senza raw e senza immagini mantiene comportamento SKIPPED con RAW_TEXT_MISSING invariato', async () => {
    const emptyFixture: RealReceiptFixture = {
      id: 'NO_RAW_NO_IMG_01',
      label: 'No raw and no images',
      groundTruth: {
        id: 'NO_RAW_NO_IMG_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    expect(hasImageSources(emptyFixture)).toBe(false);

    const report = await executeFixture(emptyFixture);
    expect(report.mode).toBe('RAW_FIXTURE');
    expect(report.status).toBe('SKIPPED');
    expect(report.warnings.some((w) => w.includes('RAW_TEXT_MISSING'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE'))).toBe(false);
  });

  it('18. Multi-image dispatch: preservazione dell\'ordine dichiarato negli array multi-immagine', () => {
    const fixtureOrdered: RealReceiptFixture = {
      id: 'ORDERED_01',
      label: 'Ordered pages fixture',
      imagePaths: ['p01.jpg', 'p02.jpg', 'p03.jpg'],
      groundTruth: {
        id: 'ORDERED_01',
        expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      },
    };

    expect(hasImageSources(fixtureOrdered)).toBe(true);
    expect(fixtureOrdered.imagePaths?.[0]).toBe('p01.jpg');
    expect(fixtureOrdered.imagePaths?.[1]).toBe('p02.jpg');
    expect(fixtureOrdered.imagePaths?.[2]).toBe('p03.jpg');
  });
});
