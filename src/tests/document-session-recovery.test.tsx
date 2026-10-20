import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
} from '../repositories';

describe('Test di Recupero e Conflitto Sessioni Documentali (TEST-DOCUMENT-SESSION-RECOVERY)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('CASO A — draft esistente: stesso fileHash rileva sessione attiva e non crea duplicati', async () => {
    const fileHash = 'hash-test-file-a-123';
    
    // Crea una sessione esistente in stato draft con un segmento avente lo stesso fileHash
    const existingSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
      metadata: { title: 'Scontrino Esistente Draft' },
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: existingSession.id,
      fileName: 'test.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,abc',
      fileHash,
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: existingSession.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'test.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash,
      processingStatus: 'pending',
    });

    // Cerca sessione attiva per fileHash escludendo una nuova sessione
    const newSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const activeFound = await documentSessionRepository.findActiveSessionByFileHash(fileHash, newSession.id);
    expect(activeFound).not.toBeNull();
    expect(activeFound?.id).toBe(existingSession.id);
    expect(activeFound?.status).toBe('draft');
  });

  it('CASO B — ready / ready_for_review con OCRProcess: rileva sessione pronta per la revisione', async () => {
    const fileHash = 'hash-test-file-b-456';

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-b',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const existingSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      ocrProcessId: ocrProc.id,
      metadata: { title: 'Scontrino Pronto per Revisione' },
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: existingSession.id,
      fileName: 'test-b.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1200,
      storageKey: 'data:image/jpeg;base64,xyz',
      fileHash,
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: existingSession.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'test-b.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash,
      processingStatus: 'processed',
    });

    const newSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const activeFound = await documentSessionRepository.findActiveSessionByFileHash(fileHash, newSession.id);
    expect(activeFound).not.toBeNull();
    expect(activeFound?.id).toBe(existingSession.id);
    expect(activeFound?.status).toBe('ready_for_review');
    expect(activeFound?.ocrProcessId).toBe(ocrProc.id);
  });

  it('CASO C — elimina precedente: sessione non registrata cancellata transazionalmente', async () => {
    const existingSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: existingSession.id,
      fileName: 'test-c.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,abc',
      fileHash: 'hash-c',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: existingSession.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'test-c.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-c',
      processingStatus: 'pending',
    });

    // Elimina sessione
    await documentSessionRepository.delete(existingSession.id);

    const checkSession = await documentSessionRepository.getById(existingSession.id);
    expect(checkSession).toBeUndefined();

    const checkAtt = await attachmentRepository.getById(att.id);
    expect(checkAtt).toBeUndefined();

    const checkSegs = await documentPageSegmentRepository.getBySessionId(existingSession.id);
    expect(checkSegs.length).toBe(0);
  });

  it('CASO D — documento già registrato: expenseId presente vieta la cancellazione', async () => {
    const existingSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'reviewed',
      expenseId: 'exp-123',
    });

    await expect(documentSessionRepository.delete(existingSession.id)).rejects.toThrow(
      /già registrata a bilancio/i
    );

    const checkSession = await documentSessionRepository.getById(existingSession.id);
    expect(checkSession).toBeDefined();
  });

  it('CASO E — tentativo duplicato: nessun record orfano o sessione vuota lasciata', async () => {
    const fileHash = 'hash-duplicate-test';

    const existingSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: existingSession.id,
      fileName: 'dup.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,dup',
      fileHash,
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: existingSession.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'dup.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash,
      processingStatus: 'pending',
    });

    // Simula tentata creazione di nuova sessione vuota prima di intercettare il duplicato
    const newEmptySession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    expect(newEmptySession.pageCount).toBe(0);

    // Quando viene intercettato il duplicato, se la sessione è vuota viene ripulita
    const segs = await documentPageSegmentRepository.getBySessionId(newEmptySession.id);
    if (segs.length === 0 && !newEmptySession.ocrProcessId) {
      await documentSessionRepository.delete(newEmptySession.id);
    }

    const checkEmpty = await documentSessionRepository.getById(newEmptySession.id);
    expect(checkEmpty).toBeUndefined();
  });

  it('CASO F — sessione terminale reviewed/cancelled/failed: non blocca nuove acquisizioni', async () => {
    const terminalSessions = ['reviewed', 'failed', 'cancelled'] as const;

    for (const status of terminalSessions) {
      const fileHash = `hash-terminal-file-${status}`;

      const sess = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        status,
      });

      const att = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: sess.id,
        fileName: 'term.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 500,
        storageKey: 'data:image/jpeg;base64,term',
        fileHash,
        status: 'active',
      });

      await documentPageSegmentRepository.create({
        sessionId: sess.id,
        sequenceIndex: 0,
        attachmentId: att.id,
        originalFileName: 'term.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash,
        processingStatus: 'processed',
      });

      const newSession = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        status: 'draft',
      });

      const activeFound = await documentSessionRepository.findActiveSessionByFileHash(fileHash, newSession.id);
      expect(activeFound).toBeNull();
    }
  });
});
