import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Digital Reconstruction 3.1 text reconstruction layout', () => {
  it('uses one interactive reconstruction instead of a duplicated receipt-lines graphic', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/attachments/OcrReviewModal.tsx'),
      'utf8'
    );

    expect(source).toContain('data-testid="digital-reconstruction-3-1"');
    expect(source).toContain('raster guida invisibile + testo digitale ricostruito');
    expect(source).toContain('Clicca una riga evidenziata nella Digital Reconstruction 3.1');
    expect(source).toContain('Righe non ancora localizzate nella geometria');
    expect(source).not.toContain('Actions on their own row so they cannot squeeze receipt columns');
    expect(source).not.toContain('10,0%');
    expect(source).toContain('data-testid="digital-text-reconstruction"');
    expect(source).toContain('data-testid="canonical-raster-guide"');
    expect(source).toContain('activeCanonicalRaster.dataUrl');
    expect(source).toContain("reconstructionView === 'compare' ? 0.28 : 0");
    expect(source).toContain("setReconstructionView('digital')");
    expect(source).toContain("setReconstructionView('compare')");
    expect(source).toContain('il raster normalizzato resta invisibile');
    expect(source).toContain('sopra viene renderizzato il testo digitale');
    expect(source).not.toContain('data-testid="legacy-geometric-fallback"');
  });

  it('keeps editing controls attached to the selected geometric line', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/attachments/OcrReviewModal.tsx'),
      'utf8'
    );

    expect(source).toContain('setEditingRowId(reviewLine.id)');
    expect(source).toContain("value={selectedReviewLine.description}");
    expect(source).toContain("value={selectedReviewLine.lineTotal}");
    expect(source).toContain('handleConfirmLine(selectedReviewLine.id)');
  });
});
