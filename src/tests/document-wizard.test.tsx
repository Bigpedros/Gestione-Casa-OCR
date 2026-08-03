import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  expenseRepository,
} from '../repositories';
import { backupService } from '../services/backupService';
import { computeFileHash } from '../utils/imagePreprocessing';

describe('Wizard Acquisizione Documento di Spesa (TEST-DOCUMENT-WIZARD)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST-WIZ-001: Creazione e persistenza immediata di una bozza con 1 immagine', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'draft',
      metadata: { title: 'Scontrino_Test_01' },
    });

    expect(session.id).toBeDefined();
    expect(session.status).toBe('draft');
    expect(session.processingMode).toBe('singleReceipt');

    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino_01.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 45000,
      storageKey: 'data:image/jpeg;base64,dummyData01',
      fileHash: 'hash-scontrino-01',
      status: 'active',
    });

    const segment = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: attachment.id,
      originalFileName: 'scontrino_01.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-scontrino-01',
      processingStatus: 'pending',
    });

    expect(segment.id).toBeDefined();

    const storedSession = await documentSessionRepository.getById(session.id);
    expect(storedSession?.pageCount).toBe(1);

    const drafts = await documentSessionRepository.getDraftSessions();
    expect(drafts.length).toBe(1);
    expect(drafts[0].id).toBe(session.id);
  });

  it('TEST-WIZ-002: Chiusura e recupero di sessioni bozza (singola e multiple)', async () => {
    // 1. Crea due bozze a differenti orari
    const draft1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'draft',
      metadata: { title: 'Bozza Vecchia' },
    });

    // Pausa simbolica
    await new Promise((res) => setTimeout(res, 50));

    const draft2 = await documentSessionRepository.create({
      documentType: 'invoice',
      sourceMode: 'pdf',
      processingMode: 'multiPageDocument',
      status: 'draft',
      metadata: { title: 'Bozza Recente' },
    });

    const drafts = await documentSessionRepository.getDraftSessions();
    expect(drafts.length).toBe(2);
    // Deve ordinare dalla più recente
    expect(drafts[0].id).toBe(draft2.id);
    expect(drafts[1].id).toBe(draft1.id);
  });

  it('TEST-WIZ-003: Ripresa bozza senza duplicazione della sessione', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'draft',
      metadata: { title: 'Bozza_In_Corso' },
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-100',
      originalFileName: 'page_1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-page-100',
      processingStatus: 'pending',
    });

    // Simula ripresa della sessione aggiornando la modalità ed aggiungendo una seconda pagina
    await documentSessionRepository.update(session.id, {
      processingMode: 'longReceipt',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: 'att-101',
      originalFileName: 'page_2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      fileHash: 'hash-page-101',
      processingStatus: 'pending',
    });

    const allSessions = await documentSessionRepository.getAll();
    expect(allSessions.length).toBe(1); // Nessun duplicato di sessione
    expect(allSessions[0].pageCount).toBe(2);
    expect(allSessions[0].processingMode).toBe('longReceipt');
  });

  it('TEST-WIZ-004: Eliminazione volontaria transazionale (assenza di record orfani)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'draft',
    });

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'f1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10000,
      storageKey: 'data:f1',
      fileHash: 'h1',
      status: 'active',
    });

    const att2 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'f2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10000,
      storageKey: 'data:f2',
      fileHash: 'h2',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'f1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'h1',
      processingStatus: 'pending',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: att2.id,
      originalFileName: 'f2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'h2',
      processingStatus: 'pending',
    });

    // Esegui la cancellazione transazionale della sessione
    await documentSessionRepository.delete(session.id);

    // Verifica la totale assenza di record orfani
    const sessions = await documentSessionRepository.getAll();
    const segments = await documentPageSegmentRepository.getBySessionId(session.id);
    const attachments = await attachmentRepository.getAll();

    expect(sessions.length).toBe(0);
    expect(segments.length).toBe(0);
    expect(attachments.length).toBe(0);
  });

  it('TEST-WIZ-005: Modalità scontrino lungo (longReceipt) e sovrapposizione segmenti', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'overlappingImages',
      processingMode: 'longReceipt',
      status: 'draft',
    });

    const seg1 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-long-1',
      originalFileName: 'scontrino_parte1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      fileHash: 'hash-l1',
      processingStatus: 'pending',
    });

    const seg2 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: 'att-long-2',
      originalFileName: 'scontrino_parte2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      overlapWithPrevious: true,
      fileHash: 'hash-l2',
      processingStatus: 'pending',
    });

    expect(seg1.segmentMode).toBe('overlappingSegment');
    expect(seg2.segmentMode).toBe('overlappingSegment');
    expect(seg2.overlapWithPrevious).toBe(true);
  });

  it('TEST-WIZ-006: Operazioni sulle pagine (rotazione, riordino, eliminazione, sostituzione)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'generic',
      sourceMode: 'multiplePages',
      processingMode: 'multiPageDocument',
      status: 'draft',
    });

    const s1 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-s1',
      originalFileName: 'p1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-s1',
      processingStatus: 'pending',
    });

    const s2 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: 'att-s2',
      originalFileName: 'p2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-s2',
      processingStatus: 'pending',
    });

    // Rotazione 90°
    const updatedS1 = await documentPageSegmentRepository.update(s1.id, { rotationDegrees: 90 });
    expect(updatedS1.rotationDegrees).toBe(90);

    // Riordino
    await documentPageSegmentRepository.reorder(session.id, [s2.id, s1.id]);
    const reordered = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(reordered[0].id).toBe(s2.id);
    expect(reordered[0].sequenceIndex).toBe(0);
    expect(reordered[1].id).toBe(s1.id);
    expect(reordered[1].sequenceIndex).toBe(1);

    // Eliminazione segmento s2
    await documentPageSegmentRepository.delete(s2.id);
    const afterDelete = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(afterDelete.length).toBe(1);
    expect(afterDelete[0].id).toBe(s1.id);
    expect(afterDelete[0].sequenceIndex).toBe(0);
  });

  it('TEST-WIZ-007: Rilevamento duplicato tramite hash e calcolo computeFileHash', async () => {
    const dummyFile = new File(['contenuto scontrino test'], 'test.jpg', { type: 'image/jpeg' });
    const hash1 = await computeFileHash(dummyFile);
    const hash2 = await computeFileHash(dummyFile);

    expect(hash1).toBeDefined();
    expect(hash1).toBe(hash2);

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'draft',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-hash-1',
      originalFileName: 'test.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: hash1,
      processingStatus: 'pending',
    });

    // Il tentativo di reinserire lo stesso hash solleva un'eccezione
    await expect(
      documentPageSegmentRepository.create({
        sessionId: session.id,
        sequenceIndex: 1,
        attachmentId: 'att-hash-2',
        originalFileName: 'copia_test.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: hash1,
        processingStatus: 'pending',
      })
    ).rejects.toThrow('stesso hash già presente');
  });

  it('TEST-WIZ-008: Acquisizione documento PDF (singola e multipagina)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'invoice',
      sourceMode: 'pdf',
      processingMode: 'multiPageDocument',
      status: 'draft',
    });

    const pdfAttachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'fattura_luce.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 150000,
      storageKey: 'data:application/pdf;base64,pdfDummy',
      fileHash: 'hash-pdf-01',
      status: 'active',
    });

    const pdfSegment = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: pdfAttachment.id,
      originalFileName: 'fattura_luce.pdf',
      originalMimeType: 'application/pdf',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-pdf-01',
      processingStatus: 'pending',
    });

    expect(pdfAttachment.mimeType).toBe('application/pdf');
    expect(pdfSegment.originalMimeType).toBe('application/pdf');
  });

  it('TEST-WIZ-009: Conferma finale ("Prepara per il riconoscimento"): 1 solo OCRProcess e NESSUNA spesa creata', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'draft',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'spesa.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 30000,
      storageKey: 'data:image/jpeg;base64,dummyData',
      fileHash: 'hash-final-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'spesa.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-final-01',
      processingStatus: 'pending',
    });

    // Transizione in stato ready e creazione di 1 solo OCRProcess
    await documentSessionRepository.update(session.id, { status: 'ready' });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'pending',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    const finalSession = await documentSessionRepository.getById(session.id);
    expect(finalSession?.status).toBe('ready');
    expect(finalSession?.ocrProcessId).toBe(ocrProc.id);

    const allOcr = await ocrProcessRepository.getAll();
    expect(allOcr.length).toBe(1);

    const allExpenses = await expenseRepository.getAll();
    expect(allExpenses.length).toBe(0); // Nessun Expense / ExpenseItem creato
  });

  it('TEST-WIZ-010: Backup e Ripristino di sessioni draft e ready (con campo processingMode)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'overlappingImages',
      processingMode: 'longReceipt',
      status: 'draft',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-bk-1',
      originalFileName: 'bk1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      fileHash: 'hash-bk-1',
      processingStatus: 'pending',
    });

    const json = await backupService.exportBackup();
    expect(json).toContain('documentSessions');

    await db.delete();
    await db.open();

    const val = backupService.validateBackup(json);
    expect(val.isValid).toBe(true);
    await backupService.importBackup(val.data!);

    const restored = await documentSessionRepository.getById(session.id);
    expect(restored).toBeDefined();
    expect(restored?.processingMode).toBe('longReceipt');
    expect(restored?.status).toBe('draft');
  });
});
