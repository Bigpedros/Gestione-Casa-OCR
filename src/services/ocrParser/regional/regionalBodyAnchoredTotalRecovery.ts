import type { RegionalMonetaryToken } from './types';

export interface AnchoredElectronicBodyTotalCandidate {
  rawText: string;
  parsedValue: number;
  confidence: number;
}

/**
 * OCR-05B1-B1-P1
 *
 * Recupero fail-closed del totale da BODY regionale quando:
 * - il first pass non ha un totale;
 * - il testo full-page contiene un'ancora fiscale esplicita di totale;
 * - esiste evidenza di pagamento elettronico (quindi niente tender cash > totale);
 * - il BODY regionale contiene pochi token monetari esatti (2..5);
 * - l'ultimo token monetario è separato dai precedenti e domina i prezzi articolo;
 * - il documento è piccolo, senza sconti/rettifiche/righe negative.
 *
 * Nessuna conoscenza merchant-specifica o Ground Truth.
 */
export function findAnchoredElectronicBodyTotalCandidate(
  bodyTokens: readonly RegionalMonetaryToken[],
  firstParseDraft: any,
  fullRawText: string
): AnchoredElectronicBodyTotalCandidate | null {
  if (!firstParseDraft || firstParseDraft.documentCategory !== 'COMMERCIAL_RECEIPT') {
    return null;
  }

  const existingTotal = firstParseDraft.total?.value;
  if (typeof existingTotal === 'number' && existingTotal > 0) {
    return null;
  }

  const text = fullRawText || '';
  const hasExplicitTotalAnchor =
    /\bTOTALE\s+(?:COMPLESSIVO|DOVUTO|SPESA|EURO)\b/i.test(text) ||
    /\bIMPORTO\s+TOTALE\b/i.test(text);

  if (!hasExplicitTotalAnchor) return null;

  const hasElectronicTender =
    /\bPAGAMENTO\s+ELETTRONICO\b/i.test(text) ||
    /\b(?:CARTA(?:\s+DI\s+CREDITO)?|BANCOMAT|POS|MASTERCARD|VISA)\b/i.test(text);

  if (!hasElectronicTender) return null;

  // Cash tender can be larger than the fiscal total: fail closed if cash semantics coexist.
  if (/\b(?:CONTANTI|CASH|RESTO|CHANGE)\b/i.test(text)) {
    return null;
  }

  const lines = Array.isArray(firstParseDraft.lines) ? firstParseDraft.lines : [];
  if (lines.length < 1 || lines.length > 3) return null;

  const hasUnsafeLine = lines.some((line: any) =>
    line?.isNegative ||
    line?.type === 'DISCOUNT' ||
    line?.type === 'ROUNDING' ||
    (typeof line?.discount === 'number' && line.discount > 0)
  );
  if (hasUnsafeLine) return null;

  const exactTokens = bodyTokens
    .filter(
      (token) =>
        token.classification === 'exact_monetary' &&
        token.parsedValue !== null &&
        token.parsedValue > 0 &&
        token.reason !== 'matches_known_total'
    )
    .slice()
    .sort((a, b) => a.lineIndex - b.lineIndex);

  if (exactTokens.length < 2 || exactTokens.length > 5) return null;

  const candidate = exactTokens[exactTokens.length - 1];
  const prior = exactTokens.slice(0, -1);
  if (candidate.parsedValue === null || prior.length === 0) return null;

  const previousToken = prior[prior.length - 1];
  const previousValue = previousToken.parsedValue;
  if (previousValue === null) return null;

  // Structural separation: total/payment region must not be on the same/adjacent OCR row.
  if (candidate.lineIndex - previousToken.lineIndex < 2) return null;

  const priorValues = prior
    .map((token) => token.parsedValue)
    .filter((value): value is number => value !== null && value > 0);

  if (priorValues.length !== prior.length) return null;

  const maxPrior = Math.max(...priorValues);
  const value = candidate.parsedValue;

  // Conservative dominance: fiscal/payment candidate must be meaningfully greater
  // than every preceding item-like amount. Avoid arbitrary one-cent promotion.
  if (value - maxPrior < 0.20) return null;

  // Sanity bounds for small-receipt recovery.
  if (value < 0.50 || value > 500) return null;
  if (maxPrior > 0 && value > maxPrior * 10) return null;

  return {
    rawText: candidate.rawToken,
    parsedValue: value,
    confidence: 88,
  };
}
