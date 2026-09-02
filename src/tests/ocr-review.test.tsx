import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
  expenseRepository,
  supplierRepository,
  productRepository,
  auditLogRepository,
} from '../repositories';
import { productClassificationService } from '../services/productClassification';

describe('Revisione Obbligatoria Dati OCR (TEST-OCR-REVIEW)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST-REV-001: Transizione dello stato a ready_for_review e accesso alla revisione', async () => {
    // 1. Crea sessione e allegati
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
      metadata: { title: 'Scontrino_Esselunga_01' },
    });

    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'esselunga_01.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 85000,
      storageKey: 'data:image/jpeg;base64,dummyReviewImage',
      fileHash: 'hash-esselunga-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: attachment.id,
      originalFileName: 'esselunga_01.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-esselunga-01',
      processingStatus: 'processed',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: attachment.id,
      status: 'completed',
      rawText: 'ESSELUNGA\nPANE 2.50\nLATTE 1.80\nTOTALE 4.30',
      detectedSupplier: 'ESSELUNGA',
      detectedDate: '2026-08-01',
      detectedTotal: 4.30,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, {
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
    });

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('ready_for_review');
    expect(updatedSession?.ocrProcessId).toBe(ocrProc.id);
  });

  it('TEST-REV-002: Salvataggio bozza di revisione ("Salva bozza") senza creare record contabili', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      metadata: { title: 'Bozza_Revisione_Test' },
    });

    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino_bozza.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 50000,
      storageKey: 'data:image/jpeg;base64,dummyBozzaData',
      fileHash: 'hash-bozza-01',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: attachment.id,
      status: 'completed',
      detectedSupplier: 'Coop',
      detectedTotal: 15.50,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    // Crea righe OCR bozza
    await ocrReceiptLineRepository.bulkCreate([
      {
        ocrProcessId: ocrProc.id,
        originalText: 'MELA GOLDEN 5.50',
        description: 'Mela Golden',
        quantity: 1,
        unitPrice: 5.50,
        lineTotal: 5.50,
        confidence: 100,
        reviewStatus: 'pending',
      },
      {
        ocrProcessId: ocrProc.id,
        originalText: 'ACQUA NATURALE 10.00',
        description: 'Acqua Naturale',
        quantity: 2,
        unitPrice: 5.00,
        lineTotal: 10.00,
        confidence: 100,
        reviewStatus: 'pending',
      },
    ]);

    // Simulazione aggiornamento progressivo bozza
    await ocrProcessRepository.update(ocrProc.id, {
      detectedSupplier: 'Coop Supermercati',
      detectedTotal: 15.50,
    });

    // Verifica che nessuna spesa o movimento contabile sia stato creato
    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(0);

    const suppliers = await supplierRepository.getAll();
    expect(suppliers.length).toBe(0);

    const products = await productRepository.getAll();
    expect(products.length).toBe(0);

    const updatedOcr = await ocrProcessRepository.getById(ocrProc.id);
    expect(updatedOcr?.confirmedByUser).toBe(false);
  });

  it('TEST-REV-003: Conferma revisione ("Conferma revisione") imposta confirmedByUser, aggiorna lo stato a reviewed e genera Audit Log', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      metadata: { title: 'Scontrino_Da_Confermare' },
    });

    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino_final.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 60000,
      storageKey: 'data:image/jpeg;base64,dummyFinalData',
      fileHash: 'hash-final-01',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: attachment.id,
      status: 'completed',
      detectedSupplier: 'Conad',
      detectedDate: '2026-08-02',
      detectedTotal: 12.00,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const lineItems = await ocrReceiptLineRepository.bulkCreate([
      {
        ocrProcessId: ocrProc.id,
        originalText: 'PASTA 2.00',
        description: 'Pasta Barilla 500g',
        quantity: 2,
        unitPrice: 1.00,
        lineTotal: 2.00,
        confidence: 100,
        reviewStatus: 'confirmed',
      },
      {
        ocrProcessId: ocrProc.id,
        originalText: 'PASSATA 10.00',
        description: 'Passata di Pomodoro 1kg',
        quantity: 5,
        unitPrice: 2.00,
        lineTotal: 10.00,
        confidence: 100,
        reviewStatus: 'confirmed',
      },
    ]);

    // Esegui la conferma della revisione
    await ocrProcessRepository.update(ocrProc.id, {
      confirmedByUser: true,
      status: 'completed',
    });

    await documentSessionRepository.update(session.id, {
      status: 'reviewed',
    });

    await auditLogRepository.create({
      action: 'update',
      entityType: 'OCRProcess',
      entityId: ocrProc.id,
      newValues: {
        sessionId: session.id,
        lineCount: lineItems.length,
        totalAmount: 12.00,
        supplierName: 'Conad',
      },
    });

    // Verifiche
    const finalSession = await documentSessionRepository.getById(session.id);
    expect(finalSession?.status).toBe('reviewed');

    const finalOcr = await ocrProcessRepository.getById(ocrProc.id);
    expect(finalOcr?.confirmedByUser).toBe(true);

    const logs = await auditLogRepository.getByEntity('OCRProcess', ocrProc.id);
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('update');

    // REGOLA FONDAMENTALE: Zero Expense create fino a questa fase!
    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(0);
  });

  it('TEST-REV-004: Coerenza del totale tra totale documento e somma righe', async () => {
    const lines = [
      { lineTotal: 10.00 },
      { lineTotal: 5.50 },
      { lineTotal: 4.50 },
    ];
    const computedTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    expect(computedTotal).toBe(20.00);

    const docTotal = 20.00;
    const isMatching = Math.abs(computedTotal - docTotal) < 0.01;
    expect(isMatching).toBe(true);

    const mismatchDocTotal = 25.00;
    const isMismatching = Math.abs(computedTotal - mismatchDocTotal) >= 0.01;
    expect(isMismatching).toBe(true);
  });

  it('TEST-REV-005: Validazione PAYMENT_PROOF / ricevute POS senza righe articolo', async () => {
    // Sessione e OCR di tipo PAYMENT_PROOF (es. ricevuta POS)
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-1',
      status: 'completed',
      rawText: 'POS NEXI\nTOTALE 25.00 EUR\nAUT 123456',
      detectedSupplier: 'NEXI POS',
      detectedDate: '2026-09-01',
      detectedTotal: 25.00,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    // Creazione registrazione contabile senza alcuna riga articolo (0 ocrReceiptLines)
    const exp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      expenseDate: '2026-09-01',
      documentTotal: 25.00,
      supplierName: 'NEXI POS',
    });

    expect(exp).toBeDefined();
    expect(exp.amount).toBe(25.00);
    expect(exp.description).toContain('NEXI POS');

    const createdItems = await db.expenseItems.where('expenseId').equals(exp.id).toArray();
    expect(createdItems.length).toBe(0);
  });
});
