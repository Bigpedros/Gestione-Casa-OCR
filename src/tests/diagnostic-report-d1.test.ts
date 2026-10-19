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
    expect(report.tesseract).toBeDefined();
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

  it('TEST D1-R2-01: In assenza di build info, appBuildSha NON deve essere "8c9a051" e deve essere null o "unknown"', async () => {
    const origBuildInfo = (globalThis as any).__APP_BUILD_INFO__;
    try {
      delete (globalThis as any).__APP_BUILD_INFO__;
      if (typeof window !== 'undefined') {
        delete (window as any).__APP_BUILD_INFO__;
      }

      const report = await buildDiagnosticReport({});
      expect(report.environment.appBuildSha).not.toBe('8c9a051');
      expect([null, 'unknown']).toContain(report.environment.appBuildSha);
    } finally {
      if (origBuildInfo) (globalThis as any).__APP_BUILD_INFO__ = origBuildInfo;
    }
  });

  it('TEST D1-R2-02: In assenza di build info, appBuildTimestamp NON deve essere generato con l\'ora corrente e deve essere null o "unknown"', async () => {
    const origBuildInfo = (globalThis as any).__APP_BUILD_INFO__;
    try {
      delete (globalThis as any).__APP_BUILD_INFO__;
      if (typeof window !== 'undefined') {
        delete (window as any).__APP_BUILD_INFO__;
      }

      const report = await buildDiagnosticReport({});
      expect([null, 'unknown']).toContain(report.environment.appBuildTimestamp);
    } finally {
      if (origBuildInfo) (globalThis as any).__APP_BUILD_INFO__ = origBuildInfo;
    }
  });

  it('TEST D1-R2-03: Quando __APP_BUILD_INFO__ è disponibile, appBuildSha, appBuildTimestamp e appVersion corrispondono', async () => {
    const mockBuildInfo = {
      appVersion: '1.2.3',
      buildId: 'v1.2.3-abcdef0',
      gitCommit: 'abcdef0123456789abcdef0123456789abcdef01',
      buildTimestamp: '2026-09-15T12:00:00.000Z',
    };

    const origBuildInfo = (globalThis as any).__APP_BUILD_INFO__;
    try {
      (globalThis as any).__APP_BUILD_INFO__ = mockBuildInfo;
      if (typeof window !== 'undefined') {
        (window as any).__APP_BUILD_INFO__ = mockBuildInfo;
      }

      const report = await buildDiagnosticReport({});
      expect(report.environment.appBuildSha).toBe(mockBuildInfo.gitCommit);
      expect(report.environment.appBuildTimestamp).toBe(mockBuildInfo.buildTimestamp);
      expect(report.environment.appVersion).toBe(mockBuildInfo.appVersion);
    } finally {
      if (origBuildInfo) {
        (globalThis as any).__APP_BUILD_INFO__ = origBuildInfo;
      } else {
        delete (globalThis as any).__APP_BUILD_INFO__;
      }
    }
  });

  it('TEST D1-R2-04: Il report NON deve dichiarare PSM 6 se tale valore non proviene dalla telemetria runtime', async () => {
    const ocrProcessWithoutParams: OCRProcess = {
      id: 'ocr-proc-no-params',
      attachmentId: 'att-1',
      status: 'completed',
      confidence: 80,
      confirmationRequired: false,
      confirmedByUser: false,
      rawText: 'TEST',
      processedAt: new Date().toISOString(),
      metadata: {} as any,
    };

    const report = await buildDiagnosticReport({ ocrProcess: ocrProcessWithoutParams });
    expect(report.tesseract.ocrParameters.tessedit_pageseg_mode).not.toBe('6');
  });

  it('TEST D1-R2-05: Se il parametro runtime non è disponibile, il report deve restituire null/"unknown" e NON inventare un valore', async () => {
    const ocrProcessEmpty: OCRProcess = {
      id: 'ocr-proc-empty',
      attachmentId: 'att-1',
      status: 'completed',
      confidence: 80,
      confirmationRequired: false,
      confirmedByUser: false,
      rawText: 'TEST',
      processedAt: new Date().toISOString(),
      metadata: {} as any,
    };

    const reportEmpty = await buildDiagnosticReport({ ocrProcess: ocrProcessEmpty });
    expect([null, 'unknown']).toContain(reportEmpty.tesseract.ocrParameters.tessedit_pageseg_mode);
    expect([null, 'unknown']).toContain(reportEmpty.tesseract.ocrParameters.user_defined_dpi);
    expect([null, 'unknown']).toContain(reportEmpty.tesseract.ocrParameters.preserve_interword_spaces);

    // Quando invece i parametri sono esplicitamente forniti dalla telemetria runtime, devono essere riportati fedelmente
    const ocrProcessWithParams: OCRProcess = {
      id: 'ocr-proc-with-params',
      attachmentId: 'att-1',
      status: 'completed',
      confidence: 80,
      confirmationRequired: false,
      confirmedByUser: false,
      rawText: 'TEST',
      processedAt: new Date().toISOString(),
      metadata: {
        ocrParameters: {
          tessedit_pageseg_mode: '4',
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
        },
      } as any,
    };

    const reportWithParams = await buildDiagnosticReport({ ocrProcess: ocrProcessWithParams });
    expect(reportWithParams.tesseract.ocrParameters.tessedit_pageseg_mode).toBe('4');
    expect(reportWithParams.tesseract.ocrParameters.user_defined_dpi).toBe('300');
    expect(reportWithParams.tesseract.ocrParameters.preserve_interword_spaces).toBe('1');
  });
});
