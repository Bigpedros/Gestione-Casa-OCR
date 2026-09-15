import type { ParsedReceiptDraft, ParsedReceiptLine } from './types';

const MONEY_TOLERANCE = 0.05;
export const TOTAL_RECOVERED_FROM_LINE_SUM = 'TOTAL_RECOVERED_FROM_LINE_SUM';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasResolvedPositivePrice(line: ParsedReceiptLine): boolean {
  return (
    line.lineTotal > 0 &&
    line.unitPrice > 0 &&
    line.quantity === 1 &&
    !line.isNegative &&
    (line.discount ?? 0) <= 0 &&
    line.normalizedDescription.trim().length > 0 &&
    !(line.warnings?.includes('PRICE_NOT_DETECTED') ?? false)
  );
}

/**
 * OCR-05B1-A1 — Single-line total recovery.
 *
 * Fail-closed accounting recovery for the narrowest possible case:
 * - COMMERCIAL_RECEIPT only;
 * - total genuinely missing/non-positive;
 * - exactly one official product line;
 * - line fully resolved, positive, qty=1, not negative, no discount;
 * - no incompatible subtotal;
 * - no incompatible positive total alternatives.
 *
 * The function deliberately does NOT infer totals for multi-line documents and
 * does NOT use merchant-specific rules.
 */
export function applySingleLineTotalRecovery(draft: ParsedReceiptDraft): boolean {
  if (draft.documentCategory !== 'COMMERCIAL_RECEIPT') return false;

  if (draft.total.value !== null && draft.total.value > 0) return false;
  if (draft.lines.length !== 1) return false;

  const line = draft.lines[0];
  if (!hasResolvedPositivePrice(line)) return false;

  const candidate = roundMoney(line.lineTotal);
  if (candidate <= 0) return false;

  const subtotal = draft.subtotal.value;
  if (
    subtotal !== null &&
    subtotal > 0 &&
    Math.abs(roundMoney(subtotal) - candidate) > MONEY_TOLERANCE
  ) {
    return false;
  }

  const positiveAlternatives = (draft.total.alternatives ?? [])
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .map(roundMoney);

  if (
    positiveAlternatives.some(
      (value) => Math.abs(value - candidate) > MONEY_TOLERANCE
    )
  ) {
    return false;
  }

  const warnings = [...(draft.total.warnings ?? [])];
  if (!warnings.includes(TOTAL_RECOVERED_FROM_LINE_SUM)) {
    warnings.push(TOTAL_RECOVERED_FROM_LINE_SUM);
  }

  draft.total = {
    ...draft.total,
    value: candidate,
    confidence: Math.max(draft.total.confidence, 88),
    sourceText: `LINE_SUM:${candidate.toFixed(2)}`,
    warnings,
  };

  return true;
}
