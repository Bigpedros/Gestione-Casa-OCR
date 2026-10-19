import { computeStringSha256 } from './imagePreprocessing';
import type {
  DocumentSession,
  DocumentPageSegment,
  OCRProcess,
  Attachment,
} from '../types';

declare const __APP_BUILD_INFO__: {
  appVersion: string;
  buildId: string;
  gitCommit: string | null;
  buildTimestamp: string;
} | undefined;

export interface DiagnosticReportOptions {
  session?: DocumentSession | null;
  segments?: DocumentPageSegment[];
  attachmentsMap?: Record<string, Attachment>;
  ocrProcess?: OCRProcess | null;
  editableLines?: any[];
  documentCategory?: string | null;
  calculatedSumLines?: number;
  discrepancy?: number;
  hasDiscrepancy?: boolean;
  isDiscrepancyApproved?: boolean;
  validationErrors?: any[];
  detectedSupplierName?: string | null;
  selectedSupplierName?: string | null;
  expenseDate?: string | null;
  isDateDetectedFromOcr?: boolean;
  documentTotal?: number | null;
  paymentMethod?: string | null;
  persistedDbLinesCount?: number;
  normalizedLines?: string[];
  documentTitle?: string | null;
}

export const buildDiagnosticReport = async (
  opts: DiagnosticReportOptions
): Promise<Record<string, any>> => {
  const {
    session,
    segments = [],
    attachmentsMap = {},
    ocrProcess,
    editableLines = [],
  } = opts;

  const ocrProcessMetadata = (ocrProcess?.metadata as Record<string, any>) || {};
  const rawText = ocrProcess?.rawText || '';
  const rawTextSha256 = await computeStringSha256(rawText);

  // Environment & Build Info detection
  let appBuildInfo: {
    appVersion?: string;
    buildId?: string;
    gitCommit?: string | null;
    buildTimestamp?: string | null;
  } | null = null;

  try {
    if (typeof __APP_BUILD_INFO__ !== 'undefined' && __APP_BUILD_INFO__) {
      appBuildInfo = __APP_BUILD_INFO__;
    } else if (typeof window !== 'undefined' && (window as any).__APP_BUILD_INFO__) {
      appBuildInfo = (window as any).__APP_BUILD_INFO__;
    } else if (typeof globalThis !== 'undefined' && (globalThis as any).__APP_BUILD_INFO__) {
      appBuildInfo = (globalThis as any).__APP_BUILD_INFO__;
    }
  } catch {
    appBuildInfo = null;
  }

  const appBuildSha = appBuildInfo?.gitCommit ?? null;
  const appBuildTimestamp = appBuildInfo?.buildTimestamp ?? null;
  const appVersion = appBuildInfo?.appVersion ?? '1.0.0';

  let isStandalone = false;
  let serviceWorkerState = 'unsupported';
  let screenWidth = 0;
  let screenHeight = 0;
  let devicePixelRatio = 1;
  let userAgent = '';
  let platform = '';
  let deviceMemory: any = 'N/A';
  let hardwareConcurrency: any = 'N/A';
  let isSecureContext = true;

  if (typeof window !== 'undefined') {
    screenWidth = window.screen?.width || 0;
    screenHeight = window.screen?.height || 0;
    devicePixelRatio = window.devicePixelRatio || 1;
    isSecureContext = window.isSecureContext ?? false;
    isStandalone =
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as any)?.standalone === true;

    if ('serviceWorker' in navigator) {
      serviceWorkerState = navigator.serviceWorker.controller ? 'active' : 'inactive';
    }
  }

  if (typeof navigator !== 'undefined') {
    userAgent = navigator.userAgent || '';
    platform = navigator.platform || '';
    if ('deviceMemory' in navigator) {
      deviceMemory = (navigator as any).deviceMemory;
    }
    if ('hardwareConcurrency' in navigator) {
      hardwareConcurrency = navigator.hardwareConcurrency;
    }
  }

  // Determine Max Canvas Dimension safely (avoid jsdom getContext warning)
  let maxCanvasDimension = 16384;
  if (typeof document !== 'undefined' && !userAgent.includes('jsdom')) {
    try {
      const testCanvas = document.createElement('canvas');
      const gl =
        testCanvas.getContext('webgl') ||
        (testCanvas.getContext('experimental-webgl') as any);
      if (gl) {
        maxCanvasDimension = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 16384;
      }
    } catch {
      maxCanvasDimension = 16384;
    }
  }

  const primaryTelemetry = ocrProcessMetadata.preprocessingTelemetry || {};

  const mappedSegments = segments.map((seg, idx) => {
    const segMeta = (seg.metadata as Record<string, any>) || {};
    const att = attachmentsMap[seg.id] || (seg.attachmentId ? attachmentsMap[seg.attachmentId] : undefined);
    const sessionMeta = (session?.metadata as Record<string, any>) || {};
    const variantScores = Array.isArray(ocrProcessMetadata.variantScores)
      ? ocrProcessMetadata.variantScores
      : [];

    return {
      segmentIndex: seg.sequenceIndex ?? idx,
      acquisition: {
        acquisitionSource:
          segMeta.acquisitionSource || sessionMeta.acquisitionSource || 'gallery_picker',
        inputAccept:
          segMeta.inputAccept || 'image/jpeg,image/jpg,image/png,image/webp,image/bmp',
        hasCaptureAttribute: segMeta.hasCaptureAttribute ?? false,
        isMultiple: segMeta.isMultiple ?? true,
      },
      originalFile: {
        fileName: segMeta.originalFileName || seg.originalFileName || att?.fileName || 'unknown',
        mimeType: segMeta.originalMimeType || seg.originalMimeType || att?.mimeType || 'image/jpeg',
        sizeBytes: segMeta.originalFileSizeBytes || att?.sizeBytes || 0,
        lastModified: segMeta.originalFileLastModified || null,
        sha256: segMeta.originalFileSha256 || seg.fileHash || att?.fileHash || '',
      },
      persistedDataUrl: {
        length: segMeta.persistedDataUrlLength || att?.storageKey?.length || 0,
        sizeBytes: segMeta.persistedDataUrlSizeBytes || att?.sizeBytes || 0,
        sha256: segMeta.persistedDataUrlSha256 || seg.fileHash || att?.fileHash || '',
      },
      decodedImage: {
        naturalWidth: primaryTelemetry.decodedNaturalWidth || seg.width || 0,
        naturalHeight: primaryTelemetry.decodedNaturalHeight || seg.height || 0,
        aspectRatio:
          primaryTelemetry.decodedAspectRatio ||
          (seg.width && seg.height ? Math.round((seg.width / seg.height) * 1000) / 1000 : 0),
      },
      canvas: {
        width: primaryTelemetry.canvasWidth || seg.width || 0,
        height: primaryTelemetry.canvasHeight || seg.height || 0,
        scaleFactor: primaryTelemetry.canvasScaleFactor || 1,
        rotationDegreesApplied: seg.rotationDegrees || 0,
        pixelSha256: primaryTelemetry.pixelSha256 || 'unknown',
        pixelBytesLength: primaryTelemetry.pixelBytesLength || 0,
      },
      variants: variantScores.map((v: any, vIdx: number) => ({
        variantName: v.variant || 'original',
        executionOrder: v.executionOrder ?? vIdx + 1,
        width: v.width || 0,
        height: v.height || 0,
        encodedMimeType: v.encodedMimeType || 'image/png',
        encodedSizeBytes: v.encodedSizeBytes || 0,
        encodedSha256: v.encodedSha256 || '',
        pixelSha256: v.pixelSha256 || '',
        processingTimeMs: v.processingTimeMs || 0,
        ocrConfidence: v.confidence || 0,
        ocrOverallScore: v.overallScore || 0,
        ocrTextLength: v.ocrTextLength || 0,
        ocrLineCount: v.ocrLineCount || 0,
        ocrTextSha256: v.ocrTextSha256 || '',
        ocrSnippet: v.ocrSnippet || '',
        scoreReasons: Array.isArray(v.reasons) ? v.reasons : [],
        ocrExecutionTimeMs: v.ocrExecutionTimeMs || 0,
      })),
      variantsAttempted: ocrProcessMetadata.variantsAttempted ?? (variantScores.length || 1),
      variantsSkipped: ocrProcessMetadata.variantsSkipped ?? 0,
      earlyExitTriggered: ocrProcessMetadata.earlyExitTriggered ?? false,
      winningVariant: ocrProcessMetadata.selectedVariant || 'original',
      winningRule: 'punteggio complessivo massimo',
    };
  });

  const resolvedDocumentCategory =
    opts.documentCategory ||
    ocrProcessMetadata.documentCategory ||
    (session?.metadata as any)?.detectedDocumentCategory ||
    (session?.metadata as any)?.documentCategory ||
    null;

  const finalExtractedLines = editableLines.map((l: any, index: number) => ({
    index: index + 1,
    id: l.id,
    originalText: l.originalText,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    isNegative: l.lineTotal < 0,
    confidence: l.confidence,
    warnings: Array.isArray(l.warnings) ? l.warnings : [],
    categoryId: l.categoryId || null,
    productId: l.productId || null,
    actionMode: l.actionMode || 'create',
  }));

  const calculatedSum =
    opts.calculatedSumLines !== undefined
      ? opts.calculatedSumLines
      : Math.round(
          editableLines.reduce((acc, l) => acc + (Number(l.lineTotal) || 0), 0) * 100
        ) / 100;

  const docTotal = opts.documentTotal ?? (ocrProcess?.detectedTotal || 0);
  const diffVal =
    resolvedDocumentCategory === 'PAYMENT_PROOF'
      ? 0
      : Math.round(Math.abs(docTotal - calculatedSum) * 100) / 100;
  const discrepancy = opts.discrepancy !== undefined ? opts.discrepancy : diffVal;
  const hasDiscrepancy =
    opts.hasDiscrepancy !== undefined
      ? opts.hasDiscrepancy
      : resolvedDocumentCategory === 'PAYMENT_PROOF'
      ? false
      : discrepancy > 0.05;

    const tesseractTelemetry =
      ocrProcessMetadata.tesseract ||
      ocrProcessMetadata.tesseractTelemetry ||
      ocrProcessMetadata.ocrTelemetry ||
      {};

    const ocrParams =
      ocrProcessMetadata.ocrParameters ||
      tesseractTelemetry.ocrParameters ||
      {};

    const tesseditPagesegMode =
      ocrParams.tessedit_pageseg_mode ??
      ocrProcessMetadata.tessedit_pageseg_mode ??
      tesseractTelemetry.tessedit_pageseg_mode ??
      null;

    const userDefinedDpi =
      ocrParams.user_defined_dpi ??
      ocrProcessMetadata.user_defined_dpi ??
      tesseractTelemetry.user_defined_dpi ??
      null;

    const preserveInterwordSpaces =
      ocrParams.preserve_interword_spaces ??
      ocrProcessMetadata.preserve_interword_spaces ??
      tesseractTelemetry.preserve_interword_spaces ??
      null;

    const tesseractCoreVersion =
      tesseractTelemetry.coreVersion ??
      ocrProcessMetadata.coreVersion ??
      null;

    const tesseractWorkerType =
      tesseractTelemetry.workerType ??
      ocrProcessMetadata.workerType ??
      (typeof Worker !== 'undefined' ? 'web_worker' : null);

    const tesseractLang =
      tesseractTelemetry.lang ??
      ocrProcessMetadata.lang ??
      null;

    const traineddataSha256 =
      tesseractTelemetry.traineddataSha256 ??
      ocrProcessMetadata.traineddataSha256 ??
      null;

    return {
    // Legacy top-level fields for full backward-compatibility with tests & review modal
    timestamp: new Date().toISOString(),
    ocrProcessId: ocrProcess?.id || null,
    sessionId: session?.id || null,
    documentTitle: opts.documentTitle || (session?.metadata?.title as string) || null,
    documentCategory: resolvedDocumentCategory,
    confidence: ocrProcess?.confidence || null,
    selectedVariant: ocrProcessMetadata.selectedVariant || null,
    variantScores: ocrProcessMetadata.variantScores || [],
    detectedSupplier: opts.detectedSupplierName ?? (ocrProcess?.detectedSupplier || null),
    selectedSupplier: opts.selectedSupplierName ?? (opts.detectedSupplierName ?? (ocrProcess?.detectedSupplier || null)),
    detectedDate: opts.expenseDate ?? (ocrProcess?.detectedDate || null),
    isDateDetectedFromOcr: opts.isDateDetectedFromOcr ?? false,
    detectedTotal: opts.documentTotal ?? (ocrProcess?.detectedTotal || null),
    paymentMethod: opts.paymentMethod ?? (ocrProcessMetadata.detectedPaymentMethod || null),
    rawText,
    normalizedLines: opts.normalizedLines ?? (ocrProcessMetadata.normalizedLines || []),
    persistedDbLinesCount: opts.persistedDbLinesCount ?? 0,
    extractedLines: finalExtractedLines,
    calculatedSumLines: calculatedSum,
    discrepancy,
    hasDiscrepancy,
    isDiscrepancyApproved: opts.isDiscrepancyApproved ?? false,
    validationErrors: opts.validationErrors || [],

    // Schema D1 structured sections
    diagnosticVersion: 'D1',
    generatedAt: new Date().toISOString(),
    environment: {
      appBuildSha,
      appBuildTimestamp,
      appVersion,
      userAgent,
      platform,
      deviceMemory,
      hardwareConcurrency,
      screenWidth,
      screenHeight,
      devicePixelRatio,
      maxCanvasDimension,
      isSecureContext,
      isStandalone,
      serviceWorkerState,
    },
    tesseract: {
      coreVersion: tesseractCoreVersion,
      workerType: tesseractWorkerType,
      lang: tesseractLang,
      traineddataSha256: traineddataSha256,
      ocrParameters: {
        tessedit_pageseg_mode: tesseditPagesegMode,
        user_defined_dpi: userDefinedDpi,
        preserve_interword_spaces: preserveInterwordSpaces,
      },
    },
    session: {
      sessionId: session?.id || '',
      documentType: session?.documentType || 'receipt',
      sourceMode: session?.sourceMode || 'singleImage',
      processingMode: session?.processingMode || 'singleReceipt',
      status: session?.status || 'ready_for_review',
      acquisitionSource:
        (session?.metadata as any)?.acquisitionSource || 'gallery_picker',
      pageCount: session?.pageCount || segments.length || 1,
    },
    segments: mappedSegments,
    ocrProcess: {
      ocrProcessId: ocrProcess?.id || '',
      status: ocrProcess?.status || 'completed',
      confidence: ocrProcess?.confidence || 0,
      rawTextLength: rawText.length,
      rawTextSha256,
      rawText,
      extractedLinesCount: editableLines.length,
      extractedLines: finalExtractedLines,
    },
  };
};
