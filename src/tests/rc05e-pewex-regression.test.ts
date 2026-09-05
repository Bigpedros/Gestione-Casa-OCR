import { describe, it, expect } from 'vitest';
import { extractRegionalMonetaryTokens } from '../services/ocrParser/regional/monetaryTokenParser';
import { generateShadowAlignmentProposals } from '../services/ocrParser/regional/shadowAlignment';
import { ParsedLineItemV2 } from '../services/ocrParser/types';

/**
 * RAW REGIONALI REALI CERTIFICATI IN RC-05C-R2 (Evidenza empirica congelata)
 */
const PEWEX_BODY_RAW_REAL = `
VA     Prezzo(€)             GE
00%          12,44 PRI
GG
00%    12,20 Pa
o n            PARIS
LUIGI Aa
00%                     0,10 VG
00%       0,69 RIA
00%                   0,69 SG
RA
SU
00%           2599    e  MN
Li             MS
00%           2489 O
00%           2,99 ANS
34,53 NSA
i       SEEN
I RS
34,53 e

53
`;

const PEWEX_FOOTER_RAW_REAL = `
lettronico              34,53
31-07-7076 12:10
DOCUMENTO N. 0972-0042
7 99ÎEB065409
`;

function createMockPewexItem(idx: number, desc: string): ParsedLineItemV2 {
  return {
    id: `pewex_item_${idx}`,
    type: 'ARTICLE',
    rawIndices: [idx],
    rawText: desc,
    normalizedText: desc,
    description: desc,
    quantity: 1,
    unitOfMeasure: null,
    unitPrice: 0,
    lineTotal: null,
    vatRate: null,
    discount: null,
    isNegative: false,
    confidence: { description: 80, quantity: 80, unitPrice: 0, lineTotal: 0, vat: 0, overall: 40 },
    monetaryEvidence: { unitPriceEvidence: 'MISSING', lineTotalEvidence: 'MISSING' },
    warnings: ['PRICE_NOT_DETECTED'],
    reasons: [],
    rawLines: [{ rawIndex: idx, rawText: desc, normalizedText: desc }],
  };
}

describe('RC-05E: Pewex Real Raw Regional Evidence Regression Fixture', () => {
  it('extracts exactly 6 exact monetary tokens and 2 degraded tokens from real PEWEX body raw', () => {
    // Estraiamo con knownTotalValue = 34.53 per verificare la tracciabilità del totale finale
    const tokens = extractRegionalMonetaryTokens(PEWEX_BODY_RAW_REAL, { knownTotalValue: 34.53 });

    const exactItemTokens = tokens.filter(
      (t) => t.classification === 'exact_monetary' && t.reason !== 'matches_known_total'
    );
    const degradedTokens = tokens.filter((t) => t.classification === 'degraded');
    const totalTokens = tokens.filter((t) => t.reason === 'matches_known_total');

    // 6 prezzi articolo esatti
    expect(exactItemTokens).toHaveLength(6);
    expect(exactItemTokens.map((t) => t.parsedValue)).toEqual([12.44, 12.2, 0.1, 0.69, 0.69, 2.99]);

    // 2 token degradati con parsedValue: null (2599 e 2489)
    expect(degradedTokens).toHaveLength(2);
    expect(degradedTokens.map((t) => t.rawToken)).toEqual(['2599', '2489']);
    expect(degradedTokens.every((t) => t.parsedValue === null)).toBe(true);

    // I due 34,53 in fondo alla scansione body sono tracciati separatamente
    expect(totalTokens).toHaveLength(2);
    expect(totalTokens.every((t) => t.parsedValue === 34.53)).toBe(true);
  });

  it('proves that shadow alignment NEVER blindly assigns the two 34,53 or degraded tokens as item prices', () => {
    const pewex8Items: ParsedLineItemV2[] = [
      createMockPewexItem(1, 'LATTE BONTÀ E PASTORIZZATO'),
      createMockPewexItem(2, 'PARMIGIANO REGGIANO DOP'),
      createMockPewexItem(3, 'BUSTA BIODEGRADABILE'),
      createMockPewexItem(4, 'ACQUA MINERALE NATURALE'),
      createMockPewexItem(5, 'ACQUA MINERALE NATURALE'),
      createMockPewexItem(6, 'BISCOTTI FROLLINI INTEGRALI'),
      createMockPewexItem(7, 'PASTA DI SEMOLA 500G'),
      createMockPewexItem(8, 'YOGURT GRECO INTERO'),
    ];

    const bodyTokens = extractRegionalMonetaryTokens(PEWEX_BODY_RAW_REAL, { knownTotalValue: 34.53 });
    const proposals = generateShadowAlignmentProposals(pewex8Items, bodyTokens);

    // Con 8 item orfani e solo 6 prezzi certi + 2 degradati, Tier 2 si disattiva per sicurezza
    expect(proposals).toHaveLength(8);
    expect(proposals.every((p) => p.status === 'AMBIGUOUS')).toBe(true);

    // Nessun item riceve 34.53 o numeri degradati
    const proposedValues = proposals.map((p) => p.proposedPrice).filter((v) => v !== null);
    expect(proposedValues).toHaveLength(0);
    expect(proposals.some((p) => p.proposedPrice === 34.53)).toBe(false);
  });

  it('extracts the exact total 34.53 from PEWEX footer raw and rejects document metadata', () => {
    const footerTokens = extractRegionalMonetaryTokens(PEWEX_FOOTER_RAW_REAL);

    const exactFooterTokens = footerTokens.filter((t) => t.classification === 'exact_monetary');
    expect(exactFooterTokens).toHaveLength(1);
    expect(exactFooterTokens[0].parsedValue).toBe(34.53);

    // Date, ore e numeri documento sono rifiutati
    const rejected = footerTokens.filter((t) => t.classification === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(2);
  });
});
