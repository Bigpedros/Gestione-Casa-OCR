import type { ParsedReceiptDraft } from './types';

const STRONG_STRUCTURAL_LINE_RE =
  /(?:^\s*(?:TOTALE|SUBTOTALE|PAGAMENTO|RESTO|IMPORTO\s+PAGAT[OA])\b|\b(?:NON\s+RISCOSSO|CREDITO)\b)/i;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function combinations(indices: number[], choose: number): number[][] {
  const out: number[][] = [];
  const current: number[] = [];

  function walk(start: number): void {
    if (current.length === choose) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= indices.length - (choose - current.length); i += 1) {
      current.push(indices[i]);
      walk(i + 1);
      current.pop();
    }
  }

  walk(0);
  return out;
}

/**
 * OCR-05D — remove only unmistakable structural rows.
 * IMPORTANT: generic "IVA" is intentionally NOT structural because a legitimate
 * product row can contain a VAT column/value.
 * Discounts and rounding lines are legitimate item adjustments, not leaked structural rows.
 */
export function applyStructuralLineCleanup(draft: ParsedReceiptDraft): number {
  if (draft.lines.length <= 1) return 0;

  const kept = draft.lines.filter((line) => {
    if (line.isNegative || line.lineTotal < 0 || line.discount !== null) return true;
    const desc = line.normalizedDescription || line.originalText || '';
    if (/\b(?:SCONTO|ARROTONDAMENTO|ROUNDING)\b/i.test(desc)) return true;
    return !STRONG_STRUCTURAL_LINE_RE.test(desc);
  });

  // Fail closed: never erase the entire article list.
  if (kept.length === 0) return 0;

  const removed = draft.lines.length - kept.length;
  if (removed > 0) draft.lines = kept;
  return removed;
}

/**
 * Generic article-subset cleanup.
 * If an already trusted total (+ explicit positive discount/rounding field)
 * can be produced by exactly one strict subset of positive article rows,
 * remove only the rows outside that unique subset.
 *
 * This targets leaked fiscal/payment/rounding rows without merchant knowledge.
 */
export function applyUniqueTotalSubsetCleanup(draft: ParsedReceiptDraft): number {
  const total = draft.total.value;
  if (total === null || total <= 0) return 0;
  if (draft.lines.length < 2 || draft.lines.length > 15) return 0;

  const target = roundMoney(total + Math.max(0, draft.discounts.value ?? 0));
  const eligible = draft.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !line.isNegative && line.lineTotal > 0);

  if (eligible.length < 1 || eligible.length > 15) return 0;

  const eligibleIndices = eligible.map((x) => x.index);
  const solutions: number[][] = [];

  // Prefer the largest closing subset: we are removing leaked rows, not
  // reconstructing a document from a tiny accidental combination.
  for (let size = eligibleIndices.length - 1; size >= 1; size -= 1) {
    for (const subset of combinations(eligibleIndices, size)) {
      const sum = roundMoney(
        subset.reduce((acc, idx) => acc + draft.lines[idx].lineTotal, 0)
      );
      if (Math.abs(sum - target) <= 0.05) solutions.push(subset);
      if (solutions.length > 1) break;
    }
    if (solutions.length > 0) break;
  }

  if (solutions.length !== 1) return 0;

  const selected = new Set(solutions[0]);
  const removedIndices = draft.lines
    .map((_, index) => index)
    .filter((index) => !selected.has(index));

  if (removedIndices.length === 0 || removedIndices.length > 4) return 0;

  // Guard: do not remove a large portion of the document.
  if (selected.size < Math.ceil(draft.lines.length * 0.5)) return 0;

  draft.lines = draft.lines.filter((_, index) => selected.has(index));
  return removedIndices.length;
}

/**
 * Correct a single obvious leading-digit OCR contamination only when that one
 * correction uniquely closes an already trusted total.
 */
export function applyUniqueLeadingDigitPriceCorrection(draft: ParsedReceiptDraft): boolean {
  const total = draft.total.value;
  if (total === null || total <= 0 || draft.lines.length < 2) return false;

  const target = roundMoney(total + Math.max(0, draft.discounts.value ?? 0));
  const currentSum = roundMoney(draft.lines.reduce((s, l) => s + l.lineTotal, 0));
  if (Math.abs(currentSum - target) <= 0.05) return false;

  const candidates: Array<{ index: number; corrected: number }> = [];

  for (let i = 0; i < draft.lines.length; i++) {
    const line = draft.lines[i];
    if (line.isNegative || line.quantity !== 1 || line.lineTotal <= 0) continue;
    if (Math.abs(line.unitPrice - line.lineTotal) > 0.001) continue;

    const fixed = line.lineTotal.toFixed(2);
    const [integerPart, decimalPart] = fixed.split('.');
    if (!integerPart || integerPart.length < 2) continue;

    const corrected = Number(`${integerPart.slice(1)}.${decimalPart}`);
    if (!Number.isFinite(corrected) || corrected <= 0 || corrected >= line.lineTotal) continue;

    const projected = roundMoney(currentSum - line.lineTotal + corrected);
    if (Math.abs(projected - target) <= 0.05) {
      candidates.push({ index: i, corrected: roundMoney(corrected) });
    }
  }

  if (candidates.length !== 1) return false;

  const { index, corrected } = candidates[0];
  const line = draft.lines[index];
  const warnings = (line.warnings ?? []).filter((w) => w !== 'LOW_CONFIDENCE');
  if (!warnings.includes('PRICE_CORRECTED_BY_UNIQUE_TOTAL_CLOSURE')) {
    warnings.push('PRICE_CORRECTED_BY_UNIQUE_TOTAL_CLOSURE');
  }

  draft.lines[index] = {
    ...line,
    unitPrice: corrected,
    lineTotal: corrected,
    confidence: Math.max(line.confidence, 0.9),
    warnings,
  };
  return true;
}
