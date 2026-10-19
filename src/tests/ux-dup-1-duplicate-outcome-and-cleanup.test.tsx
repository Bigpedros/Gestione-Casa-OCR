import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../database/db';
import {
  documentSessionRepository,
  ocrProcessRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrReceiptLineRepository,
  expenseRepository,
  supplierRepository,
} from '../repositories';
import { PendingOcrReviewBanner } from '../features/attachments/PendingOcrReviewBanner';
import { OcrReviewModal } from '../features/attachments/OcrReviewModal';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { ocrService } from '../services/ocrService';
import { productClassificationService } from '../services/productClassification/ProductClassificationService';

describe('PATCH UX-DUP-1 — Duplicate Outcome UX & Pending Acquisition Cleanup', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
    vi.restoreAllMocks();
  });

  it('TEST A: EXACT_DUPLICATE => compare "Documento già registrato" e NON compare "Riprova OCR"', async () => {
    const sup = await supplierRepository.create({ name: "GRUPPO CAFFE' ESPRESSO" } as any);
    const histExpense = await expenseRepository.create({
      description: "Scontrino GRUPPO CAFFE' ESPRESSO",
      amount: 21.5,
      expenseDate: '2026-09-08',
      categoryId: 'cat-alimentari',
      supplierId: sup.id,
      classification: 'necessary',
      status: 'paid',
    } as any);

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'nuovo_scontrino.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 150000,
      storageKey: 'data:image/jpeg;base64,sample-base64',
      fileHash: 'hash-differente-dal-vecchio',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      rawText: "GRUPPO CAFFE' ESPRESSO\nILLY IPERESPRESSO 8.50\n50 GINSENG 13.00\nTOTALE 21.50",
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO",
      detectedDate: '2026-09-08',
      detectedTotal: 21.5,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'nuovo_scontrino.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-seg-a',
      processingStatus: 'processed',
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ILLY IPERESPRESSO 8.50',
      description: 'ILLY IPERESPRESSO',
      quantity: 1,
      unitPrice: 8.5,
      lineTotal: 8.5,
      confidence: 95,
      reviewStatus: 'confirmed',
      metadata: { categoryId: 'cat-alimentari' },
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: '50 GINSENG 13.00',
      description: '50 GINSENG',
      quantity: 1,
      unitPrice: 13.0,
      lineTotal: 13.0,
      confidence: 95,
      reviewStatus: 'confirmed',
      metadata: { categoryId: 'cat-alimentari' },
    });

    vi.spyOn(productClassificationService, 'createAccountingRegistration').mockRejectedValueOnce(
      new Error(
        `[DUPLICATE_RECEIPT_EXACT] Impossibile creare la registrazione contabile: scontrino/documento già contabilizzato nella spesa ${histExpense.id}. Motivo: Fornitore, data, importo e righe coincidenti con la spesa ${histExpense.id}`
      )
    );

    render(
      <MemoryRouter>
        <OcrReviewModal
          isOpen={true}
          onClose={vi.fn()}
          sessionId={session.id}
          ocrProcessId={ocrProc.id}
        />
      </MemoryRouter>
    );

    const createBtn = await screen.findByRole('button', { name: /Crea Registrazione Contabile/i });
    expect(createBtn).toBeInTheDocument();

    fireEvent.click(createBtn);

    expect(await screen.findByText('Documento già registrato')).toBeInTheDocument();
    expect(screen.getByText(/Questo scontrino risulta già contabilizzato/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(histExpense.id, 'i'))).toBeInTheDocument();
    expect(screen.queryByText(/Riprova OCR/i)).not.toBeInTheDocument();
  });

  it('TEST B: EXACT_DUPLICATE => nessuna nuova Expense viene creata', async () => {
    const expensesBefore = await db.expenses.count();

    const sup = await supplierRepository.create({ name: 'BAR CENTRALE' } as any);
    const hist = await expenseRepository.create({
      description: 'Caffè Bar Centrale',
      amount: 5.0,
      expenseDate: '2026-09-08',
      categoryId: 'cat-alimentari',
      supplierId: sup.id,
      classification: 'necessary',
      status: 'paid',
    } as any);

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      pageCount: 1,
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-b',
      status: 'completed',
      rawText: 'BAR CENTRALE\nCAFFE 5.00\nTOTALE 5.00',
      detectedSupplier: 'BAR CENTRALE',
      detectedDate: '2026-09-08',
      detectedTotal: 5.0,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'CAFFE 5.00',
      description: 'CAFFE',
      quantity: 1,
      unitPrice: 5.0,
      lineTotal: 5.0,
      confidence: 95,
      reviewStatus: 'confirmed',
      metadata: { categoryId: 'cat-alimentari' },
    });

    vi.spyOn(productClassificationService, 'createAccountingRegistration').mockRejectedValueOnce(
      new Error(`[DUPLICATE_RECEIPT_EXACT] scontrino già contabilizzato nella spesa ${hist.id}`)
    );

    render(
      <MemoryRouter>
        <OcrReviewModal
          isOpen={true}
          onClose={vi.fn()}
          sessionId={session.id}
          ocrProcessId={ocrProc.id}
        />
      </MemoryRouter>
    );

    const createBtn = await screen.findByRole('button', { name: /Crea Registrazione Contabile/i });
    fireEvent.click(createBtn);

    await screen.findByText('Documento già registrato');

    const expensesAfter = await db.expenses.count();
    expect(expensesAfter).toBe(expensesBefore + 1); // solo la spesa storica creata
  });

  it('TEST C: Errore OCR reale => "Riprova OCR" continua a comparire normalmente', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'draft',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'documentPageSegment',
      entityId: session.id,
      fileName: 'page.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,123',
      fileHash: 'h-c-1',
      status: 'active',
    } as any);

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      fileHash: 'h-c-1',
      processingStatus: 'processed',
    } as any);

    vi.spyOn(ocrService, 'recognize').mockRejectedValueOnce(
      new Error('Errore engine OCR: immagine illeggibile')
    );

    render(
      <MemoryRouter>
        <OcrReviewModal
          isOpen={true}
          onClose={vi.fn()}
          sessionId={session.id}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Errore engine OCR/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Riprova OCR/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Documento già registrato')).not.toBeInTheDocument();
  });

  it('TEST D: Pending picker => ogni acquisizione eliminabile mostra azione Elimina', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'Fornitore 1\n10.00',
      detectedSupplier: 'Fornitore 1',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s1.id, { ocrProcessId: proc1.id });

    const s2 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc2 = await ocrProcessRepository.create({
      attachmentId: 'att-2',
      status: 'completed',
      rawText: 'Fornitore 2\n20.00',
      detectedSupplier: 'Fornitore 2',
      detectedTotal: 20.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    render(<PendingOcrReviewBanner onOpenReview={vi.fn()} />);

    const bannerBtn = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(bannerBtn);

    expect(await screen.findByText('Seleziona Documento OCR da Rivedere')).toBeInTheDocument();

    const rivediBtns = screen.getAllByRole('button', { name: /^Rivedi$/i });
    const eliminaBtns = screen.getAllByRole('button', { name: /Elimina/i });

    expect(rivediBtns).toHaveLength(2);
    expect(eliminaBtns).toHaveLength(2);
  });

  it('TEST E: Click Elimina => richiede conferma con messaggio dedicato', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'Fornitore 1\n10.00',
      detectedSupplier: 'Fornitore 1',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s1.id, { ocrProcessId: proc1.id });

    const s2 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc2 = await ocrProcessRepository.create({
      attachmentId: 'att-2',
      status: 'completed',
      rawText: 'Fornitore 2\n20.00',
      detectedSupplier: 'Fornitore 2',
      detectedTotal: 20.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    render(<PendingOcrReviewBanner onOpenReview={vi.fn()} />);

    const bannerBtn = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(bannerBtn);

    const eliminaBtns = await screen.findAllByRole('button', { name: /Elimina/i });
    fireEvent.click(eliminaBtns[0]);

    expect(await screen.findByText('Eliminare questa acquisizione?')).toBeInTheDocument();
    expect(screen.getByText(/Verranno rimossi la bozza OCR, le pagine e gli allegati locali/i)).toBeInTheDocument();
    expect(screen.getByText(/Le spese già contabilizzate non possono essere eliminate da qui/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annulla/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Elimina acquisizione/i })).toBeInTheDocument();
  });

  it('TEST F: Conferma eliminazione di sessione pending valida => pulizia completa a cascata', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino_f.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100000,
      storageKey: 'data:image/jpeg;base64,data',
      fileHash: 'hash-att-f',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      rawText: 'TEST F\n12.00',
      detectedSupplier: 'TEST F',
      detectedTotal: 12.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    const segment = await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'scontrino_f.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-seg-f',
      processingStatus: 'processed',
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'TEST F 12.00',
      description: 'TEST F',
      quantity: 1,
      unitPrice: 12.0,
      lineTotal: 12.0,
      confidence: 90,
      reviewStatus: 'pending',
    });

    // Aggiungi una seconda sessione per consentire l'apertura del picker
    const dummySession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const dummyProc = await ocrProcessRepository.create({
      attachmentId: 'att-dummy',
      status: 'completed',
      rawText: 'DUMMY\n1.00',
      detectedSupplier: 'DUMMY',
      detectedTotal: 1.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(dummySession.id, { ocrProcessId: dummyProc.id });

    render(<PendingOcrReviewBanner onOpenReview={vi.fn()} />);

    const bannerBtn = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(bannerBtn);

    const testFTitle = await screen.findByText('TEST F');
    const testFRow = testFTitle.closest('.rounded-2xl') || testFTitle.parentElement!;
    const eliminaBtn = within(testFRow as HTMLElement).getByRole('button', { name: /Elimina/i });
    fireEvent.click(eliminaBtn);

    const confirmBtn = await screen.findByRole('button', { name: /Elimina acquisizione/i });
    fireEvent.click(confirmBtn);

    await waitFor(async () => {
      const s = await db.documentSessions.get(session.id);
      expect(s).toBeUndefined();
    });

    expect(await db.documentPageSegments.get(segment.id)).toBeUndefined();
    expect(await db.ocrProcesses.get(ocrProc.id)).toBeUndefined();
    expect(await db.ocrReceiptLines.get(line.id)).toBeUndefined();
    expect(await db.attachments.get(att.id)).toBeUndefined();
  });

  it('TEST G: Dopo delete => riga sparisce e i conteggi del banner si aggiornano', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-g1',
      status: 'completed',
      rawText: 'Doc G1\n10.00',
      detectedSupplier: 'Doc G1',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s1.id, { ocrProcessId: proc1.id });

    const s2 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc2 = await ocrProcessRepository.create({
      attachmentId: 'att-g2',
      status: 'completed',
      rawText: 'Doc G2\n20.00',
      detectedSupplier: 'Doc G2',
      detectedTotal: 20.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    render(<PendingOcrReviewBanner onOpenReview={vi.fn()} />);

    expect(await screen.findByText(/Documenti OCR pronti per la revisione \(2\)/i)).toBeInTheDocument();

    const bannerBtn = screen.getByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(bannerBtn);

    expect(await screen.findByText('Doc G1')).toBeInTheDocument();
    expect(screen.getByText('Doc G2')).toBeInTheDocument();

    const g1Title = screen.getByText('Doc G1');
    const g1Row = g1Title.closest('.rounded-2xl') || g1Title.parentElement!;
    const eliminaBtn = within(g1Row as HTMLElement).getByRole('button', { name: /Elimina/i });
    fireEvent.click(eliminaBtn); // Elimina Doc G1

    const confirmBtn = await screen.findByRole('button', { name: /Elimina acquisizione/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText('Doc G1')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Doc G2')).toBeInTheDocument();
  });

  it('TEST H: Ultima acquisizione eliminata => picker si chiude e banner scompare', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-h1',
      status: 'completed',
      rawText: 'Doc H1\n10.00',
      detectedSupplier: 'Doc H1',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s1.id, { ocrProcessId: proc1.id });

    const s2 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc2 = await ocrProcessRepository.create({
      attachmentId: 'att-h2',
      status: 'completed',
      rawText: 'Doc H2\n20.00',
      detectedSupplier: 'Doc H2',
      detectedTotal: 20.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    const { container } = render(<PendingOcrReviewBanner onOpenReview={vi.fn()} />);

    const bannerBtn = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(bannerBtn);

    // Elimina prima sessione (Doc H1)
    const h1Title = await screen.findByText('Doc H1');
    const h1Row = h1Title.closest('.rounded-2xl') || h1Title.parentElement!;
    let eliminaBtn = within(h1Row as HTMLElement).getByRole('button', { name: /Elimina/i });
    fireEvent.click(eliminaBtn);
    let confirmBtn = await screen.findByRole('button', { name: /Elimina acquisizione/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText('Doc H1')).not.toBeInTheDocument();
    });

    // Elimina seconda sessione (Doc H2)
    const h2Title = await screen.findByText('Doc H2');
    const h2Row = h2Title.closest('.rounded-2xl') || h2Title.parentElement!;
    eliminaBtn = within(h2Row as HTMLElement).getByRole('button', { name: /Elimina/i });
    fireEvent.click(eliminaBtn);
    confirmBtn = await screen.findByRole('button', { name: /Elimina acquisizione/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText('Seleziona Documento OCR da Rivedere')).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });
  });

  it('TEST I: Sessione collegata a Expense => cancellazione vietata ed Expense intatta', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-i1',
      status: 'completed',
      rawText: 'Doc I1\n50.00',
      detectedSupplier: 'Doc I1',
      detectedTotal: 50.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s1.id, { ocrProcessId: proc1.id });

    const expense = await expenseRepository.create({
      description: 'Spesa protetta',
      amount: 50.0,
      expenseDate: '2026-09-08',
      categoryId: 'cat-alimentari',
      classification: 'necessary',
      status: 'paid',
      metadata: { documentSessionId: s1.id },
    } as any);

    const s2 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
      pageCount: 1,
    });
    const proc2 = await ocrProcessRepository.create({
      attachmentId: 'att-i2',
      status: 'completed',
      rawText: 'Doc I2\n20.00',
      detectedSupplier: 'Doc I2',
      detectedTotal: 20.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    render(<PendingOcrReviewBanner onOpenReview={vi.fn()} />);

    const bannerBtn = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(bannerBtn);

    const i1Title = await screen.findByText('Doc I1');
    const i1Row = i1Title.closest('.rounded-2xl') || i1Title.parentElement!;
    const eliminaBtn = within(i1Row as HTMLElement).getByRole('button', { name: /Elimina/i });
    fireEvent.click(eliminaBtn); // tenta di eliminare s1 (collegata a spesa)

    const confirmBtn = await screen.findByRole('button', { name: /Elimina acquisizione/i });
    fireEvent.click(confirmBtn);

    expect(
      await screen.findByText(/Questa acquisizione è già collegata a una spesa e non può essere eliminata da questo elenco/i)
    ).toBeInTheDocument();

    expect(await db.documentSessions.get(s1.id)).toBeDefined();
    expect(await db.expenses.get(expense.id)).toBeDefined();
  });

  it('TEST J: EXACT_DUPLICATE + "Elimina questa acquisizione" => elimina soltanto nuova sessione e mantiene Expense storica', async () => {
    const sup = await supplierRepository.create({ name: 'STORICA' } as any);
    const histExp = await expenseRepository.create({
      description: 'Spesa storica intatta',
      amount: 30.0,
      expenseDate: '2026-09-08',
      categoryId: 'cat-alimentari',
      supplierId: sup.id,
      classification: 'necessary',
      status: 'paid',
    } as any);

    const newSession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      pageCount: 1,
    });

    const newAtt = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: newSession.id,
      fileName: 'nuova.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 120000,
      storageKey: 'data:image/jpeg;base64,data',
      fileHash: 'hash-j-att',
      status: 'active',
    });

    const newProc = await ocrProcessRepository.create({
      attachmentId: newAtt.id,
      status: 'completed',
      rawText: 'STORICA\nOGGETTO 30.00\nTOTALE 30.00',
      detectedSupplier: 'STORICA',
      detectedDate: '2026-09-08',
      detectedTotal: 30.0,
      confirmationRequired: true,
      confirmedByUser: true,
    });
    await documentSessionRepository.update(newSession.id, { ocrProcessId: newProc.id });

    await ocrReceiptLineRepository.create({
      ocrProcessId: newProc.id,
      originalText: 'OGGETTO 30.00',
      description: 'OGGETTO',
      quantity: 1,
      unitPrice: 30.0,
      lineTotal: 30.0,
      confidence: 95,
      reviewStatus: 'confirmed',
      metadata: { categoryId: 'cat-alimentari' },
    });

    vi.spyOn(productClassificationService, 'createAccountingRegistration').mockRejectedValueOnce(
      new Error(`[DUPLICATE_RECEIPT_EXACT] scontrino già contabilizzato nella spesa ${histExp.id}`)
    );

    const handleClose = vi.fn();

    render(
      <MemoryRouter>
        <OcrReviewModal
          isOpen={true}
          onClose={handleClose}
          sessionId={newSession.id}
          ocrProcessId={newProc.id}
        />
      </MemoryRouter>
    );

    const createBtn = await screen.findByRole('button', { name: /Crea Registrazione Contabile/i });
    fireEvent.click(createBtn);

    await screen.findByText('Documento già registrato');

    const deleteBtn = screen.getByRole('button', { name: /Elimina questa acquisizione/i });
    fireEvent.click(deleteBtn);

    expect(await screen.findByText(/Verrà eliminata soltanto questa nuova acquisizione duplicata/i)).toBeInTheDocument();

    const confirmDeleteBtn = screen.getByRole('button', { name: /^Elimina acquisizione$/i });
    fireEvent.click(confirmDeleteBtn);

    await waitFor(async () => {
      const s = await db.documentSessions.get(newSession.id);
      expect(s).toBeUndefined();
    });

    const hist = await db.expenses.get(histExp.id);
    expect(hist).toBeDefined();
    expect(hist?.amount).toBe(30.0);
    expect(handleClose).toHaveBeenCalled();
  });

  it('TEST K: Chiudi EXACT_DUPLICATE => nessun nuovo OCR, nessuna spesa creata e spesa storica intatta', async () => {
    const histExp = await expenseRepository.create({
      description: 'Storica K',
      amount: 15.0,
      expenseDate: '2026-09-08',
      categoryId: 'cat-alimentari',
      classification: 'necessary',
      status: 'paid',
    } as any);

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      pageCount: 1,
    });

    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-k',
      status: 'completed',
      rawText: 'K\nARTICOLO 15.00\nTOTALE 15.00',
      detectedSupplier: 'K',
      detectedDate: '2026-09-08',
      detectedTotal: 15.0,
      confirmationRequired: true,
      confirmedByUser: true,
    });
    await documentSessionRepository.update(session.id, { ocrProcessId: proc.id });

    await ocrReceiptLineRepository.create({
      ocrProcessId: proc.id,
      originalText: 'ARTICOLO 15.00',
      description: 'ARTICOLO',
      quantity: 1,
      unitPrice: 15.0,
      lineTotal: 15.0,
      confidence: 95,
      reviewStatus: 'confirmed',
      metadata: { categoryId: 'cat-alimentari' },
    });

    const ocrSpy = vi.spyOn(ocrService, 'recognize');
    vi.spyOn(productClassificationService, 'createAccountingRegistration').mockRejectedValueOnce(
      new Error(`[DUPLICATE_RECEIPT_EXACT] scontrino già contabilizzato nella spesa ${histExp.id}`)
    );

    const handleClose = vi.fn();

    render(
      <MemoryRouter>
        <OcrReviewModal
          isOpen={true}
          onClose={handleClose}
          sessionId={session.id}
          ocrProcessId={proc.id}
        />
      </MemoryRouter>
    );

    const createBtn = await screen.findByRole('button', { name: /Crea Registrazione Contabile/i });
    fireEvent.click(createBtn);

    await screen.findByText('Documento già registrato');

    const closeBtns = screen.getAllByRole('button', { name: /^Chiudi$/i });
    fireEvent.click(closeBtns[0]);

    expect(handleClose).toHaveBeenCalled();
    expect(ocrSpy).not.toHaveBeenCalled();

    const expenses = await db.expenses.toArray();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].id).toBe(histExp.id);
  });
});
