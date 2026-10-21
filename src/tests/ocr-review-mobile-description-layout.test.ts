import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OCR review mobile row layout', () => {
  it('keeps description in a protected grid column and actions on a separate row', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/attachments/OcrReviewModal.tsx'),
      'utf8'
    );

    expect(source).toContain("grid-cols-[minmax(0,1fr)_3.5rem_4rem]");
    expect(source).toContain("Actions on their own row so they cannot squeeze receipt columns");
    expect(source).toContain("{line.description || line.originalText}");
  });
});
