import type { ParsedReceiptDraft, ParsedReceiptLine } from './types';

export interface VariantPreviewCandidate {
  readonly variant: string;
  readonly evaluationScore: number;
  readonly draft: ParsedReceiptDraft;
}

export interface VariantPriceEvidence {
  readonly variant: string;
  readonly description: string;
  readonly price: number;
  readonly confidence: number;
}

export interface VariantTotalConsensus {
  readonly value: number;
  readonly supportingVariants: readonly string[];
  readonly directSupportingVariants: readonly string[];
}

const MONEY_TOLERANCE = 0.05;
const PURE_PRICE_RE = /^[-−]?\d{1,4}[.,]\d{2}$/;
const GENERIC_TOKENS = new Set([
  'ARTICOLO', 'PRODOTTO', 'PREZZO', 'IMPORTO', 'EURO', 'TOTALE', 'SUBTOTALE',
  'SCONTO', 'OFFERTA', 'PROMO', 'IVA', 'PESO', 'PEZZI', 'QUANTITA', 'PZ', 'GR',
  'KG', 'LT', 'ML',
]);

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizedTokens(description: string): string[] {
  const normalized = description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  return Array.from(new Set(
    normalized
      .split(/\s+/)
      .filter((token) => token.length >= 3 && /[A-Z]/.test(token) && !GENERIC_TOKENS.has(token))
  ));
}

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 5 || right.length < 5) return false;
  if (Math.abs(left.length - right.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    if (left.length === right.length) {
      i += 1;
      j += 1;
    } else if (left.length > right.length) {
      i += 1;
    } else {
      j += 1;
    }
  }

  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

function tokenEquivalent(left: string, right: string): boolean {
  return left === right || editDistanceAtMostOne(left, right);
}

function isUnresolved(line: ParsedReceiptLine): boolean {
  return line.lineTotal <= 0 || line.unitPrice <= 0 || (line.warnings?.includes('PRICE_NOT_DETECTED') ?? false);
}

export function isOrphanPurePriceLine(line: ParsedReceiptLine): boolean {
  return (
    line.lineTotal > 0 &&
    line.normalizedDescription.trim().length === 0 &&
    PURE_PRICE_RE.test(line.originalText.trim())
  );
}

function lineSum(lines: readonly ParsedReceiptLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + (line.lineTotal > 0 ? line.lineTotal : 0), 0));
}

export function isStructurallyCoherentDraft(draft: ParsedReceiptDraft): boolean {
  const lines = draft.lines.filter((line) => !isOrphanPurePriceLine(line));
  if (!draft.total.value || draft.total.value <= 0 || lines.length === 0) return false;
  if (lines.some((line) => line.normalizedDescription.trim().length === 0 || isUnresolved(line))) return false;
  return Math.abs(lineSum(lines) - draft.total.value) <= MONEY_TOLERANCE;
}

/**
 * OCR-04 — Il punteggio visuale resta il criterio principale.
 * Una variante strutturalmente coerente può superarlo solo se è vicina (max 8 punti)
 * e chiude tutte le righe con quadratura contabile entro 5 centesimi.
 */
export function selectVariantWinnerIndex(candidates: readonly VariantPreviewCandidate[]): number {
  if (!candidates.length) return -1;

  let baseIndex = 0;
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index].evaluationScore > candidates[baseIndex].evaluationScore) {
      baseIndex = index;
    }
  }

  const baseScore = candidates[baseIndex].evaluationScore;
  const coherent = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) =>
      candidate.evaluationScore >= baseScore - 8 && isStructurallyCoherentDraft(candidate.draft)
    )
    .sort((left, right) => right.candidate.evaluationScore - left.candidate.evaluationScore);

  return coherent.length > 0 ? coherent[0].index : baseIndex;
}

export function collectVariantTotalConsensus(
  candidates: readonly VariantPreviewCandidate[]
): VariantTotalConsensus | null {
  const support = new Map<number, Set<string>>();
  const directSupport = new Map<number, Set<string>>();

  for (const candidate of candidates) {
    const values = new Set<number>();
    const direct = candidate.draft.total.value;
    if (direct !== null && direct > 0) {
      const rounded = roundMoney(direct);
      values.add(rounded);
      if (!directSupport.has(rounded)) directSupport.set(rounded, new Set());
      directSupport.get(rounded)!.add(candidate.variant);
    }

    for (const alternative of candidate.draft.total.alternatives ?? []) {
      if (typeof alternative === 'number' && alternative > 0) {
        values.add(roundMoney(alternative));
      }
    }

    for (const value of values) {
      if (!support.has(value)) support.set(value, new Set());
      support.get(value)!.add(candidate.variant);
    }
  }

  const ranked = [...support.entries()]
    .map(([value, variants]) => ({
      value,
      supportingVariants: [...variants],
      directSupportingVariants: [...(directSupport.get(value) ?? new Set<string>())],
    }))
    .filter((entry) => entry.supportingVariants.length >= 2 && entry.directSupportingVariants.length >= 1)
    .sort((left, right) =>
      right.supportingVariants.length - left.supportingVariants.length ||
      right.directSupportingVariants.length - left.directSupportingVariants.length
    );

  if (ranked.length === 0) return null;
  if (
    ranked.length > 1 &&
    ranked[0].supportingVariants.length === ranked[1].supportingVariants.length &&
    ranked[0].directSupportingVariants.length === ranked[1].directSupportingVariants.length
  ) {
    return null;
  }

  return ranked[0];
}

export function applyVariantTotalConsensus(
  draft: ParsedReceiptDraft,
  consensus: VariantTotalConsensus | null
): ParsedReceiptDraft {
  if (!consensus || !draft.total.value || draft.total.value <= 0) return draft;
  if (Math.abs(draft.total.value - consensus.value) <= MONEY_TOLERANCE) return draft;

  const winnerAcknowledgesConsensus = (draft.total.alternatives ?? []).some(
    (value) => typeof value === 'number' && Math.abs(value - consensus.value) <= MONEY_TOLERANCE
  );
  if (!winnerAcknowledgesConsensus) return draft;

  const alternatives = Array.from(new Set([
    ...(draft.total.alternatives ?? []).filter((value): value is number => typeof value === 'number'),
    draft.total.value,
  ].map(roundMoney))).filter((value) => Math.abs(value - consensus.value) > MONEY_TOLERANCE);

  const warnings = [...(draft.total.warnings ?? [])];
  if (!warnings.includes('TOTAL_RECOVERED_FROM_VARIANT_CONSENSUS')) {
    warnings.push('TOTAL_RECOVERED_FROM_VARIANT_CONSENSUS');
  }

  return {
    ...draft,
    total: {
      ...draft.total,
      value: consensus.value,
      confidence: Math.max(draft.total.confidence, 90),
      alternatives,
      warnings,
    },
  };
}

export function applyVariantDateConflictGuard(
  draft: ParsedReceiptDraft,
  candidates: readonly VariantPreviewCandidate[]
): ParsedReceiptDraft {
  const dates = Array.from(new Set(
    candidates
      .map((candidate) => candidate.draft.date.value)
      .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
  ));
  if (dates.length <= 1) return draft;

  const warningCode = 'VARIANT_DATE_CONFLICT';
  const warnings = draft.warnings.filter((warning) => warning.code !== warningCode);
  warnings.push({
    code: warningCode,
    message: `Le varianti OCR propongono date discordanti (${dates.join(', ')}): richiesta revisione manuale`,
    severity: 'high',
    field: 'date',
    details: { candidateDates: dates },
  });

  const dateWarnings = [...(draft.date.warnings ?? [])];
  if (!dateWarnings.includes(warningCode)) dateWarnings.push(warningCode);

  return {
    ...draft,
    date: { ...draft.date, warnings: dateWarnings },
    warnings,
    requiresManualReview: true,
  };
}

export function collectVariantPriceEvidence(
  candidates: readonly VariantPreviewCandidate[],
  winnerVariant: string
): VariantPriceEvidence[] {
  const evidence: VariantPriceEvidence[] = [];

  for (const candidate of candidates) {
    if (candidate.variant === winnerVariant) continue;
    for (const line of candidate.draft.lines) {
      if (
        line.lineTotal > 0 &&
        line.unitPrice > 0 &&
        line.quantity === 1 &&
        !line.isNegative &&
        line.normalizedDescription.trim().length > 0 &&
        !(line.warnings?.includes('PRICE_NOT_DETECTED') ?? false)
      ) {
        evidence.push({
          variant: candidate.variant,
          description: line.normalizedDescription,
          price: roundMoney(line.lineTotal),
          confidence: line.confidence,
        });
      }
    }
  }

  return evidence;
}

function strongDescriptionMatch(leftDescription: string, rightDescription: string): boolean {
  const left = normalizedTokens(leftDescription);
  const right = normalizedTokens(rightDescription);
  if (!left.length || !right.length) return false;

  const leftKey = left.join(' ');
  const rightKey = right.join(' ');
  if (leftKey === rightKey) return true;

  const usedRight = new Set<number>();
  let matched = 0;

  for (const leftToken of left) {
    let matchIndex = right.findIndex(
      (rightToken, index) => !usedRight.has(index) && rightToken === leftToken
    );

    if (matchIndex === -1) {
      matchIndex = right.findIndex(
        (rightToken, index) => !usedRight.has(index) && tokenEquivalent(leftToken, rightToken)
      );
    }

    if (matchIndex !== -1) {
      usedRight.add(matchIndex);
      matched += 1;
    }
  }

  const coverage = matched / Math.max(left.length, right.length);
  return matched >= 2 && coverage >= 0.75;
}

function rebuildWarnings(draft: ParsedReceiptDraft): ParsedReceiptDraft['warnings'] {
  const warnings = draft.warnings.filter(
    (warning) => warning.code !== 'LINE_SUM_MISMATCH' && warning.code !== 'UNRESOLVED_PRICE_WARNING'
  );

  const sum = lineSum(draft.lines);
  if (draft.total.value && draft.lines.length > 0) {
    const diff = Math.abs(sum - draft.total.value);
    if (diff > MONEY_TOLERANCE) {
      warnings.push({
        code: 'LINE_SUM_MISMATCH',
        message: `Discrepanza tra somma delle righe (${sum.toFixed(2)} €) e totale rilevato (${draft.total.value.toFixed(2)} €)`,
        severity: 'medium',
        field: 'total',
        details: { sumLines: sum, detectedTotal: draft.total.value, diff },
      });
    }
  }

  if (draft.lines.some(isUnresolved)) {
    warnings.push({
      code: 'UNRESOLVED_PRICE_WARNING',
      message: 'Una o più righe articolo presentano un prezzo non rilevato: richiesta revisione manuale (Regola Ceccotti)',
      severity: 'high',
      field: 'lines',
    });
  }

  return warnings;
}

/**
 * OCR-04 — Fusione fail-closed fra varianti OCR.
 * - elimina solo righe prezzo pure prive di descrizione (orfane);
 * - recupera esclusivamente righe ancora senza prezzo;
 * - richiede descrizione fortemente coincidente e prezzo univoco fra le varianti;
 * - non permette che il nuovo prezzo faccia superare il totale oltre 5 centesimi;
 * - non modifica mai un prezzo già riconosciuto.
 */
export function applyStrictVariantEvidenceFusion(
  draft: ParsedReceiptDraft,
  evidence: readonly VariantPriceEvidence[]
): ParsedReceiptDraft {
  const lines = draft.lines
    .filter((line) => !isOrphanPurePriceLine(line))
    .map((line) => ({ ...line, warnings: [...(line.warnings ?? [])] }));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isUnresolved(line) || line.quantity !== 1 || line.isNegative) continue;

    const matches = evidence.filter(
      (item) => item.price > 0 && strongDescriptionMatch(line.normalizedDescription, item.description)
    );
    if (!matches.length) continue;

    const uniquePrices = Array.from(new Set(matches.map((item) => roundMoney(item.price))));
    if (uniquePrices.length !== 1) continue;

    const proposedPrice = uniquePrices[0];
    const currentSum = lineSum(lines);
    const projectedSum = roundMoney(currentSum + proposedPrice);

    // OCR-04 R2-R2: la fusione tra varianti è ammessa solo quando il prezzo
    // candidato chiude contabilmente il documento entro 5 centesimi.
    // La confidence aggregata della riga non viene usata come gate perché
    // incorpora campi estranei al prezzo (es. IVA e quantità).
    if (!draft.total.value || draft.total.value <= 0) continue;
    if (Math.abs(projectedSum - draft.total.value) > MONEY_TOLERANCE) continue;

    const warnings = (line.warnings ?? []).filter(
      (warning) => warning !== 'PRICE_NOT_DETECTED' && warning !== 'LOW_CONFIDENCE'
    );
    if (!warnings.includes('PRICE_RECOVERED_FROM_VARIANT_FUSION')) {
      warnings.push('PRICE_RECOVERED_FROM_VARIANT_FUSION');
    }

    lines[index] = {
      ...line,
      unitPrice: proposedPrice,
      lineTotal: proposedPrice,
      confidence: Math.max(line.confidence, Math.max(...matches.map((item) => item.confidence))),
      warnings,
    };
  }

  // OCR-04 R3: correzione strettissima di un prezzo già letto quando una sola
  // variante alternativa propone un importo diverso di massimo 5 centesimi e
  // quella sostituzione porta la somma delle righe a chiudere il totale entro 1 centesimo.
  // Non inventa importi: il valore deve esistere in una variante OCR reale.
  if (draft.total.value && draft.total.value > 0) {
    const currentSum = lineSum(lines);
    const currentDiff = Math.abs(currentSum - draft.total.value);
    if (currentDiff > 0.005 && currentDiff <= MONEY_TOLERANCE) {
      const proposals: Array<{ index: number; price: number; confidence: number; projectedDiff: number }> = [];

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (isUnresolved(line) || line.quantity !== 1 || line.isNegative || line.lineTotal <= 0) continue;

        const matches = evidence.filter(
          (item) =>
            item.price > 0 &&
            Math.abs(item.price - line.lineTotal) > 0.001 &&
            Math.abs(item.price - line.lineTotal) <= MONEY_TOLERANCE &&
            strongDescriptionMatch(line.normalizedDescription, item.description)
        );
        const uniquePrices = Array.from(new Set(matches.map((item) => roundMoney(item.price))));
        if (uniquePrices.length !== 1) continue;

        const proposedPrice = uniquePrices[0];
        const projectedSum = roundMoney(currentSum - line.lineTotal + proposedPrice);
        const projectedDiff = Math.abs(projectedSum - draft.total.value);
        if (projectedDiff <= 0.011 && projectedDiff + 0.001 < currentDiff) {
          proposals.push({
            index,
            price: proposedPrice,
            confidence: Math.max(...matches.map((item) => item.confidence)),
            projectedDiff,
          });
        }
      }

      proposals.sort((left, right) => left.projectedDiff - right.projectedDiff);
      const best = proposals[0];
      const second = proposals[1];
      if (best && (!second || best.projectedDiff + 0.001 < second.projectedDiff)) {
        const line = lines[best.index];
        const warnings = [...(line.warnings ?? [])];
        if (!warnings.includes('PRICE_CORRECTED_FROM_VARIANT_FUSION')) {
          warnings.push('PRICE_CORRECTED_FROM_VARIANT_FUSION');
        }
        lines[best.index] = {
          ...line,
          unitPrice: best.price,
          lineTotal: best.price,
          confidence: Math.max(line.confidence, best.confidence),
          warnings,
        };
      }
    }
  }

  const provisional: ParsedReceiptDraft = {
    ...draft,
    lines,
    warnings: [],
  };
  provisional.warnings = rebuildWarnings({ ...draft, lines, warnings: draft.warnings });
  provisional.requiresManualReview =
    lines.some(isUnresolved) || provisional.warnings.some((warning) => warning.severity === 'high');

  return provisional;
}
