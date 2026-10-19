import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { jsPDF } from 'jspdf';
import { ScanReceiptModal } from '../features/attachments/ScanReceiptModal';
import { db } from '../database/db';
import {
  attachmentRepository,
  documentSessionRepository,
  documentPageSegmentRepository,
  ocrProcessRepository,
} from '../repositories';

describe('PC-02 — UI Integration Test (ScanReceiptModal PDF flow)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  const createTestDigitalPdf = (lines: string[]): File => {
    const doc = new jsPDF();
    let y = 20;
    lines.forEach((line) => {
      doc.text(line, 20, y);
      y += 10;
    });
    const buffer = doc.output('arraybuffer');
    return new File([new Uint8Array(buffer)], 'scontrino_digitale.pdf', {
      type: 'application/pdf',
    });
  };

  it('Acquisisce PDF digitale, mostra anteprima e crea OCRProcess completato al submit', async () => {
    const onScanComplete = vi.fn();
    const onClose = vi.fn();

    const pdfFile = createTestDigitalPdf([
      'ESSELUNGA S.P.A.',
      'SCONTRINO FISCALE',
      'PASTA BARILLA 500G 1,19 €',
      'LATTE FRESCO 1,59 €',
      'TOTALE 2,78 €',
    ]);

    render(
      <ScanReceiptModal
        isOpen={true}
        onClose={onClose}
        onScanComplete={onScanComplete}
      />
    );

    // Find the PDF file input
    const pdfInput = document.querySelector('input[accept*="application/pdf"]') as HTMLInputElement;
    expect(pdfInput).toBeDefined();

    // Ingest the PDF file
    fireEvent.change(pdfInput, { target: { files: [pdfFile] } });

    // Wait for the modal to advance to the 'pages' step
    await waitFor(() => {
      expect(screen.getByText(/Testo digitale rilevato nel PDF/i)).toBeInTheDocument();
    });

    // Check that segments and session were created
    const sessions = await documentSessionRepository.getAll();
    expect(sessions.length).toBe(1);
    expect(sessions[0].sourceMode).toBe('pdf');
    expect(sessions[0].metadata?.isTextNative).toBe(true);

    const segments = await documentPageSegmentRepository.getBySessionId(sessions[0].id);
    expect(segments.length).toBe(1);
    expect(segments[0].originalFileName).toContain('scontrino_digitale.pdf');

    // Check that attachments exist (original PDF + page image)
    const attachments = await attachmentRepository.getAll();
    const originalPdf = attachments.find((a) => a.mimeType === 'application/pdf');
    expect(originalPdf).toBeDefined();
    expect(originalPdf?.fileName).toBe('scontrino_digitale.pdf');

    // Click on "Continua a Riepilogo"
    const nextBtn = screen.getByRole('button', { name: /Continua a Riepilogo/i });
    fireEvent.click(nextBtn);

    // Click on "Prepara per il riconoscimento"
    const submitBtn = await screen.findByRole('button', { name: /Prepara per il riconoscimento/i });
    fireEvent.click(submitBtn);

    // Verify completion
    await waitFor(() => {
      expect(onScanComplete).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    const [firstAttachmentId, ocrProcessId] = onScanComplete.mock.calls[0];
    expect(firstAttachmentId).toBeDefined();
    const ocrProc = await ocrProcessRepository.getById(ocrProcessId);
    expect(ocrProc).toBeDefined();
    expect(ocrProc?.status).toBe('completed');
    expect(ocrProc?.rawText).toContain('ESSELUNGA');
    expect(ocrProc?.rawText).toContain('TOTALE 2,78');
    expect((ocrProc?.metadata as any)?.source).toBe('pdf_native_text');
  });
});
