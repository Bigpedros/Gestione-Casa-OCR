import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { db } from '../database/db';
import {
  documentSessionRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
  expenseRepository,
} from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { OcrReviewModal } from '../features/attachments/OcrReviewModal';
import { receiptParserService } from '../services/ocrParser/receiptParserService';

const REAL_POS_RECEIPT_TEXT = `EUROSPAR
VIA ROMA 123
DATA: 15/03/2026 14:30
PAGAMENTO BANCOMAT
CARTA: ************1234
STAN: 5678 AUT: 9012
IMPORTO: EUR 14,46
OPERAZIONE ESEGUITA
ARRIVEDERCI E GRAZIE`;

describe('FASE P4-D2-RC-02 — Nessuna Falsa Discrepanza per PAYMENT_PROOF', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
    vi.restoreAllMocks();
  });

  // TEST 1
  it('TEST 1: La categoria PAYMENT_PROOF prodotta dal parsing viene persistita in OCRProcess.metadata.documentCategory', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test1',
      status: 'pending',
      rawText: REAL_POS_RECEIPT_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const draft = await receiptParserService.parse(ocrProc.id);
    expect(draft.documentCategory).toBe('PAYMENT_PROOF');

    const updatedProc = await ocrProcessRepository.getById(ocrProc.id);
    expect((updatedProc?.metadata as any)?.documentCategory).toBe('PAYMENT_PROOF');
  });

  // TEST 2
  it('TEST 2: Dopo receiptParserService.parse(ocrProcessId), PAYMENT_PROOF mantiene zero record in ocrReceiptLines', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test2',
      status: 'pending',
      rawText: REAL_POS_RECEIPT_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const draft = await receiptParserService.parse(ocrProc.id);
    expect(draft.lines).toEqual([]);

    const linesInDb = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(linesInDb).toHaveLength(0);
  });

  // TEST 3
  it('TEST 3: PAYMENT_PROOF con totale positivo e zero righe non mostra il banner "Attenzione: Discrepanza sul Totale Documento"', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      metadata: { title: 'Ricevuta_POS_Eurospar' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test3',
      status: 'completed',
      rawText: REAL_POS_RECEIPT_TEXT,
      detectedSupplier: 'EUROSPAR',
      detectedDate: '2026-03-15',
      detectedTotal: 14.46,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'PAYMENT_PROOF',
        detectedPaymentMethod: 'bancomat',
      },
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Attenzione: Discrepanza sul Totale Documento/i)).not.toBeInTheDocument();
  });

  // TEST 4
  it('TEST 4: PAYMENT_PROOF non mostra il box "Discrepanza Rilevata negli Importi"', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      metadata: { title: 'Ricevuta_POS_Eurospar' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test4',
      status: 'completed',
      rawText: REAL_POS_RECEIPT_TEXT,
      detectedSupplier: 'EUROSPAR',
      detectedDate: '2026-03-15',
      detectedTotal: 14.46,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'PAYMENT_PROOF',
        detectedPaymentMethod: 'bancomat',
      },
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Discrepanza Rilevata negli Importi/i)).not.toBeInTheDocument();
  });

  // TEST 5
  it('TEST 5: PAYMENT_PROOF non mostra la checkbox di approvazione della discrepanza', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      metadata: { title: 'Ricevuta_POS_Eurospar' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test5',
      status: 'completed',
      rawText: REAL_POS_RECEIPT_TEXT,
      detectedSupplier: 'EUROSPAR',
      detectedDate: '2026-03-15',
      detectedTotal: 14.46,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'PAYMENT_PROOF',
        detectedPaymentMethod: 'bancomat',
      },
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Confermo la discrepanza e approvo il totale dello scontrino/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  // TEST 6
  it('TEST 6: La diagnostica PAYMENT_PROOF esporta i campi richiesti senza discrepanza', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      metadata: { title: 'Ricevuta_POS_Eurospar' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test6',
      status: 'completed',
      rawText: REAL_POS_RECEIPT_TEXT,
      detectedSupplier: 'EUROSPAR',
      detectedDate: '2026-03-15',
      detectedTotal: 14.46,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'PAYMENT_PROOF',
        detectedPaymentMethod: 'bancomat',
      },
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    const diagToggle = screen.getByText(/Mostra diagnostica OCR/i);
    fireEvent.click(diagToggle);

    const copyBtn = screen.getByRole('button', { name: /Copia diagnostica/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });

    const diagJson = JSON.parse(writeTextMock.mock.calls[0][0]);
    expect(diagJson.documentCategory).toBe('PAYMENT_PROOF');
    expect(diagJson.calculatedSumLines).toBe(0);
    expect(diagJson.discrepancy).toBe(0);
    expect(diagJson.hasDiscrepancy).toBe(false);
    expect(diagJson.validationErrors).toEqual([]);
    expect(diagJson.extractedLines).toEqual([]);
    expect(diagJson.persistedDbLinesCount).toBe(0);
  });

  // TEST 7
  it('TEST 7: "Conferma revisione dati" non viene bloccato dalla falsa discrepanza', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      metadata: { title: 'Ricevuta_POS_Eurospar' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test7',
      status: 'completed',
      rawText: REAL_POS_RECEIPT_TEXT,
      detectedSupplier: 'EUROSPAR',
      detectedDate: '2026-03-15',
      detectedTotal: 14.46,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'PAYMENT_PROOF',
        detectedPaymentMethod: 'bancomat',
      },
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole('button', { name: /Conferma revisione dati/i });
    expect(confirmBtn).not.toBeDisabled();
  });

  // TEST 8
  it('TEST 8: "Crea Registrazione Contabile" non viene bloccato dalla falsa discrepanza e crea realmente una spesa', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      metadata: { title: 'Ricevuta_POS_Eurospar' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test8',
      status: 'completed',
      rawText: REAL_POS_RECEIPT_TEXT,
      detectedSupplier: 'EUROSPAR',
      detectedDate: '2026-03-15',
      detectedTotal: 14.46,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'PAYMENT_PROOF',
        detectedPaymentMethod: 'bancomat',
      },
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    const accountingBtn = screen.getByRole('button', { name: /Crea Registrazione Contabile/i });
    expect(accountingBtn).not.toBeDisabled();

    fireEvent.click(accountingBtn);

    await waitFor(async () => {
      const expenses = await expenseRepository.getAll();
      expect(expenses.length).toBe(1);
      expect(expenses[0].amount).toBe(14.46);
      expect(expenses[0].description).toContain('EUROSPAR');
    });

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('completed');
  });

  // TEST 9
  it('TEST 9: Fallback metadata obbligatorio: session.detectedDocumentCategory undefined, OCRProcess.metadata PAYMENT_PROOF', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    // session.detectedDocumentCategory è undefined
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      metadata: { title: 'Ricevuta_POS_Senza_SessionCategory' },
    });
    expect(session.detectedDocumentCategory).toBeUndefined();

    // OCRProcess contiene la categoria nei metadata
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test9',
      status: 'completed',
      rawText: REAL_POS_RECEIPT_TEXT,
      detectedSupplier: 'EUROSPAR',
      detectedDate: '2026-03-15',
      detectedTotal: 14.46,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'PAYMENT_PROOF',
        detectedPaymentMethod: 'bancomat',
      },
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    // 1. Nessun banner di discrepanza
    expect(screen.queryByText(/Attenzione: Discrepanza sul Totale Documento/i)).not.toBeInTheDocument();

    // 2. Nessun box di discrepanza
    expect(screen.queryByText(/Discrepanza Rilevata negli Importi/i)).not.toBeInTheDocument();

    // 3. Nessuna checkbox
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    // 4. Pulsanti non bloccati
    const confirmBtn = screen.getByRole('button', { name: /Conferma revisione dati/i });
    const accountingBtn = screen.getByRole('button', { name: /Crea Registrazione Contabile/i });
    expect(confirmBtn).not.toBeDisabled();
    expect(accountingBtn).not.toBeDisabled();

    // 5. Diagnostica con discrepancy 0 e hasDiscrepancy false
    const diagToggle = screen.getByText(/Mostra diagnostica OCR/i);
    fireEvent.click(diagToggle);

    const copyBtn = screen.getByRole('button', { name: /Copia diagnostica/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });

    const diagJson = JSON.parse(writeTextMock.mock.calls[0][0]);
    expect(diagJson.documentCategory).toBe('PAYMENT_PROOF');
    expect(diagJson.discrepancy).toBe(0);
    expect(diagJson.hasDiscrepancy).toBe(false);
  });

  // TEST 10
  it('TEST 10: COMMERCIAL_RECEIPT sbilanciato continua a mostrare il banner superiore', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      metadata: { title: 'Scontrino_Sbilanciato' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-comm-test10',
      status: 'completed',
      rawText: 'SUPERMERCATO\nPANE 2.00\nTOTALE 10.00',
      detectedSupplier: 'SUPERMERCATO',
      detectedDate: '2026-03-15',
      detectedTotal: 10.00,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'COMMERCIAL_RECEIPT',
      },
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE 2.00',
      description: 'PANE',
      quantity: 1,
      unitPrice: 2.00,
      lineTotal: 2.00,
      confidence: 90,
      reviewStatus: 'pending',
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('SUPERMERCATO')).toBeInTheDocument();
    });

    expect(screen.getByText(/Attenzione: Discrepanza sul Totale Documento/i)).toBeInTheDocument();
  });

  // TEST 11
  it('TEST 11: COMMERCIAL_RECEIPT sbilanciato continua a mostrare box e checkbox e resta bloccato fino all’approvazione', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      metadata: { title: 'Scontrino_Sbilanciato' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-comm-test11',
      status: 'completed',
      rawText: 'SUPERMERCATO\nPANE 2.00\nTOTALE 10.00',
      detectedSupplier: 'SUPERMERCATO',
      detectedDate: '2026-03-15',
      detectedTotal: 10.00,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'COMMERCIAL_RECEIPT',
      },
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE 2.00',
      description: 'PANE',
      quantity: 1,
      unitPrice: 2.00,
      lineTotal: 2.00,
      confidence: 90,
      reviewStatus: 'pending',
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('SUPERMERCATO')).toBeInTheDocument();
    });

    expect(screen.getByText(/Discrepanza Rilevata negli Importi/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Conferma revisione dati/i });
    expect(confirmBtn).toBeDisabled();

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(confirmBtn).not.toBeDisabled();
  });

  // TEST 12
  it('TEST 12: La diagnostica COMMERCIAL_RECEIPT sbilanciata conserva calculatedSumLines, discrepancy, hasDiscrepancy true e validationErrors', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      metadata: { title: 'Scontrino_Sbilanciato_Diag' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-comm-test12',
      status: 'completed',
      rawText: 'SUPERMERCATO\nPANE 2.00\nTOTALE 10.00',
      detectedSupplier: 'SUPERMERCATO',
      detectedDate: '2026-03-15',
      detectedTotal: 10.00,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'COMMERCIAL_RECEIPT',
      },
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE 2.00',
      description: 'PANE',
      quantity: 1,
      unitPrice: 2.00,
      lineTotal: 2.00,
      confidence: 90,
      reviewStatus: 'pending',
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('SUPERMERCATO')).toBeInTheDocument();
    });

    const diagToggle = screen.getByText(/Mostra diagnostica OCR/i);
    fireEvent.click(diagToggle);

    const copyBtn = screen.getByRole('button', { name: /Copia diagnostica/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });

    const diagJson = JSON.parse(writeTextMock.mock.calls[0][0]);
    expect(diagJson.documentCategory).toBe('COMMERCIAL_RECEIPT');
    expect(diagJson.calculatedSumLines).toBe(2);
    expect(diagJson.discrepancy).toBe(8);
    expect(diagJson.hasDiscrepancy).toBe(true);
    expect(diagJson.validationErrors.length).toBeGreaterThan(0);
    expect(diagJson.validationErrors.some((err: string) => err.toLowerCase().includes('discrepanza'))).toBe(true);
  });

  // TEST 13
  it('TEST 13: COMMERCIAL_RECEIPT perfettamente quadrato: nessun banner, nessun box, nessuna checkbox, discrepancy 0, hasDiscrepancy false', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'COMMERCIAL_RECEIPT',
      metadata: { title: 'Scontrino_Quadrato' },
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-comm-test13',
      status: 'completed',
      rawText: 'SUPERMERCATO\nPANE 2.00\nLATTE 3.00\nTOTALE 5.00',
      detectedSupplier: 'SUPERMERCATO',
      detectedDate: '2026-03-15',
      detectedTotal: 5.00,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(ocrProc.id, {
      metadata: {
        documentCategory: 'COMMERCIAL_RECEIPT',
      },
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE 2.00',
      description: 'PANE',
      quantity: 1,
      unitPrice: 2.00,
      lineTotal: 2.00,
      confidence: 90,
      reviewStatus: 'pending',
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'LATTE 3.00',
      description: 'LATTE',
      quantity: 1,
      unitPrice: 3.00,
      lineTotal: 3.00,
      confidence: 90,
      reviewStatus: 'pending',
    });

    await documentSessionRepository.update(session.id, { ocrProcessId: ocrProc.id });

    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('SUPERMERCATO')).toBeInTheDocument();
    });

    // 1. Nessun banner di discrepanza
    expect(screen.queryByText(/Attenzione: Discrepanza sul Totale Documento/i)).not.toBeInTheDocument();

    // 2. Nessun box di discrepanza
    expect(screen.queryByText(/Discrepanza Rilevata negli Importi/i)).not.toBeInTheDocument();

    // 3. Nessuna checkbox di approvazione discrepanza
    expect(
      screen.queryByText(/Confermo la discrepanza e approvo il totale dello scontrino/i)
    ).not.toBeInTheDocument();

    // 4. Diagnostica: discrepancy 0, hasDiscrepancy false
    const diagToggle = screen.getByText(/Mostra diagnostica OCR/i);
    fireEvent.click(diagToggle);

    const copyBtn = screen.getByRole('button', { name: /Copia diagnostica/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });

    const diagJson = JSON.parse(writeTextMock.mock.calls[0][0]);
    expect(diagJson.documentCategory).toBe('COMMERCIAL_RECEIPT');
    expect(diagJson.calculatedSumLines).toBe(5);
    expect(diagJson.discrepancy).toBe(0);
    expect(diagJson.hasDiscrepancy).toBe(false);
  });

  // TEST 14
  it('TEST 14: Regressione RC-01: testo POS reale classificato PAYMENT_PROOF, draft.lines [], zero righe persistite, parsing ripetuto non genera righe, nessuna falsa discrepanza nella UI', async () => {
    // 1. Parsing iniziale
    const draft1 = receiptParserService.parseText(REAL_POS_RECEIPT_TEXT);
    expect(draft1.documentCategory).toBe('PAYMENT_PROOF');
    expect(draft1.lines).toEqual([]);
    expect(draft1.total.value).toBe(14.46);

    // 2. Persistenza e parse() via service
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-pos-test14',
      status: 'pending',
      rawText: REAL_POS_RECEIPT_TEXT,
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      detectedDocumentCategory: 'PAYMENT_PROOF',
      ocrProcessId: ocrProc.id,
      metadata: { title: 'Test_POS_Regression_RC01' },
    });

    const parsedDraft1 = await receiptParserService.parse(ocrProc.id);
    expect(parsedDraft1.lines).toEqual([]);

    const linesInDb1 = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(linesInDb1).toHaveLength(0);

    // 3. Parsing ripetuto per verificare idempotenza (non deve generare righe)
    const parsedDraft2 = await receiptParserService.parse(ocrProc.id);
    expect(parsedDraft2.lines).toEqual([]);

    const linesInDb2 = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
    expect(linesInDb2).toHaveLength(0);

    // 4. Montaggio UI: nessuna falsa discrepanza
    render(
      <OcrReviewModal
        isOpen={true}
        onClose={vi.fn()}
        sessionId={session.id}
        ocrProcessId={ocrProc.id}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('EUROSPAR')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Attenzione: Discrepanza sul Totale Documento/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Discrepanza Rilevata negli Importi/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Conferma revisione dati/i });
    const accountingBtn = screen.getByRole('button', { name: /Crea Registrazione Contabile/i });
    expect(confirmBtn).not.toBeDisabled();
    expect(accountingBtn).not.toBeDisabled();
  });
});
