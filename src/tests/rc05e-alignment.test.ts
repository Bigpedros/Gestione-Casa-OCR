import { describe, it, expect } from 'vitest';
import { generateShadowAlignmentProposals } from '../services/ocrParser/regional/shadowAlignment';
import { ParsedLineItemV2 } from '../services/ocrParser/types';
import { RegionalMonetaryToken } from '../services/ocrParser/regional/types';

function createMockLineItem(overrides: Partial<ParsedLineItemV2> = {}): ParsedLineItemV2 {
  return {
    id: `item_${Math.random()}`,
    type: 'ARTICLE',
    rawIndices: [0],
    rawText: 'ARTICOLO ESEMPIO',
    normalizedText: 'ARTICOLO ESEMPIO',
    description: 'ARTICOLO ESEMPIO',
    quantity: 1,
    unitOfMeasure: null,
    unitPrice: 0,
    lineTotal: null,
    vatRate: null,
    discount: null,
    isNegative: false,
    confidence: {
      description: 80,
      quantity: 80,
      unitPrice: 0,
      lineTotal: 0,
      vat: 0,
      overall: 40,
    },
    monetaryEvidence: {
      unitPriceEvidence: 'MISSING',
      lineTotalEvidence: 'MISSING',
    },
    warnings: ['PRICE_NOT_DETECTED'],
    reasons: [],
    rawLines: [{ rawIndex: 0, rawText: 'ARTICOLO ESEMPIO', normalizedText: 'ARTICOLO ESEMPIO' }],
    ...overrides,
  };
}

function createMockToken(val: number | null, isDegraded = false): RegionalMonetaryToken {
  return {
    rawToken: val !== null ? val.toFixed(2).replace('.', ',') : '2599',
    parsedValue: isDegraded ? null : val,
    lineIndex: 0,
    confidence: isDegraded ? 40 : 90,
    classification: isDegraded ? 'degraded' : 'exact_monetary',
  };
}

describe('RC-05E: Regional Shadow Alignment Module', () => {
  it('Scenario A: 8 unresolved items, 8 exact tokens, no multiline/no discount -> Tier 2 proposals allowed', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      createMockLineItem({ description: `PRODOTTO ${i + 1}`, rawIndices: [i] })
    );
    const tokens = [1.5, 2.0, 3.25, 4.1, 0.99, 12.44, 5.0, 7.8].map((v) => createMockToken(v));

    const proposals = generateShadowAlignmentProposals(items, tokens);

    expect(proposals).toHaveLength(8);
    expect(proposals.every((p) => p.status === 'PROPOSED')).toBe(true);
    expect(proposals.every((p) => p.tier === 'TIER_2')).toBe(true);
    expect(proposals.map((p) => p.proposedPrice)).toEqual([1.5, 2.0, 3.25, 4.1, 0.99, 12.44, 5.0, 7.8]);
  });

  it('Scenario B: 8 unresolved items, 6 exact tokens -> AMBIGUOUS / NO FILL', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      createMockLineItem({ description: `PRODOTTO ${i + 1}`, rawIndices: [i] })
    );
    const tokens = [1.5, 2.0, 3.25, 4.1, 0.99, 12.44].map((v) => createMockToken(v));

    const proposals = generateShadowAlignmentProposals(items, tokens);

    expect(proposals).toHaveLength(8);
    expect(proposals.every((p) => p.status === 'AMBIGUOUS')).toBe(true);
    expect(proposals.every((p) => p.proposedPrice === null)).toBe(true);
    expect(proposals[0].reason).toContain('count_mismatch');
  });

  it('Scenario C: 8 items, 6 exact + 2 degraded -> degraded tokens NOT used as price fill', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      createMockLineItem({ description: `PRODOTTO ${i + 1}`, rawIndices: [i] })
    );
    const tokens = [
      createMockToken(12.44),
      createMockToken(12.2),
      createMockToken(0.1),
      createMockToken(0.69),
      createMockToken(0.69),
      createMockToken(null, true), // 2599 degraded
      createMockToken(null, true), // 2489 degraded
      createMockToken(2.99),
    ];

    const proposals = generateShadowAlignmentProposals(items, tokens);

    expect(proposals).toHaveLength(8);
    expect(proposals.every((p) => p.status === 'AMBIGUOUS')).toBe(true);
    expect(proposals.every((p) => p.proposedPrice === null)).toBe(true);
    expect(proposals[0].reason).toContain('degraded_tokens_present');
  });

  it('Scenario D: multiline item present -> Tier 2 disabled', () => {
    const items = [
      createMockLineItem({ description: 'PROD 1', rawIndices: [0] }),
      createMockLineItem({ description: 'PROD 2 MULTILINE', rawIndices: [1, 2] }),
    ];
    const tokens = [createMockToken(1.5), createMockToken(2.5)];

    const proposals = generateShadowAlignmentProposals(items, tokens);

    expect(proposals.every((p) => p.status === 'AMBIGUOUS')).toBe(true);
    expect(proposals[0].reason).toContain('multiline_items_present');
  });

  it('Scenario E: discount present -> Tier 2 disabled', () => {
    const items = [
      createMockLineItem({ description: 'PROD 1', type: 'ARTICLE', rawIndices: [0] }),
      createMockLineItem({ description: 'SCONTO PROMO', type: 'DISCOUNT', isNegative: true, rawIndices: [1] }),
    ];
    const tokens = [createMockToken(10.0), createMockToken(-2.0)];

    const proposals = generateShadowAlignmentProposals(items, tokens);

    expect(proposals.every((p) => p.status === 'AMBIGUOUS')).toBe(true);
    expect(proposals[0].reason).toContain('discount_or_rounding');
  });

  it('Scenario F: extra monetary tokens present -> Tier 2 disabled', () => {
    const items = [createMockLineItem({ rawIndices: [0] })];
    const tokens = [createMockToken(1.5), createMockToken(2.5)]; // 2 tokens for 1 item

    const proposals = generateShadowAlignmentProposals(items, tokens);

    expect(proposals[0].status).toBe('AMBIGUOUS');
    expect(proposals[0].reason).toContain('count_mismatch');
  });

  it('Scenario G: already-priced line is never overwritten', () => {
    const alreadyPricedItem = createMockLineItem({
      description: 'PASTA BARILLA',
      unitPrice: 1.25,
      lineTotal: 1.25,
      warnings: [],
      monetaryEvidence: { unitPriceEvidence: 'CERTAIN', lineTotalEvidence: 'CERTAIN' },
      rawIndices: [0],
    });
    const items = [alreadyPricedItem];
    const tokens = [createMockToken(99.99)];

    const proposals = generateShadowAlignmentProposals(items, tokens);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe('REJECTED');
    expect(proposals[0].reason).toContain('already_priced_line_protected');
    expect(proposals[0].proposedPrice).toBe(1.25);
  });
});
