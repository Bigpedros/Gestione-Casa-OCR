import { describe, it, expect } from 'vitest';
import { shouldRunRegionalSecondPass } from '../services/ocrParser/regional/triggerPolicy';
import { ParsedReceiptDraft, ParsedReceiptLine } from '../services/ocrParser/types';
import { DocumentCategory, OCRLineReviewStatus } from '../types';

function createMockDraft(overrides: Partial<ParsedReceiptDraft> = {}): ParsedReceiptDraft {
  return {
    documentCategory: 'COMMERCIAL_RECEIPT',
    supplier: { value: 'SUPERMERCATO', confidence: 80 },
    address: { value: 'VIA ROMA 1', confidence: 80 },
    taxIdentifier: { value: '12345678901', confidence: 80 },
    date: { value: '2026-07-31', confidence: 80 },
    time: { value: '12:00', confidence: 80 },
    total: { value: 34.53, confidence: 90 },
    subtotal: { value: 34.53, confidence: 90 },
    vat: { value: null, confidence: 0 },
    discounts: { value: null, confidence: 0 },
    paymentMethod: { value: 'carta', confidence: 85 },
    lines: [
      {
        originalText: 'ARTICOLO 1  10,00',
        normalizedDescription: 'ARTICOLO 1',
        quantity: 1,
        unitPrice: 10.0,
        lineTotal: 10.0,
        confidence: 85,
        reviewStatus: 'pending',
        warnings: [],
      },
    ],
    warnings: [],
    overallConfidence: 85,
    ...overrides,
  };
}

function createUnresolvedLine(idx: number): ParsedReceiptLine {
  return {
    originalText: `ARTICOLO ${idx}`,
    normalizedDescription: `ARTICOLO ${idx}`,
    quantity: 1,
    unitPrice: 0,
    lineTotal: 0,
    confidence: 50,
    reviewStatus: 'pending',
    warnings: ['PRICE_NOT_DETECTED'],
  };
}

describe('RC-05E: Regional Trigger Policy (Pure Function)', () => {
  it('triggers FOOTER when COMMERCIAL_RECEIPT has missing total', () => {
    const draft = createMockDraft({
      total: { value: null, confidence: 0 },
    });
    const result = shouldRunRegionalSecondPass(draft);

    expect(result.shouldRun).toBe(true);
    expect(result.targetRegions).toEqual(['footer']);
    expect(result.reason).toContain('missing_or_low_confidence_total');
  });

  it('triggers BODY when COMMERCIAL_RECEIPT has high missing-price ratio (>= 40%)', () => {
    const lines = [
      createUnresolvedLine(1),
      createUnresolvedLine(2),
      createUnresolvedLine(3),
      createUnresolvedLine(4),
      {
        originalText: 'ARTICOLO OK  5,00',
        normalizedDescription: 'ARTICOLO OK',
        quantity: 1,
        unitPrice: 5.0,
        lineTotal: 5.0,
        confidence: 90,
        reviewStatus: 'pending' as OCRLineReviewStatus,
        warnings: [],
      },
    ];
    const draft = createMockDraft({
      total: { value: 25.0, confidence: 90 },
      lines,
    });
    const result = shouldRunRegionalSecondPass(draft);

    expect(result.shouldRun).toBe(true);
    expect(result.targetRegions).toEqual(['body']);
    expect(result.reason).toContain('high_missing_prices');
  });

  it('triggers BOTH BODY and FOOTER when both prices and total are missing', () => {
    const lines = [createUnresolvedLine(1), createUnresolvedLine(2)];
    const draft = createMockDraft({
      total: { value: null, confidence: 0 },
      lines,
    });
    const result = shouldRunRegionalSecondPass(draft);

    expect(result.shouldRun).toBe(true);
    expect(result.targetRegions).toEqual(['body', 'footer']);
    expect(result.reason).toContain('missing_total_and_high_missing_prices');
  });

  it('does NOT trigger for complete COMMERCIAL_RECEIPT with valid total and complete prices', () => {
    const draft = createMockDraft();
    const result = shouldRunRegionalSecondPass(draft);

    expect(result.shouldRun).toBe(false);
    expect(result.targetRegions).toEqual([]);
    expect(result.reason).toContain('complete_commercial_receipt');
  });

  it('does NOT trigger for PAYMENT_PROOF', () => {
    const draft = createMockDraft({
      documentCategory: 'PAYMENT_PROOF' as DocumentCategory,
      total: { value: null, confidence: 0 },
    });
    const result = shouldRunRegionalSecondPass(draft);

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toContain('ineligible_document_category');
  });

  it('does NOT trigger for UNKNOWN category', () => {
    const draft = createMockDraft({
      documentCategory: 'UNKNOWN' as DocumentCategory,
      total: { value: null, confidence: 0 },
    });
    const result = shouldRunRegionalSecondPass(draft);

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toContain('ineligible_document_category');
  });

  it('does NOT trigger for INVOICE_OR_BILL', () => {
    const draft = createMockDraft({
      documentCategory: 'INVOICE_OR_BILL' as DocumentCategory,
      total: { value: null, confidence: 0 },
    });
    const result = shouldRunRegionalSecondPass(draft);

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toContain('ineligible_document_category');
  });
});
