import { runBatch } from '../src/tests/harness/runner';
import { generateFullReportText } from '../src/tests/harness/reporter';
import { INITIAL_REAL_RECEIPTS_CORPUS } from '../src/tests/fixtures/real-receipts';

async function main() {
  console.log('Avvio Real Receipts Batch Harness...\n');
  const { reports, summary } = await runBatch(INITIAL_REAL_RECEIPTS_CORPUS, {
    mode: 'RAW_FIXTURE',
  });

  const fullReport = generateFullReportText(reports, summary);
  console.log(fullReport);

  if (summary.failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Errore durante l\'esecuzione del Batch Harness:', err);
  process.exit(1);
});
