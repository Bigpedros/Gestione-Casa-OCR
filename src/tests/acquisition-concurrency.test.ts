import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('acquisition concurrency and conflict gating', () => {
  const source = fs.readFileSync(
    path.resolve('src/features/attachments/ScanReceiptModal.tsx'),
    'utf8'
  );

  it('preflights conflicts before creating a new session', () => {
    const preflight = source.indexOf('// PRE-FLIGHT: calcola gli hash');
    const createSession = source.indexOf('session = await documentSessionRepository.create({');
    expect(preflight).toBeGreaterThan(-1);
    expect(createSession).toBeGreaterThan(preflight);
    expect(source).toContain('findActiveSessionByFileHash(prepared.fileHash)');
  });

  it('prevents concurrent ingestion with a synchronous ref lock', () => {
    expect(source).toContain('const ingestLockRef = useRef<boolean>(false)');
    expect(source).toContain('if (ingestLockRef.current)');
    expect(source).toContain('ingestLockRef.current = true');
    expect(source).toContain('ingestLockRef.current = false');
  });

  it('renders normal wizard steps only when no conflict screen is active', () => {
    expect(source).toContain("!conflictingSession && step === 'source'");
    expect(source).toContain("!conflictingSession && step === 'pages' && currentSession");
    expect(source).toContain("!conflictingSession && step === 'summary' && currentSession");
  });

  it('snapshots FileList before reset so picker selections are not lost', () => {
    expect(source.match(/const selected = Array\.from\(e\.target\.files \?\? \[\]\)/g)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(source).not.toContain('const selected = e.target.files;');
  });

  it('resets file input values and disables source buttons during ingest', () => {
    expect(source.match(/e\.currentTarget\.value = ''/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/disabled=\{isLoading\}/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
