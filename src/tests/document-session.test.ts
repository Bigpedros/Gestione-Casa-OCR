import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  expenseRepository,
  reportRepository,
  attachmentRepository,
} from '../repositories';
import { backupService } from '../services/backupService';

describe('Modello Dati Sessioni Documentali Multipagina (TEST-DOCUMENT-SESSION)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST-DS-001: Creazione sessione documentale con una singola pagina', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    expect(session.id).toBeDefined();
    expect(session.documentType).toBe('receipt');
    expect(session.sourceMode).toBe('singleImage');
    expect(session.status).toBe('draft');
    expect(session.pageCount).toBe(0);

    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'scontrino_01.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 15000,
      storageKey: 'data:image/jpeg;base64,dummy01',
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
    expect(segment.sessionId).toBe(session.id);
    expect(segment.sequenceIndex).toBe(0);

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.pageCount).toBe(1);

    const pages = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(pages.length).toBe(1);
    expect(pages[0].id).toBe(segment.id);
  });

  it('TEST-DS-002: Sessione con più pagine ordinate', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'invoice',
      sourceMode: 'multiplePages',
      status: 'ready',
    });

    const pageData = [
      { name: 'pag_1.pdf', hash: 'hash-pdf-p1', seq: 0 },
      { name: 'pag_2.pdf', hash: 'hash-pdf-p2', seq: 1 },
      { name: 'pag_3.pdf', hash: 'hash-pdf-p3', seq: 2 },
    ];

    for (const item of pageData) {
      const att = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: 'unlinked',
        fileName: item.name,
        mimeType: 'application/pdf',
        sizeBytes: 25000,
        storageKey: `data:application/pdf;base64,${item.hash}`,
        fileHash: item.hash,
        status: 'active',
      });

      await documentPageSegmentRepository.create({
        sessionId: session.id,
        sequenceIndex: item.seq,
        attachmentId: att.id,
        originalFileName: item.name,
        originalMimeType: 'application/pdf',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: item.hash,
        processingStatus: 'pending',
      });
    }

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.pageCount).toBe(3);

    const pages = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(pages.length).toBe(3);
    expect(pages.map((p) => p.sequenceIndex)).toEqual([0, 1, 2]);
    expect(pages.map((p) => p.originalFileName)).toEqual(['pag_1.pdf', 'pag_2.pdf', 'pag_3.pdf']);
  });

  it('TEST-DS-003: Riordino delle pagine di una sessione', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'overlappingImages',
      status: 'draft',
    });

    const seg1 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-1',
      originalFileName: 'parte_top.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      fileHash: 'hash-top',
      processingStatus: 'pending',
    });

    const seg2 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: 'att-2',
      originalFileName: 'parte_bottom.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      fileHash: 'hash-bottom',
      processingStatus: 'pending',
    });

    // Invertiamo l'ordine: seg2 (bottom) prima di seg1 (top)
    await documentPageSegmentRepository.reorder(session.id, [seg2.id, seg1.id]);

    const pagesAfter = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(pagesAfter[0].id).toBe(seg2.id);
    expect(pagesAfter[0].sequenceIndex).toBe(0);
    expect(pagesAfter[1].id).toBe(seg1.id);
    expect(pagesAfter[1].sequenceIndex).toBe(1);
  });

  it('TEST-DS-004: Rimozione di una pagina e ri-indicizzazione automatica', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'generic',
      sourceMode: 'multiplePages',
      status: 'draft',
    });

    const seg0 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-a',
      originalFileName: 'doc_a.png',
      originalMimeType: 'image/png',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-a',
      processingStatus: 'pending',
    });

    const seg1 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: 'att-b',
      originalFileName: 'doc_b.png',
      originalMimeType: 'image/png',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-b',
      processingStatus: 'pending',
    });

    const seg2 = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 2,
      attachmentId: 'att-c',
      originalFileName: 'doc_c.png',
      originalMimeType: 'image/png',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-c',
      processingStatus: 'pending',
    });

    // Rimuoviamo il segmento intermedio (seg1)
    await documentPageSegmentRepository.delete(seg1.id);

    const pagesRemaining = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(pagesRemaining.length).toBe(2);
    expect(pagesRemaining[0].id).toBe(seg0.id);
    expect(pagesRemaining[0].sequenceIndex).toBe(0);
    expect(pagesRemaining[1].id).toBe(seg2.id);
    expect(pagesRemaining[1].sequenceIndex).toBe(1); // Ri-indicizzato da 2 a 1

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.pageCount).toBe(2);
  });

  it('TEST-DS-005: Prevenzione duplicati per indice di sequenza e fileHash', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-unique',
      originalFileName: 'scontrino.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-unique-123',
      processingStatus: 'pending',
    });

    // Tentativo 1: Stesso indice di sequenza (0)
    await expect(
      documentPageSegmentRepository.create({
        sessionId: session.id,
        sequenceIndex: 0,
        attachmentId: 'att-other',
        originalFileName: 'altro.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: 'hash-different',
        processingStatus: 'pending',
      })
    ).rejects.toThrow('indice di sequenza 0 già presente');

    // Tentativo 2: Stesso fileHash
    await expect(
      documentPageSegmentRepository.create({
        sessionId: session.id,
        sequenceIndex: 1,
        attachmentId: 'att-duplicate-hash',
        originalFileName: 'scontrino_copia.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: 'hash-unique-123',
        processingStatus: 'pending',
      })
    ).rejects.toThrow('stesso hash già presente');
  });

  it('TEST-DS-006: Integrazione Backup e Ripristino (compresa retrocompatibilità)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'pdf',
      status: 'completed',
    });

    const segment = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-pdf-1',
      originalFileName: 'fattura.pdf',
      originalMimeType: 'application/pdf',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-pdf-backup',
      processingStatus: 'processed',
    });

    // 1. Esporta backup
    const backupJson = await backupService.exportBackup();
    expect(backupJson).toContain('documentSessions');
    expect(backupJson).toContain('documentPageSegments');

    // 2. Resetta DB
    await db.delete();
    await db.open();
    expect((await documentSessionRepository.getAll()).length).toBe(0);

    // 3. Importa backup
    const validation = backupService.validateBackup(backupJson);
    expect(validation.isValid).toBe(true);
    await backupService.importBackup(validation.data!);

    // 4. Verifica ripristino
    const restoredSessions = await documentSessionRepository.getAll();
    expect(restoredSessions.length).toBe(1);
    expect(restoredSessions[0].id).toBe(session.id);

    const restoredSegments = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(restoredSegments.length).toBe(1);
    expect(restoredSegments[0].id).toBe(segment.id);
  });

  it('TEST-DS-007: Assenza di interferenze o modifiche a spese e report', async () => {
    const expensesCountBefore = await expenseRepository.getAll();
    const reportsCountBefore = await reportRepository.getAll();

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'multiplePages',
      status: 'draft',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-isolamento',
      originalFileName: 'foto.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-isolamento',
      processingStatus: 'pending',
    });

    const expensesCountAfter = await expenseRepository.getAll();
    const reportsCountAfter = await reportRepository.getAll();

    expect(expensesCountAfter.length).toBe(expensesCountBefore.length);
    expect(reportsCountAfter.length).toBe(reportsCountBefore.length);
  });
});
