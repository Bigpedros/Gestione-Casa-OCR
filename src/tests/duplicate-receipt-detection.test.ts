import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { DuplicateReceiptDetector } from '../services/duplicateDetection/DuplicateReceiptDetector';
import { ProductClassificationService } from '../services/productClassification/ProductClassificationService';
import { lateExpenseService } from '../services/lateExpenseService';
import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  expenseRepository,
  supplierRepository,
} from '../repositories';

describe('PATCH DR-1 — Duplicate Receipt Detection & Accounting Protection Suite', () => {
  const classificationService = new ProductClassificationService();

  beforeEach(async () => {
    await db.delete();
    await db.open();

    // Inizializza categorie di base
    await db.categories.bulkAdd([
      {
        id: 'cat-food',
        code: 'CAT_FOOD',
        name: 'Alimentari e Spesa',
        type: 'expense',
        level: 1,
        enabled: true,
        system: true,
        sortOrder: 1,
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      },
      {
        id: 'sub-groceries',
        code: 'SUB_GROCERIES',
        name: 'Supermercato',
        parentId: 'cat-food',
        type: 'expense',
        level: 2,
        enabled: true,
        system: true,
        sortOrder: 1,
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      },
    ]);
  });

  // TEST A: Stesso identico fileHash dopo sessione completed => EXACT_DUPLICATE
  it('TEST A — Stesso identico fileHash dopo sessione completed restituisce EXACT_DUPLICATE', async () => {
    const fileHash = 'sha256-hash-documento-fisico-123456';

    const session1 = await documentSessionRepository.create({
      status: 'completed',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const attachment1 = await attachmentRepository.create({
      fileName: 'scontrino1.jpg',
      fileHash,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      storageKey: 'storage-1',
      status: 'active',
      entityType: 'expense',
      entityId: '',
    });

    await documentPageSegmentRepository.create({
      sessionId: session1.id,
      sequenceIndex: 0,
      attachmentId: attachment1.id,
      originalFileName: 'scontrino1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash,
      processingStatus: 'processed',
    });

    const ocrProc1 = await ocrProcessRepository.create({
      attachmentId: attachment1.id,
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: 'SUPERMERCATO CONAD',
      detectedDate: '2026-09-08',
      detectedTotal: 21.50,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc1.id,
      originalText: 'CAFFE ESPRESSO 21.50',
      description: 'CAFFE ESPRESSO',
      quantity: 1,
      unitPrice: 21.50,
      lineTotal: 21.50,
      confidence: 95,
      reviewStatus: 'confirmed',
    });

    await documentSessionRepository.update(session1.id, { ocrProcessId: ocrProc1.id });

    // Registra prima spesa
    const expense1 = await classificationService.createAccountingRegistration({
      ocrProcessId: ocrProc1.id,
      sessionId: session1.id,
      expenseDate: '2026-09-08',
      documentTotal: 21.50,
    });

    expect(expense1).toBeDefined();

    // Nuova sessione 2 che acquisisce lo STESSO fileHash
    const session2 = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    await documentPageSegmentRepository.create({
      sessionId: session2.id,
      sequenceIndex: 0,
      attachmentId: attachment1.id,
      originalFileName: 'scontrino2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash,
      processingStatus: 'processed',
    });

    const ocrProc2 = await ocrProcessRepository.create({
      attachmentId: attachment1.id,
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: 'SUPERMERCATO CONAD',
      detectedDate: '2026-09-08',
      detectedTotal: 21.50,
    });

    await documentSessionRepository.update(session2.id, { ocrProcessId: ocrProc2.id });

    // Rilevamento duplicato
    const detectResult = await DuplicateReceiptDetector.detect({
      ocrProcessId: ocrProc2.id,
      sessionId: session2.id,
      fileHash,
      supplierName: 'SUPERMERCATO CONAD',
      expenseDate: '2026-09-08',
      total: 21.50,
    });

    expect(detectResult.matchLevel).toBe('EXACT_DUPLICATE');
    expect(detectResult.confidenceScore).toBe(100);
    expect(detectResult.matchedExpenseId).toBe(expense1.id);
    expect(detectResult.signals.exactFileHash).toBe(true);
  });

  // TEST B: Nuova fotografia dello stesso scontrino (hash diverso), stesso fornitore/data/totale + fingerprint righe quasi identico => EXACT_DUPLICATE
  it('TEST B — Nuova foto con fileHash diverso ma fornitore, data, totale e righe coincidenti => EXACT_DUPLICATE', async () => {
    // Spesa 1 esistente
    const expense1 = await expenseRepository.create({
      entryMode: 'receipt',
      description: 'Scontrino DESPAR',
      amount: 15.80,
      expenseDate: '2026-09-10',
      paymentDate: '2026-09-10',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-groceries',
      paymentMethod: 'cash',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });

    await db.expenseItems.bulkAdd([
      {
        id: 'ei-1',
        expenseId: expense1.id,
        description: 'LATTE PARMALAT 1L',
        quantity: 2,
        unitPrice: 1.90,
        total: 3.80,
        categoryId: 'cat-food',
        subcategoryId: 'sub-groceries',
        classification: 'necessary',
        classificationSource: 'automatic',
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      },
      {
        id: 'ei-2',
        expenseId: expense1.id,
        description: 'PASTA BARILLA 500G',
        quantity: 3,
        unitPrice: 1.20,
        total: 3.60,
        categoryId: 'cat-food',
        subcategoryId: 'sub-groceries',
        classification: 'necessary',
        classificationSource: 'automatic',
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      },
      {
        id: 'ei-3',
        expenseId: expense1.id,
        description: 'BISCOTTI MULINO BIANCO',
        quantity: 2,
        unitPrice: 4.20,
        total: 8.40,
        categoryId: 'cat-food',
        subcategoryId: 'sub-groceries',
        classification: 'necessary',
        classificationSource: 'automatic',
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      },
    ]);

    // Nuovo scontrino ri-fotografato (hash nuovo)
    const detectResult = await DuplicateReceiptDetector.detect({
      fileHash: 'sha256-nuova-foto-angolazione-diversa-999',
      supplierName: 'DESPAR',
      expenseDate: '2026-09-10',
      total: 15.80,
      lines: [
        { description: 'LATTE PARMALAT 1 L', quantity: 2, unitPrice: 1.90, lineTotal: 3.80 },
        { description: 'PASTA BARILLA 500 GR', quantity: 3, unitPrice: 1.20, lineTotal: 3.60 },
        { description: 'BISCOTTI MULINO BIANCO', quantity: 2, unitPrice: 4.20, lineTotal: 8.40 },
      ],
    });

    expect(detectResult.matchLevel).toBe('EXACT_DUPLICATE');
    expect(detectResult.confidenceScore).toBeGreaterThanOrEqual(95);
    expect(detectResult.matchedExpenseId).toBe(expense1.id);
    expect(detectResult.signals.lineItemsSimilarity).toBeGreaterThanOrEqual(0.75);
    expect(detectResult.signals.sameDate).toBe(true);
    expect(detectResult.signals.sameTotal).toBe(true);
  });

  // TEST C: Stesso fornitore/data/totale + stessa ora ma righe non disponibili => PROBABLE_DUPLICATE, NON EXACT
  it('TEST C — Stesso fornitore/data/totale + stessa ora ma righe non disponibili => PROBABLE_DUPLICATE (NON EXACT)', async () => {
    const expense1 = await expenseRepository.create({
      entryMode: 'receipt',
      description: 'Scontrino BAR CENTRALE',
      amount: 4.50,
      expenseDate: '2026-09-12',
      paymentDate: '2026-09-12',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-groceries',
      paymentMethod: 'cash',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        detectedTime: '09:15',
      } as any,
    });

    // Nuovo scontrino con stessa ora 09:15 ma nessuna riga estratta
    const detectResult = await DuplicateReceiptDetector.detect({
      supplierName: 'BAR CENTRALE',
      expenseDate: '2026-09-12',
      time: '09:15',
      total: 4.50,
      lines: [], // Righe non disponibili
    });

    expect(detectResult.matchLevel).toBe('PROBABLE_DUPLICATE');
    expect(detectResult.matchLevel).not.toBe('EXACT_DUPLICATE');
    expect(detectResult.confidenceScore).toBe(88);
    expect(detectResult.matchedExpenseId).toBe(expense1.id);
    expect(detectResult.signals.sameTime).toBe(true);
  });

  // TEST D: Stesso fornitore/data/totale, ora assente => PROBABLE_DUPLICATE
  it('TEST D — Stesso fornitore/data/totale con ora assente => PROBABLE_DUPLICATE', async () => {
    const expense1 = await expenseRepository.create({
      entryMode: 'receipt',
      description: 'Scontrino FARMACIA CENTRALE',
      amount: 18.20,
      expenseDate: '2026-09-14',
      paymentDate: '2026-09-14',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-groceries',
      paymentMethod: 'cash',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });

    const detectResult = await DuplicateReceiptDetector.detect({
      supplierName: 'FARMACIA CENTRALE',
      expenseDate: '2026-09-14',
      total: 18.20,
      time: null, // Ora assente
      lines: [],
    });

    expect(detectResult.matchLevel).toBe('PROBABLE_DUPLICATE');
    expect(detectResult.confidenceScore).toBe(80);
    expect(detectResult.matchedExpenseId).toBe(expense1.id);
    expect(detectResult.signals.sameTime).toBeNull();
  });

  // TEST E: Stesso fornitore/data/totale, ora differente e righe differenti => NO_DUPLICATE o confidenza ridotta
  it('TEST E — Stesso fornitore/data/totale con orario distante e righe differenti => NO_DUPLICATE', async () => {
    const expense1 = await expenseRepository.create({
      entryMode: 'receipt',
      description: 'Scontrino BAR ESPRESSO',
      amount: 3.50,
      expenseDate: '2026-09-15',
      paymentDate: '2026-09-15',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-groceries',
      paymentMethod: 'cash',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        detectedTime: '08:00', // Mattina
      } as any,
    });

    await db.expenseItems.bulkAdd([
      {
        id: 'ei-e1',
        expenseId: expense1.id,
        description: 'CAPPUCCIO E CORNETTO',
        quantity: 1,
        unitPrice: 3.50,
        total: 3.50,
        categoryId: 'cat-food',
        subcategoryId: 'sub-groceries',
        classification: 'necessary',
        classificationSource: 'automatic',
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      },
    ]);

    // Nuovo scontrino serale con prodotti differenti (es. trancio pizza)
    const detectResult = await DuplicateReceiptDetector.detect({
      supplierName: 'BAR ESPRESSO',
      expenseDate: '2026-09-15',
      time: '18:30', // Sera (+10 ore e mezza)
      total: 3.50,
      lines: [{ description: 'TRANCIO PIZZA MARGHERITA', quantity: 1, unitPrice: 3.50, lineTotal: 3.50 }],
    });

    expect(detectResult.matchLevel).toBe('NO_DUPLICATE');
    expect(detectResult.confidenceScore).toBeLessThan(50);
  });

  // TEST F: Nomi OCR diversi ma stesso supplier/taxId o normalizzazione equivalente => riconoscimento corretto
  it('TEST F — Nomi OCR diversi ma stesso supplier con alias/normalizzazione => riconoscimento duplicato corretto', async () => {
    const supplier = await supplierRepository.create({
      name: 'ESSELUNGA S.P.A.',
      aliases: ['ESSELUNGA', 'ESSELUNGA MILANO', 'ESSELUNGA SUPERSTORE'],
      status: 'confirmed',
    });

    const expense1 = await expenseRepository.create({
      entryMode: 'receipt',
      supplierId: supplier.id,
      description: 'Scontrino ESSELUNGA S.P.A.',
      amount: 42.10,
      expenseDate: '2026-09-16',
      paymentDate: '2026-09-16',
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-food',
      subcategoryId: 'sub-groceries',
      paymentMethod: 'cash',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
    });

    // Test con variante OCR "ESSELUNGA SUPERSTORE"
    const detectResult = await DuplicateReceiptDetector.detect({
      supplierName: 'ESSELUNGA SUPERSTORE',
      expenseDate: '2026-09-16',
      total: 42.10,
    });

    expect(detectResult.matchLevel).toBe('PROBABLE_DUPLICATE');
    expect(detectResult.matchedExpenseId).toBe(expense1.id);
    expect(detectResult.signals.sameSupplier).toBe(true);
  });

  // TEST G: Due acquisti reali distinti stesso negozio/data/importo con prodotti differenti => NON bloccare come EXACT; eventuale PROBABLE con override
  it('TEST G — Due acquisti reali distinti stesso negozio/data/importo con prodotti differenti => NON blocca come EXACT e permette allowProbableDuplicate', async () => {
    // Spesa 1: Spesa mattutina al Conad (€ 10.00) con Latte e Biscotti
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-g1',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: 'CONAD CITY',
      detectedDate: '2026-09-16',
      detectedTotal: 10.00,
    });

    await ocrReceiptLineRepository.bulkCreate([
      {
        ocrProcessId: proc1.id,
        originalText: 'LATTE FRESCO 2.50',
        description: 'LATTE FRESCO',
        quantity: 2,
        unitPrice: 2.50,
        lineTotal: 5.00,
        confidence: 90,
        reviewStatus: 'confirmed',
      },
      {
        ocrProcessId: proc1.id,
        originalText: 'BISCOTTI FROLLINI 5.00',
        description: 'BISCOTTI FROLLINI',
        quantity: 1,
        unitPrice: 5.00,
        lineTotal: 5.00,
        confidence: 90,
        reviewStatus: 'confirmed',
      },
    ]);

    const exp1 = await classificationService.createAccountingRegistration({
      ocrProcessId: proc1.id,
      expenseDate: '2026-09-16',
      documentTotal: 10.00,
      supplierName: 'CONAD CITY',
    });

    expect(exp1).toBeDefined();

    // Spesa 2: Altro acquisto pomeridiano al Conad (€ 10.00) con Detersivo piatti e Candeggina
    const proc2 = await ocrProcessRepository.create({
      attachmentId: 'att-g2',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: 'CONAD CITY',
      detectedDate: '2026-09-16',
      detectedTotal: 10.00,
    });

    await ocrReceiptLineRepository.bulkCreate([
      {
        ocrProcessId: proc2.id,
        originalText: 'DETERSIVO PIATTI 4.00',
        description: 'DETERSIVO PIATTI',
        quantity: 1,
        unitPrice: 4.00,
        lineTotal: 4.00,
        confidence: 90,
        reviewStatus: 'confirmed',
      },
      {
        ocrProcessId: proc2.id,
        originalText: 'CANDEGGINA IGIENIZZANTE 6.00',
        description: 'CANDEGGINA IGIENIZZANTE',
        quantity: 1,
        unitPrice: 6.00,
        lineTotal: 6.00,
        confidence: 90,
        reviewStatus: 'confirmed',
      },
    ]);

    // Senza override esplicito, la safety contabile protegge con DUPLICATE_RECEIPT_PROBABLE (ma NON EXACT)
    await expect(
      classificationService.createAccountingRegistration({
        ocrProcessId: proc2.id,
        expenseDate: '2026-09-16',
        documentTotal: 10.00,
        supplierName: 'CONAD CITY',
      })
    ).rejects.toThrow(/DUPLICATE_RECEIPT_PROBABLE/);

    // Con allowProbableDuplicate: true, la registrazione contabile avviene con successo
    const exp2 = await classificationService.createAccountingRegistration({
      ocrProcessId: proc2.id,
      expenseDate: '2026-09-16',
      documentTotal: 10.00,
      supplierName: 'CONAD CITY',
      allowProbableDuplicate: true,
    });

    expect(exp2).toBeDefined();
    expect(exp2.id).not.toBe(exp1.id);
    expect((exp2.metadata as any)?.probableDuplicateOverridden).toBe(true);
    expect((exp2.metadata as any)?.matchedDuplicateExpenseId).toBe(exp1.id);

    const allExpenses = await db.expenses.toArray();
    expect(allExpenses.length).toBe(2);
  });

  // TEST H: CASO REALE GRUPPO CAFFE' ESPRESSO: seconda acquisizione dopo prima Expense completed => rilevata prima di creare la seconda Expense
  it('TEST H — CASO REALE GRUPPO CAFFE\' ESPRESSO: seconda acquisizione dello stesso scontrino rilevata e bloccata', async () => {
    // Sessione 1: GRUPPO CAFFE' ESPRESSO del 08/09/2026, totale € 21,50
    const session1 = await documentSessionRepository.create({
      status: 'completed',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc1 = await ocrProcessRepository.create({
      attachmentId: 'att-espresso-1',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO",
      detectedDate: '2026-09-08',
      detectedTotal: 21.50,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc1.id,
      originalText: 'CAFFE MISCELA BAR 21.50',
      description: 'CAFFE MISCELA BAR',
      quantity: 1,
      unitPrice: 21.50,
      lineTotal: 21.50,
      confidence: 98,
      reviewStatus: 'confirmed',
    });

    await documentSessionRepository.update(session1.id, { ocrProcessId: ocrProc1.id });

    // Contabilizza prima spesa
    const exp1 = await classificationService.createAccountingRegistration({
      ocrProcessId: ocrProc1.id,
      sessionId: session1.id,
      supplierName: "GRUPPO CAFFE' ESPRESSO",
      expenseDate: '2026-09-08',
      documentTotal: 21.50,
    });

    expect(exp1.id).toBeDefined();

    // Sessione 2: Seconda scansione identica (nuova sessione, nuovo processo)
    const session2 = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc2 = await ocrProcessRepository.create({
      attachmentId: 'att-espresso-2',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO",
      detectedDate: '2026-09-08',
      detectedTotal: 21.50,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc2.id,
      originalText: 'CAFFE MISCELA BAR 21.50',
      description: 'CAFFE MISCELA BAR',
      quantity: 1,
      unitPrice: 21.50,
      lineTotal: 21.50,
      confidence: 98,
      reviewStatus: 'confirmed',
    });

    await documentSessionRepository.update(session2.id, { ocrProcessId: ocrProc2.id });

    // Tentativo di creare la seconda registrazione contabile: DEVE BLOCCARE prima di creare l'Expense
    await expect(
      classificationService.createAccountingRegistration({
        ocrProcessId: ocrProc2.id,
        sessionId: session2.id,
        supplierName: "GRUPPO CAFFE' ESPRESSO",
        expenseDate: '2026-09-08',
        documentTotal: 21.50,
      })
    ).rejects.toThrow(/DUPLICATE_RECEIPT_EXACT/);

    // Verifica che nel DB sia rimasta ESATTAMENTE UNA SOLA SPESA
    const totalExpenses = await db.expenses.toArray();
    expect(totalExpenses.length).toBe(1);
    expect(totalExpenses[0].id).toBe(exp1.id);
  });

  // TEST I: Doppio click sulla stessa sessione => continua a essere idempotente
  it('TEST I — Doppio click sulla stessa sessione continua a restituire la spesa esistente in modo trasparente', async () => {
    const session = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-idemp',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: true,
      detectedSupplier: 'SUPERMERCATO TEST',
      detectedDate: '2026-09-01',
      detectedTotal: 15.00,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PRODOTTO A 15.00',
      description: 'PRODOTTO A',
      quantity: 1,
      unitPrice: 15.00,
      lineTotal: 15.00,
      confidence: 90,
      reviewStatus: 'confirmed',
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    // Click 1
    const exp1 = await classificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      supplierName: 'SUPERMERCATO TEST',
      expenseDate: '2026-09-01',
      documentTotal: 15.00,
    });

    // Click 2 immediato sulla stessa sessione
    const exp2 = await classificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      supplierName: 'SUPERMERCATO TEST',
      expenseDate: '2026-09-01',
      documentTotal: 15.00,
    });

    expect(exp1.id).toBe(exp2.id);
    const count = (await db.expenses.toArray()).length;
    expect(count).toBe(1);
  });

  // TEST J: lateExpenseService: stesso attachmentId con nuovo/differente ocrProcessId => doppia registrazione impedita
  it('TEST J — lateExpenseService: stesso attachmentId con ocrProcessId differente blocca la doppia contabilizzazione', async () => {
    const attachmentId = 'att-unique-12345';

    // Prima registrazione tramite lateExpenseService
    const exp1 = await lateExpenseService.registerOcrExpense({
      ocrProcessId: 'proc-1',
      attachmentId,
      description: 'Spesa farmacia',
      amount: 25.00,
      expenseDate: '2026-08-15',
      categoryId: 'cat-food',
      subcategoryId: 'sub-groceries',
    });

    expect(exp1).toBeDefined();

    // Seconda registrazione con NUOVO ocrProcessId ma STESSO attachmentId
    await expect(
      lateExpenseService.registerOcrExpense({
        ocrProcessId: 'proc-2-differente',
        attachmentId, // Stesso attachmentId!
        description: 'Spesa farmacia re-inviata',
        amount: 25.00,
        expenseDate: '2026-08-15',
        categoryId: 'cat-food',
        subcategoryId: 'sub-groceries',
      })
    ).rejects.toThrow(/Spesa già contabilizzata per questo scontrino/);
  });
});
