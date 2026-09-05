import { describe, it, expect } from 'vitest';
import { runBatch } from './harness/runner';
import { generateFullReportText } from './harness/reporter';
import { INITIAL_REAL_RECEIPTS_CORPUS } from './fixtures/real-receipts';

describe('REAL RECEIPTS BATCH HARNESS — ESECUZIONE MASSIVA SU SCONTRINI REALI', () => {
  it('Esegue la pipeline reale su tutti i documenti del corpus iniziale e produce il report standard', async () => {
    // Esecuzione batch in MODE B (RAW FIXTURE)
    const { reports, summary } = await runBatch(INITIAL_REAL_RECEIPTS_CORPUS, {
      mode: 'RAW_FIXTURE',
    });

    const fullReportText = generateFullReportText(reports, summary);

    // Stampa del report standardizzato completo a console
    // eslint-disable-next-line no-console
    console.log('\n' + fullReportText + '\n');

    // 1. Verifica che i campioni congelati (Todis, Eurospin, Pewex) siano stati eseguiti con successo
    const todisReport = reports.find((r) => r.documentId === 'TODIS_001');
    expect(todisReport).toBeDefined();
    expect(['PASS', 'PARTIAL']).toContain(todisReport?.status);
    expect(todisReport?.category).toBe('COMMERCIAL_RECEIPT');
    expect(todisReport?.detectedTotal).toBe(21.90);
    expect(todisReport?.failureReasons).toHaveLength(0);

    const eurospinReport = reports.find((r) => r.documentId === 'EUROSPIN_001');
    expect(eurospinReport).toBeDefined();
    expect(eurospinReport?.status).toBe('FAIL');
    expect(eurospinReport?.category).toBe('COMMERCIAL_RECEIPT');
    expect(eurospinReport?.detectedTotal).toBe(14.48);
    expect(eurospinReport?.detectedLineCount).toBe(11);
    expect(eurospinReport?.failureReasons.some((r) => r.includes('Totale errato'))).toBe(true);

    const pewexReport = reports.find((r) => r.documentId === 'PEWEX_001');
    expect(pewexReport).toBeDefined();
    expect(pewexReport?.status).toBe('FAIL');
    expect(pewexReport?.category).toBe('COMMERCIAL_RECEIPT');
    expect(pewexReport?.failureReasons.some((r) => r.includes('Totale errato'))).toBe(true);

    // 2. Verifica che i campioni in attesa di acquisizione raw siano in stato SKIPPED (non falso FAIL)
    const pendingReports = reports.filter((r) => r.status === 'SKIPPED');
    expect(pendingReports.length).toBe(10);

    // 3. Accuratezza categoria al 100%
    expect(summary.failCount).toBe(2); // Eurospin e Pewex catturano le discrepanze note
    expect(summary.categoryAccuracyPct).toBe(100);
  });
});
