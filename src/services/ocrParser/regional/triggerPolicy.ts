/**
 * RC-05E: REGIONAL TRIGGER DECISION POLICY (PURE FUNCTION)
 *
 * Funzione pura per valutare se uno scontrino parsed richiede il secondo passaggio
 * regionale. Basata esclusivamente sull'output del First Parse.
 * NON collegata al runtime in RC-05E.
 */

import { ParsedReceiptDraft } from '../types';

export interface RegionalTriggerResult {
  readonly shouldRun: boolean;
  readonly reason: string;
  readonly targetRegions: readonly ('body' | 'footer')[];
}

export function shouldRunRegionalSecondPass(draft: ParsedReceiptDraft): RegionalTriggerResult {
  // 1. Vincolo di categoria: solo COMMERCIAL_RECEIPT è eleggibile
  if (draft.documentCategory !== 'COMMERCIAL_RECEIPT') {
    return {
      shouldRun: false,
      reason: `ineligible_document_category_${draft.documentCategory}`,
      targetRegions: [],
    };
  }

  // 2. Valutazione stato totale (Footer)
  const isTotalMissingOrInvalid =
    draft.total.value === null || draft.total.value <= 0 || draft.total.confidence < 50;

  // 3. Valutazione righe senza prezzo (Body)
  const lines = draft.lines || [];
  const articleLines = lines.filter((l) => !l.originalText.includes('SCONTO') && (l.lineTotal === 0 || l.lineTotal > 0));
  
  const missingPriceLines = lines.filter((l) => {
    const hasWarning = l.warnings?.includes('PRICE_NOT_DETECTED');
    const isZeroWithWarning = l.unitPrice === 0 && l.lineTotal === 0 && hasWarning;
    return Boolean(hasWarning || isZeroWithWarning);
  });

  const missingPriceRatio =
    articleLines.length > 0 ? missingPriceLines.length / articleLines.length : lines.length > 0 && missingPriceLines.length > 0 ? 1.0 : 0;

  const isHighMissingPriceRatio = missingPriceLines.length > 0 && missingPriceRatio >= 0.40;

  // 4. Determinazione regioni target
  const targetRegions: ('body' | 'footer')[] = [];
  if (isHighMissingPriceRatio) {
    targetRegions.push('body');
  }
  if (isTotalMissingOrInvalid) {
    targetRegions.push('footer');
  }

  if (targetRegions.length === 0) {
    return {
      shouldRun: false,
      reason: 'complete_commercial_receipt_no_regional_pass_needed',
      targetRegions: [],
    };
  }

  let reason = '';
  if (targetRegions.includes('body') && targetRegions.includes('footer')) {
    reason = `missing_total_and_high_missing_prices_${missingPriceLines.length}_of_${articleLines.length}`;
  } else if (targetRegions.includes('body')) {
    reason = `high_missing_prices_ratio_${Math.round(missingPriceRatio * 100)}pct`;
  } else {
    reason = 'missing_or_low_confidence_total';
  }

  return {
    shouldRun: true,
    reason,
    targetRegions,
  };
}
