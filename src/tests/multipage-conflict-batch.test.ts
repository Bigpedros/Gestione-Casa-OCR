import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('multipage acquisition conflict recovery', () => {
  it('preserves the complete selected batch across an existing-session conflict', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/attachments/ScanReceiptModal.tsx'),
      'utf8'
    );

    expect(source).toContain('type PendingConflictBatch');
    expect(source).toContain('files: File[]');
    expect(source).toContain('const inputFiles = Array.from(files)');
    expect(source).toContain('files: inputFiles');
    expect(source).toContain('pendingBatch.files');
    expect(source).toContain('pendingBatch.isPdf');
    expect(source).toContain('pendingBatch.sourceInfo');
    expect(source).not.toContain('setConflictingFile(file)');
    expect(source).not.toContain('handleFilesIngest([fileToAcquire])');
  });

  it('keeps a partially acquired session so replay is idempotent by file hash', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/attachments/ScanReceiptModal.tsx'),
      'utf8'
    );

    expect(source).toContain('temporarySessionIsEmpty');
    expect(source).toContain('setCurrentSession(session)');
    expect(source).toContain('documentPageSegmentRepository.getByHash(session.id, fileHash)');
    expect(source).toContain('duplicateCount++');
  });
});
