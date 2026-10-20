import type { ReceiptVariantName } from './imagePreprocessing';

export type AcquisitionSource =
  | 'camera'
  | 'gallery'
  | 'pdf'
  | 'append'
  | 'replace'
  | 'unknown';

export interface AppBuildInfo {
  appVersion: string;
  buildId: string;
  gitCommit: string | null;
  buildTimestamp: string;
}

export const getAppBuildInfo = (): AppBuildInfo => {
  const globalBuildInfo = (globalThis as any).__APP_BUILD_INFO__;
  if (globalBuildInfo) {
    return globalBuildInfo;
  }
  return {
    appVersion: '1.0.0',
    buildId: 'build-local-d1',
    gitCommit: null,
    buildTimestamp: new Date().toISOString(),
  };
};

export interface RuntimeDiagnostics {
  userAgent: string | null;
  platform: string | null;
  devicePixelRatio: number | null;
  hardwareConcurrency: number | null;
  language: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  timezone: string | null;
  serviceWorkerSupported: boolean;
  serviceWorkerControlled: boolean;
  serviceWorkerScriptUrl: string | null;
  serviceWorkerState: string | null;
}

export const getRuntimeDiagnostics = async (): Promise<RuntimeDiagnostics> => {
  const isBrowser = typeof window !== 'undefined';
  const nav = isBrowser ? window.navigator : null;

  let swScriptUrl: string | null = null;
  let swState: string | null = null;
  let swControlled = false;
  let swSupported = false;

  if (isBrowser && 'serviceWorker' in navigator) {
    swSupported = true;
    swControlled = Boolean(navigator.serviceWorker.controller);
    if (navigator.serviceWorker.controller) {
      swScriptUrl = navigator.serviceWorker.controller.scriptURL || null;
      swState = navigator.serviceWorker.controller.state || null;
    } else {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const activeSw = reg.active || reg.waiting || reg.installing;
          if (activeSw) {
            swScriptUrl = activeSw.scriptURL || null;
            swState = activeSw.state || null;
          }
        }
      } catch {
        // Fallback sicuro se getRegistration fallisce
      }
    }
  }

  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    timezone = null;
  }

  return {
    userAgent: nav?.userAgent || null,
    platform: nav?.platform || null,
    devicePixelRatio: isBrowser && typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : null,
    hardwareConcurrency: nav && typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    language: nav?.language || null,
    screenWidth: isBrowser && window.screen ? window.screen.width : null,
    screenHeight: isBrowser && window.screen ? window.screen.height : null,
    timezone,
    serviceWorkerSupported: swSupported,
    serviceWorkerControlled: swControlled,
    serviceWorkerScriptUrl: swScriptUrl,
    serviceWorkerState: swState,
  };
};

export interface TesseractDiagnostics {
  tesseractJsVersion: string;
  language: string;
  parameters: {
    preserve_interword_spaces: string;
    user_defined_dpi: string;
    tessedit_pageseg_mode: string;
  };
  tesseractCoreVariant: string | null;
  trainedDataSha256: string | null;
  wasmSimd: boolean | null;
}

export const getTesseractInfo = (): TesseractDiagnostics => {
  return {
    tesseractJsVersion: '7.0.0',
    language: 'ita',
    parameters: {
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '4',
    },
    tesseractCoreVariant: null,
    trainedDataSha256: null,
    wasmSimd: null,
  };
};

export interface DiagnosticExportSchema {
  diagnosticsSchemaVersion: 'OCR-DIAG-D1';
  timestamp: string;
  appBuild: AppBuildInfo;
  runtime: RuntimeDiagnostics;
  source: {
    acquisitionSource: AcquisitionSource;
    inputFileName: string | null;
    inputMimeType: string | null;
    inputSizeBytes: number | null;
    inputLastModified: number | null;
    inputSha256: string | null;
    persistedPayloadSizeBytes: number | null;
    persistedPayloadSha256: string | null;
    inputMatchesPersistedPayload: boolean | null;
    originalWidth: number | null;
    originalHeight: number | null;
    decodedWidth: number | null;
    decodedHeight: number | null;
    rotationDegrees: number;
    maxDimension: number;
    canvasWidth: number | null;
    canvasHeight: number | null;
    canvasOutputMimeType: string;
  };
  ocr: {
    ocrProcessId: string | null;
    sessionId: string | null;
    documentCategory: string | null;
    confidence: number | null;
    selectedVariant: ReceiptVariantName | null;
    variantsAttempted: number | null;
    variantsSkipped: number | null;
    earlyExitTriggered: boolean;
    variantScores: Array<Record<string, any>>;
    tesseract: TesseractDiagnostics;
  };
  result: Record<string, any>;
}
