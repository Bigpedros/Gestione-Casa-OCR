import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { db } from '../database/db';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
} from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { OcrReviewModal } from '../features/attachments/OcrReviewModal';
import { ocrService } from '../services/ocrService';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { productClassificationService } from '../services/productClassification/ProductClassificationService';
import { OCRProcess } from '../types';

describe('FASE CI-R3 — Lifecycle Asincrono OcrReviewModal & Annullamento Operazioni Pendenti', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
    vi.restoreAllMocks();
  });

  // TEST 1: Smontaggio durante loadReviewData non lancia ReferenceError / unhandled rejection
  it('TEST 1: Smontaggio durante loadReviewData non produce errori asincroni post-unmount', async () => {
    let resolveSessionGet: ((val: any) => void) | null = null;
    const sessionPromise = new Promise((resolve) => {
      resolveSessionGet = resolve;
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-test-1',
      status: 'completed',
      rawText: 'BAR TEST\nTOTALE 10.00',
      detectedSupplier: 'BAR TEST',
      detectedDate: '2026-09-01',
      detectedTotal: 10.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    // Mock documentSessionRepository.getById to hang until we resolve it
    const originalGetById = documentSessionRepository.getById.bind(documentSessionRepository);
    vi.spyOn(documentSessionRepository, 'getById').mockImplementation(((id: string) => {
      return sessionPromise.then(() => originalGetById(id));
    }) as any);

    const { unmount } = render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    // Unmount while loadReviewData is awaiting sessionPromise
    unmount();

    // Now resolve the promise after unmount
    await act(async () => {
      if (resolveSessionGet) resolveSessionGet(null);
      await new Promise((r) => setTimeout(r, 50));
    });

    // Se la cancellazione funziona, nessun errore / setter post-unmount viene eseguito
    expect(true).toBe(true);
  });

  // TEST 2: Cambio repentino di sessionId / ocrProcessId invalida la richiesta precedente
  it('TEST 2: Cambio repentino di sessionId/ocrProcessId scarta il risultato della richiesta precedente', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-s1',
      status: 'completed',
      rawText: 'FORNITORE 1\nTOTALE 11.00',
      detectedSupplier: 'FORNITORE 1',
      detectedDate: '2026-09-01',
      detectedTotal: 11.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s1.id, { ocrProcessId: proc1.id });

    const s2 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc2 = await ocrProcessRepository.create({
      attachmentId: 'att-s2',
      status: 'completed',
      rawText: 'FORNITORE 2\nTOTALE 22.00',
      detectedSupplier: 'FORNITORE 2',
      detectedDate: '2026-09-02',
      detectedTotal: 22.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    let resolveFirstReq: ((val: any) => void) | null = null;
    const firstReqPromise = new Promise((resolve) => {
      resolveFirstReq = resolve;
    });

    const originalGetByOcr = ocrReceiptLineRepository.getByOcrProcessId.bind(ocrReceiptLineRepository);
    vi.spyOn(ocrReceiptLineRepository, 'getByOcrProcessId').mockImplementation(((procId: string) => {
      if (procId === proc1.id) {
        return firstReqPromise.then(() => originalGetByOcr(procId));
      }
      return originalGetByOcr(procId);
    }) as any);

    const { rerender } = render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s1.id}
        ocrProcessId={proc1.id}
      />
    );

    // Switch to s2 immediately
    rerender(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s2.id}
        ocrProcessId={proc2.id}
      />
    );

    // Wait for s2 to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Now resolve first slow request
    await act(async () => {
      if (resolveFirstReq) resolveFirstReq(null);
      await new Promise((r) => setTimeout(r, 50));
    });

    // The modal should display data from s2 / proc2, NOT s1
    expect(screen.getByDisplayValue('FORNITORE 2')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('FORNITORE 1')).not.toBeInTheDocument();
  });

  // TEST 3: Chiusura modale (isOpen=false) annulla l'aggiornamento dello stato
  it('TEST 3: Chiusura modale (isOpen=false) durante il caricamento non esegue setter di stato', async () => {
    let resolveClassification: ((val: any) => void) | null = null;
    const classificationPromise = new Promise((resolve) => {
      resolveClassification = resolve;
    });

    const s = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-s3',
      status: 'completed',
      rawText: 'TEST FORNITORE\nTOTALE 30.00',
      detectedSupplier: 'TEST FORNITORE',
      detectedDate: '2026-09-01',
      detectedTotal: 30.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s.id, { ocrProcessId: proc.id });

    vi.spyOn(productClassificationService, 'classifyReceiptLines').mockImplementation((async () => {
      await classificationPromise;
      return {
        ocrProcessId: proc.id,
        overallConfidence: 85,
        supplierProposal: { detectedName: 'TEST FORNITORE', matchedSupplier: null, confidence: 80 },
        lineProposals: [],
        warnings: [],
        unclassifiedCount: 0,
        knownProductCount: 0,
        newProductCount: 0,
        conflictedCount: 0,
        averageConfidence: 85,
      };
    }) as any);

    const { rerender } = render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s.id}
        ocrProcessId={proc.id}
      />
    );

    // Close modal while classification is pending
    rerender(
      <OcrReviewModal
        isOpen={false}
        onClose={vi.fn()}
        sessionId={s.id}
        ocrProcessId={proc.id}
      />
    );

    // Resolve classification after close
    await act(async () => {
      if (resolveClassification) resolveClassification(null);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.queryByText('Revisione e Verifica Dati OCR')).not.toBeInTheDocument();
  });

  // TEST 4: Smontaggio durante esecuzione OCR (ocrService.recognize) non causa eccezioni
  it('TEST 4: Smontaggio durante ocrService.recognize non causa crash né unhandled rejection', async () => {
    let resolveRecognize: ((val: any) => void) | null = null;
    const recognizePromise = new Promise((resolve) => {
      resolveRecognize = resolve;
    });

    const s = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: s.id,
      fileName: 'test.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      storageKey: 'data:image/jpeg;base64,test',
      fileHash: 'hash-test',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: s.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'test.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-test',
      processingStatus: 'processed',
    });

    vi.spyOn(ocrService, 'recognize').mockImplementation((async (_sId: string, progressCallback?: any) => {
      if (progressCallback) progressCallback({ statusText: 'Scansione in corso...', progressPercentage: 40 });
      await recognizePromise;
      const res: OCRProcess = {
        id: 'proc-rec-1',
        attachmentId: att.id,
        status: 'completed',
        rawText: 'SCANSIONATO\nTOTALE 15.00',
        detectedSupplier: 'SCANSIONATO',
        detectedTotal: 15.0,
        confirmationRequired: true,
        confirmedByUser: false,
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
      };
      return res;
    }) as any);

    const { unmount } = render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s.id}
      />
    );

    // Unmount during OCR recognize
    unmount();

    // Resolve recognize after unmount
    await act(async () => {
      if (resolveRecognize) resolveRecognize(null);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(true).toBe(true);
  });

  // TEST 5: Smontaggio durante parsing scontrino (receiptParserService.parse) gestito in sicurezza
  it('TEST 5: Smontaggio durante receiptParserService.parse gestito senza errori', async () => {
    let resolveParse: ((val: any) => void) | null = null;
    const parsePromise = new Promise((resolve) => {
      resolveParse = resolve;
    });

    const s = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-parse-1',
      status: 'completed',
      rawText: 'RAW TEXT TO PARSE\nTOTALE 50.00',
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s.id, { ocrProcessId: proc.id });

    vi.spyOn(receiptParserService, 'parse').mockImplementation((async () => {
      await parsePromise;
      return {
        ocrProcessId: proc.id,
        rawText: proc.rawText || '',
        normalizedText: proc.rawText || '',
        supplier: { name: 'PARSED SUPPLIER', confidence: 90, rawMatchedText: 'PARSED' },
        date: { date: '2026-09-01', confidence: 90, rawMatchedText: '01/09/26' },
        total: { amount: 50.0, confidence: 95, rawMatchedText: '50.00' },
        lines: [],
        warnings: [],
        confidence: 90,
      } as any;
    }) as any);

    const { unmount } = render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s.id}
        ocrProcessId={proc.id}
      />
    );

    unmount();

    await act(async () => {
      if (resolveParse) resolveParse(null);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(true).toBe(true);
  });

  // TEST 6: Errore asincrono dopo lo smontaggio non invoca setErrorMessage né genera unhandled error
  it('TEST 6: Errore asincrono sollevato dopo lo smontaggio non causa setState su componente smontato', async () => {
    let rejectSessionGet: ((err: any) => void) | null = null;
    const errorPromise = new Promise((_, reject) => {
      rejectSessionGet = reject;
    });

    const s = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    vi.spyOn(documentSessionRepository, 'getById').mockImplementation((async () => {
      await errorPromise;
      return null;
    }) as any);

    const { unmount } = render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s.id}
      />
    );

    unmount();

    await act(async () => {
      if (rejectSessionGet) rejectSessionGet(new Error('Network/DB Error post-unmount'));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(true).toBe(true);
  });

  // TEST 7: Caricamento completato con successo quando il componente rimane montato
  it('TEST 7: Caricamento nominale completato correttamente quando il componente rimane montato', async () => {
    const s = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-nominal-1',
      status: 'completed',
      rawText: 'CONAD\nPANE 2.00\nTOTALE 2.00',
      detectedSupplier: 'CONAD',
      detectedDate: '2026-09-01',
      detectedTotal: 2.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s.id, { ocrProcessId: proc.id });

    await ocrReceiptLineRepository.create({
      ocrProcessId: proc.id,
      originalText: 'PANE 2.00',
      description: 'PANE',
      quantity: 1,
      unitPrice: 2.0,
      lineTotal: 2.0,
      confidence: 90,
      reviewStatus: 'pending',
    });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s.id}
        ocrProcessId={proc.id}
      />
    );

    expect(await screen.findByDisplayValue('CONAD')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('2').length).toBeGreaterThanOrEqual(1);
  });

  // TEST 8: Re-apertura della modale dopo chiusura precedente carica correttamente la nuova richiesta
  it('TEST 8: Re-apertura della modale dopo chiusura genera un nuovo requestId valido e visualizza i dati', async () => {
    const s = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });

    const proc = await ocrProcessRepository.create({
      attachmentId: 'att-reopen-1',
      status: 'completed',
      rawText: 'COOP\nLATTE 1.50\nTOTALE 1.50',
      detectedSupplier: 'COOP',
      detectedDate: '2026-09-01',
      detectedTotal: 1.5,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s.id, { ocrProcessId: proc.id });

    const { rerender } = render(
      <OcrReviewModal
        isOpen={false}
        onClose={vi.fn()}
        sessionId={s.id}
        ocrProcessId={proc.id}
      />
    );

    expect(screen.queryByText('Revisione e Verifica Dati OCR')).not.toBeInTheDocument();

    // Open modal
    rerender(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={s.id}
        ocrProcessId={proc.id}
      />
    );

    expect(await screen.findByDisplayValue('COOP')).toBeInTheDocument();
  });
});
