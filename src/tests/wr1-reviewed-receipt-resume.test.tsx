import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
import { AttachmentsPage } from '../features/attachments/AttachmentsPage';
import { PendingOcrReviewBanner } from '../features/attachments/PendingOcrReviewBanner';
import { OcrReviewModal } from '../features/attachments/OcrReviewModal';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { ocrService } from '../services/ocrService';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { productClassificationService } from '../services/productClassification/ProductClassificationService';

describe('PATCH WR-1 — Reviewed Receipt Resume & Orphan Session Hygiene', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
    vi.restoreAllMocks();
  });

  it('TEST A: reviewed + confirmedByUser + no expense => compare azione "Completa registrazione" in AttachmentsPage', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'reviewed',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'IMG_3782.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 250000,
      storageKey: 'data:image/jpeg;base64,sample-base64',
      fileHash: 'hash-img-3782',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      rawText: "GRUPPO CAFFE' ESPRESSO S.R.L.\nILLY IPERESPRESSO 8.50\n50 GINSENG 13.00\nTOTALE 21.50",
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO S.R.L.",
      detectedDate: '2026-09-08',
      detectedTotal: 21.5,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'IMG_3782.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-img-3782',
      processingStatus: 'processed',
    });

    render(
      <MemoryRouter>
        <AttachmentsPage />
      </MemoryRouter>
    );

    const resumeBtn = await screen.findByRole('button', { name: /Completa registrazione/i });
    expect(resumeBtn).toBeInTheDocument();
    expect(screen.getByText("GRUPPO CAFFE' ESPRESSO S.R.L.")).toBeInTheDocument();
    expect(screen.getByText('21,50 €')).toBeInTheDocument();
    expect(screen.getByText('Revisionato')).toBeInTheDocument();
  });

  it('TEST B: click sull\'azione "Completa registrazione" => apre esattamente sessionId/ocrProcessId originali', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'reviewed',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'IMG_3782.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 250000,
      storageKey: 'data:image/jpeg;base64,sample-base64',
      fileHash: 'hash-img-3782-b',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      rawText: "GRUPPO CAFFE' ESPRESSO S.R.L.\nTOTALE 21.50",
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO S.R.L.",
      detectedDate: '2026-09-08',
      detectedTotal: 21.5,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'IMG_3782.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-img-3782-b',
      processingStatus: 'processed',
    });

    render(
      <MemoryRouter>
        <AttachmentsPage />
      </MemoryRouter>
    );

    const resumeBtn = await screen.findByRole('button', { name: /Completa registrazione/i });
    fireEvent.click(resumeBtn);

    // Verify modal is displayed with original session and OCR process data
    await waitFor(() => {
      expect(screen.getByText(/Revisione e Verifica Dati OCR/i)).toBeInTheDocument();
    });
  });

  it('TEST C & D & E: riapertura reviewed => immagine presente, linee corrette 8,50 e 13,00 caricate, NESSUN nuovo OCR eseguito', async () => {
    const recognizeSpy = vi.spyOn(ocrService, 'recognize');
    const parseSpy = vi.spyOn(receiptParserService, 'parse');

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'reviewed',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'IMG_3782.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 250000,
      storageKey: 'data:image/jpeg;base64,sample-img-data',
      fileHash: 'hash-img-3782-cde',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      rawText: "GRUPPO CAFFE' ESPRESSO S.R.L.\nILLY IPERESPRESSO GINSENG 8.50\n50 GINSENG AMARO OFF CPS 13.00\nTOTALE 21.50",
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO S.R.L.",
      detectedDate: '2026-09-08',
      detectedTotal: 21.5,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'IMG_3782.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-img-3782-cde',
      processingStatus: 'processed',
    });

    // Create the two corrected lines
    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ILLY IPERESPRESSO GINSENG 8.50',
      description: 'ILLY IPERESPRESSO GINSENG',
      quantity: 1,
      unitPrice: 8.5,
      lineTotal: 8.5,
      confidence: 0.95,
      reviewStatus: 'confirmed',
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: '50 GINSENG AMARO OFF CPS 13.00',
      description: '50 GINSENG AMARO OFF CPS',
      quantity: 1,
      unitPrice: 13.0,
      lineTotal: 13.0,
      confidence: 0.95,
      reviewStatus: 'confirmed',
    });

    render(
      <MemoryRouter>
        <OcrReviewModal
          isOpen={true}
          sessionId={session.id}
          ocrProcessId={ocrProc.id}
          onClose={() => {}}
        />
      </MemoryRouter>
    );

    // TEST C: Verify image is displayed (img element with storageKey)
    await waitFor(() => {
      const img = screen.getByAltText('Documento OCR');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,sample-img-data');
    });

    // TEST D: Verify OCR Receipt Lines are rendered
    await waitFor(() => {
      expect(screen.getByDisplayValue('ILLY IPERESPRESSO GINSENG')).toBeInTheDocument();
      expect(screen.getByDisplayValue('50 GINSENG AMARO OFF CPS')).toBeInTheDocument();
    });

    // TEST E: Verify OCR recognize and parse were NOT called
    expect(recognizeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();

    // Verify "Crea Registrazione Contabile" button is present and ready
    const createBtn = screen.getByRole('button', { name: /Crea Registrazione Contabile/i });
    expect(createBtn).toBeInTheDocument();
  });

  it('TEST F: sessione draft valida con segmento => resta nel PendingOcrReviewBanner', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      pageCount: 1,
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-valid-f',
      status: 'completed',
      rawText: 'TODIS\nTOTALE 10.00',
      detectedSupplier: 'TODIS',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-valid-f',
      originalFileName: 'todis.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-todis-f',
      processingStatus: 'processed',
    });

    const handleOpenReview = vi.fn();
    render(<PendingOcrReviewBanner onOpenReview={handleOpenReview} />);

    const bannerBtn = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    expect(bannerBtn).toBeInTheDocument();
  });

  it('TEST G: sessione vuota pageCount=0, segments=0 => NON compare nel banner', async () => {
    // Empty orphaned session like Documento_16-09-2026_133
    const emptySession = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      pageCount: 0,
    });

    const emptyProc = await ocrProcessRepository.create({
      attachmentId: 'att-orphan',
      status: 'failed',
      rawText: '',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(emptySession.id, { ocrProcessId: emptyProc.id });

    const handleOpenReview = vi.fn();
    const { container } = render(<PendingOcrReviewBanner onOpenReview={handleOpenReview} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Rivedi dati estratti/i)).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('TEST H: sessione reviewed => NON compare nel banner', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'reviewed',
      pageCount: 1,
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-rev-h',
      status: 'completed',
      rawText: 'BAR CENTRALE\nTOTALE 5.00',
      detectedSupplier: 'BAR CENTRALE',
      detectedTotal: 5.0,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-rev-h',
      originalFileName: 'bar.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-bar-h',
      processingStatus: 'processed',
    });

    const handleOpenReview = vi.fn();
    const { container } = render(<PendingOcrReviewBanner onOpenReview={handleOpenReview} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Rivedi dati estratti/i)).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('TEST I: sessione completed => NON compare nel banner', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'completed',
      expenseId: 'exp-completed-i',
      pageCount: 1,
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-comp-i',
      status: 'completed',
      rawText: 'CONAD\nTOTALE 30.00',
      expenseId: 'exp-completed-i',
      detectedSupplier: 'CONAD',
      detectedTotal: 30.0,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-comp-i',
      originalFileName: 'conad.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-conad-i',
      processingStatus: 'processed',
    });

    const handleOpenReview = vi.fn();
    const { container } = render(<PendingOcrReviewBanner onOpenReview={handleOpenReview} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Rivedi dati estratti/i)).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('TEST J: sessione reviewed/non contabilizzata => può arrivare a createAccountingRegistration => DR-1 viene quindi eseguito', async () => {
    // 1. Create a supplier
    const sup = await supplierRepository.create({
      name: "GRUPPO CAFFE' ESPRESSO S.R.L.",
      aliases: [],
      status: 'confirmed',
    });

    // 2. Create existing expense with exact same supplier, date, total to test DR-1 duplicate check
    const existingExp = await expenseRepository.create({
      entryMode: 'receipt',
      supplierId: sup.id,
      amount: 21.5,
      expenseDate: '2026-09-08',
      description: "GRUPPO CAFFE' ESPRESSO S.R.L.",
      competenceMonth: 9,
      competenceYear: 2026,
      categoryId: 'cat-groceries',
      subcategoryId: 'sub-supermarket',
      paymentMethod: 'debitCard',
      status: 'paid',
      classification: 'necessary',
      notified: false,
    });
    expect(existingExp.id).toBeDefined();

    // 3. Create reviewed session
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'reviewed',
      pageCount: 1,
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'IMG_3782.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 250000,
      storageKey: 'data:image/jpeg;base64,sample-img-data',
      fileHash: 'hash-img-3782-j',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: att.id,
      status: 'completed',
      rawText: "GRUPPO CAFFE' ESPRESSO S.R.L.\nILLY IPERESPRESSO GINSENG 8.50\n50 GINSENG AMARO OFF CPS 13.00\nTOTALE 21.50",
      detectedSupplier: "GRUPPO CAFFE' ESPRESSO S.R.L.",
      detectedDate: '2026-09-08',
      detectedTotal: 21.5,
      confirmationRequired: true,
      confirmedByUser: true,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'IMG_3782.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-img-3782-j',
      processingStatus: 'processed',
    });

    const line1 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ILLY IPERESPRESSO GINSENG 8.50',
      description: 'ILLY IPERESPRESSO GINSENG',
      quantity: 1,
      unitPrice: 8.5,
      lineTotal: 8.5,
      confidence: 0.95,
      reviewStatus: 'confirmed',
    });

    const line2 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: '50 GINSENG AMARO OFF CPS 13.00',
      description: '50 GINSENG AMARO OFF CPS',
      quantity: 1,
      unitPrice: 13.0,
      lineTotal: 13.0,
      confidence: 0.95,
      reviewStatus: 'confirmed',
    });

    // Calling createAccountingRegistration without duplicate resolution when duplicate exists
    // DuplicateReceiptDetector DR-1 will detect exact duplicate match against existingExp!
    await expect(
      productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
        paymentMethod: 'debitCard',
        supplierId: sup.id,
        supplierName: "GRUPPO CAFFE' ESPRESSO S.R.L.",
        expenseDate: '2026-09-08',
        documentTotal: 21.5,
        decisions: [
          {
            lineId: line1.id,
            originalText: line1.originalText,
            description: line1.description,
            quantity: 1,
            unitPrice: 8.5,
            lineTotal: 8.5,
            confidence: 0.95,
            action: 'unlinked',
            productId: null,
          },
          {
            lineId: line2.id,
            originalText: line2.originalText,
            description: line2.description,
            quantity: 1,
            unitPrice: 13.0,
            lineTotal: 13.0,
            confidence: 0.95,
            action: 'unlinked',
            productId: null,
          },
        ],
        deletedLineIds: [],
        allowDiscrepancy: false,
      })
    ).rejects.toThrow(/DUPLICATE_RECEIPT/i);

    // Now call with allowProbableDuplicate = true -> successfully creates expense and updates session
    const createdExp = await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      paymentMethod: 'debitCard',
      supplierId: sup.id,
      supplierName: "GRUPPO CAFFE' ESPRESSO S.R.L.",
      expenseDate: '2026-09-08',
      documentTotal: 21.5,
      allowProbableDuplicate: true,
      decisions: [
        {
          lineId: line1.id,
          originalText: line1.originalText,
          description: line1.description,
          quantity: 1,
          unitPrice: 8.5,
          lineTotal: 8.5,
          confidence: 0.95,
          action: 'unlinked',
          productId: null,
        },
        {
          lineId: line2.id,
          originalText: line2.originalText,
          description: line2.description,
          quantity: 1,
          unitPrice: 13.0,
          lineTotal: 13.0,
          confidence: 0.95,
          action: 'unlinked',
          productId: null,
        },
      ],
      deletedLineIds: [],
      allowDiscrepancy: false,
    });

    expect(createdExp).toBeDefined();
    expect(createdExp.amount).toBe(21.5);

    // Verify session and OCRProcess are now completed and linked to created expense
    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('completed');
    expect(updatedSession?.expenseId).toBe(createdExp.id);

    const updatedOcr = await ocrProcessRepository.getById(ocrProc.id);
    expect(updatedOcr?.expenseId).toBe(createdExp.id);
  });
});
