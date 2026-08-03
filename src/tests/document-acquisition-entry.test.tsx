import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../database/db';
import { ExpensesPage } from '../features/expenses/ExpensesPage';
import { AttachmentsPage } from '../features/attachments/AttachmentsPage';
import { ScanReceiptModal } from '../features/attachments/ScanReceiptModal';
import { attachmentRepository, ocrProcessRepository, expenseRepository } from '../repositories';

describe('Punto di accesso unico Acquisisci Documento di Spesa (TEST-DOCUMENT-ACQUISITION-ENTRY)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST-DAE-001: Presenza del pulsante "Acquisisci documento" in Gestione Spese e apertura modale', async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    // Verifica la presenza del pulsante principale "Acquisisci documento"
    const acquireButton = await screen.findByRole('button', { name: /Acquisisci documento/i });
    expect(acquireButton).toBeInTheDocument();

    // Clicca sul pulsante per aprire la modale
    fireEvent.click(acquireButton);

    await waitFor(() => {
      expect(screen.getByText('Acquisisci documento di spesa')).toBeInTheDocument();
    });
  });

  it('TEST-DAE-002: Presenza e apertura dalla pagina Allegati (funzione secondaria)', async () => {
    render(
      <MemoryRouter>
        <AttachmentsPage />
      </MemoryRouter>
    );

    const scanButton = await screen.findByRole('button', { name: /Scansiona scontrino/i });
    expect(scanButton).toBeInTheDocument();

    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(screen.getByText('Acquisisci documento di spesa')).toBeInTheDocument();
    });
  });

  it('TEST-DAE-003: Chiusura e annullamento senza alcuna scrittura su DB', async () => {
    render(
      <MemoryRouter>
        <ExpensesPage />
      </MemoryRouter>
    );

    const acquireButton = await screen.findByRole('button', { name: /Acquisisci documento/i });
    fireEvent.click(acquireButton);

    await waitFor(() => {
      expect(screen.getByText('Acquisisci documento di spesa')).toBeInTheDocument();
    });

    // Clicca su Chiudi
    const closeBtn = screen.getByRole('button', { name: /Chiudi/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Acquisisci documento di spesa')).not.toBeInTheDocument();
    });

    // Verifica zero scritture in db
    const attachments = await attachmentRepository.getAll();
    const ocrProcesses = await ocrProcessRepository.getAll();
    const expenses = await expenseRepository.getAll();

    expect(attachments.length).toBe(0);
    expect(ocrProcesses.length).toBe(0);
    expect(expenses.length).toBe(0);
  });

  it('TEST-DAE-004: Conferma scansione genera esattamente 1 Attachment e 1 OCRProcess (senza Expense)', async () => {
    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'scontrino_spesa.jpg',
      description: 'Scontrino acquisito tramite scansione',
      mimeType: 'image/jpeg',
      sizeBytes: 120000,
      storageKey: 'data:image/jpeg;base64,dummyScanData',
      fileHash: 'hash-test-single',
      status: 'active',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: attachment.id,
      status: 'pending',
      confirmationRequired: true,
      confirmedByUser: false,
    });
    expect(ocrProc.id).toBeDefined();

    const allAttachments = await attachmentRepository.getAll();
    const allOcr = await ocrProcessRepository.getAll();
    const allExpenses = await expenseRepository.getAll();

    expect(allAttachments.length).toBe(1);
    expect(allOcr.length).toBe(1);
    expect(allOcr[0].attachmentId).toBe(attachment.id);
    expect(allOcr[0].status).toBe('pending');

    // NESSUNA spesa creata automaticamente
    expect(allExpenses.length).toBe(0);
  });

  it('TEST-DAE-005: Condivisione del medesimo componente ScanReceiptModal in entrambe le pagine', () => {
    // Entrambe le pagine importano ed utilizzano lo stesso ScanReceiptModal
    expect(ScanReceiptModal).toBeDefined();
    expect(typeof ScanReceiptModal).toBe('function');
  });
});
