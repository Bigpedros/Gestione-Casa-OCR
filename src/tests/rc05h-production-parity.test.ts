import { describe, it, expect, beforeAll } from 'vitest';
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
    /*
     * Immagine sintetica autosufficiente:
     * il test di parità CI non deve dipendere dal corpus fotografico
     * RC-05H, che resta volutamente escluso dal repository Git.
     *
     * La larghezza iniziale di 2500 px esercita anche il vincolo
     * maxDimension: 2400 della pipeline di produzione.
     */
    const canvas = document.createElement('canvas');
    canvas.width = 2500;
    canvas.height = 500;

    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();

    ctx!.fillStyle = '#ffffff';
    ctx!.fillRect(0, 0, canvas.width, canvas.height);

    ctx!.fillStyle = '#000000';
    ctx!.font = '48px sans-serif';
    ctx!.fillText('DOCUMENTO COMMERCIALE', 120, 180);
    ctx!.fillText('TOTALE 14,46 EUR', 120, 300);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    const variants = await createReceiptImageVariants(dataUrl, {
      rotationDegrees: 0,
      maxDimension: 2400,
    });

    expect(variants).toHaveLength(3);

    const names = variants.map((v) => v.name);
    expect(names).toEqual([
      'original',
      'gentle_contrast',
      'sharpened_light',
    ]);

    for (const v of variants) {
      expect(v.dataUrl).toMatch(/^data:image\/(?:jpeg|png);base64,/);
      expect(v.dataUrl.length).toBeGreaterThan(1000);
      expect(v.label).toBeTruthy();
    }
  });

  it('3. Valutazione qualità OCR di produzione — evaluateReceiptOcrQuality assegna punteggi deterministici', () => {
    const goodText =
      'EUROSPIN LAZZARO\n04/09/2024 18:30\nIMPORTO PAGATO: 5.49\nTOTALE COMPLESSIVO 5.49 EUR\nPAGAMENTO ELETTRONICO\nGRAZIE E ARRIVEDERCI';

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

    const s1 =
      'INTESTAZIONE COMMERCIALE\nRIGA 1 10.00\nRIGA 2 20.00';
    const s2 =
      'RIGA 3 30.00\nTOTALE 60.00';

    const stitched = ocrService.stitchSegmentTexts([s1, s2]);

    expect(stitched).toContain('INTESTAZIONE COMMERCIALE');
    expect(stitched).toContain('TOTALE 60.00');
  });

  it('5. Parser di produzione — receiptParserService.parseText è il parser ufficiale', () => {
    expect(typeof receiptParserService.parseText).toBe('function');

    const draft = receiptParserService.parseText(
      'EUROSPIN\n04/09/2024\nTOTALE 5.49\nPAGAMENTO CONTANTI',
    );

    expect(draft).toBeDefined();
    expect(draft.documentCategory).toBeDefined();
    expect(draft.total).toBeDefined();
  });

  it('6. Criteri di classificazione Gate — determineGateStatus applica rigorosamente le regole del Final Gate', () => {
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