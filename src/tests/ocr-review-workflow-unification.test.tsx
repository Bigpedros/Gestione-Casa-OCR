import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../database/db';
import { documentSessionRepository, ocrProcessRepository } from '../repositories';
import { PendingOcrReviewBanner } from '../features/attachments/PendingOcrReviewBanner';
import { AttachmentsPage } from '../features/attachments/AttachmentsPage';
import { ExpensesPage } from '../features/expenses/ExpensesPage';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('FASE P4-D1-E2E-W2-R1 — Unificazione Workflow Rivedi Dati Estratti', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('TEST 1: 0 sessioni pendenti -> il banner NON appare', async () => {
    const handleOpenReview = vi.fn();
    const { container } = render(
      <PendingOcrReviewBanner onOpenReview={handleOpenReview} />
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Rivedi dati estratti/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Documenti OCR pronti per la revisione/i)).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('TEST 2: 1 sessione pendente -> premendo il comando viene aperta DIRETTAMENTE la revisione della sessione', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'SEPA-FAST\nTOTALE 45.00',
      detectedSupplier: 'SEPA-FAST',
      detectedDate: '2026-09-01',
      detectedTotal: 45.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    let openedSessionId: string | null = null;
    let openedOcrProcId: string | null = null;

    render(
      <PendingOcrReviewBanner
        onOpenReview={(sId, procId) => {
          openedSessionId = sId;
          openedOcrProcId = procId;
        }}
      />
    );

    const button = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    expect(openedSessionId).toBe(session.id);
    expect(openedOcrProcId).toBe(ocrProc.id);
    expect(screen.queryByText('Seleziona Documento OCR da Rivedere')).not.toBeInTheDocument();
  });

  it('TEST 3: 2 o più sessioni pendenti -> premendo il comando viene mostrato il SELETTORE / MODAL di scelta', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'SEPA-FAST\n45.00',
      detectedSupplier: 'SEPA-FAST',
      detectedTotal: 45.0,
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
      attachmentId: 'att-2',
      status: 'completed',
      rawText: 'TODIS\n22.50',
      detectedSupplier: 'TODIS',
      detectedTotal: 22.5,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    let openedSessionId: string | null = null;

    render(
      <PendingOcrReviewBanner
        onOpenReview={(sId) => {
          openedSessionId = sId;
        }}
      />
    );

    const button = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(button);

    expect(openedSessionId).toBeNull();
    expect(await screen.findByText('Seleziona Documento OCR da Rivedere')).toBeInTheDocument();
    expect(screen.getByText('SEPA-FAST')).toBeInTheDocument();
    expect(screen.getByText('TODIS')).toBeInTheDocument();
  });

  it('TEST 4: la selezione dal selettore apre correttamente la sessione scelta', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'SEPA-FAST\n45.00',
      detectedSupplier: 'SEPA-FAST',
      detectedTotal: 45.0,
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
      attachmentId: 'att-2',
      status: 'completed',
      rawText: 'TODIS\n22.50',
      detectedSupplier: 'TODIS',
      detectedTotal: 22.5,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    let openedSessionId: string | null = null;
    let openedOcrProcId: string | null = null;

    render(
      <PendingOcrReviewBanner
        onOpenReview={(sId, procId) => {
          openedSessionId = sId;
          openedOcrProcId = procId;
        }}
      />
    );

    const button = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(button);

    expect(await screen.findByText('Seleziona Documento OCR da Rivedere')).toBeInTheDocument();

    const todisHeading = screen.getByText('TODIS');
    const todisCard = (todisHeading.closest('div.p-3\\.5') || todisHeading.closest('div[class*="rounded-2xl"]')) as HTMLElement;
    const todisButton = within(todisCard).getByRole('button', { name: /Rivedi/i });

    fireEvent.click(todisButton);

    expect(openedSessionId).toBe(s2.id);
    expect(openedOcrProcId).toBe(proc2.id);
  });

  it('TEST 5: il comportamento è identico se invocato da AttachmentsPage (mostra selettore con 2 sessioni)', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'SEPA-FAST\n45.00',
      detectedSupplier: 'SEPA-FAST',
      detectedTotal: 45.0,
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
      attachmentId: 'att-2',
      status: 'completed',
      rawText: 'TODIS\n22.50',
      detectedSupplier: 'TODIS',
      detectedTotal: 22.5,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    render(
      <MemoryRouter>
        <AttachmentsPage />
      </MemoryRouter>
    );

    const bannerButton = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    expect(bannerButton).toBeInTheDocument();

    fireEvent.click(bannerButton);

    expect(await screen.findByText('Seleziona Documento OCR da Rivedere')).toBeInTheDocument();
    expect(screen.getByText('SEPA-FAST')).toBeInTheDocument();
    expect(screen.getByText('TODIS')).toBeInTheDocument();
  });

  it('TEST 6: il comportamento è identico se invocato da ExpensesPage (mostra selettore con 2 sessioni)', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'SEPA-FAST\n45.00',
      detectedSupplier: 'SEPA-FAST',
      detectedTotal: 45.0,
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
      attachmentId: 'att-2',
      status: 'completed',
      rawText: 'TODIS\n22.50',
      detectedSupplier: 'TODIS',
      detectedTotal: 22.5,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s2.id, { ocrProcessId: proc2.id });

    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    const bannerButton = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    expect(bannerButton).toBeInTheDocument();

    fireEvent.click(bannerButton);

    expect(await screen.findByText('Seleziona Documento OCR da Rivedere')).toBeInTheDocument();
    expect(screen.getByText('SEPA-FAST')).toBeInTheDocument();
    expect(screen.getByText('TODIS')).toBeInTheDocument();
  });

  it('TEST 7: nessuna regressione con 1 sola sessione in ExpensesPage (apre direttamente)', async () => {
    const s1 = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      status: 'ready_for_review',
    });
    const proc1 = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'SEPA-FAST\n45.00',
      detectedSupplier: 'SEPA-FAST',
      detectedTotal: 45.0,
      confirmationRequired: true,
      confirmedByUser: false,
    });
    await documentSessionRepository.update(s1.id, { ocrProcessId: proc1.id });

    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    const bannerButton = await screen.findByRole('button', { name: /Rivedi dati estratti/i });
    fireEvent.click(bannerButton);

    expect(screen.queryByText('Seleziona Documento OCR da Rivedere')).not.toBeInTheDocument();
    expect(await screen.findByText('Revisione e Verifica Dati OCR')).toBeInTheDocument();
  });
});
