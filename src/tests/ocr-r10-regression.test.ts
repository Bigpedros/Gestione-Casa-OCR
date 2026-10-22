import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('R10 geometry + dual OCR fusion + readable reconstruction', () => {
  const decision = fs.readFileSync(
    path.resolve('src/vendor/motore-ocr-ai/core/pipeline/decisionEngine.ts'),'utf8'
  );
  const geometry = fs.readFileSync(
    path.resolve('src/vendor/motore-ocr-ai/core/geometry/imageGeometryNormalizer.ts'),'utf8'
  );
  const reconstruction = fs.readFileSync(
    path.resolve('src/vendor/motore-ocr-ai/core/reconstruction/digitalReconstruction.ts'),'utf8'
  );
  const review = fs.readFileSync(
    path.resolve('src/features/attachments/OcrReviewModal.tsx'),'utf8'
  );

  it('allows coherent independent OCR text to fill omissions from the primary reader', () => {
    expect(decision).toContain('DE-RUNTIME-DIAG-4');
    expect(decision).toContain('hasCoherentIndependentLineSupport');
    expect(decision).toContain('confidence<76');
    expect(decision).toContain("candidate.token.lineId||");
  });

  it('performs a bounded second deskew pass only when residual skew improves', () => {
    expect(geometry).toContain('Secondo pass conservativo');
    expect(geometry).toContain('candidateAnalysis.skew');
    expect(geometry).toContain("Math.abs(candidateAnalysis.skew)<Math.abs(afterDeskew.skew)*.72");
  });

  it('enforces a readable text floor in reconstruction and UI', () => {
    expect(reconstruction).toContain('pageWidth*.014');
    expect(reconstruction).toContain('Math.max(9,pageWidth*.011)');
    expect(review).toContain('(activeDigitalReconstruction.width || 0) * 0.014');
    expect(review).toContain('12');
  });
});
