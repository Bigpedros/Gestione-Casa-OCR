import { db } from '../database/db';
import { reportRepository } from '../repositories';
import { reportService } from './reportService';
import { getMonthName } from '../utils/formatters';

/**
 * Returns the automatic closing date for a given year and month (1-12).
 * The closing date is 00:00:00 local time on the 1st day of month + 1.
 * For example:
 * - August 2026 (year 2026, month 8) -> 1 September 2026 00:00:00
 * - December 2026 (year 2026, month 12) -> 1 January 2027 00:00:00
 */
export function getAutomaticClosingDate(year: number, month: number): Date {
  const closingYear = month === 12 ? year + 1 : year;
  const closingMonth = month === 12 ? 1 : month + 1;
  // JavaScript Date month index is 0-based, so closingMonth - 1 is the target month
  return new Date(closingYear, closingMonth - 1, 1, 0, 0, 0, 0);
}

/**
 * Repairs any report that was prematurely closed before its automatic closing date.
 * Restores status to 'provisional' and closedAt to null.
 * Idempotent and safe to run on app init / page load.
 */
export async function repairPrematurelyClosedMonths(): Promise<number> {
  let repairedCount = 0;
  try {
    const allReports = await db.monthlyReports.toArray();
    const now = new Date();

    for (const report of allReports) {
      const autoClosingDate = getAutomaticClosingDate(report.year, report.month);

      // If current time is strictly BEFORE the automatic closing date,
      // but report is marked 'final' or closedAt is set, it was prematurely closed.
      if (now < autoClosingDate && (report.status === 'final' || report.closedAt != null)) {
        console.warn(
          `[monthClosingService] Prematurely closed month detected: ${report.month}/${report.year}. Reopening...`
        );
        await reportRepository.save({
          ...report,
          status: 'provisional',
          closedAt: null,
        });
        repairedCount++;
      }
    }
  } catch (error) {
    console.error('[monthClosingService] Error repairing prematurely closed months:', error);
  }
  return repairedCount;
}

/**
 * Automatically closes expired months that have passed their automatic closing date
 * but are still marked as 'provisional'.
 * Idempotent and safe to run on app init / page load.
 */
export async function closeExpiredMonths(): Promise<number> {
  let closedCount = 0;
  try {
    const allReports = await db.monthlyReports.toArray();
    const now = new Date();

    for (const report of allReports) {
      const autoClosingDate = getAutomaticClosingDate(report.year, report.month);

      // If current time is AFTER or EQUAL to automatic closing date,
      // but report is still 'provisional', close it automatically.
      if (now >= autoClosingDate && report.status !== 'final') {
        console.warn(
          `[monthClosingService] Automatically closing expired month: ${report.month}/${report.year}`
        );
        await reportService.generateMonthlyReport(report.year, report.month, true);
        closedCount++;
      }
    }
  } catch (error) {
    console.error('[monthClosingService] Error closing expired months:', error);
  }
  return closedCount;
}

/**
 * Convenience runner that performs repair then closes expired months.
 */
export async function runMonthClosingCheck(): Promise<{ repaired: number; closed: number }> {
  const repaired = await repairPrematurelyClosedMonths();
  const closed = await closeExpiredMonths();
  return { repaired, closed };
}

/**
 * Returns user-facing informative strings for the report period according to P-33R requirements.
 */
export function getClosingInfoText(
  year: number,
  month: number,
  isSingleMonth: boolean,
  status?: 'provisional' | 'final'
): { mainText: string; subText: string } {
  if (!isSingleMonth) {
    return {
      mainText: 'Il mese viene chiuso automaticamente alla sua scadenza.',
      subText: 'I singoli mesi vengono chiusi automaticamente alla rispettiva scadenza.',
    };
  }

  const autoClosingDate = getAutomaticClosingDate(year, month);
  const now = new Date();
  const targetMonthName = getMonthName(autoClosingDate.getMonth() + 1).toLowerCase();
  const targetYear = autoClosingDate.getFullYear();

  if (now < autoClosingDate || status === 'provisional') {
    return {
      mainText: 'Il mese viene chiuso automaticamente alla sua scadenza.',
      subText: `Chiusura automatica prevista il 1° ${targetMonthName} ${targetYear} alle 00:00.`,
    };
  } else {
    return {
      mainText: 'Mese chiuso automaticamente.',
      subText: `Chiuso il 1° ${targetMonthName} ${targetYear} alle 00:00.`,
    };
  }
}
