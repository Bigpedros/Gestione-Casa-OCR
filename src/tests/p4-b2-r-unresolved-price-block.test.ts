/**
 * P4-B2-R: Test Suite Correzione Minima Bloccante
 * REGOLA CECCOTTI: Prezzo Non Rilevato ≠ Prezzo Zero
 *
 * Verifica che una riga il cui prezzo non è stato rilevato non possa essere
 * confermata e trasformata silenziosamente in una riga economica definitiva da € 0,00.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { productClassificationService } from '../services/productClassification';
import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
  documentSessionRepository,
} from '../repositories';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';
import { receiptParserService } from '../services/ocrParser';
import { TextNormalizationModule } from '../services/ocrParser/modules/TextNormalizationModule';
import { ReceiptZoneSegmenter } from '../services/ocrParser/modules/ReceiptZoneSegmenter';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { SegmentedReceiptLine } from '../services/ocrParser/types';

function createTestBodyLines(lines: string[], startRawIndex = 0): SegmentedReceiptLine[] {
  return lines.map((text, idx) => ({
    index: idx,
    rawIndex: startRawIndex + idx,
    rawText: text,
    text: text,
    zone: 'BODY',
    confidence: 1.0,
    reasons: ['unit_test_fixture'],
  }));
}

describe('P4-B2-R: Regola Ceccotti — Prezzo Non Rilevato ≠ Prezzo Zero', () => {
  beforeEach(async () => {
    await db.products.clear();
    await db.productAliases.clear();
    await db.suppliers.clear();
    await db.ocrProcesses.clear();
    await db.ocrReceiptLines.clear();
    await db.expenses.clear();
    await db.expenseItems.clear();
    await db.categories.clear();

    // Inizializza categorie di base
    await seedInitialCategoriesAndSettings();
  });

  it('1. Prezzo non rilevato: V2 produce null, adapter legacy usa 0 con warning PRICE_NOT_DETECTED', () => {
    const bodyLines = createTestBodyLines(['YOGURT GRECO NATURALE']);
    const resultV2 = LineItemParserV2.parseBody(bodyLines);

    expect(resultV2.items.length).toBe(1);
    const item = resultV2.items[0];
    expect(item.description).toBe('YOGURT GRECO NATURALE');
    expect(item.lineTotal).toBeNull();
    expect(item.unitPrice).toBeNull();
    expect(item.monetaryEvidence.lineTotalEvidence).toBe('MISSING');
    expect(item.warnings).toContain('PRICE_NOT_DETECTED');

    // Adapter legacy
    const legacy = LineItemParserV2.toLegacyLines(resultV2.items);
    expect(legacy.length).toBe(1);
    expect(legacy[0].lineTotal).toBe(0);
    expect(legacy[0].unitPrice).toBe(0);
    expect(legacy[0].warnings).toContain('PRICE_NOT_DETECTED');
  });

  it('2. Blocco creazione ExpenseItem per riga con prezzo mancante / non rilevato', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-ceccotti-1',
      status: 'completed',
      detectedSupplier: 'SUPERMERCATO TEST',
      detectedDate: '2026-08-29',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      pageCount: 1,
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
      metadata: {
        title: 'Scontrino Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    });

    const lineWithoutPrice = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ARTICOLO SENZA PREZZO',
      description: 'ARTICOLO SENZA PREZZO',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      confidence: 60,
      reviewStatus: 'pending',
      metadata: {
        warnings: ['PRICE_NOT_DETECTED'],
        priceNotDetected: true,
      },
    });

    // Tentativo di creare la registrazione contabile senza aver risolto il prezzo
    await expect(
      productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
        decisions: [
          {
            lineId: lineWithoutPrice.id,
            originalText: lineWithoutPrice.originalText,
            description: lineWithoutPrice.description,
            quantity: 1,
            unitPrice: 0,
            lineTotal: 0,
            action: 'create_new',
            newProductDetails: { displayName: 'Articolo Senza Prezzo' },
          },
        ],
      })
    ).rejects.toThrow(/prezzo non rilevato o ambiguo dall'OCR/i);

    // Verifica che nessun Expense né ExpenseItem sia stato creato
    const expenses = await db.expenses.toArray();
    expect(expenses.length).toBe(0);
    const items = await db.expenseItems.toArray();
    expect(items.length).toBe(0);
  });

  it('3. Inserimento manuale del prezzo corretto abilita la conferma e crea l\'ExpenseItem', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-ceccotti-2',
      status: 'completed',
      detectedSupplier: 'SUPERMERCATO TEST',
      detectedDate: '2026-08-29',
      detectedTotal: 2.5,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      pageCount: 1,
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
      metadata: {
        title: 'Scontrino Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'BISCOTTI INTEGRALI',
      description: 'BISCOTTI INTEGRALI',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      confidence: 60,
      reviewStatus: 'pending',
      metadata: {
        warnings: ['PRICE_NOT_DETECTED'],
        priceNotDetected: true,
      },
    });

    // L'utente inserisce manualmente il prezzo reale (€ 2.50)
    const expense = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      documentTotal: 2.5,
      decisions: [
        {
          lineId: line.id,
          originalText: line.originalText,
          description: line.description,
          quantity: 1,
          unitPrice: 2.5,
          lineTotal: 2.5,
          action: 'create_new',
          newProductDetails: { displayName: 'Biscotti Integrali' },
        },
      ],
    });

    expect(expense).toBeDefined();
    expect(expense.amount).toBe(2.5);

    const items = await db.expenseItems.where('expenseId').equals(expense.id).toArray();
    expect(items.length).toBe(1);
    expect(items[0].unitPrice).toBe(2.5);
    expect(items[0].total).toBe(2.5);
  });

  it('4. Prezzo reale 0,00 € esplicitamente presente nel testo: evidence CERTAIN e nessun blocco', async () => {
    const bodyLines = createTestBodyLines(['CAMPIONE OMAGGIO 0.00 0.00']);
    const resultV2 = LineItemParserV2.parseBody(bodyLines);

    expect(resultV2.items.length).toBe(1);
    const item = resultV2.items[0];
    expect(item.lineTotal).toBe(0);
    expect(item.monetaryEvidence.lineTotalEvidence).toBe('CERTAIN');
    expect(item.warnings).not.toContain('PRICE_NOT_DETECTED');

    const legacy = LineItemParserV2.toLegacyLines(resultV2.items);
    expect(legacy[0].lineTotal).toBe(0);
    expect(legacy[0].warnings).not.toContain('PRICE_NOT_DETECTED');

    // In DB come omaggio/sconto valido
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-ceccotti-3',
      status: 'completed',
      detectedSupplier: 'NEGOZIO PROMO',
      detectedDate: '2026-08-29',
      detectedTotal: 5.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      pageCount: 1,
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
      metadata: {
        title: 'Scontrino Omaggio',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    });

    const promoLine = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'SCONTO PROMO OMAGGIO 0.00',
      description: 'SCONTO PROMO OMAGGIO',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      confidence: 90,
      reviewStatus: 'pending',
      metadata: {
        warnings: [],
        priceNotDetected: false,
      },
    });

    const itemLine = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ACQUA NATURALE 5.00',
      description: 'ACQUA NATURALE',
      quantity: 1,
      unitPrice: 5.0,
      lineTotal: 5.0,
      confidence: 95,
      reviewStatus: 'pending',
      metadata: {
        warnings: [],
        priceNotDetected: false,
      },
    });

    const expense = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      documentTotal: 5.0,
      decisions: [
        {
          lineId: promoLine.id,
          originalText: promoLine.originalText,
          description: promoLine.description,
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
          action: 'create_new',
          newProductDetails: { displayName: 'Sconto Promo Omaggio' },
        },
        {
          lineId: itemLine.id,
          originalText: itemLine.originalText,
          description: itemLine.description,
          quantity: 1,
          unitPrice: 5.0,
          lineTotal: 5.0,
          action: 'create_new',
          newProductDetails: { displayName: 'Acqua Naturale' },
        },
      ],
    });

    expect(expense).toBeDefined();
    expect(expense.amount).toBe(5.0);
  });

  it('5. L\'approvazione della discrepanza contabile NON bypassa il blocco del prezzo sconosciuto', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-ceccotti-4',
      status: 'completed',
      detectedSupplier: 'SUPERMERCATO TEST',
      detectedDate: '2026-08-29',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      pageCount: 1,
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
      metadata: {
        title: 'Scontrino Discrepanza',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'RIGA SENZA PREZZO',
      description: 'RIGA SENZA PREZZO',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      confidence: 70,
      reviewStatus: 'pending',
      metadata: {
        warnings: ['PRICE_NOT_DETECTED'],
        priceNotDetected: true,
      },
    });

    // Passiamo allowDiscrepancy: true, ma la presenza del prezzo sconosciuto DEVE comunque bloccare
    await expect(
      productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
        documentTotal: 10.0,
        allowDiscrepancy: true, // NON deve bypassare la regola Ceccotti
        decisions: [
          {
            lineId: line.id,
            originalText: line.originalText,
            description: line.description,
            quantity: 1,
            unitPrice: 0,
            lineTotal: 0,
            action: 'create_new',
            newProductDetails: { displayName: 'Riga Senza Prezzo' },
          },
        ],
      })
    ).rejects.toThrow(/prezzo non rilevato o ambiguo dall'OCR/i);
  });

  it('6. Fixture Todis: 10 righe nel body, prezzi certi/plausibili o tracciati con evidenza coerente', () => {
    const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
    const zones = ReceiptZoneSegmenter.segment(norm);
    const result = LineItemParserV2.parseBody(zones.body);

    expect(result.items.length).toBe(10);
    expect(result.summary.articleCount).toBe(9);
    expect(result.summary.discountCount).toBe(1);

    // Prezzi certi presenti
    expect(result.items[1].lineTotal).toBe(1.99); // PATATINE KETTLE
    expect(result.items[5].lineTotal).toBe(6.99); // GRANDE IMPERO 1000GR
    expect(result.items[6].lineTotal).toBe(1.89); // NUTELLA

    // Prezzi mancanti o ambigui hanno evidenza coerente
    expect(result.items[0].monetaryEvidence.lineTotalEvidence).toBe('MISSING');
    expect(result.items[0].warnings).toContain('PRICE_NOT_DETECTED');

    const legacyLines = LineItemParserV2.toLegacyLines(result.items);
    expect(legacyLines.length).toBe(10);
  });

  it('7. COMMERCIAL_RECEIPT continua a utilizzare LineItemParserV2 ufficialmente', () => {
    const draft = receiptParserService.parseText(TODIS_REAL_RAW_TEXT);
    const comparison = receiptParserService.getLastShadowComparison();

    expect(draft.lines.length).toBe(10);
    expect(comparison).toBeDefined();
    expect(comparison?.executed).toBe(true);
    expect(comparison?.isV2Official).toBe(true);
    expect(comparison?.fallbackUsed).toBe(false);
  });
});

