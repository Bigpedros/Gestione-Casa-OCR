import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { ocrService } from '../services/ocrService';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  expenseRepository,
} from '../repositories';
import { OCRProgress } from '../types';

describe('Motore OCR Local-First (TEST-OCR-ENGINE)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    ocrService.setMockEngine(null);
  });

  it('TEST-OCR-001: Riconoscimento documento singolo (1 pagina)', async () => {
    // Mock del motore per restituire testo noto in ambiente test
    ocrService.setMockEngine(async (_storageKey) => {
      return {
        text: 'SUPERMERCATO DESPAR\nSCONTRINO FISCALE\nTOTALE EURO 24.50',
        confidence: 92,
      };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino_single.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 35000,
      storageKey: 'data:image/jpeg;base64,dummySingleImageData',
      fileHash: 'hash-single-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'scontrino_single.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-single-01',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    expect(ocrProcess.id).toBeDefined();
    expect(ocrProcess.status).toBe('completed');
    expect(ocrProcess.rawText).toContain('SUPERMERCATO DESPAR');
    expect(ocrProcess.rawText).toContain('TOTALE EURO 24.50');
    expect(ocrProcess.confidence).toBe(92);
    expect(ocrProcess.processedAt).toBeDefined();
    expect(ocrProcess.errorMessage).toBeNull();

    // Verifiche architetturali vincolanti
    expect(ocrProcess.detectedSupplier).toBeUndefined();
    expect(ocrProcess.detectedDate).toBeUndefined();
    expect(ocrProcess.detectedTotal).toBeUndefined();

    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(0); // Nessuna spesa creata!
  });

  it('TEST-OCR-002: Riconoscimento multipagina con concatenazione in ordine di sequenceIndex', async () => {
    ocrService.setMockEngine(async (_storageKey, pageIndex) => {
      if (pageIndex === 0) {
        return { text: 'FATTURA N. 1024\nPAGINA 1 DI 2\nIMPORTO PARZIALE 100.00', confidence: 95 };
      }
      return { text: 'PAGINA 2 DI 2\nIVA 22% 22.00\nTOTALE FATTURA 122.00', confidence: 90 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'invoice',
      sourceMode: 'multiplePages',
      processingMode: 'multiPageDocument',
      status: 'ready',
    });

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'pag1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 40000,
      storageKey: 'data:image/jpeg;base64,pag1',
      fileHash: 'hash-multi-01',
      status: 'active',
    });

    const att2 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'pag2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42000,
      storageKey: 'data:image/jpeg;base64,pag2',
      fileHash: 'hash-multi-02',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'pag1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-multi-01',
      processingStatus: 'pending',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: att2.id,
      originalFileName: 'pag2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-multi-02',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    expect(ocrProcess.status).toBe('completed');
    expect(ocrProcess.rawText).toContain('PAGINA 1 DI 2');
    expect(ocrProcess.rawText).toContain('PAGINA 2 DI 2');
    // Verifica che il testo di pagina 1 sia prima di pagina 2
    const posPage1 = ocrProcess.rawText!.indexOf('PAGINA 1 DI 2');
    const posPage2 = ocrProcess.rawText!.indexOf('PAGINA 2 DI 2');
    expect(posPage1).toBeGreaterThan(-1);
    expect(posPage2).toBeGreaterThan(posPage1);

    expect(ocrProcess.confidence).toBe(93); // Media tra 95 e 90
  });

  it('TEST-OCR-003: Scontrino lungo (longReceipt) concatenazione senza rimozione sovrapposizione', async () => {
    ocrService.setMockEngine(async (_storageKey, pageIndex) => {
      if (pageIndex === 0) {
        return { text: 'SUPERMERCATO CONAD\nLATTE BISCRO\nPANE FRESCO', confidence: 88 };
      }
      return { text: 'PANE FRESCO\nPASTA BARILLA\nSUBTOTALE 15.80', confidence: 86 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'overlappingImages',
      processingMode: 'longReceipt',
      status: 'ready',
    });

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'part1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 30000,
      storageKey: 'data:image/jpeg;base64,part1',
      fileHash: 'hash-long-01',
      status: 'active',
    });

    const att2 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'part2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 31000,
      storageKey: 'data:image/jpeg;base64,part2',
      fileHash: 'hash-long-02',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'part1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      fileHash: 'hash-long-01',
      processingStatus: 'pending',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: att2.id,
      originalFileName: 'part2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      overlapWithPrevious: true,
      fileHash: 'hash-long-02',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    expect(ocrProcess.status).toBe('completed');
    expect(ocrProcess.rawText).toContain('LATTE BISCRO');
    expect(ocrProcess.rawText).toContain('PASTA BARILLA');
  });

  it('TEST-OCR-004: Monitoraggio della progressione durante il riconoscimento', async () => {
    ocrService.setMockEngine(async (_storageKey, pageIndex, _totalPages, onProgressPct) => {
      onProgressPct(50);
      onProgressPct(100);
      return { text: `Pagina ${pageIndex + 1}`, confidence: 90 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'generic',
      sourceMode: 'multiplePages',
      processingMode: 'multiPageDocument',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'prog.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 20000,
      storageKey: 'data:image/jpeg;base64,prog',
      fileHash: 'hash-prog-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'prog.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-prog-01',
      processingStatus: 'pending',
    });

    const progressUpdates: OCRProgress[] = [];
    await ocrService.recognize(session.id, (prog) => {
      progressUpdates.push({ ...prog });
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.some((p) => p.status === 'loading_model')).toBe(true);
    expect(progressUpdates.some((p) => p.status === 'completed')).toBe(true);

    const lastProgress = progressUpdates[progressUpdates.length - 1];
    expect(lastProgress.progressPercentage).toBe(100);
    expect(lastProgress.status).toBe('completed');
  });

  it('TEST-OCR-005: Annullamento dell elaborazione e rilascio risorse', async () => {
    let cancelCalled = false;

    ocrService.setMockEngine(async (_storageKey, pageIndex) => {
      if (pageIndex === 1) {
        // Durante la seconda pagina invochiamo il cancel
        await ocrService.cancel(sessionId);
        cancelCalled = true;
      }
      return { text: `Pagina ${pageIndex + 1}`, confidence: 80 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'multiplePages',
      processingMode: 'multiPageDocument',
      status: 'ready',
    });
    const sessionId = session.id;

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: sessionId,
      fileName: 'c1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 15000,
      storageKey: 'data:image/jpeg;base64,c1',
      fileHash: 'hash-c-01',
      status: 'active',
    });

    const att2 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: sessionId,
      fileName: 'c2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 15000,
      storageKey: 'data:image/jpeg;base64,c2',
      fileHash: 'hash-c-02',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'c1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-c-01',
      processingStatus: 'pending',
    });

    await documentPageSegmentRepository.create({
      sessionId,
      sequenceIndex: 1,
      attachmentId: att2.id,
      originalFileName: 'c2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-c-02',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(sessionId);

    expect(cancelCalled).toBe(true);
    expect(ocrProcess.status).toBe('failed');
    expect(ocrProcess.errorMessage).toContain('annullata');

    const updatedSession = await documentSessionRepository.getById(sessionId);
    expect(updatedSession?.status).toBe('draft');
  });

  it('TEST-OCR-006: Gestione errori per documento vuoto (0 segmenti)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    await expect(ocrService.recognize(session.id)).rejects.toThrow('Documento vuoto');

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('failed');

    const ocrProcesses = await ocrProcessRepository.getAll();
    expect(ocrProcesses.length).toBe(1);
    expect(ocrProcesses[0].status).toBe('failed');
    expect(ocrProcesses[0].errorMessage).toContain('Documento vuoto');
  });

  it('TEST-OCR-007: Gestione errori per allegato/immagine mancante', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-non-esistente',
      originalFileName: 'missing.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-missing',
      processingStatus: 'pending',
    });

    await expect(ocrService.recognize(session.id)).rejects.toThrow('Allegato non trovato');

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('failed');
  });

  it('TEST-OCR-008: Tassativa assenza di interpretazione e di creazione spese', async () => {
    ocrService.setMockEngine(async () => {
      return {
        text: 'ESSELUNGA S.P.A.\n12/05/2026\nPASTA RUMMO 1.20\nCARNE BOVINA 8.50\nTOTALE 9.70',
        confidence: 94,
      };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'esselunga.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 50000,
      storageKey: 'data:image/jpeg;base64,esselunga',
      fileHash: 'hash-esselunga',
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
      fileHash: 'hash-esselunga',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    // Verifiche:
    // 1. rawText presente
    expect(ocrProcess.rawText).toContain('TOTALE 9.70');
    // 2. Nessun dato interpretato in questa fase
    expect(ocrProcess.detectedSupplier).toBeUndefined();
    expect(ocrProcess.detectedDate).toBeUndefined();
    expect(ocrProcess.detectedTotal).toBeUndefined();
    // 3. Nessuna spesa o voce di spesa creata
    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(0);
  });
});
