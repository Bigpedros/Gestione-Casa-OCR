import type { ParsedReceiptLine } from '../types';
import type { RegionalMonetaryToken } from './types';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseLastMoney(line: string): number | null {
  const matches = [...line.matchAll(/-?\d{1,4}[.,]\d{2}/g)];
  if (!matches.length) return null;
  const value = Number(matches[matches.length - 1][0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function findDirectTotalAnchor(rawText: string): number | null {
  const ranked: Array<{ rank: number; value: number }> = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /\bSUBTOTALE\b/i.test(line)) continue;

    const value = parseLastMoney(line);
    if (value === null || value <= 0) continue;

    let rank = 0;
    if (/\bTOTALE\s+(?:COMPLESSIVO|DOVUTO|SPESA|EURO)\b/i.test(line)) rank = 4;
    else if (/^\s*TOTALE\b/i.test(line)) rank = 3;
    else if (/\bIMPORTO\s+PAGAT[OA]\b/i.test(line)) rank = 2;
    else if (/\bPAGAMENTO\s+ELETTRONICO\b/i.test(line)) rank = 1;

    if (rank > 0) ranked.push({ rank, value: roundMoney(value) });
  }

  if (!ranked.length) return null;
  const maxRank = Math.max(...ranked.map((x) => x.rank));
  const top = ranked.filter((x) => x.rank === maxRank).map((x) => x.value);
  const unique = [...new Set(top.map((v) => v.toFixed(2)))].map(Number);
  return unique.length === 1 ? unique[0] : null;
}

export function isPlausibleBodyTotalCandidate(
  candidate: number,
  tokens: readonly RegionalMonetaryToken[]
): boolean {
  if (!Number.isFinite(candidate) || candidate <= 0) return false;

  const positives = tokens
    .filter(
      (t) =>
        t.classification === 'exact_monetary' &&
        !t.isNegative &&
        t.parsedValue !== null &&
        t.parsedValue > 0
    )
    .map((t) => t.parsedValue as number);

  if (positives.length < 3) return true;

  const largerCount = positives.filter((v) => v > candidate + 0.05).length;
  const sum = roundMoney(positives.reduce((s, v) => s + v, 0));

  if (largerCount >= 2 && candidate < sum * 0.25) return false;
  return true;
}

function combinations<T>(items: readonly T[], choose: number): T[][] {
  const out: T[][] = [];
  const current: T[] = [];

  function walk(start: number): void {
    if (current.length === choose) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (choose - current.length); i += 1) {
      current.push(items[i]);
      walk(i + 1);
      current.pop();
    }
  }

  walk(0);
  return out;
}

export interface SelfClosingRegionalRecovery {
  readonly total: number;
  readonly prices: readonly number[];
}

/**
 * OCR-05D — recover total + ordered price vector from the regional monetary
 * evidence itself, but only when there is exactly ONE solution:
 * one exact token acts as total and exactly N other ordered exact tokens sum
 * to that total, where N is the number of official unresolved article lines.
 */
export function recoverUniqueSelfClosingTotalAndPrices(
  lines: readonly ParsedReceiptLine[],
  tokens: readonly RegionalMonetaryToken[]
): SelfClosingRegionalRecovery | null {
  if (lines.length < 2 || lines.length > 12) return null;

  const allUnresolved = lines.every(
    (line) =>
      line.quantity === 1 &&
      !line.isNegative &&
      line.lineTotal <= 0 &&
      line.unitPrice <= 0
  );
  if (!allUnresolved) return null;

  const exact = tokens
    .filter(
      (t) =>
        t.classification === 'exact_monetary' &&
        !t.isNegative &&
        t.parsedValue !== null &&
        t.parsedValue > 0
    )
    .sort((a, b) => a.lineIndex - b.lineIndex);

  if (exact.length < lines.length + 1 || exact.length > lines.length + 5) return null;

  const solutions: SelfClosingRegionalRecovery[] = [];

  for (let totalIndex = 0; totalIndex < exact.length; totalIndex += 1) {
    const totalToken = exact[totalIndex];
    const total = roundMoney(totalToken.parsedValue as number);
    const remaining = exact.filter((_, idx) => idx !== totalIndex);

    for (const combo of combinations(remaining, lines.length)) {
      const prices = combo.map((t) => roundMoney(t.parsedValue as number));
      if (prices.some((v) => v <= 0 || v >= total - 0.001)) continue;

      const sum = roundMoney(prices.reduce((s, v) => s + v, 0));
      if (Math.abs(sum - total) <= 0.05) {
        solutions.push({ total, prices });
        if (solutions.length > 1) return null;
      }
    }
  }

  return solutions.length === 1 ? solutions[0] : null;
}

export function recoverUniqueOrderedPricesByTotal(
  lines: readonly ParsedReceiptLine[],
  tokens: readonly RegionalMonetaryToken[],
  trustedTotal: number
): number[] | null {
  if (trustedTotal <= 0 || lines.length < 2 || lines.length > 12) return null;

  const allUnresolved = lines.every(
    (line) =>
      line.quantity === 1 &&
      !line.isNegative &&
      line.lineTotal <= 0 &&
      line.unitPrice <= 0
  );
  if (!allUnresolved) return null;

  const exact = tokens
    .filter(
      (t) =>
        t.classification === 'exact_monetary' &&
        t.reason !== 'matches_known_total' &&
        !t.isNegative &&
        t.parsedValue !== null &&
        t.parsedValue > 0 &&
        Math.abs((t.parsedValue as number) - trustedTotal) > 0.05
    )
    .sort((a, b) => a.lineIndex - b.lineIndex);

  if (exact.length < lines.length || exact.length > lines.length + 4) return null;

  const closing = combinations(exact, lines.length).filter((combo) => {
    const sum = roundMoney(combo.reduce((s, t) => s + (t.parsedValue as number), 0));
    return Math.abs(sum - trustedTotal) <= 0.05;
  });

  if (closing.length !== 1) return null;
  return closing[0].map((t) => roundMoney(t.parsedValue as number));
}
