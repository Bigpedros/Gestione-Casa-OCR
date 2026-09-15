import type { ParsedLineItemV2 } from '../types';

export interface PhysicalBodyRecoveredLine {
  readonly description: string;
  readonly price: number;
  readonly rawText: string;
  readonly confidence: number;
}

export interface PhysicalBodyDocumentRecoveryCandidate {
  readonly lines: readonly PhysicalBodyRecoveredLine[];
  readonly discountAmount: number;
  readonly total: number;
  readonly paymentMethod: 'contanti';
  readonly confidence: number;
  readonly score: number;
  readonly closureDiff: number;
}

const EXCLUDED_DESCRIPTION_RE =
  /\b(?:TOTALE|SUBTOTALE|PAGAMENTO|RESTO|IMPORTO|IVA|DOCUMENTO|COMMERCIALE)\b/i;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function lastMoneyOnLine(line: string): number | null {
  const matches = [...line.matchAll(/-?\d{1,4}[.,]\d{2}/g)];
  if (!matches.length) return null;
  const raw = matches[matches.length - 1][0];
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function deriveDirectFiscalTotal(rawText: string): number | null {
  const values: number[] = [];
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /\bSUBTOTALE\b/i.test(line)) continue;
    if (!/\bTOTALE(?:\s+(?:COMPLESSIVO|DOVUTO|SPESA|EURO))?\b/i.test(line)) continue;
    const matches = [...line.matchAll(/\d{1,4}[.,]\d{2}/g)];
    if (!matches.length) continue;
    const value = Number(matches[matches.length - 1][0].replace(',', '.'));
    if (Number.isFinite(value) && value > 0) values.push(roundMoney(value));
  }
  const unique = [...new Set(values.map((v) => v.toFixed(2)))].map(Number);
  return unique.length === 1 ? unique[0] : null;
}

export function deriveCashMinusChangeTotal(rawText: string): number | null {
  let cash: number | null = null;
  let change: number | null = null;

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/pagamento\s+contante/i.test(line)) {
      cash = lastMoneyOnLine(line);
    } else if (/\bresto\b/i.test(line)) {
      change = lastMoneyOnLine(line);
    }
  }

  if (cash === null || change === null || cash <= 0 || change < 0 || cash < change) {
    return null;
  }

  const total = roundMoney(cash - change);
  return total > 0 ? total : null;
}

export function buildPhysicalBodyDocumentRecoveryCandidate(
  rawText: string,
  items: readonly ParsedLineItemV2[],
  ocrConfidence: number
): PhysicalBodyDocumentRecoveryCandidate | null {
  const directFiscalTotal = deriveDirectFiscalTotal(rawText);
  const cashSettlementTotal = deriveCashMinusChangeTotal(rawText);
  const independentTotal = directFiscalTotal ?? cashSettlementTotal;
  if (independentTotal === null) return null;

  const productItems = items.filter((item) => {
    const description = item.description.trim();
    if (!description) return false;
    if (/\b(?:SCONTO|ARROTONDAMENTO|ROUNDING)\b/i.test(description)) return false;
    if (item.type === 'DISCOUNT' || item.type === 'ROUNDING' || item.type === 'RETURN_STORNO') return false;
    if (item.isNegative) return false;
    if (item.lineTotal === null || item.lineTotal <= 0) return false;
    if (EXCLUDED_DESCRIPTION_RE.test(description)) return false;
    return true;
  });

  if (productItems.length < 3 || productItems.length > 20) return null;

  const recoveredLines: PhysicalBodyRecoveredLine[] = [];
  for (const item of productItems) {
    if (item.lineTotal === null || item.lineTotal <= 0) return null;

    recoveredLines.push({
      description: item.description.replace(/\s+/g, ' ').trim(),
      price: roundMoney(item.lineTotal),
      rawText: item.rawText,
      confidence: Math.max(90, Math.round(item.confidence.overall)),
    });
  }

  const negativeItems = items.filter(
    (item) =>
      item.isNegative ||
      item.type === 'DISCOUNT' ||
      item.type === 'ROUNDING' ||
      item.type === 'RETURN_STORNO' ||
      /\b(?:SCONTO|ARROTONDAMENTO|ROUNDING)\b/i.test(item.description || '') ||
      ((item.lineTotal ?? 0) < 0)
  );

  const discountSigned = roundMoney(
    negativeItems.reduce((sum, item) => {
      const value = item.lineTotal ?? item.discount ?? 0;
      return sum + (value > 0 ? -Math.abs(value) : value);
    }, 0)
  );

  const productSum = roundMoney(
    recoveredLines.reduce((sum, line) => sum + line.price, 0)
  );
  const commercialSum = roundMoney(productSum + discountSigned);
  let closureDiff = roundMoney(Math.abs(commercialSum - independentTotal));

  // Some fiscal receipts apply cash rounding at settlement after the fiscal total.
  // Accept that pattern only when an explicit direct fiscal TOTAL is visible and
  // cash-minus-change independently closes the rounded settlement amount.
  if (
    closureDiff > 0.05 &&
    directFiscalTotal !== null &&
    cashSettlementTotal !== null &&
    Math.abs(productSum - directFiscalTotal) <= 0.05 &&
    Math.abs(commercialSum - cashSettlementTotal) <= 0.05
  ) {
    closureDiff = 0;
  }

  if (closureDiff > 0.05) return null;

  const discountAmount = roundMoney(Math.abs(discountSigned));
  const boundedOcrConfidence = Math.max(0, Math.min(100, Math.round(ocrConfidence)));

  const score =
    recoveredLines.length * 10 +
    (negativeItems.length > 0 ? 8 : 0) +
    12 +
    40 +
    10 +
    Math.round(boundedOcrConfidence / 10);

  return {
    lines: recoveredLines,
    discountAmount,
    total: independentTotal,
    paymentMethod: 'contanti',
    confidence: Math.max(92, boundedOcrConfidence),
    score,
    closureDiff,
  };
}

export function selectBestPhysicalBodyDocumentRecoveryCandidate(
  candidates: readonly PhysicalBodyDocumentRecoveryCandidate[]
): PhysicalBodyDocumentRecoveryCandidate | null {
  if (!candidates.length) return null;

  return [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      a.closureDiff - b.closureDiff ||
      b.confidence - a.confidence ||
      b.lines.length - a.lines.length
  )[0] ?? null;
}
