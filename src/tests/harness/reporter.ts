import { HarnessDocumentReport, HarnessBatchSummary } from './types';

/**
 * Formatta un valore di testo in una colonna a larghezza fissa.
 */
function pad(str: string | number | null | undefined, width: number, alignLeft = true): string {
  const val = str !== null && str !== undefined ? String(str) : '-';
  if (val.length > width) {
    return val.slice(0, width - 1) + '…';
  }
  return alignLeft ? val.padEnd(width) : val.padStart(width);
}

/**
 * Genera la tabella sintetica di tutti i documenti.
 */
export function formatDocumentTable(reports: HarnessDocumentReport[]): string {
  const lines: string[] = [];
  lines.push('='.repeat(140));
  lines.push('REAL RECEIPTS BATCH HARNESS — TABELLA SINTETICA DOCUMENTI');
  lines.push('='.repeat(140));

  const header = [
    pad('ID', 16),
    pad('STATUS', 9),
    pad('CATEGORY (CONF)', 18),
    pad('MERCHANT DETECTED', 22),
    pad('LINES (DET/EXP)', 16),
    pad('PRICE/NOPRICE', 14),
    pad('TOTAL (DET/EXP)', 17),
    pad('PAYMENT', 12),
    pad('TIME', 7),
  ].join(' | ');

  lines.push(header);
  lines.push('-'.repeat(140));

  for (const r of reports) {
    const statusColor = r.status;
    const catStr = `${r.category} (${r.categoryConfidence}%)`;
    const merchStr = r.merchantCandidate || r.merchantRaw || '-';
    const linesStr = `${r.detectedLineCount} / ${r.expectedLineCount !== undefined ? r.expectedLineCount : '-'}`;
    const priceBreakdown = `${r.linesWithPrice} / ${r.linesPriceNotDetected}`;
    const detTotalStr = r.detectedTotal !== null ? r.detectedTotal.toFixed(2) + '€' : '-';
    const expTotalStr = r.expectedTotal !== undefined ? r.expectedTotal.toFixed(2) + '€' : '-';
    const totalStr = `${detTotalStr} / ${expTotalStr}`;
    const payStr = r.detectedPaymentMethod || '-';
    const timeStr = `${r.durationMs}ms`;

    const row = [
      pad(r.documentId, 16),
      pad(statusColor, 9),
      pad(catStr, 18),
      pad(merchStr, 22),
      pad(linesStr, 16),
      pad(priceBreakdown, 14),
      pad(totalStr, 17),
      pad(payStr, 12),
      pad(timeStr, 7),
    ].join(' | ');

    lines.push(row);
  }

  lines.push('='.repeat(140));
  return lines.join('\n');
}

/**
 * Formatta il dettaglio dei documenti FAIL.
 */
export function formatFailureDetails(reports: HarnessDocumentReport[]): string {
  const fails = reports.filter((r) => r.status === 'FAIL');
  if (fails.length === 0) {
    return '>> NESSUN FAIL RILEVATO: Tutti i documenti hanno superato i controlli critici.';
  }

  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push(`DETTAGLIO DOCUMENTI FAIL (${fails.length})`);
  lines.push('='.repeat(80));

  for (const f of fails) {
    lines.push(`\n[FAIL] ${f.documentId} — ${f.label}`);
    lines.push(`  - Modalità: ${f.mode}`);
    lines.push(`  - Motivi di fallimento:`);
    for (const reason of f.failureReasons) {
      lines.push(`      * ${reason}`);
    }
    if (f.warnings.length > 0) {
      lines.push(`  - Warning rilevati:`);
      for (const w of f.warnings.slice(0, 5)) {
        lines.push(`      ! ${w}`);
      }
    }
    if (f.notes) {
      lines.push(`  - Note layout: ${f.notes}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formatta il dettaglio dei documenti PARTIAL.
 */
export function formatPartialDetails(reports: HarnessDocumentReport[]): string {
  const partials = reports.filter((r) => r.status === 'PARTIAL');
  if (partials.length === 0) {
    return '>> NESSUN PARTIAL: Nessun dato secondario richiede revisione.';
  }

  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push(`DETTAGLIO DOCUMENTI PARTIAL (${partials.length})`);
  lines.push('='.repeat(80));

  for (const p of partials) {
    lines.push(`\n[PARTIAL] ${p.documentId} — ${p.label}`);
    lines.push(`  - Motivi di revisione / discrepanze minori:`);
    for (const reason of p.partialReasons) {
      lines.push(`      ~ ${reason}`);
    }
    if (p.warnings.length > 0) {
      lines.push(`  - Warnings: ${p.warnings.slice(0, 3).join(' | ')}`);
    }
    if (p.notes) {
      lines.push(`  - Note layout: ${p.notes}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formatta il riepilogo finale con percentuali di accuratezza.
 */
export function formatBatchSummary(summary: HarnessBatchSummary): string {
  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push('REAL RECEIPTS BATCH HARNESS — RIEPILOGO FINALE ACCURATEZZA');
  lines.push('='.repeat(80));

  lines.push(`TOTAL DOCUMENTS              : ${summary.totalDocuments}`);
  lines.push(`PASS                         : ${summary.passCount}`);
  lines.push(`PARTIAL                      : ${summary.partialCount}`);
  lines.push(`FAIL                         : ${summary.failCount}`);
  if (summary.skippedCount > 0) {
    lines.push(`SKIPPED (Pending Acquisition): ${summary.skippedCount}`);
  }
  lines.push('-'.repeat(80));
  lines.push(`CATEGORY ACCURACY            : ${summary.categoryAccuracyPct}%`);
  lines.push(`MERCHANT ACCURACY            : ${summary.merchantAccuracyPct}%`);
  lines.push(`TOTAL ACCURACY               : ${summary.totalAccuracyPct}%`);
  lines.push(`LINE COUNT ACCURACY          : ${summary.lineCountAccuracyPct}%`);
  lines.push(`PAYMENT METHOD ACCURACY      : ${summary.paymentMethodAccuracyPct}%`);
  lines.push('-'.repeat(80));
  lines.push(`DURATA TOTALE BATCH          : ${summary.totalDurationMs} ms`);
  lines.push('='.repeat(80));

  return lines.join('\n');
}

/**
 * Genera l'output completo per console o file di log.
 */
export function generateFullReportText(
  reports: HarnessDocumentReport[],
  summary: HarnessBatchSummary
): string {
  return [
    formatDocumentTable(reports),
    '',
    formatFailureDetails(reports),
    '',
    formatPartialDetails(reports),
    '',
    formatBatchSummary(summary),
  ].join('\n');
}
