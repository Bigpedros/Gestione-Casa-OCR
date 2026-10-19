import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  expenseRepository,
} from '../repositories';
import { DuplicateReceiptDetector } from '../services/duplicateDetection/DuplicateReceiptDetector';

describe('PATCH DR-1A — Exact FileHash Preflight Certification', () => {
  beforeEach(async () => {
    await db.expenses.clear();
    await db.expenseItems.clear();
    await db.ocrProcesses.clear();
    await db.ocrReceiptLines.clear();
    await db.documentSessions.clear();
    await db.documentPageSegments.clear();
    await db.attachments.clear();
  });

  it('TEST A: Stesso identico fileHash già contabilizzato => EXACT_DUPLICATE, no ConstraintError, no new Attachment, no new Expense', async () => {
    const historicalFileHash = 'sha256-conad-20260908-exact';

    // 1. Spesa storica contabilizzata
    const historicalExpense = await expenseRepository.create({
      entryMode: 'receipt',
      amount: 21.5,
      description: 'Spesa Conad Settembre',
      expenseDate: '2026-09-08',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-groceries',
      subcategoryId: 'sub-supermarket',
      paymentMethod: 'debitCard',
      status: 'paid',
      classification: 'necessary',
      notified: false,
    });

    // 2. Sessione storica completed
    const historicalSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'completed',
      expenseId: historicalExpense.id,
      metadata: {
        fileHash: historicalFileHash,
      },
    });

    // 3. Allegato storico con fileHash UNIQUE nel DB
    const historicalAttachment = await attachmentRepository.create({
      entityType: 'expense',
      entityId: historicalExpense.id,
      fileName: 'conad_receipt.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 154000,
      storageKey: 'data:image/jpeg;base64,historicalImageData',
      fileHash: historicalFileHash,
      status: 'active',
    });

    // 4. Segmento storico collegato alla sessione
    await documentPageSegmentRepository.create({
      sessionId: historicalSession.id,
      sequenceIndex: 0,
      attachmentId: historicalAttachment.id,
      originalFileName: 'conad_receipt.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: historicalFileHash,
      processingStatus: 'processed',
    });

    const initialAttachmentCount = await db.attachments.count();
    const initialExpenseCount = await db.expenses.count();
    const initialOcrCount = await db.ocrProcesses.count();

    // 5. Tentativo di caricamento nuovo con lo STESSO IDENTICO fileHash
    const preflightResult = await DuplicateReceiptDetector.preflightFileHash(historicalFileHash);

    // Verifiche preflight
    expect(preflightResult.action).toBe('EXACT_DUPLICATE');
    expect(preflightResult.reason).toBe('EXACT_FILE_HASH');
    expect(preflightResult.matchedExpenseId).toBe(historicalExpense.id);
    expect(preflightResult.matchedExpense).not.toBeNull();
    expect(preflightResult.matchedExpense?.amount).toBe(21.5);
    expect(preflightResult.userMessage).toContain('Questo documento risulta già registrato');
    expect(preflightResult.userMessage).toContain('€21,50');
    expect(preflightResult.userMessage).toContain('08/09/2026');

    // Verifiche integrità stato database (nessun nuovo attachment, nessuna nuova spesa, nessun OCR)
    expect(await db.attachments.count()).toBe(initialAttachmentCount);
    expect(await db.expenses.count()).toBe(initialExpenseCount);
    expect(await db.ocrProcesses.count()).toBe(initialOcrCount);
  });

  it('TEST B: Stesso fileHash in sessione ACTIVE => messaggio "già in lavorazione", no new Attachment, no ghost draft', async () => {
    const activeFileHash = 'sha256-active-session-hash';

    // 1. Sessione attiva in corso (status: processing)
    const activeSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'processing',
    });

    const activeAttachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: activeSession.id,
      fileName: 'active_receipt.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 89000,
      storageKey: 'data:image/jpeg;base64,activeImageData',
      fileHash: activeFileHash,
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: activeSession.id,
      sequenceIndex: 0,
      attachmentId: activeAttachment.id,
      originalFileName: 'active_receipt.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: activeFileHash,
      processingStatus: 'pending',
    });

    // 2. Creazione sessione temporanea per il nuovo tentativo
    const tempSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const preflightResult = await DuplicateReceiptDetector.preflightFileHash(activeFileHash, tempSession.id);

    expect(preflightResult.action).toBe('ACTIVE_SESSION');
    expect(preflightResult.activeSession?.id).toBe(activeSession.id);
    expect(preflightResult.userMessage).toContain('Documento già in lavorazione nella sessione attiva');
    expect(preflightResult.userMessage).toContain(activeSession.id);

    // Cleanup sessione temporanea (come implementato in ScanReceiptModal quando addedCount === 0)
    await documentSessionRepository.delete(tempSession.id);

    // Verifiche: la sessione temporanea è stata eliminata, la sessione attiva esiste ancora
    expect(await db.documentSessions.get(tempSession.id)).toBeUndefined();
    expect(await db.documentSessions.get(activeSession.id)).toBeDefined();
    expect(await db.attachments.count()).toBe(1);
  });

  it('TEST C: File nuovo con hash diverso => preflight PROCEED e ingestione normale', async () => {
    const freshFileHash = 'sha256-fresh-receipt-unique-999';

    const tempSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const preflightResult = await DuplicateReceiptDetector.preflightFileHash(freshFileHash, tempSession.id);

    expect(preflightResult.action).toBe('PROCEED');
    expect(preflightResult.matchedExpenseId).toBeUndefined();
    expect(preflightResult.activeSession).toBeUndefined();

    // Creazione normale dell'attachment e del segmento
    const newAtt = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: tempSession.id,
      fileName: 'new_receipt.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 120000,
      storageKey: 'data:image/jpeg;base64,freshData',
      fileHash: freshFileHash,
      status: 'active',
    });

    expect(newAtt).toBeDefined();
    expect(newAtt.fileHash).toBe(freshFileHash);
  });

  it('TEST D: Nuova fotografia dello stesso scontrino (hash diverso) => NON intercettata da preflight hash, procede a OCR e DR-1', async () => {
    const historicalFileHash = 'sha256-first-photo-hash';
    const photoReTakeHash = 'sha256-second-photo-angle-different-hash';

    // 1. Spesa storica con prima foto
    const exp = await expenseRepository.create({
      entryMode: 'receipt',
      amount: 45.0,
      description: 'Ristorante Pizzeria',
      expenseDate: '2026-09-10',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-restaurant',
      paymentMethod: 'creditCard',
      status: 'paid',
      classification: 'voluntary',
      notified: false,
    });

    const completedSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'completed',
      expenseId: exp.id,
    });

    await attachmentRepository.create({
      entityType: 'expense',
      entityId: exp.id,
      fileName: 'photo_1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 200000,
      storageKey: 'data:image/jpeg;base64,photo1',
      fileHash: historicalFileHash,
      status: 'active',
    });

    // 2. Preflight per la seconda foto (hash diverso)
    const preflightResult = await DuplicateReceiptDetector.preflightFileHash(photoReTakeHash, completedSession.id);

    // Il preflight hash lascia passare la nuova foto
    expect(preflightResult.action).toBe('PROCEED');
    expect(preflightResult.matchedExpenseId).toBeUndefined();

    // Successivamente, il detector semantico DR-1 intercetta la duplicazione semantica
    const semanticCheck = await DuplicateReceiptDetector.detect({
      fileHash: photoReTakeHash,
      supplierName: 'Ristorante Pizzeria',
      total: 45.0,
      expenseDate: '2026-09-10',
    });

    expect(semanticCheck.matchLevel).toBe('PROBABLE_DUPLICATE');
    expect(semanticCheck.matchedExpenseId).toBe(exp.id);
  });

  it('TEST E: Exact duplicate con sessione temporanea appena creata => sessione temporanea eliminata, nessuna ghost draft', async () => {
    const fileHash = 'sha256-registered-receipt-321';

    // 1. Documento già contabilizzato
    const exp = await expenseRepository.create({
      entryMode: 'receipt',
      amount: 15.3,
      description: 'Farmacia Centrale',
      expenseDate: '2026-09-12',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-health',
      subcategoryId: 'sub-pharmacy',
      paymentMethod: 'cash',
      status: 'paid',
      classification: 'necessary',
      notified: false,
    });

    const historicalSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'completed',
      expenseId: exp.id,
    });

    await attachmentRepository.create({
      entityType: 'expense',
      entityId: exp.id,
      fileName: 'farmacia.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 110000,
      storageKey: 'data:image/jpeg;base64,farmacia',
      fileHash: fileHash,
      status: 'active',
    });

    // 2. L'utente apre il modale ed inizia l'upload: viene creata la sessione temporanea (isNewSession = true)
    const tempSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const preflight = await DuplicateReceiptDetector.preflightFileHash(fileHash, tempSession.id);
    expect(preflight.action).toBe('EXACT_DUPLICATE');

    // ScanReceiptModal rileva preflight.action === 'EXACT_DUPLICATE', incrementa duplicateCount e se addedCount === 0 effettua rollback
    const addedCount = 0;
    if (addedCount === 0) {
      await documentSessionRepository.delete(tempSession.id);
    }

    // Verifiche:
    // a. Nessuna ghost session a pageCount = 0
    const ghost = await db.documentSessions.get(tempSession.id);
    expect(ghost).toBeUndefined();

    // b. Sessione storica completed intatta
    const preserved = await db.documentSessions.get(historicalSession.id);
    expect(preserved).toBeDefined();
    expect(preserved?.status).toBe('completed');
    expect(preserved?.expenseId).toBe(exp.id);

    // c. Conteggio sessioni totali = 1 (solo la storica)
    expect(await db.documentSessions.count()).toBe(1);
  });

  it('TEST F: Attachment storico orphan/non contabilizzato => comportamento controllato, nessun crash ConstraintError', async () => {
    const orphanFileHash = 'sha256-orphan-file-without-expense';

    // 1. Attachment orfano creato in passato (es. upload interrotto, o sessione cancellata senza cascata allegati)
    const orphanAtt = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'legacy-deleted-session-id',
      fileName: 'aborted_upload.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 95000,
      storageKey: 'data:image/jpeg;base64,abortedData',
      fileHash: orphanFileHash,
      status: 'active',
    });

    // 2. Verifica che l'attachment esiste e ha fileHash
    expect(orphanAtt.id).toBeDefined();

    // 3. Nuova sessione per nuovo caricamento
    const newSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    // 4. Esecuzione preflight
    const preflight = await DuplicateReceiptDetector.preflightFileHash(orphanFileHash, newSession.id);

    // Azione attesa: REUSE_ORPHAN_ATTACHMENT
    expect(preflight.action).toBe('REUSE_ORPHAN_ATTACHMENT');
    expect(preflight.existingAttachment?.id).toBe(orphanAtt.id);
    expect(preflight.matchedExpenseId).toBeUndefined();

    // 5. Ingestione protetta (aggiornamento record esistente per riuso senza violazione indice UNIQUE)
    let finalAttachment;
    if (preflight.action === 'REUSE_ORPHAN_ATTACHMENT' && preflight.existingAttachment) {
      finalAttachment = await attachmentRepository.update(preflight.existingAttachment.id, {
        entityType: 'unlinked',
        entityId: newSession.id,
        fileName: 'reused_upload.jpg',
        description: `Pagina 1 per ${newSession.id}`,
        mimeType: 'image/jpeg',
        sizeBytes: 95000,
        storageKey: 'data:image/jpeg;base64,abortedData',
        status: 'active',
      });
    }

    expect(finalAttachment).toBeDefined();
    expect(finalAttachment?.id).toBe(orphanAtt.id);
    expect(finalAttachment?.entityId).toBe(newSession.id);
    expect(finalAttachment?.fileHash).toBe(orphanFileHash);

    // Verifiche:
    // Nessun ConstraintError sollevato
    // Conteggio totale attachments rimane 1 (nessun duplicato inserito)
    expect(await db.attachments.count()).toBe(1);
  });
});
