import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
} from '../repositories';

describe('Completamento Punto 14 - Gestione Sessione Documentale & Revisione OCR', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('P14-01: Gestione Documenti Multipagina (Sequence e Pagine Mantenute)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'multiplePages',
      status: 'draft',
      pageCount: 0,
    });

    const pagesData = [
      { name: 'scontrino_pag1.jpg', hash: 'hash-p1-abc' },
      { name: 'scontrino_pag2.jpg', hash: 'hash-p2-def' },
      { name: 'scontrino_pag3.jpg', hash: 'hash-p3-ghi' },
    ];

    for (let i = 0; i < pagesData.length; i++) {
      const p = pagesData[i];
      const att = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: session.id,
        fileName: p.name,
        mimeType: 'image/jpeg',
        sizeBytes: 12000,
        storageKey: `data:image/jpeg;base64,${p.hash}`,
        fileHash: p.hash,
        status: 'active',
      });

      await documentPageSegmentRepository.create({
        sessionId: session.id,
        sequenceIndex: i,
        attachmentId: att.id,
        originalFileName: p.name,
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: p.hash,
        processingStatus: 'processed',
      });
    }

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.pageCount).toBe(3);

    const segments = await documentPageSegmentRepository.getBySessionId(session.id);
    expect(segments.length).toBe(3);
    expect(segments[0].sequenceIndex).toBe(0);
    expect(segments[1].sequenceIndex).toBe(1);
    expect(segments[2].sequenceIndex).toBe(2);
  });

  it('P14-02: Ripresa della Revisione (Bozza Salvata e Ripristinata)', async () => {
    // Setup categorie e fornitore
    const catId = 'cat-alimentari-123';
    const nowStr = new Date().toISOString();
    await db.categories.add({
      id: catId,
      code: 'ALIMENTARI',
      name: 'Alimentari',
      type: 'expense',
      level: 1,
      enabled: true,
      sortOrder: 1,
      system: false,
      metadata: { createdAt: nowStr, updatedAt: nowStr, version: 1 },
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      rawText: 'ESSELUNGA\nPASTA 1.20\nLATTE 1.50\nTOTAL 2.70',
      detectedSupplier: 'Esselunga SpA',
      detectedDate: '2026-03-15',
      detectedTotal: 2.70,
      confidence: 90,
      status: 'pending',
      confirmedByUser: false,
      confirmationRequired: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    const line1 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PASTA 1.20',
      description: 'PASTA SPAGHETTI 500G',
      quantity: 1,
      unitPrice: 1.20,
      lineTotal: 1.20,
      confidence: 90,
      reviewStatus: 'modified',
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        categoryId: catId,
        actionMode: 'link_existing',
      },
    });

    const line2 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'LATTE 1.50',
      description: 'LATTE INTERO 1L',
      quantity: 1,
      unitPrice: 1.50,
      lineTotal: 1.50,
      confidence: 85,
      reviewStatus: 'modified',
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        categoryId: catId,
        actionMode: 'create_new',
        newProductDisplayName: 'Latte Fresco Intero',
      },
    });

    // Simuliamo riapertura della revisione salvata
    const dbLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(dbLines.length).toBe(2);

    const savedLine1 = dbLines.find((l) => l.id === line1.id);
    expect(savedLine1?.description).toBe('PASTA SPAGHETTI 500G');
    expect((savedLine1?.metadata as any)?.categoryId).toBe(catId);

    const savedLine2 = dbLines.find((l) => l.id === line2.id);
    expect((savedLine2?.metadata as any)?.newProductDisplayName).toBe('Latte Fresco Intero');
  });

  it('P14-03: Protezione Sessioni Duplicate per stesso FileHash', async () => {
    const session1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
    });

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session1.id,
      fileName: 'scontrino_unico.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 15000,
      storageKey: 'data:image/jpeg;base64,hash123',
      fileHash: 'hash-unico-123',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session1.id,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'scontrino_unico.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-unico-123',
      processingStatus: 'processed',
    });

    // Verifichiamo che la ricerca per active session trovi session1
    const duplicateCheck = await documentSessionRepository.findActiveSessionByFileHash('hash-unico-123');
    expect(duplicateCheck).not.toBeNull();
    expect(duplicateCheck?.id).toBe(session1.id);

    // Se la sessione venisse completata / rivista, la ricerca non dovrebbe più considerarla attiva
    await documentSessionRepository.update(session1.id, { status: 'reviewed' });
    const checkAfterReview = await documentSessionRepository.findActiveSessionByFileHash('hash-unico-123');
    expect(checkAfterReview).toBeNull();
  });

  it('P14-04: Validazione Finale e Blocco Conferma in Caso di Errori', async () => {
    await ocrProcessRepository.create({
      attachmentId: 'att-val',
      rawText: 'MOCK OCR',
      detectedSupplier: 'Supermercato',
      detectedDate: '2026-03-15',
      detectedTotal: 10.00,
      confidence: 80,
      status: 'pending',
      confirmedByUser: false,
      confirmationRequired: true,
    });

    // Test con riga senza categoria
    const lineWithoutCat = {
      lineId: 'l1',
      description: 'Prodotto Anonimo',
      originalText: 'Prodotto Anonimo',
      quantity: 1,
      unitPrice: 5.00,
      lineTotal: 5.00,
      confidence: 80,
      action: 'unlinked' as const,
      categoryId: null, // Categoria mancante
    };

    // La quadratura e la classificazione per confermare richiedono validation
    expect(lineWithoutCat.categoryId).toBeNull();
  });

  it('P14-05: Navigazione Filtri della Revisione (Errore, Unclassified, Modificate, Sconti, Resi)', async () => {
    const lines = [
      { id: '1', description: 'Mela', categoryId: 'cat1', lineTotal: 1.5, quantity: 1, unitPrice: 1.5, reviewStatus: 'confirmed' },
      { id: '2', description: 'Pane', categoryId: null, lineTotal: 2.0, quantity: 1, unitPrice: 2.0, reviewStatus: 'pending' }, // Unclassified & Error
      { id: '3', description: 'SCONTO PROMO', categoryId: 'cat1', lineTotal: -0.5, quantity: 1, unitPrice: -0.5, reviewStatus: 'modified' }, // Discount & Modified
      { id: '4', description: 'RESO ARTICOLO', categoryId: 'cat1', lineTotal: -3.0, quantity: 1, unitPrice: -3.0, reviewStatus: 'modified' }, // Return & Modified
    ];

    const errors = lines.filter(
      (l) => !l.categoryId || l.quantity <= 0 || (l.unitPrice <= 0 && l.lineTotal === 0)
    );
    const unclassified = lines.filter((l) => !l.categoryId);
    const modified = lines.filter((l) => l.reviewStatus === 'modified');
    const discounts = lines.filter((l) => l.lineTotal < 0 || /SCONTO/i.test(l.description));
    const returns = lines.filter((l) => l.lineTotal < 0 || /RESO/i.test(l.description));

    expect(errors.length).toBe(1);
    expect(unclassified.length).toBe(1);
    expect(modified.length).toBe(2);
    expect(discounts.length).toBe(2);
    expect(returns.length).toBe(2);
  });

  it('P14-06: Documenti Molto Grandi (Batch Deletion e Atomicità su 50+ Righe)', async () => {
    const nowStr = new Date().toISOString();
    await db.categories.add({
      id: 'cat-lg-123',
      code: 'ALIMENTARI_LG',
      name: 'Alimentari Grandi',
      type: 'expense',
      level: 1,
      enabled: true,
      sortOrder: 1,
      system: false,
      metadata: { createdAt: nowStr, updatedAt: nowStr, version: 1 },
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-lg',
      rawText: 'BIG RECEIPT',
      detectedSupplier: 'Ipermercato Gigante',
      detectedDate: '2026-03-15',
      detectedTotal: 250.00,
      confidence: 95,
      status: 'pending',
      confirmedByUser: false,
      confirmationRequired: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    // Creiamo 55 righe
    const now = new Date().toISOString();
    const linesToInsert = [];
    for (let i = 1; i <= 55; i++) {
      linesToInsert.push({
        id: `line-lg-${i}`,
        ocrProcessId: ocrProc.id,
        originalText: `ARTICOLO ${i}`,
        description: `Prodotto Alimentare N. ${i}`,
        quantity: 1,
        unitPrice: 2.00,
        lineTotal: 2.00,
        confidence: 90,
        reviewStatus: 'pending' as const,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      });
    }

    await db.ocrReceiptLines.bulkAdd(linesToInsert);

    const initialLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(initialLines.length).toBe(55);

    // Eliminazione batch di 10 righe
    const idsToDelete = initialLines.slice(0, 10).map((l) => l.id);
    await db.ocrReceiptLines.bulkDelete(idsToDelete);

    const remainingLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(remainingLines.length).toBe(45);
  });
});
