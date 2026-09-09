import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ensureCanvasEnvironment,
  determineGateStatus,
} from './harness/rc05hBenchmarkRunner';
import {
  createReceiptImageVariants,
  evaluateReceiptOcrQuality,
} from '../utils/imagePreprocessing';
import { ocrService } from '../services/ocrService';
import { receiptParserService } from '../services/ocrParser/receiptParserService';

describe('RC-05H PRODUCTION PIPELINE PARITY TEST', () => {
  beforeAll(() => {
    ensureCanvasEnvironment();
  });

  it('1. Canvas Polyfill — garantisce la disponibilità di HTMLCanvasElement e Image in Node', () => {
    expect((globalThis as any).window).toBeDefined();
    expect((globalThis as any).window.HTMLCanvasElement).toBeDefined();
    expect((globalThis as any).document.createElement('canvas')).toBeDefined();
    expect((globalThis as any).Image).toBeDefined();
  });

  it('2. Preprocessing di produzione — createReceiptImageVariants genera 3 varianti con maxDimension: 2400', async () => {
    const samplePath = path.resolve('local-test-assets/rc05h/RR-001_EUROSPIN_p01.jpeg');
    expect(fs.existsSync(samplePath)).toBe(true);

    const buf = fs.readFileSync(samplePath);
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;

    const variants = await createReceiptImageVariants(dataUrl, {
      rotationDegrees: 0,
      maxDimension: 2400,
    });

    expect(variants).toHaveLength(3);
    const names = variants.map((v) => v.name);
    expect(names).toEqual(['original', 'gentle_contrast', 'sharpened_light']);

    for (const v of variants) {
      expect(v.dataUrl).toMatch(/^data:image\/(?:jpeg|png);base64,/);
      expect(v.dataUrl.length).toBeGreaterThan(1000);
      expect(v.label).toBeTruthy();
    }
  });

  it('3. Valutazione qualità OCR di produzione — evaluateReceiptOcrQuality assegna punteggi deterministici', () => {
    const goodText = 'EUROSPIN LAZZARO\n04/09/2024 18:30\nIMPORTO PAGATO: 5.49\nTOTALE COMPLESSIVO 5.49 EUR\nPAGAMENTO ELETTRONICO\nGRAZIE E ARRIVEDERCI';
    const evalGood = evaluateReceiptOcrQuality(goodText, 85);
    expect(evalGood.overallScore).toBeGreaterThan(40);
    expect(evalGood.totalScore).toBeGreaterThan(0);
    expect(evalGood.confidenceScore).toBeGreaterThan(15);

    const badText = '??? ### 1111';
    const evalBad = evaluateReceiptOcrQuality(badText, 30);
    expect(evalBad.overallScore).toBeLessThan(evalGood.overallScore);
  });

  it('4. Stitching di produzione — ocrService.stitchSegmentTexts è il metodo reale di produzione', () => {
    expect(typeof ocrService.stitchSegmentTexts).toBe('function');

    // Test segmenti singoli e multipli
    const s1 = 'INTESTAZIONE COMMERCIALE\nRIGA 1 10.00\nRIGA 2 20.00';
    const s2 = 'RIGA 3 30.00\nTOTALE 60.00';
    const stitched = ocrService.stitchSegmentTexts([s1, s2]);
    expect(stitched).toContain('INTESTAZIONE COMMERCIALE');
    expect(stitched).toContain('TOTALE 60.00');
  });

  it('5. Parser di produzione — receiptParserService.parseText è il parser ufficiale', () => {
    expect(typeof receiptParserService.parseText).toBe('function');
    const draft = receiptParserService.parseText('EUROSPIN\n04/09/2024\nTOTALE 5.49\nPAGAMENTO CONTANTI');
    expect(draft).toBeDefined();
    expect(draft.documentCategory).toBeDefined();
    expect(draft.total).toBeDefined();
  });

  it('6. Criteri di classificazione Gate — determineGateStatus applica rigorosamente le regole del Final Gate', () => {
    // Caso PASS
    const passDoc = determineGateStatus({
      categoryMatch: true,
      totalMatch: true,
      expectedCategory: 'COMMERCIAL_RECEIPT',
      detectedLineCount: 5,
      expectedLineCount: 5,
      merchantMatch: true,
      dateMatch: true,
      lineCountMatch: true,
    });
    expect(passDoc).toBe('PASS');

    // Caso BLOCKING per Totale errato
    const blockTotal = determineGateStatus({
      categoryMatch: true,
      totalMatch: false,
      expectedCategory: 'COMMERCIAL_RECEIPT',
      detectedLineCount: 5,
      expectedLineCount: 5,
      merchantMatch: true,
      dateMatch: true,
      lineCountMatch: true,
    });
    expect(blockTotal).toBe('BLOCKING');

    // Caso BLOCKING per Categoria errata
    const blockCat = determineGateStatus({
      categoryMatch: false,
      totalMatch: true,
      expectedCategory: 'COMMERCIAL_RECEIPT',
      detectedLineCount: 5,
      expectedLineCount: 5,
      merchantMatch: true,
      dateMatch: true,
      lineCountMatch: true,
    });
    expect(blockCat).toBe('BLOCKING');

    // Caso BLOCKING per perdita catastrofica di righe commerciali
    const blockLines = determineGateStatus({
      categoryMatch: true,
      totalMatch: true,
      expectedCategory: 'COMMERCIAL_RECEIPT',
      detectedLineCount: 0,
      expectedLineCount: 8,
      merchantMatch: true,
      dateMatch: true,
      lineCountMatch: false,
    });
    expect(blockLines).toBe('BLOCKING');

    // Caso NON_BLOCKING per discrepanza secondaria
    const nonBlock = determineGateStatus({
      categoryMatch: true,
      totalMatch: true,
      expectedCategory: 'COMMERCIAL_RECEIPT',
      detectedLineCount: 4,
      expectedLineCount: 5,
      merchantMatch: true,
      dateMatch: false,
      lineCountMatch: false,
    });
    expect(nonBlock).toBe('NON_BLOCKING');
  });
});
