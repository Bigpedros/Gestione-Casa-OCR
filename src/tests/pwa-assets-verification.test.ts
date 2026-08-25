import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { PNG } from 'pngjs';
import { verifyPngFile, runVerification } from '../../scripts/verify-pwa-assets.mjs';

describe('PWA Assets & PNG Binary Verification Tests (Regression Guard)', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-test-'));
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('TEST-PWA-001: accetta un file PNG binario valido con dimensioni corrette', () => {
    const validPngPath = path.join(tempDir, 'valid-192.png');
    const png = new PNG({ width: 192, height: 192 });
    png.data.fill(128);
    const validBuffer = PNG.sync.write(png);
    fs.writeFileSync(validPngPath, validBuffer);

    const result = verifyPngFile(validPngPath, 192, 192, true);
    expect(result).not.toBe(false);
    if (result) {
      expect(result.width).toBe(192);
      expect(result.height).toBe(192);
      expect(result.size).toBe(validBuffer.length);
    }
  });

  it('TEST-PWA-002: rifiuta categoricamente un file corrotto con header EF BF BD 50 4E 47', () => {
    const corruptedPath = path.join(tempDir, 'corrupted-utf8.png');
    const png = new PNG({ width: 192, height: 192 });
    png.data.fill(128);
    const validBuffer = PNG.sync.write(png);

    // Simula la corruzione UTF-8 con il carattere di rimpiazzo EF BF BD
    const corruptedBuffer = Buffer.concat([
      Buffer.from([0xef, 0xbf, 0xbd, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
      validBuffer.subarray(8),
    ]);
    fs.writeFileSync(corruptedPath, corruptedBuffer);

    const result = verifyPngFile(corruptedPath, 192, 192, true);
    expect(result).toBe(false);
  });

  it('TEST-PWA-003: rifiuta un file PNG troncato o vuoto', () => {
    const truncatedPath = path.join(tempDir, 'truncated.png');
    // Scrive solo 4 byte
    fs.writeFileSync(truncatedPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = verifyPngFile(truncatedPath, 192, 192);
    expect(result).toBe(false);
  });

  it('TEST-PWA-004: rifiuta un file PNG con dimensioni diverse da quelle attese', () => {
    const mismatchPath = path.join(tempDir, 'mismatch-dim.png');
    const png = new PNG({ width: 128, height: 128 });
    png.data.fill(200);
    fs.writeFileSync(mismatchPath, PNG.sync.write(png));

    // Atteso 192x192, ma il file è 128x128
    const result = verifyPngFile(mismatchPath, 192, 192, true);
    expect(result).toBe(false);
  });

  it('TEST-PWA-005: rifiuta un file non quadrato se richiesta forma quadrata', () => {
    const nonSquarePath = path.join(tempDir, 'non-square.png');
    const png = new PNG({ width: 192, height: 96 });
    png.data.fill(255);
    fs.writeFileSync(nonSquarePath, PNG.sync.write(png));

    const result = verifyPngFile(nonSquarePath, 192, 96, true);
    expect(result).toBe(false);
  });

  it('TEST-PWA-006: verifica che tutti i 19 asset reali in public/ siano conformi e validi', () => {
    const result = runVerification({ checkDist: false });
    expect(result.success).toBe(true);
    expect(result.errorsCount).toBe(0);
  });

  it('TEST-PWA-007: assicura che generate-pwa-assets.mjs non sovrascriva screenshot reali', () => {
    const generatorContent = fs.readFileSync(path.join(process.cwd(), 'scripts/generate-pwa-assets.mjs'), 'utf8');
    expect(generatorContent).not.toContain('savePNG(generateMobileHomeScreenshot()');
    expect(generatorContent).not.toContain('savePNG(generateDesktopHomeScreenshot()');
    expect(generatorContent).not.toContain('savePNG(generateMobileReportScreenshot()');
  });
});
