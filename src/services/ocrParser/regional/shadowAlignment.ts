/**
 * RC-05E: REGIONAL SHADOW ALIGNMENT
 *
 * Funzione pura per l'allineamento SHADOW tra token regionali e righe articolo.
 * Produce ESCLUSIVAMENTE proposte (proposals) non vincolanti.
 * NON modifica gli item ufficiali, NON rimuove warnings, NON altera lo stato.
 */

import { ParsedLineItemV2 } from '../types';
import { RegionalMonetaryToken, RegionalAlignmentProposal } from './types';

export function generateShadowAlignmentProposals(
  items: readonly ParsedLineItemV2[],
  tokens: readonly RegionalMonetaryToken[]
): RegionalAlignmentProposal[] {
  const proposals: RegionalAlignmentProposal[] = [];

  if (!items || items.length === 0) {
    return proposals;
  }

  // 1. Identificazione delle righe senza prezzo (unresolved items)
  const unresolvedItemsWithIndex = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const hasPriceNotDetected = item.warnings?.includes('PRICE_NOT_DETECTED') || false;
      const isMissingPrice = item.lineTotal === null || item.monetaryEvidence?.lineTotalEvidence === 'MISSING';
      return hasPriceNotDetected || isMissingPrice;
    });

  // 2. Identificazione dei token monetari certi (exact_monetary con parsedValue valido)
  const exactTokensWithIndex = tokens
    .map((token, index) => ({ token, index }))
    .filter(
      ({ token }) =>
        token.classification === 'exact_monetary' &&
        token.parsedValue !== null &&
        token.reason !== 'matches_known_total'
    );

  const degradedTokens = tokens.filter((t) => t.classification === 'degraded');

  // Verifica presenza di sconti o rettifiche nel set di articoli
  const hasDiscounts = items.some((it) => it.type === 'DISCOUNT' || it.type === 'ROUNDING' || it.isNegative);

  // Verifica presenza di articoli multilinea aggregati
  const hasMultiline = items.some((it) => it.rawIndices && it.rawIndices.length > 1);

  // TIER 1 REALITY CHECK: Bounding box pixel non disponibili per gli item full-page
  // Tier 1 è esplicitamente NOT AVAILABLE in RC-05E e non deve essere simulato.

  // 3. TIER 2: STRICT COUNT AGREEMENT CHECK
  // Condizioni tassative per formulare proposte ordinali shadow:
  const canAttemptTier2 =
    unresolvedItemsWithIndex.length > 0 &&
    unresolvedItemsWithIndex.length === exactTokensWithIndex.length &&
    degradedTokens.length === 0 &&
    !hasDiscounts &&
    !hasMultiline;

  if (canAttemptTier2) {
    // Genera proposte per ciascuna riga orfana
    for (let i = 0; i < unresolvedItemsWithIndex.length; i++) {
      const { item, index: itemIdx } = unresolvedItemsWithIndex[i];
      const { token, index: tokenIdx } = exactTokensWithIndex[i];

      proposals.push({
        itemIndex: itemIdx,
        itemDescription: item.description,
        tokenIndex: tokenIdx,
        proposedPrice: token.parsedValue,
        tier: 'TIER_2',
        status: 'PROPOSED',
        reason: 'strict_count_monotonic_agreement',
      });
    }
    return proposals;
  }

  // 4. TIER 3: CONSERVATIVE NO-FILL / AMBIGUOUS FALLBACK
  // Se le condizioni di parità assoluta non sono soddisfatte, emettiamo proposte con stato AMBIGUOUS o REJECTED
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isUnresolved = unresolvedItemsWithIndex.some((u) => u.index === i);

    if (!isUnresolved) {
      proposals.push({
        itemIndex: i,
        itemDescription: item.description,
        tokenIndex: -1,
        proposedPrice: item.lineTotal,
        tier: 'TIER_3',
        status: 'REJECTED',
        reason: 'already_priced_line_protected',
      });
      continue;
    }

    let reason = 'tier_3_ambiguous_layout';
    if (degradedTokens.length > 0) {
      reason = `degraded_tokens_present_count_${degradedTokens.length}`;
    } else if (hasMultiline) {
      reason = 'multiline_items_present';
    } else if (hasDiscounts) {
      reason = 'discount_or_rounding_items_present';
    } else if (unresolvedItemsWithIndex.length !== exactTokensWithIndex.length) {
      reason = `count_mismatch_unresolved_${unresolvedItemsWithIndex.length}_vs_exact_${exactTokensWithIndex.length}`;
    }

    proposals.push({
      itemIndex: i,
      itemDescription: item.description,
      tokenIndex: -1,
      proposedPrice: null,
      tier: 'TIER_3',
      status: 'AMBIGUOUS',
      reason,
    });
  }

  return proposals;
}
