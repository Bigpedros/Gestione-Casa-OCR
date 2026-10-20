import { describe, expect, it } from 'vitest';
import { MOTORE_OCR_AI_SOURCE_COMMIT, mapMotoreOcrTokensToWords } from '../services/motoreOcrAiBridge';
import type { OcrToken } from '../vendor/motore-ocr-ai/contracts';

describe('MOTORE-OCR-AI integration', () => {
  it('pins the audited engine source', () => {
    expect(MOTORE_OCR_AI_SOURCE_COMMIT).toBe('619cefd9030864d1cc80c74b93cd429fbbd650aa');
  });

  it('maps stabilized tokens to Gestione Casa geometry', () => {
    const tokens: OcrToken[] = [
      { id: 't1', text: 'TOTALE', confidence: 96, box: { x: 10, y: 20, width: 60, height: 15 }, lineId: 'l1', provenance: 'ocr' },
      { id: 't2', text: '21,50', confidence: 93, box: { x: 180, y: 20, width: 45, height: 15 }, lineId: 'l1', provenance: 'ocr' },
    ];
    expect(mapMotoreOcrTokensToWords(tokens)).toEqual([
      { text: 'TOTALE', confidence: 96, bbox: { x0: 10, y0: 20, x1: 70, y1: 35 } },
      { text: '21,50', confidence: 93, bbox: { x0: 180, y0: 20, x1: 225, y1: 35 } },
    ]);
  });
});
