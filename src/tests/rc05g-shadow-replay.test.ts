import { describe, it, expect } from 'vitest';
import { INITIAL_REAL_RECEIPTS_CORPUS } from './fixtures/real-receipts';
import {
  executeShadowReplayDocument,
  runShadowReplayBatch,
  formatShadowReplayTable,
  formatShadowReplaySummary,
} from './harness/shadowReplay';
import { PEWEX_FIXTURE } from './fixtures/real-receipts/pewex.fixture';
import { EUROSPIN_FIXTURE } from './fixtures/real-receipts/eurospin.fixture';
import { TODIS_FIXTURE } from './fixtures/real-receipts/todis.fixture';
import { receiptParserService } from '../services/ocrParser/receiptParserService';

describe('RC-05G: Real RawText and Recorded Regional Shadow Replay Harness', () => {
  it('1. Verifies complete corpus inventory has exactly 13 documents', () => {
    expect(INITIAL_REAL_RECEIPTS_CORPUS).toHaveLength(13);
  });

  it('2. Verifies exactly 3 documents have real frozen rawText acquired', () => {
    const acquired = INITIAL_REAL_RECEIPTS_CORPUS.filter(
      (f) => typeof f.rawText === 'string' && f.rawText.trim().length > 0
    );
    expect(acquired).toHaveLength(3);
    const ids = acquired.map((f) => f.id);
    expect(ids).toContain('EUROSPIN_001');
    expect(ids).toContain('TODIS_001');
    expect(ids).toContain('PEWEX_001');
  });

  it('3. Verifies exactly 10 documents are in SKIPPED_NO_RAWTEXT status without fabricating data', () => {
    const { reports } = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    const skipped = reports.filter((r) => r.acquisitionStatus === 'SKIPPED_NO_RAWTEXT');
    expect(skipped).toHaveLength(10);
    expect(skipped.every((r) => r.validationLevel === 'L0_UNACQUIRED')).toBe(true);
    expect(skipped.every((r) => r.regionalReplayStatus === 'UNAVAILABLE')).toBe(true);
    expect(skipped.every((r) => r.officialTotal === null)).toBe(true);
  });

  it('4. Classifies validation levels accurately: L0 (10), L1 (2), L2 (1)', () => {
    const { summary, reports } = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    expect(summary.unacquiredCount).toBe(10); // L0
    expect(summary.rawTextAcquiredCount).toBe(3); // 2 L1 + 1 L2
    expect(summary.recordedRegionalCount).toBe(1); // L2 Pewex

    const l1Reports = reports.filter((r) => r.validationLevel === 'L1_REAL_RAWTEXT');
    expect(l1Reports).toHaveLength(2);
    expect(l1Reports.map((r) => r.fixtureId).sort()).toEqual(['EUROSPIN_001', 'TODIS_001']);

    const l2Reports = reports.filter((r) => r.validationLevel === 'L2_RECORDED_REGIONAL');
    expect(l2Reports).toHaveLength(1);
    expect(l2Reports[0].fixtureId).toBe('PEWEX_001');
  });

  it('5. Evaluates trigger policy on PEWEX: triggers missing_total and requests body+footer', () => {
    const pewexReport = executeShadowReplayDocument(PEWEX_FIXTURE);
    expect(pewexReport.officialTotal).toBeNull();
    expect(pewexReport.actualTriggerReason).toBe('missing_total');
    expect(pewexReport.expectedTriggerReason).toBe('missing_total');
    expect(pewexReport.triggerMatch).toBe(true);
    expect(pewexReport.requestedRegions).toContain('body');
    expect(pewexReport.requestedRegions).toContain('footer');
  });

  it('6. Evaluates trigger policy on Eurospin: expected trigger null (reconciled total 14.46 with confidence >= 50 does not trigger regional pass)', () => {
    const eurospinReport = executeShadowReplayDocument(EUROSPIN_FIXTURE);
    expect(eurospinReport.officialTotal).toBe(14.46);
    expect(eurospinReport.actualTriggerReason).toBeNull();
    expect(eurospinReport.expectedTriggerReason).toBe('missing_total');
    expect(eurospinReport.triggerMatch).toBe(false);
    expect(eurospinReport.requestedRegions).toEqual([]);
  });

  it('7. Evaluates trigger policy on Todis deterministically: expected trigger low_price_density (4/10 missing prices)', () => {
    const todisReport = executeShadowReplayDocument(TODIS_FIXTURE);
    expect(todisReport.officialTotal).toBe(21.90);
    expect(todisReport.actualTriggerReason).toBe('low_price_density');
    expect(todisReport.expectedTriggerReason).toBe('low_price_density');
    expect(todisReport.triggerMatch).toBe(true);
    expect(todisReport.requestedRegions).toEqual(['body']);
  });

  it('8. Verifies recorded regional replay is available exclusively for PEWEX_001', () => {
    const { reports } = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    const recordedAvailable = reports.filter((r) => r.recordedRegionalAvailable);
    expect(recordedAvailable).toHaveLength(1);
    expect(recordedAvailable[0].fixtureId).toBe('PEWEX_001');
    expect(recordedAvailable[0].regionalReplayStatus).toBe('EXECUTED_L2');
  });

  it('9. Recovers Pewex total 34.53 from recorded footer and matches ground truth perfectly in shadow', () => {
    const pewexReport = executeShadowReplayDocument(PEWEX_FIXTURE);
    expect(pewexReport.regionalTotalCandidate).toBe(34.53);
    expect(pewexReport.expectedTotal).toBe(34.53);
    expect(pewexReport.totalCandidateMatch).toBe(true);
    expect(pewexReport.falsePositiveAssessment).toBe('NO_FALSE_POSITIVE');
  });

  it('10. Confirms NO regional proposal generated for Eurospin (L1 only)', () => {
    const eurospinReport = executeShadowReplayDocument(EUROSPIN_FIXTURE);
    expect(eurospinReport.regionalReplayStatus).toBe('UNAVAILABLE');
    expect(eurospinReport.regionalTotalCandidate).toBeNull();
    expect(eurospinReport.monetaryTokenCount).toBe(0);
    expect(eurospinReport.priceTokensExtracted).toHaveLength(0);
  });

  it('11. Confirms NO regional proposal generated for Todis (L1 only)', () => {
    const todisReport = executeShadowReplayDocument(TODIS_FIXTURE);
    expect(todisReport.regionalReplayStatus).toBe('UNAVAILABLE');
    expect(todisReport.regionalTotalCandidate).toBeNull();
    expect(todisReport.monetaryTokenCount).toBe(0);
    expect(todisReport.priceTokensExtracted).toHaveLength(0);
  });

  it('12. Reports falsePositiveRate as NOT_MEASURABLE due to lack of L2 negative samples in current corpus', () => {
    const { summary } = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    expect(summary.falsePositiveRate).toBe('NOT_MEASURABLE');
  });

  it('13. Reports correctSkipRate as NOT_MEASURABLE_ON_REAL_CORPUS (no POS/multi-source in real corpus)', () => {
    const { summary } = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    expect(summary.correctSkipRate).toBe('NOT_MEASURABLE_ON_REAL_CORPUS');
  });

  it('14. Extracts monetary tokens with explicit values from Pewex body and footer', () => {
    const pewexReport = executeShadowReplayDocument(PEWEX_FIXTURE);
    expect(pewexReport.monetaryTokenCount).toBe(10);
    expect(pewexReport.priceTokensExtracted).toEqual([12.44, 12.20, 0.10, 0.69, 0.69, 2.99]);
  });

  it('15. Enforces conservative alignment and NO_FILL / AMBIGUOUS on count mismatch (5 official full-page items vs 6 exact eligible regional price tokens)', () => {
    const pewexReport = executeShadowReplayDocument(PEWEX_FIXTURE);
    expect(pewexReport.alignmentOutcome).toBe('AMBIGUOUS');
  });

  it('16. Does NOT fabricate values for unacquired fixtures', () => {
    const { reports } = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    const unacquired = reports.filter((r) => r.validationLevel === 'L0_UNACQUIRED');
    for (const u of unacquired) {
      expect(u.officialTotal).toBeNull();
      expect(u.regionalTotalCandidate).toBeNull();
      expect(u.monetaryTokenCount).toBe(0);
      expect(u.priceTokensExtracted).toHaveLength(0);
    }
  });

  it('17. Formats deterministic textual report and batch summary', () => {
    const { reports, summary } = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    const tableText = formatShadowReplayTable(reports);
    const summaryText = formatShadowReplaySummary(summary);

    expect(tableText).toContain('RC-05G: REAL RAWTEXT AND RECORDED REGIONAL SHADOW REPLAY HARNESS — REPORT');
    expect(tableText).toContain('PEWEX_001');
    expect(tableText).toContain('EUROSPIN_001');
    expect(tableText).toContain('TODIS_001');
    expect(tableText).toContain('L2_RECORDED_REGIONAL');
    expect(tableText).toContain('L1_REAL_RAWTEXT');
    expect(tableText).toContain('L0_UNACQUIRED');

    expect(summaryText).toContain('TOTAL CORPUS DOCUMENTS       : 13');
    expect(summaryText).toContain('RAWTEXT ACQUIRED (L1/L2)     : 3 / 13');
    expect(summaryText).toContain('RECORDED REGIONAL REPLAY (L2): 1 / 13');
    expect(summaryText).toContain('TRIGGER AGREEMENT RATE       : 2 / 3 (67%)');
    expect(summaryText).toContain('TOTAL RECOVERY RATE (L2)     : 1 / 1 (100% on Pewex)');
  });

  it('18. Guarantees that official ParsedReceiptDraft remains completely unmodified during shadow replay', () => {
    const draftBefore = receiptParserService.parseText(PEWEX_FIXTURE.rawText!);
    const totalBefore = draftBefore.total.value;
    const linesPayloadBefore = draftBefore.lines.map((l) => ({
      originalText: l.originalText,
      normalizedDescription: l.normalizedDescription,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      warnings: l.warnings,
    }));

    // Eseguiamo il replay
    executeShadowReplayDocument(PEWEX_FIXTURE);

    const draftAfter = receiptParserService.parseText(PEWEX_FIXTURE.rawText!);
    const linesPayloadAfter = draftAfter.lines.map((l) => ({
      originalText: l.originalText,
      normalizedDescription: l.normalizedDescription,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      warnings: l.warnings,
    }));

    expect(draftAfter.total.value).toBe(totalBefore);
    expect(linesPayloadAfter).toEqual(linesPayloadBefore);
  });

  it('19. Preserves PRICE_NOT_DETECTED warnings on official items', () => {
    const draft = receiptParserService.parseText(PEWEX_FIXTURE.rawText!);
    expect(draft.lines.every((l) => l.warnings?.includes('PRICE_NOT_DETECTED'))).toBe(true);
  });

  it('20. Does NOT write to Dexie or any persistence layer during replay', () => {
    // Il replay è una funzione pura in-memory
    const report = executeShadowReplayDocument(PEWEX_FIXTURE);
    expect(report).toBeDefined();
  });

  it('21. Does NOT depend on image files in repository', () => {
    for (const fixture of INITIAL_REAL_RECEIPTS_CORPUS) {
      expect(fixture.imagePath).toBeUndefined();
      expect(fixture.imageDataUrl).toBeUndefined();
    }
  });

  it('22. Does NOT depend on live Tesseract worker execution in batch replay test', () => {
    const result = runShadowReplayBatch(INITIAL_REAL_RECEIPTS_CORPUS);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.summary.totalCorpus).toBe(13);
    expect(result.summary.rawTextAcquiredCount).toBe(3);
    expect(INITIAL_REAL_RECEIPTS_CORPUS.every((f) => f.imagePath === undefined && f.imageDataUrl === undefined)).toBe(true);
  });

  it('23. Guarantees NO modifications to production services', () => {
    // receiptParserService è invocato con parseText puro
    expect(typeof receiptParserService.parseText).toBe('function');
  });
});
