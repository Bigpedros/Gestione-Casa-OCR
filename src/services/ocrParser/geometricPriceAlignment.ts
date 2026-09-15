import type { OcrWordGeometry, ParsedReceiptLine } from './types';
import { TextNormalizationModule } from './modules/TextNormalizationModule';

export interface GeometricPriceProposal {
  readonly itemIndex: number;
  readonly proposedPrice: number;
  readonly priceText: string;
  readonly priceWordConfidence: number;
  readonly descriptionCoverage: number;
  readonly matchedDescriptionTokens: readonly string[];
  readonly priceBox: OcrWordGeometry['bbox'];
}

const EXACT_PRICE_RE = /^[-−]?\d{1,4}[.,]\d{2}$/;
const GENERIC_DESCRIPTION_TOKENS = new Set([
  'ARTICOLO',
  'PRODOTTO',
  'PREZZO',
  'IMPORTO',
  'EURO',
  'TOTALE',
  'SUBTOTALE',
  'SCONTO',
  'OFFERTA',
  'PROMO',
  'IVA',
  'PESO',
  'PEZZI',
  'QUANTITA',
  'PZ',
  'GR',
  'KG',
  'LT',
  'ML',
]);

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
    .trim();
}

function normalizePriceToken(value: string): string {
  return value
    .trim()
    .replace(/^[€EUR\s"'`([{]+/i, '')
    .replace(/[€EUR\s"'`)\]}]+$/i, '')
    .trim();
}

function verticalOverlapRatio(
  left: OcrWordGeometry['bbox'],
  right: OcrWordGeometry['bbox']
): number {
  const overlap = Math.max(0, Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0));
  const minHeight = Math.min(left.y1 - left.y0, right.y1 - right.y0);
  if (minHeight <= 0) return 0;
  return overlap / minHeight;
}

function getDescriptionTokens(description: string): string[] {
  return Array.from(
    new Set(
      description
        .split(/\s+/)
        .map(normalizeToken)
        .filter(
          (token) =>
            token.length >= 3 &&
            /[A-Z]/.test(token) &&
            !GENERIC_DESCRIPTION_TOKENS.has(token)
        )
    )
  );
}

function isStrictlyUnresolvedLine(line: ParsedReceiptLine): boolean {
  return (
    line.lineTotal <= 0 &&
    line.unitPrice <= 0 &&
    line.quantity === 1 &&
    !line.isNegative &&
    (line.warnings?.includes('PRICE_NOT_DETECTED') ?? false)
  );
}

function parseExactPrice(word: OcrWordGeometry): number | null {
  const cleaned = normalizePriceToken(word.text);
  if (!EXACT_PRICE_RE.test(cleaned)) return null;
  const parsed = TextNormalizationModule.parseItalianNumber(cleaned);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * OCR-03 — Produce proposte geometriche fail-closed.
 *
 * Condizioni richieste:
 * - riga ufficiale ancora senza prezzo, quantità 1 e non negativa;
 * - token prezzo esatto, confidenza >= 70;
 * - prezzo nella metà destra dell'area OCR;
 * - un solo token monetario esatto sulla stessa fascia verticale;
 * - descrizione a sinistra del prezzo;
 * - copertura descrittiva >= 60% e almeno due token, oppure un token distintivo >= 5;
 * - relazione univoca 1:1 fra riga e prezzo.
 */
export function generateGeometricPriceProposals(
  lines: readonly ParsedReceiptLine[],
  words: readonly OcrWordGeometry[],
  knownTotalValue?: number | null
): GeometricPriceProposal[] {
  if (!lines.length || !words.length) return [];

  const validWords = words.filter(
    (word) =>
      word.text.trim().length > 0 &&
      Number.isFinite(word.confidence) &&
      word.bbox.x1 > word.bbox.x0 &&
      word.bbox.y1 > word.bbox.y0
  );
  if (!validWords.length) return [];

  const minX = Math.min(...validWords.map((word) => word.bbox.x0));
  const maxX = Math.max(...validWords.map((word) => word.bbox.x1));
  const pageWidth = maxX - minX;
  if (pageWidth <= 0) return [];

  const unresolved = lines
    .map((line, itemIndex) => ({
      line,
      itemIndex,
      tokens: getDescriptionTokens(line.normalizedDescription),
    }))
    .filter(({ line, tokens }) => isStrictlyUnresolvedLine(line) && tokens.length > 0);

  if (!unresolved.length) return [];

  const priceWords = validWords
    .map((word) => ({ word, value: parseExactPrice(word) }))
    .filter(
      (candidate): candidate is { word: OcrWordGeometry; value: number } =>
        candidate.value !== null &&
        candidate.word.confidence >= 70 &&
        candidate.word.bbox.x0 >= minX + pageWidth * 0.55 &&
        (knownTotalValue === undefined ||
          knownTotalValue === null ||
          Math.abs(candidate.value - knownTotalValue) >= 0.01)
    );

  if (!priceWords.length) return [];

  type Candidate = GeometricPriceProposal & { priceWordIndex: number };
  const candidates: Candidate[] = [];

  for (let priceIndex = 0; priceIndex < priceWords.length; priceIndex += 1) {
    const { word: priceWord, value: priceValue } = priceWords[priceIndex];

    const sameBand = validWords.filter(
      (word) => verticalOverlapRatio(word.bbox, priceWord.bbox) >= 0.55
    );

    // Una fascia con più di un token monetario esatto è ambigua
    // (es. aliquota separata dal simbolo % + prezzo articolo).
    const sameBandExactPrices = sameBand.filter(
      (word) => word.confidence >= 70 && parseExactPrice(word) !== null
    );
    if (sameBandExactPrices.length !== 1) {
      continue;
    }

    const leftWords = sameBand.filter(
      (word) =>
        word !== priceWord &&
        word.bbox.x1 <= priceWord.bbox.x0 &&
        word.confidence >= 40 &&
        parseExactPrice(word) === null
    );

    const leftTokens = leftWords
      .map((word) => ({
        token: normalizeToken(word.text),
        word,
      }))
      .filter(({ token }) => token.length >= 3 && /[A-Z]/.test(token));

    const matchesForPrice: Candidate[] = [];

    for (const { itemIndex, tokens: descriptionTokens } of unresolved) {
      const matched = Array.from(
        new Set(
          leftTokens
            .map(({ token }) => token)
            .filter((token) => descriptionTokens.includes(token))
        )
      );

      const coverage = matched.length / descriptionTokens.length;
      const hasDistinctiveSingle = matched.some((token) => token.length >= 5);
      const enoughLexicalEvidence =
        coverage >= 0.6 &&
        (matched.length >= 2 || (descriptionTokens.length === 1 && hasDistinctiveSingle));

      if (!enoughLexicalEvidence) {
        continue;
      }

      matchesForPrice.push({
        itemIndex,
        proposedPrice: priceValue,
        priceText: priceWord.text,
        priceWordConfidence: priceWord.confidence,
        descriptionCoverage: Math.round(coverage * 100) / 100,
        matchedDescriptionTokens: matched,
        priceBox: priceWord.bbox,
        priceWordIndex: priceIndex,
      });
    }

    // Il prezzo deve identificare una sola riga ufficiale.
    if (matchesForPrice.length === 1) {
      candidates.push(matchesForPrice[0]);
    }
  }

  // Anche ogni riga deve avere un solo prezzo possibile.
  const proposalCountByItem = new Map<number, number>();
  for (const candidate of candidates) {
    proposalCountByItem.set(
      candidate.itemIndex,
      (proposalCountByItem.get(candidate.itemIndex) ?? 0) + 1
    );
  }

  return candidates
    .filter((candidate) => proposalCountByItem.get(candidate.itemIndex) === 1)
    .map(({ priceWordIndex: _priceWordIndex, ...proposal }) => proposal);
}
