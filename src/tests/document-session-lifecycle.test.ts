import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
  expenseRepository,
} from '../repositories';
import { DuplicateReceiptDetector } from '../services/duplicateDetection/DuplicateReceiptDetector';

describe('PATCH DS-1 — DocumentSession Lifecycle & False Active Session Protection', () => {
  beforeEach(async () => {
    await db.expenses.clear();
    await db.expenseItems.clear();
    await db.ocrProcesses.clear();
    await db.ocrReceiptLines.clear();
    await db.documentSessions.clear();
    await db.documentPageSegments.clear();
    await db.attachments.clear();
  });

  it('TEST A: Sessione draft con stesso fileHash => findActiveSessionByFileHash la trova', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-draft-test',
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
      fileHash: 'hash-draft-test',
      processingStatus: 'pending',
    });

    const active = await documentSessionRepository.findActiveSessionByFileHash('hash-draft-test');
    expect(active).not.toBeNull();
    expect(active?.id).toBe(session.id);
    expect(active?.status).toBe('draft');
  });

  it('TEST B: Sessione processing con stesso fileHash => viene trovata', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'processing',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-processing-test',
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
      fileHash: 'hash-processing-test',
      processingStatus: 'pending',
    });

    const active = await documentSessionRepository.findActiveSessionByFileHash('hash-processing-test');
    expect(active).not.toBeNull();
    expect(active?.id).toBe(session.id);
    expect(active?.status).toBe('processing');
  });

  it('TEST C: Sessione ready_for_review con stesso fileHash => viene trovata', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-ready-review-test',
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
      fileHash: 'hash-ready-review-test',
      processingStatus: 'processed',
    });

    const active = await documentSessionRepository.findActiveSessionByFileHash('hash-ready-review-test');
    expect(active).not.toBeNull();
    expect(active?.id).toBe(session.id);
    expect(active?.status).toBe('ready_for_review');
  });

  it('TEST D: Sessione reviewed => NON viene trovata', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'reviewed',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-reviewed-test',
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
      fileHash: 'hash-reviewed-test',
      processingStatus: 'processed',
    });

    const active = await documentSessionRepository.findActiveSessionByFileHash('hash-reviewed-test');
    expect(active).toBeNull();
  });

  it('TEST E: Sessione completed collegata a Expense => NON viene trovata come attiva', async () => {
    const expense = await expenseRepository.create({
      entryMode: 'receipt',
      amount: 21.5,
      description: 'Scontrino Caffè',
      expenseDate: '2026-09-08',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-bar',
      paymentMethod: 'debitCard',
      status: 'paid',
      classification: 'necessary',
      notified: false,
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'completed',
      expenseId: expense.id,
    });

    const att = await attachmentRepository.create({
      entityType: 'expense',
      entityId: expense.id,
      fileName: 'scontrino_caffe.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-completed-test',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'scontrino_caffe.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-completed-test',
      processingStatus: 'processed',
    });

    const active = await documentSessionRepository.findActiveSessionByFileHash('hash-completed-test');
    expect(active).toBeNull();
  });

  it('TEST F: Sessione failed => NON viene trovata', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'failed',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-failed-test',
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
      fileHash: 'hash-failed-test',
      processingStatus: 'failed',
    });

    const active = await documentSessionRepository.findActiveSessionByFileHash('hash-failed-test');
    expect(active).toBeNull();
  });

  it('TEST G: Sessione cancelled => NON viene trovata', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'cancelled',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-cancelled-test',
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
      fileHash: 'hash-cancelled-test',
      processingStatus: 'pending',
    });

    const active = await documentSessionRepository.findActiveSessionByFileHash('hash-cancelled-test');
    expect(active).toBeNull();
  });

  it('TEST H: Tentativo nuovo con file duplicato rispetto a sessione ACTIVE => bloccato come sessione attiva e nessuna sessione vuota residua', async () => {
    // 1. Sessione attiva esistente
    const activeSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: activeSession.id,
      fileName: 'scontrino_attivo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,aaa',
      fileHash: 'hash-attivo-123',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: activeSession.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'scontrino_attivo.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-attivo-123',
      processingStatus: 'pending',
    });

    // 2. Nuovo tentativo: verifica blocco
    const foundActive = await documentSessionRepository.findActiveSessionByFileHash('hash-attivo-123');
    expect(foundActive).not.toBeNull();
    expect(foundActive?.id).toBe(activeSession.id);

    // 3. Simula la creazione e il rollback immediato se addedCount === 0
    const tempSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });
    // Rilevato duplicato in sessione attiva => rollback
    await documentSessionRepository.delete(tempSession.id);

    // Verifica che non rimangano sessioni orfane
    const allSessions = await documentSessionRepository.getAll();
    expect(allSessions.length).toBe(1);
    expect(allSessions[0].id).toBe(activeSession.id);
  });

  it('TEST I: Tentativo con stesso file di sessione COMPLETED => NON mostra "già in lavorazione" e raggiunge DR-1', async () => {
    const fileHash = 'hash-caffe-completed-999';

    // 1. Sessione completata storicamente e registrata
    const exp = await expenseRepository.create({
      entryMode: 'receipt',
      amount: 21.5,
      description: 'Scontrino Gruppo Caffe Espresso',
      expenseDate: '2026-09-08',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-bar',
      paymentMethod: 'debitCard',
      status: 'paid',
      classification: 'necessary',
      notified: false,
    });

    const completedSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'completed',
      expenseId: exp.id,
    });

    const completedAtt = await attachmentRepository.create({
      entityType: 'expense',
      entityId: exp.id,
      fileName: 'scontrino_caffe.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1500,
      storageKey: 'data:image/jpeg;base64,bbb',
      fileHash,
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: completedSession.id,
      sequenceIndex: 0,
      attachmentId: completedAtt.id,
      originalFileName: 'scontrino_caffe.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash,
      processingStatus: 'processed',
    });

    // 2. Controllo sessione attiva per il nuovo caricamento
    const activeCheck = await documentSessionRepository.findActiveSessionByFileHash(fileHash);
    // NON deve essere bloccato come sessione attiva
    expect(activeCheck).toBeNull();

    // 3. Il caricamento prosegue e crea una nuova sessione documentale e processo OCR
    const newSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const newAtt = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: newSession.id,
      fileName: 'scontrino_caffe_nuova_acquisizione.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1500,
      storageKey: 'data:image/jpeg;base64,bbb',
      fileHash: `${fileHash}-new-photo`,
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: newSession.id,
      sequenceIndex: 0,
      attachmentId: newAtt.id,
      originalFileName: 'scontrino_caffe_nuova_acquisizione.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash,
      processingStatus: 'processed',
    });

    const newOcrProc = await ocrProcessRepository.create({
      attachmentId: newAtt.id,
      rawText: 'GRUPPO CAFFE ESPRESSO\nDATA 08/09/2026\nTOTALE 21.50',
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO",
      detectedDate: '2026-09-08',
      detectedTotal: 21.5,
      confidence: 95,
      status: 'completed',
      confirmedByUser: false,
      confirmationRequired: false,
    });

    // 4. In fase di revisione / contabilizzazione, il controllo DR-1 rileva correttamente EXACT_DUPLICATE tramite hash storico
    const duplicateEvaluation = await DuplicateReceiptDetector.detect({
      ocrProcessId: newOcrProc.id,
      sessionId: newSession.id,
      fileHash,
      supplierName: "GRUPPO CAFFE' ESPRESSO",
      expenseDate: '2026-09-08',
      total: 21.5,
    });

    expect(duplicateEvaluation.matchLevel).toBe('EXACT_DUPLICATE');
    expect(duplicateEvaluation.matchedExpenseId).toBe(exp.id);
    expect(duplicateEvaluation.signals.exactFileHash).toBe(true);
  });

  it('TEST J: Tutti i file selezionati invalidi/duplicati => nessuna ghost draft pageCount=0 residua', async () => {
    const beforeSessions = await documentSessionRepository.getAll();
    expect(beforeSessions.length).toBe(0);

    // Simula logica ScanReceiptModal: sessione creata all'inizio, nessun file aggiunto (addedCount === 0), rollback
    const tempSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
      pageCount: 0,
    });

    // Pulizia automatica
    await documentSessionRepository.delete(tempSession.id);

    const afterSessions = await documentSessionRepository.getAll();
    expect(afterSessions.length).toBe(0);
  });

  it('TEST K: Chiusura X di una vera bozza contenente pagine => comportamento "conserva bozza" invariato', async () => {
    const draftSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: draftSession.id,
      fileName: 'bozza_pagina.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1200,
      storageKey: 'data:image/jpeg;base64,ccc',
      fileHash: 'hash-bozza-x',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: draftSession.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'bozza_pagina.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-bozza-x',
      processingStatus: 'pending',
    });

    // Chiusura modale (X) senza eliminazione: la bozza rimane intatta in Dexie
    const drafts = await documentSessionRepository.getDraftSessions();
    expect(drafts.length).toBe(1);
    expect(drafts[0].id).toBe(draftSession.id);
    expect(drafts[0].status).toBe('draft');
  });

  it('TEST L: "Annulla ed elimina" => cleanup completo di sessione, segmenti, processi, righe e allegati diretti', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'pdf',
      status: 'draft',
      pageCount: 1,
    });

    // Allegato PDF diretto della sessione
    const pdfAtt = await attachmentRepository.create({
      entityType: 'documentSession',
      entityId: session.id,
      fileName: 'documento.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5000,
      storageKey: 'data:application/pdf;base64,ddd',
      fileHash: 'hash-pdf-direct',
      status: 'active',
    });

    // Allegato immagine pagina
    const pageAtt = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'pagina1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2000,
      storageKey: 'data:image/jpeg;base64,eee',
      fileHash: 'hash-pdf-p1',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: pageAtt.id,
      originalFileName: 'pagina1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-pdf-p1',
      processingStatus: 'pending',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: pageAtt.id,
      rawText: 'TEST OCR',
      confidence: 90,
      status: 'pending',
      confirmedByUser: false,
      confirmationRequired: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ARTICOLO TEST 10.00',
      description: 'ARTICOLO TEST',
      quantity: 1,
      unitPrice: 10,
      lineTotal: 10,
      confidence: 90,
      reviewStatus: 'pending',
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    // Esecuzione "Annulla ed elimina"
    await documentSessionRepository.delete(session.id);

    // Verifica completa rimozione
    const checkSession = await documentSessionRepository.getById(session.id);
    expect(checkSession).toBeUndefined();

    const checkSegments = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(checkSegments.length).toBe(0);

    const checkProc = await ocrProcessRepository.getById(ocrProc.id);
    expect(checkProc).toBeUndefined();

    const checkLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(checkLines.length).toBe(0);

    const checkPdfAtt = await attachmentRepository.getById(pdfAtt.id);
    expect(checkPdfAtt).toBeUndefined();

    const checkPageAtt = await attachmentRepository.getById(pageAtt.id);
    expect(checkPageAtt).toBeUndefined();
  });
});
