import { describe, it, expect, beforeEach } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  isUsableDigitalText,
  processPdfDocument,
} from '../services/pdfProcessingService';
import { db } from '../database/db';
import {
  attachmentRepository,
  documentSessionRepository,
} from '../repositories';
import { receiptParserService } from '../services/ocrParser';

describe('PC-02 — Acquisizione e Processamento PDF Locale', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  // Helper to generate a digital PDF with jsPDF
  const createTestDigitalPdf = (pagesText: string[][]): Uint8Array => {
    const doc = new jsPDF();
    pagesText.forEach((lines, pIdx) => {
      if (pIdx > 0) doc.addPage();
      let y = 20;
      lines.forEach((line) => {
        doc.text(line, 20, y);
        y += 10;
      });
    });
    const buffer = doc.output('arraybuffer');
    return new Uint8Array(buffer);
  };

  it('PC-02-T01: PDF digitale (text-native) estrae il testo strutturato senza invocare Tesseract', async () => {
    const lines = [
      'LEROY MERLIN ITALIA S.r.l.',
      'DOCUMENTO COMMERCIALE',
      'Unita esterna condizionatore COMFEE',
      'codice 98644099 179,00 €',
      'SUBTOTALE 179,00 €',
      'TOTALE 179,00 €',
      '13/09/2026 10:47',
    ];
    const pdfBytes = createTestDigitalPdf([lines]);
    const file = new File([pdfBytes], 'leroy_merlin.pdf', { type: 'application/pdf' });

    const result = await processPdfDocument(file);

    expect(result.totalPages).toBe(1);
    expect(result.isTextNative).toBe(true);
    expect(result.extractedRawText).toContain('LEROY MERLIN');
    expect(result.extractedRawText).toContain('179,00');
    expect(result.pages[0].hasUsableText).toBe(true);

    // Parse the extracted raw text directly with the receipt parser service
    const parsed = receiptParserService.parseText(result.extractedRawText);
    expect(parsed).toBeDefined();
    expect(parsed.total.value).toBe(179);
  });

  it('PC-02-T02: PDF digitale multipagina unisce le pagine nell ordine sequenziale corretto', async () => {
    const page1 = [
      'SUPERMERCATO CENTRALE S.P.A.',
      'DOCUMENTO DI VENDITA PAGINA 1',
      'PANE CASERECCIO 2,50 €',
      'LATTE PARZIALMENTE SCREMATO 1,60 €',
    ];
    const page2 = [
      'DOCUMENTO DI VENDITA PAGINA 2',
      'PASTA DI SEMOLA 1,20 €',
      'SUBTOTALE 5,30 €',
      'TOTALE 5,30 €',
    ];

    const pdfBytes = createTestDigitalPdf([page1, page2]);
    const result = await processPdfDocument(pdfBytes, { fileName: 'multipage.pdf' });

    expect(result.totalPages).toBe(2);
    expect(result.isTextNative).toBe(true);
    expect(result.pages.length).toBe(2);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[1].pageNumber).toBe(2);

    expect(result.pages[0].pageText).toContain('PAGINA 1');
    expect(result.pages[1].pageText).toContain('PAGINA 2');

    // Ensure order is preserved: Page 1 comes before Page 2 in combined text
    const idxPage1 = result.extractedRawText.indexOf('PAGINA 1');
    const idxPage2 = result.extractedRawText.indexOf('PAGINA 2');
    expect(idxPage1).toBeGreaterThanOrEqual(0);
    expect(idxPage2).toBeGreaterThan(idxPage1);
  });

  it('PC-02-T03: PDF con coordinate non allineate raggruppa correttamente le righe con tolleranza', async () => {
    const doc = new jsPDF();
    // Simulate items on the same horizontal line placed at slightly different vertical offsets
    doc.text('DESCRIZIONE PRODOTTO', 20, 30.2);
    doc.text('CODICE 12345', 90, 29.8);
    doc.text('45,00 €', 160, 30.0);

    doc.text('TOTALE COMPLESSIVO', 20, 50.0);
    doc.text('45,00 €', 160, 50.2);

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    const result = await processPdfDocument(pdfBytes);

    expect(result.isTextNative).toBe(true);
    const lines = result.extractedRawText.split('\n').filter((l) => l.trim().length > 0);
    
    // First line should reconstruct all 3 items left-to-right
    expect(lines[0]).toContain('DESCRIZIONE PRODOTTO');
    expect(lines[0]).toContain('CODICE 12345');
    expect(lines[0]).toContain('45,00');
  });

  it('PC-02-T04: PDF scansito/immagine senza testo utile attiva la modalità fallback (isTextNative = false)', async () => {
    const doc = new jsPDF();
    // No text, or just a single artifact character
    doc.text('.', 10, 10);
    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));

    const result = await processPdfDocument(pdfBytes);

    expect(result.totalPages).toBe(1);
    expect(result.isTextNative).toBe(false);
    expect(result.pages[0].hasUsableText).toBe(false);
    expect(result.pages[0].imageDataUrl).toBeDefined();
  });

  it('PC-02-T05: PDF corrotto o non leggibile genera messaggio utente comprensivo e non va in crash', async () => {
    const invalidBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    await expect(processPdfDocument(invalidBytes)).rejects.toThrow(
      'Non è stato possibile leggere questo PDF. Puoi provare a convertirlo in immagine oppure inserire i dati manualmente.'
    );
  });

  it('PC-02-T06: Attachment del PDF originale viene conservato inalterato in IndexedDB', async () => {
    const lines = [
      'FATTURA COMMERCIALE 2026',
      'FORNITORE ABC SRL',
      'TOTALE 120,50 €',
    ];
    const pdfBytes = createTestDigitalPdf([lines]);
    let binary = '';
    for (let i = 0; i < pdfBytes.length; i++) {
      binary += String.fromCharCode(pdfBytes[i]);
    }
    const pdfDataUrl = 'data:application/pdf;base64,' + btoa(binary);

    // Create session
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'pdf',
      processingMode: 'singleReceipt',
      status: 'draft',
    });

    // Save original PDF attachment
    const pdfAttachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'fattura.pdf',
      description: 'Documento PDF originale',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
      storageKey: pdfDataUrl,
      fileHash: 'sha256-test-pdf-original',
      status: 'active',
    });

    const retrieved = await attachmentRepository.getById(pdfAttachment.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.mimeType).toBe('application/pdf');
    expect(retrieved?.fileName).toBe('fattura.pdf');
    expect(retrieved?.storageKey).toBe(pdfDataUrl);
  });

  it('PC-02-T07: Verifica soglia isUsableDigitalText per evitare falsi positivi', () => {
    expect(isUsableDigitalText('')).toBe(false);
    expect(isUsableDigitalText('   \n\t  ')).toBe(false);
    expect(isUsableDigitalText('1 2')).toBe(false);
    expect(isUsableDigitalText('PDF scanned artifact .')).toBe(false);
    
    // Real receipt with supplier, items, prices
    const realText = `LEROY MERLIN ITALIA S.r.l.
DOCUMENTO COMMERCIALE
Unita esterna condizionatore COMFEE mono 179,00 €
TOTALE 179,00 €`;
    expect(isUsableDigitalText(realText)).toBe(true);
  });
});
