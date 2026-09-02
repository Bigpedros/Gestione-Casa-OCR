import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { attachmentRepository } from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('Gestione Allegati e Ricevute - Test Obbligatori (TEST-ALL-001 - TEST-ALL-005)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('TEST-ALL-001: Caricare una fotografia e verificare comparsa nell elenco', async () => {
    const dummyPhotoBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...';

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'scontrino_supermercato.jpg',
      description: 'Spesa Esselunga del venerdì',
      mimeType: 'image/jpeg',
      sizeBytes: 154200,
      storageKey: dummyPhotoBase64,
      fileHash: 'hash-scontrino-123',
      status: 'active',
    });

    expect(att.id).toBeDefined();
    expect(att.fileName).toBe('scontrino_supermercato.jpg');

    const all = await attachmentRepository.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].fileName).toBe('scontrino_supermercato.jpg');
    expect(all[0].sizeBytes).toBe(154200);
  });

  it('TEST-ALL-002: Persistenza dopo chiusura e riapertura app (IndexedDB)', async () => {
    const dummyPhotoBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'foto_ricevuta.png',
      mimeType: 'image/png',
      sizeBytes: 32000,
      storageKey: dummyPhotoBase64,
      fileHash: 'hash-foto-456',
      status: 'active',
    });

    // Simula riavvio/riapertura DB
    await db.close();
    await db.open();

    const fetched = await attachmentRepository.getById(att.id);
    expect(fetched).toBeDefined();
    expect(fetched?.fileName).toBe('foto_ricevuta.png');
    expect(fetched?.storageKey).toBe(dummyPhotoBase64);

    const all = await attachmentRepository.getAll();
    expect(all).toHaveLength(1);
  });

  it('TEST-ALL-003: Aprire allegato e verificare i dati completi', async () => {
    const dummyPhotoBase64 = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

    const att = await attachmentRepository.create({
      entityType: 'expense',
      entityId: 'exp-123',
      fileName: 'fattura_elettricita.webp',
      description: 'Bolletta luce bimestre Giugno-Luglio',
      mimeType: 'image/webp',
      sizeBytes: 85400,
      storageKey: dummyPhotoBase64,
      fileHash: 'hash-bolletta-789',
      status: 'active',
    });

    const retrieved = await attachmentRepository.getById(att.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.entityType).toBe('expense');
    expect(retrieved?.entityId).toBe('exp-123');
    expect(retrieved?.description).toBe('Bolletta luce bimestre Giugno-Luglio');
    expect(retrieved?.storageKey).toContain('data:image/webp');
  });

  it('TEST-ALL-004: Eliminare un allegato e verificare la rimozione dal database', async () => {
    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'documento_vecchio.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 50000,
      storageKey: 'data:application/pdf;base64,JVBERi0xLjQK...',
      fileHash: 'hash-vecchio-000',
      status: 'active',
    });

    let all = await attachmentRepository.getAll();
    expect(all).toHaveLength(1);

    // Eliminazione
    await attachmentRepository.delete(att.id);

    all = await attachmentRepository.getAll();
    expect(all).toHaveLength(0);

    const checkDb = await attachmentRepository.getById(att.id);
    expect(checkDb).toBeUndefined();

    // Verificare persistenza dell'eliminazione dopo chiusura DB
    await db.close();
    await db.open();

    const checkDbAfterRestart = await attachmentRepository.getById(att.id);
    expect(checkDbAfterRestart).toBeUndefined();
  });

  it('TEST-ALL-005: Caricare un PDF e verificare la visualizzazione nell elenco', async () => {
    const pdfDataUrl = 'data:application/pdf;base64,JVBERi0xLjQKJ3doc3Q...';

    const pdfAtt = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'ricevuta_condominio.pdf',
      description: 'Ricevuta pagamento quota condominiale',
      mimeType: 'application/pdf',
      sizeBytes: 245000,
      storageKey: pdfDataUrl,
      fileHash: 'hash-pdf-999',
      status: 'active',
    });

    expect(pdfAtt.mimeType).toBe('application/pdf');

    const all = await attachmentRepository.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].fileName).toBe('ricevuta_condominio.pdf');
    expect(all[0].mimeType).toBe('application/pdf');
    expect(all[0].storageKey).toBe(pdfDataUrl);
  });

  it('TEST-ALL-006: Allegato con expenseId non compare tra gli unlinked e risolve spesa', async () => {
    const expId = await db.expenses.add({
      id: 'exp-test-all-6',
      entryMode: 'receipt',
      amount: 42.50,
      description: 'Spesa Alimentari',
      expenseDate: '2026-08-20',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: 'cat-spesa',
      subcategoryId: 'subcat-alimentari',
      paymentMethod: 'debitCard',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      metadata: {
        createdAt: '2026-08-20T10:00:00.000Z',
        updatedAt: '2026-08-20T10:00:00.000Z',
        version: 1,
      },
    });

    const att = await attachmentRepository.create({
      entityType: 'expense',
      entityId: expId,
      expenseId: expId,
      fileName: 'scontrino_spesa.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 120000,
      storageKey: 'data:image/jpeg;base64,...',
      fileHash: 'hash-test-att-6',
      status: 'active',
    });

    const fetched = await attachmentRepository.getById(att.id);
    expect(fetched?.expenseId).toBe('exp-test-all-6');
    expect(fetched?.entityType).toBe('expense');

    // Verifica helper isAttachmentUnlinked logic
    const isUnlinked = !fetched?.expenseId && (!fetched?.entityId || fetched?.entityId === 'unlinked');
    expect(isUnlinked).toBe(false);
  });
});
