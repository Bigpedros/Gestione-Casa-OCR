import { describe, it, expect } from 'vitest';
import { extractRegionalMonetaryTokens } from '../services/ocrParser/regional/monetaryTokenParser';

describe('RC-05E: Regional Monetary Token Extraction', () => {
  it('extracts exact monetary tokens conforming to integer + decimal separator + 2 decimals', () => {
    const raw = `
      12,44
      12.20
      0,10
      0,69
      2,99
    `;
    const tokens = extractRegionalMonetaryTokens(raw);
    const exactTokens = tokens.filter((t) => t.classification === 'exact_monetary');

    expect(exactTokens).toHaveLength(5);
    expect(exactTokens.map((t) => t.parsedValue)).toEqual([12.44, 12.2, 0.1, 0.69, 2.99]);
  });

  it('classifies tokens without decimal separator as degraded and assigns parsedValue: null (Ceccotti Rule)', () => {
    const raw = `
      2599
      2489
    `;
    const tokens = extractRegionalMonetaryTokens(raw);

    expect(tokens).toHaveLength(2);
    expect(tokens[0].rawToken).toBe('2599');
    expect(tokens[0].classification).toBe('degraded');
    expect(tokens[0].parsedValue).toBeNull();

    expect(tokens[1].rawToken).toBe('2489');
    expect(tokens[1].classification).toBe('degraded');
    expect(tokens[1].parsedValue).toBeNull();
  });

  it('strictly filters and rejects percentages, dates, times, barcodes and isolated symbols', () => {
    const raw = `
      22,00%
      10%
      31-07-2026
      12:10
      DOCUMENTO N. 0972-0042
      7 99ÎEB065409
      .
      -
    `;
    const tokens = extractRegionalMonetaryTokens(raw);
    const exactTokens = tokens.filter((t) => t.classification === 'exact_monetary');
    expect(exactTokens).toHaveLength(0);

    const rejected = tokens.filter((t) => t.classification === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(4);
  });

  it('extracts valid price on a line that also contains department or tax abbreviations', () => {
    const line = '00% 12,44 PRI';
    const tokens = extractRegionalMonetaryTokens(line);

    const exact = tokens.find((t) => t.classification === 'exact_monetary');
    expect(exact).toBeDefined();
    expect(exact?.parsedValue).toBe(12.44);
  });
});
