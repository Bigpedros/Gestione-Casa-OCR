import { describe, it, expect } from 'vitest';
import { buildDiagnosticReport } from '../utils/diagnosticReport';
import { computeStringSha256, computeBufferSha256, computeDataUrlBinaryHash } from '../utils/imagePreprocessing';
import type { DocumentSession, DocumentPageSegment, OCRProcess } from '../types';

describe('PATCH DIAGNOSTICA D1 — Parità OCR PC / iPhone', () => {
  it('TEST-D1-001: Calcolo SHA-256 per stringhe e buffer', async () => {
    const text = 'SCONTRINO FISCALE 12.50';
    const hash1 = await computeStringSha256(text);
    const hash2 = await computeStringSha256(text);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);

    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const bufferHash = await computeBufferSha256(bytes);
    expect(bufferHash).toBe(hash1);
  });

  it('TEST-D1-002: Calcolo SHA-256 payload binario DataURL base64', async () => {
    // "Hello World" in base64: SGVsbG8gV29ybGQ=
    const dataUrl = 'data:image/png;base64,SGVsbG8gV29ybGQ=';
    const { sha256, sizeBytes } = await computeDataUrlBinaryHash(dataUrl);

    expect(sizeBytes).toBe(11);
    const expected = await computeStringSha256('Hello World');
    expect(sha256).toBe(expected);
  });

  it('TEST-D1-003: Schema D1 generato da buildDiagnosticReport è completo e conforme', async () => {
    const session: DocumentSession = {
      id: 'session-test-d1',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready_for_review',
      pageCount: 1,
      documentType: 'receipt',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        acquisitionSource: 'gallery_picker',
      },
    };

    const segment: DocumentPageSegment = {
      id: 'segment-test-d1',
      sessionId: 'session-test-d1',
      sequenceIndex: 0,
      attachmentId: 'att-1',
      segmentMode: 'page',
      processingStatus: 'processed',
      fileHash: 'test-file-hash',
      originalFileName: 'scontrino.jpg',
      originalMimeType: 'image/jpeg',
      width: 800,
      height: 1200,
      rotationDegrees: 0,
      metadata: {
        acquisitionSource: 'gallery_picker',
        inputAccept: 'image/jpeg,image/png',
        hasCaptureAttribute: false,
        isMultiple: true,
        originalFileSha256: 'orig-sha256-test',
        originalFileSizeBytes: 1024,
        persistedDataUrlSha256: 'persisted-sha256-test',
      },
    };

    const ocrProcess: OCRProcess = {
      id: 'ocr-proc-d1',
      attachmentId: 'att-1',
      status: 'completed',
      confidence: 88,
      confirmationRequired: false,
      confirmedByUser: false,
      rawText: 'ESPRESSO 1.20\nTOTALE 1.20',
      processedAt: new Date().toISOString(),
      metadata: {
        selectedVariant: 'gentle_contrast',
        variantsAttempted: 3,
        variantsSkipped: 0,
        earlyExitTriggered: false,
        variantScores: [
          {
            variant: 'original',
            executionOrder: 1,
            overallScore: 60,
            confidence: 70,
            reasons: [],
          },
          {
            variant: 'gentle_contrast',
            executionOrder: 2,
            overallScore: 88,
            confidence: 88,
            reasons: ['HAS_TOTAL_LABEL'],
          },
        ],
        preprocessingTelemetry: {
          canvasWidth: 800,
          canvasHeight: 1200,
          pixelSha256: 'canvas-pixel-sha256',
        },
      } as any,
    };

    const editableLines = [
      {
        id: 'line-1',
        description: 'ESPRESSO',
        quantity: 1,
        unitPrice: 1.2,
        lineTotal: 1.2,
        confidence: 90,
      },
    ];

    const report = await buildDiagnosticReport({
      session,
      segments: [segment],
      ocrProcess,
      editableLines,
    });

    // Check top-level keys
    expect(report.diagnosticVersion).toBe('D1');
    expect(report.environment).toBeDefined();
    expect(report.environment.appBuildSha).toBeDefined();
    expect(report.tesseract).toBeDefined();
    expect(report.tesseract.coreVersion).toBe('v5.1.0');
    expect(report.session).toBeDefined();
    expect(report.session.acquisitionSource).toBe('gallery_picker');
    expect(report.segments).toHaveLength(1);

    const segRep = report.segments[0];
    expect(segRep.acquisition.acquisitionSource).toBe('gallery_picker');
    expect(segRep.originalFile.sha256).toBe('orig-sha256-test');
    expect(segRep.winningVariant).toBe('gentle_contrast');
    expect(segRep.variants).toHaveLength(2);

    expect(report.ocrProcess).toBeDefined();
    expect(report.ocrProcess.rawTextLength).toBe(ocrProcess.rawText!.length);
    expect(report.ocrProcess.rawTextSha256).toBeDefined();
    expect(report.ocrProcess.extractedLinesCount).toBe(1);
  });
});
