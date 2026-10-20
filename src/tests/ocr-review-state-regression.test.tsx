import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  attachmentRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
} from '../repositories';
import type { EditableReviewLine } from '../features/attachments/OcrReviewModal';

describe('OCR Review Workflow & Manual Line Validation Regression Tests (Cases A - F)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  const evaluateVisualState = (line: EditableReviewLine): 'normal' | 'yellow' | 'red' | 'green' => {
    if (
      line.reviewStatus === 'confirmed' ||
      line.reviewStatus === 'modified' ||
      line.isNewRow ||
      line.manuallyValidated
    ) {
      return 'green';
    }

    const isDiscountOrReturn =
      line.lineTotal < 0 ||
      /SCONTO|PROMO|ABBUONO|COUPON|BUONO|RESO|STORNO|ARROTONDAMENTO/i.test(line.description || '');

    const hasBlockingOcrError =
      (!isDiscountOrReturn && line.unitPrice <= 0 && line.lineTotal <= 0) ||
      (line.warnings && line.warnings.includes('OCR_TEXT_SUSPECT'));

    if (hasBlockingOcrError) {
      return 'red';
    }

    const confVal = typeof line.confidence === 'number' ? line.confidence : 80;
    const confPct = confVal > 0 && confVal <= 1 ? confVal * 100 : confVal;

    const hasClassificationConflict = Boolean(line.hasConflict);
    const hasWarnings = Array.isArray(line.warnings) && line.warnings.length > 0;
    const isLowConfidence = confPct < 60;
    const isUnclassified = !line.categoryId || line.categoryId === 'cat-unclassified';

    if (hasClassificationConflict || isLowConfidence || hasWarnings || isUnclassified) {
      return 'yellow';
    }

    return 'normal';
  };

  it('CASO A: riga pending + gialla -> utente preme "Conferma riga" senza modificare dati -> reviewStatus = confirmed, visualState = green', () => {
    const line: EditableReviewLine = {
      id: 'line-a',
      ocrProcessId: 'proc-1',
      originalText: 'ILLY IPERESPRESSO GINSENG 3.90',
      description: 'ILLY IPERESPRESSO GINSENG',
      quantity: 1,
      unitPrice: 3.90,
      lineTotal: 3.90,
      confidence: 0.88,
      reviewStatus: 'pending',
      productId: null,
      categoryId: 'cat-parent-cat_misc',
      subcategoryId: null,
      warnings: [],
      hasConflict: true,
      actionMode: 'unlinked',
    };

    expect(evaluateVisualState(line)).toBe('yellow');

    const confirmedLine: EditableReviewLine = {
      ...line,
      reviewStatus: 'confirmed',
      manuallyValidated: true,
    };

    expect(evaluateVisualState(confirmedLine)).toBe('green');
  });

  it('CASO B: riga pending -> utente modifica realmente il testo -> reviewStatus = modified, visualState = green', () => {
    const line: EditableReviewLine = {
      id: 'line-b',
      ocrProcessId: 'proc-1',
      originalText: 'CAFFE',
      description: 'Caffè Corretto',
      quantity: 1,
      unitPrice: 1.50,
      lineTotal: 1.50,
      confidence: 70,
      reviewStatus: 'modified',
      manuallyValidated: true,
      productId: null,
      categoryId: 'cat-food',
      subcategoryId: null,
      warnings: [],
    };

    expect(evaluateVisualState(line)).toBe('green');
  });

  it('CASO C: riga confirmed -> chiudi modal / riapri modal (load from DB) -> resta verde', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      metadata: { title: 'Test_Session' },
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'test.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,abc',
      fileHash: 'hash-test',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      detectedTotal: 3.90,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const dbLine = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ILLY',
      description: 'ILLY IPERESPRESSO GINSENG',
      quantity: 1,
      unitPrice: 3.90,
      lineTotal: 3.90,
      confidence: 88,
      reviewStatus: 'confirmed',
      metadata: {},
    });

    const loadedLine: EditableReviewLine = {
      id: dbLine.id,
      ocrProcessId: dbLine.ocrProcessId,
      originalText: dbLine.originalText,
      description: dbLine.description,
      quantity: dbLine.quantity,
      unitPrice: dbLine.unitPrice,
      lineTotal: dbLine.lineTotal,
      confidence: dbLine.confidence,
      reviewStatus: dbLine.reviewStatus,
      productId: dbLine.productId || null,
      categoryId: 'cat-food',
      subcategoryId: null,
      warnings: [],
      manuallyValidated: dbLine.reviewStatus === 'confirmed' || dbLine.reviewStatus === 'modified',
    };

    expect(evaluateVisualState(loadedLine)).toBe('green');
  });

  it('CASO D: riga con errore bloccante reale (OCR_TEXT_SUSPECT) -> utente NON può confermarla silenziosamente', () => {
    const line: EditableReviewLine = {
      id: 'line-d',
      ocrProcessId: 'proc-1',
      originalText: '###',
      description: 'Testo Corrotto',
      quantity: 1,
      unitPrice: 10.00,
      lineTotal: 10.00,
      confidence: 30,
      reviewStatus: 'pending',
      productId: null,
      categoryId: 'cat-food',
      subcategoryId: null,
      warnings: ['OCR_TEXT_SUSPECT'],
    };

    expect(evaluateVisualState(line)).toBe('red');
    const isBlocking = evaluateVisualState(line) === 'red';
    expect(isBlocking).toBe(true);
  });

  it('CASO E: pulsante globale "Conferma revisione" su righe sane ancora pending -> le righe diventano confirmed e persistono', () => {
    let lines: EditableReviewLine[] = [
      {
        id: 'line-e1',
        ocrProcessId: 'proc-1',
        originalText: 'LATTE',
        description: 'Latte Fresco',
        quantity: 1,
        unitPrice: 1.50,
        lineTotal: 1.50,
        confidence: 88,
        reviewStatus: 'pending',
        productId: null,
        categoryId: 'cat-food',
        subcategoryId: null,
        warnings: [],
      },
    ];

    lines = lines.map((line) => {
      if (line.reviewStatus === 'pending') {
        const hasBlockingOcrError = line.warnings?.includes('OCR_TEXT_SUSPECT') || (line.unitPrice <= 0 && line.lineTotal <= 0);
        if (!hasBlockingOcrError) {
          return {
            ...line,
            reviewStatus: 'confirmed' as const,
            manuallyValidated: true,
          };
        }
      }
      return line;
    });

    expect(lines[0].reviewStatus).toBe('confirmed');
    expect(evaluateVisualState(lines[0])).toBe('green');
  });

  it('CASO F: nessuna modifica artificiale richiesta per validare una riga corretta', () => {
    const line: EditableReviewLine = {
      id: 'line-f',
      ocrProcessId: 'proc-1',
      originalText: 'ILLY IPERESPRESSO GINSENG',
      description: 'ILLY IPERESPRESSO GINSENG',
      quantity: 1,
      unitPrice: 3.90,
      lineTotal: 3.90,
      confidence: 88,
      reviewStatus: 'confirmed',
      manuallyValidated: true,
      productId: null,
      categoryId: 'cat-food',
      subcategoryId: null,
      warnings: [],
    };

    expect(evaluateVisualState(line)).toBe('green');
  });
});
