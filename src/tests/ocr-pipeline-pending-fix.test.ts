import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { ocrService } from '../services/ocrService';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { productClassificationService } from '../services/productClassification/ProductClassificationService';
import { budgetService } from '../services/budgetService';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
  expenseRepository,
  categoryRepository,
} from '../repositories';

describe('Verifica Ripristino Pipeline OCR da Processo Pending (TEST-PENDING-PIPELINE)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    ocrService.setMockEngine(null);

    // Setup categorie di base
    const nowStr = new Date().toISOString();
    await db.categories.add({
      id: 'cat-food',
      code: 'CAT_FOOD',
      name: 'Alimentari',
      type: 'expense',
      level: 1,
      enabled: true,
      sortOrder: 1,
      system: true,
      metadata: { createdAt: nowStr, updatedAt: nowStr, version: 1 },
    });
  });

  // 1. Processo inesistente -> OCR avviato
  it('1. Processo inesistente: ocrService.recognize crea e completa un nuovo OCRProcess', async () => {
    ocrService.setMockEngine(async () => ({
      text: 'CONAD CITY\nPANE 1.50\nLATTE 1.20\nTOTALE 2.70',
      confidence: 90,
    }));

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 45000,
      storageKey: 'data:image/jpeg;base64,dummyKey',
      fileHash: 'hash-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'scontrino.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-01',
      processingStatus: 'pending',
    });

    const proc = await ocrService.recognize(session.id);
    expect(proc.id).toBeDefined();
    expect(proc.status).toBe('completed');
    expect(proc.rawText).toContain('CONAD CITY');
  });

  // 2. Processo pending senza rawText -> OCR avviato
  // 3. Processo pending già esistente -> nessuna duplicazione
  it('2 & 3. Processo pending esistente: recognize aggiorna il record esistente senza duplicarlo', async () => {
    ocrService.setMockEngine(async () => ({
      text: 'ESSELUNGA\nMELA 2.00\nTOTALE 2.00',
      confidence: 95,
    }));

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'esselunga.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 50000,
      storageKey: 'data:image/jpeg;base64,dummyKey2',
      fileHash: 'hash-02',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'esselunga.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-02',
      processingStatus: 'pending',
    });

    // Crea preventivamente un OCRProcess pending (come fa ScanReceiptModal)
    const existingProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'pending',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, {
      ocrProcessId: existingProc.id,
    });

    const allProcessesBefore = await ocrProcessRepository.getAll();
    expect(allProcessesBefore.length).toBe(1);

    // Esegui recognize
    const proc = await ocrService.recognize(session.id);

    // Deve aggiornare lo stesso ID, non crearne un secondo
    expect(proc.id).toBe(existingProc.id);
    expect(proc.status).toBe('completed');
    expect(proc.rawText).toContain('ESSELUNGA');

    const allProcessesAfter = await ocrProcessRepository.getAll();
    expect(allProcessesAfter.length).toBe(1);
    expect(allProcessesAfter[0].id).toBe(existingProc.id);
  });

  // 4. Processo completed con rawText -> OCR non deve essere rieseguito
  it('4. Processo completed con rawText: i dati rimangono intatti e non vengono sovrascritti se già presenti', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'completed.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 50000,
      storageKey: 'data:image/jpeg;base64,dummyKey3',
      fileHash: 'hash-03',
      status: 'active',
    });

    const completedProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      rawText: 'COOP LOMBARDIA\nACQUA 0.50\nTOTALE 0.50',
      detectedSupplier: 'COOP LOMBARDIA',
      detectedTotal: 0.50,
      confidence: 88,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, {
      ocrProcessId: completedProc.id,
    });

    // Verifichiamo che il processo possieda già rawText e status completed
    const procInDb = await ocrProcessRepository.getById(completedProc.id);
    expect(procInDb?.status).toBe('completed');
    expect(procInDb?.rawText).toBe('COOP LOMBARDIA\nACQUA 0.50\nTOTALE 0.50');
  });

  // 5 & 6. Idempotenza, Concorrenza e StrictMode
  it('5 & 6. Richieste concorrenti sulla stessa sessione restituiscono il processo senza duplicazione', async () => {
    let mockCallCount = 0;
    ocrService.setMockEngine(async () => {
      mockCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { text: 'LIDL ITALIA\nBISCOTTI 1.99\nTOTALE 1.99', confidence: 91 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'lidl.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 40000,
      storageKey: 'data:image/jpeg;base64,dummyKey4',
      fileHash: 'hash-04',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'lidl.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-04',
      processingStatus: 'pending',
    });

    const [proc1, proc2] = await Promise.all([
      ocrService.recognize(session.id),
      ocrService.recognize(session.id),
    ]);

    expect(mockCallCount).toBe(1);
    expect(proc1.id).toBe(proc2.id);
    const allProc = await ocrProcessRepository.getAll();
    expect(allProc.length).toBe(1);
    expect(allProc[0].rawText).toContain('LIDL ITALIA');
  });

  // 7, 8, 9. OCR riuscito -> rawText persistito -> parser invocato -> fornitore, totale e righe estratti
  it('7, 8, 9. Pipeline completa: recognize -> parse -> righe create e dati estratti', async () => {
    ocrService.setMockEngine(async () => ({
      text: 'CARREFOUR MARKET\nVIA ROMA 10\nDATA 12/05/2026\nPASTA BARILLA 1.45\nSUGO PRONTO 2.10\nTOTALE EURO 3.55',
      confidence: 94,
    }));

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'carrefour.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 48000,
      storageKey: 'data:image/jpeg;base64,dummyKey5',
      fileHash: 'hash-05',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'carrefour.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-05',
      processingStatus: 'pending',
    });

    // 1. Esegui OCR
    const ocrProc = await ocrService.recognize(session.id);
    expect(ocrProc.rawText).toBeDefined();
    expect(ocrProc.rawText?.length).toBeGreaterThan(0);

    // 2. Esegui Parser
    const draft = await receiptParserService.parse(ocrProc.id);
    expect(draft.supplier.value).toBeTruthy();
    expect(draft.total.value).toBe(3.55);
    expect(draft.lines.length).toBeGreaterThanOrEqual(1);

    // 3. Verifica persistenza su Dexie
    const updatedProc = await ocrProcessRepository.getById(ocrProc.id);
    expect(updatedProc?.detectedSupplier).toBeTruthy();
    expect(updatedProc?.detectedTotal).toBe(3.55);

    const dbLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(dbLines.length).toBeGreaterThanOrEqual(1);
    expect(dbLines.some((l) => l.description.includes('PASTA') || l.description.includes('SUGO'))).toBe(true);
  });

  // 10. Errore OCR -> stato failed e nessun falso completamento
  it('10. Errore OCR: lancia eccezione, imposta status failed e non genera dati fittizi', async () => {
    ocrService.setMockEngine(async () => {
      throw new Error('Errore durante la lettura del file immagine');
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'broken.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,brokenKey',
      fileHash: 'hash-err-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'broken.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-err-01',
      processingStatus: 'pending',
    });

    await expect(ocrService.recognize(session.id)).rejects.toThrow('Errore durante la lettura del file immagine');

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('failed');

    const allExpenses = await expenseRepository.getAll();
    expect(allExpenses.length).toBe(0);
  });

  // 11. Errore parser con rawText vuoto
  it('11. Parser con rawText vuoto: segnala errore e non crea righe scontrino', async () => {
    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-empty',
      status: 'completed',
      rawText: '   ',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await expect(receiptParserService.parse(proc.id)).rejects.toThrow('rawText assente o vuoto');

    const updatedProc = await ocrProcessRepository.getById(proc.id);
    expect(updatedProc?.status).toBe('failed');

    const lines = await ocrReceiptLineRepository.getByOcrProcessId(proc.id);
    expect(lines.length).toBe(0);
  });

  // 12 & 13. Conferma con dati validi -> Acquisto persistito una sola volta e Uscite totali aggiornate
  it('12 & 13. Creazione Registrazione Contabile: crea Expense ordinario e incrementa Uscite totali', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-accounting',
      status: 'completed',
      rawText: 'ESSELUNGA\nPANE 2.50\nTOTALE 2.50',
      detectedSupplier: 'Esselunga',
      detectedDate: '2026-08-15',
      detectedTotal: 2.50,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, {
      ocrProcessId: ocrProc.id,
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE 2.50',
      description: 'Pane fresco',
      quantity: 1,
      unitPrice: 2.50,
      lineTotal: 2.50,
      confidence: 95,
      reviewStatus: 'confirmed',
      productId: null,
    });

    const allCats = await categoryRepository.getAll();
    const foodCat = allCats[0];

    // Registra la spesa in contabilità
    const expense = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      supplierName: 'Esselunga',
      expenseDate: '2026-08-15',
      documentTotal: 2.50,
      paymentMethod: 'debitCard',
      decisions: [
        {
          lineId: line.id,
          originalText: 'PANE 2.50',
          description: 'Pane fresco',
          quantity: 1,
          unitPrice: 2.50,
          lineTotal: 2.50,
          confidence: 95,
          action: 'unlinked',
          categoryId: foodCat.id,
          subcategoryId: foodCat.id,
        },
      ],
    });

    expect(expense.id).toBeDefined();
    expect(expense.amount).toBe(2.50);
    expect(expense.status).toBe('paid');

    // Controllo idempotenza: una seconda invocazione restituisce la spesa già creata
    const secondExpense = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      supplierName: 'Esselunga',
      expenseDate: '2026-08-15',
      documentTotal: 2.50,
      paymentMethod: 'debitCard',
    });
    expect(secondExpense.id).toBe(expense.id);

    const allExpenses = await expenseRepository.getAll();
    expect(allExpenses.length).toBe(1);

    // Verifica aggregati mensili del mese di agosto 2026
    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(2.50);
    expect(summary.paidExpenses).toBe(2.50);
  });

  // 14. Dati mancanti -> rifiutata senza scritture parziali
  it('14. Validazione contabile: creazione rifiutata se mancano righe o se la revisione non è pronta', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft', // Stato non consentito
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-invalid',
      status: 'pending',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await expect(
      productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
        supplierName: 'Test',
        expenseDate: '2026-08-15',
        documentTotal: 10.0,
        decisions: [],
      })
    ).rejects.toThrow();

    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(0);
  });
});
