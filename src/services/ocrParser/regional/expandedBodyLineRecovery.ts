import type { ParsedReceiptLine } from '../types';

export interface ExpandedBodyRecoveredLine {
  readonly description: string;
  readonly price: number;
  readonly rawText: string;
  readonly existingItemIndex: number | null;
  readonly confidence: number;
}

const MONEY_AT_END_RE = /(\d{1,4}[.,]\d{2})\s*$/;
const EXCLUDED_LINE_RE =
  /\b(?:TOTALE|SUBTOTALE|PAGAMENTO|IMPORTO\s+PAGATO|CONTANTI|RESTO|CARTA|BANCOMAT|POS|IVA|DOCUMENTO|RT\b)\b/i;

const roundMoney = (v: number) => Math.round(v * 100) / 100;

function normalizeToken(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '').trim();
}

function descriptionTokens(value: string): string[] {
  return value.split(/\s+/).map(normalizeToken)
    .filter((token) => token.length >= 3 && /[A-Z]/.test(token));
}

function cleanDescription(prefix: string): string {
  const beforeNumeric = prefix.split(/\s+\d/)[0] ?? prefix;
  return beforeNumeric.replace(/\s+/g, ' ')
    .replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ' ]+$/g, '').trim();
}

function parseCandidateRows(rawText: string) {
  const rows: Array<{ description: string; price: number; rawText: string }> = [];
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || EXCLUDED_LINE_RE.test(line)) continue;
    const m = line.match(MONEY_AT_END_RE);
    if (!m) continue;
    const price = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0 || price > 500) continue;
    const prefix = line.slice(0, m.index).trim();
    const description = cleanDescription(prefix);
    if (!description || description.length < 4 || descriptionTokens(description).length === 0) continue;
    rows.push({ description, price: roundMoney(price), rawText: line });
  }
  return rows;
}

function findUniqueExistingMatch(candidateDescription: string, lines: readonly ParsedReceiptLine[]): number | null {
  const ct = descriptionTokens(candidateDescription);
  if (!ct.length) return null;
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const unresolved =
      line.lineTotal <= 0 && line.unitPrice <= 0 && line.quantity === 1 &&
      !line.isNegative && (line.warnings?.includes('PRICE_NOT_DETECTED') ?? false);
    if (!unresolved) continue;
    const ot = descriptionTokens(line.normalizedDescription);
    if (!ot.length) continue;
    const common = ct.filter((t) => ot.includes(t));
    const cCov = common.length / ct.length;
    const oCov = common.length / ot.length;
    const distinctiveSingle = common.some((t) => t.length >= 5);
    if ((cCov >= 0.6 && oCov >= 0.5) || (distinctiveSingle && Math.min(ct.length, ot.length) === 1)) {
      matches.push(i);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function recoverExpandedBodyLines(
  rawText: string,
  independentTotal: number | null | undefined,
  existingLines: readonly ParsedReceiptLine[]
): ExpandedBodyRecoveredLine[] {
  if (!rawText.trim() || independentTotal == null || independentTotal <= 0) return [];
  if (existingLines.length < 1 || existingLines.length > 3) return [];

  const parsed = parseCandidateRows(rawText);
  if (parsed.length < 2 || parsed.length > 4) return [];

  const descs = parsed.map((r) => r.description.toUpperCase().replace(/\s+/g, ' ').trim());
  if (new Set(descs).size !== descs.length) return [];

  const sum = roundMoney(parsed.reduce((s, r) => s + r.price, 0));
  if (Math.abs(sum - roundMoney(independentTotal)) > 0.05) return [];

  const recovered = parsed.map((r) => ({
    ...r,
    existingItemIndex: findUniqueExistingMatch(r.description, existingLines),
    confidence: 92,
  }));

  const matched = recovered.filter((r) => r.existingItemIndex !== null);
  if (matched.length < 1) return [];
  const idxs = matched.map((r) => r.existingItemIndex as number);
  if (new Set(idxs).size !== idxs.length) return [];
  if (recovered.filter((r) => r.existingItemIndex === null).length > 2) return [];

  return recovered;
}
