import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { attachmentRepository, ocrProcessRepository } from '../repositories';
import { validateReceiptFile, processReceiptImage } from '../utils/imagePreprocessing';

describe('Pre-elaborazione Scontrini e Scansione Locale (TEST-RECEIPT-PREPROCESSING)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST-REC-001: Valida correttamente estensioni e tipi di file per la scansione', () => {
    const pdfFile = new File(['dummy content'], 'documento.pdf', { type: 'application/pdf' });
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const validJpg = new File(['dummy bytes'], 'scontrino.jpg', { type: 'image/jpeg' });
    const validPng = new File(['dummy bytes'], 'scontrino.png', { type: 'image/png' });

    expect(validateReceiptFile(pdfFile).valid).toBe(true);
    expect(validateReceiptFile(textFile).valid).toBe(false);
    expect(validateReceiptFile(textFile).error).toContain('Formato file non valido');

    expect(validateReceiptFile(validJpg).valid).toBe(true);
    expect(validateReceiptFile(validPng).valid).toBe(true);
  });

  it('TEST-REC-002: Rifiuta file che superano il limite di 25MB', () => {
    const hugeFile = new File([new Uint8Array(26 * 1024 * 1024)], 'foto_enorme.jpg', {
      type: 'image/jpeg',
    });

    const res = validateReceiptFile(hugeFile);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('25MB');
  });

  it('TEST-REC-003: Elabora immagine scontrino conservando l originale', async () => {
    const dummyImageBase64 =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    const result = await processReceiptImage(dummyImageBase64, {
      maxDimension: 2048,
      rotationDegrees: 90,
      enhanceContrast: true,
      sharpen: true,
    });

    expect(result.originalDataUrl).toBe(dummyImageBase64);
    expect(result.processedDataUrl).toBeDefined();
    expect(typeof result.processedDataUrl).toBe('string');
    expect(result.originalWidth).toBeGreaterThan(0);
    expect(result.originalHeight).toBeGreaterThan(0);
  });

  it('TEST-REC-004: Salva l allegato originale e crea il record OCRProcess associato in stato pending', async () => {
    const dummyOriginalData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // 1. Creazione allegato
    const attachment = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: 'unlinked',
      fileName: 'scontrino_spesa_conad.png',
      description: 'Scontrino scansionato via fotocamera',
      mimeType: 'image/png',
      sizeBytes: 45000,
      storageKey: dummyOriginalData,
      fileHash: 'hash-scontrino-scan-001',
      status: 'active',
    });

    expect(attachment.id).toBeDefined();

    // 2. Creazione processo OCR preliminare
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: attachment.id,
      status: 'pending',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    expect(ocrProc.id).toBeDefined();
    expect(ocrProc.attachmentId).toBe(attachment.id);
    expect(ocrProc.status).toBe('pending');

    // 3. Verifica query da database
    const fetchedProc = await ocrProcessRepository.getByAttachmentId(attachment.id);
    expect(fetchedProc).toBeDefined();
    expect(fetchedProc?.id).toBe(ocrProc.id);
    expect(fetchedProc?.status).toBe('pending');
  });
});
