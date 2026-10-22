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

  it('preflights the whole batch before session creation and keeps replay idempotent by file hash', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/attachments/ScanReceiptModal.tsx'),
      'utf8'
    );

    const preflightIndex = source.indexOf('// PRE-FLIGHT: calcola gli hash');
    const createSessionIndex = source.indexOf('session = await documentSessionRepository.create({');

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(createSessionIndex).toBeGreaterThan(preflightIndex);
    expect(source).toContain('findActiveSessionByFileHash(prepared.fileHash)');
    expect(source).toContain('documentPageSegmentRepository.getByHash(session.id, fileHash)');
    expect(source).toContain('duplicateCount++');
  });
});
