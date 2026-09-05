/**
 * RC-05E: REGIONAL OCR WORKER HELPER
 *
 * Helper isolato per eseguire il riconoscimento mirato di un rettangolo
 * di ritaglio con garanzia tassativa di ripristino dei parametri di produzione.
 */

import type { Worker } from 'tesseract.js';
import { PixelCropBox } from './types';

export class WorkerRestoreError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(`[RegionalWorkerHelper] Worker parameter restore failed: ${message}`);
    this.name = 'WorkerRestoreError';
  }
}

export interface RegionalOcrResult {
  readonly text: string;
  readonly confidence: number;
}

export interface WorkerParameterConfig {
  preserve_interword_spaces?: string;
  user_defined_dpi?: string;
  tessedit_pageseg_mode?: any;
  [key: string]: any;
}

/**
 * Parametri nominali di produzione certificati in ocrService.ts (L201-205)
 */
export const PRODUCTION_TESSERACT_PARAMETERS: WorkerParameterConfig = {
  preserve_interword_spaces: '1',
  user_defined_dpi: '300',
  tessedit_pageseg_mode: '4',
};

/**
 * Parametri per il riconoscimento regionale mirato:
 * - PSM 6: Uniform block of text
 * - NO numeric whitelist
 */
export const REGIONAL_TESSERACT_PARAMETERS: WorkerParameterConfig = {
  preserve_interword_spaces: '1',
  user_defined_dpi: '300',
  tessedit_pageseg_mode: '6',
};

/**
 * Esegue il riconoscimento ottico su una regione rettangolare garantendo
 * il ripristino dei parametri di produzione nel blocco finally.
 */
export async function executeRegionalCropRecognition(
  worker: Pick<Worker, 'setParameters' | 'recognize'>,
  imageSource: any,
  cropBox: PixelCropBox
): Promise<RegionalOcrResult> {
  // 1. Configurazione worker in modalità regionale (PSM 6, no whitelist)
  await worker.setParameters(REGIONAL_TESSERACT_PARAMETERS);

  let recognizeError: unknown = null;
  let restoreError: unknown = null;
  let ocrResult: RegionalOcrResult = { text: '', confidence: 0 };

  try {
    const res = await worker.recognize(imageSource, {
      rectangle: {
        left: cropBox.left,
        top: cropBox.top,
        width: cropBox.width,
        height: cropBox.height,
      },
    } as any);

    ocrResult = {
      text: res?.data?.text || '',
      confidence: res?.data?.confidence ?? 0,
    };
  } catch (err) {
    recognizeError = err;
  } finally {
    // 2. Ripristino GARANTITO dei parametri di produzione (PSM 4)
    try {
      await worker.setParameters(PRODUCTION_TESSERACT_PARAMETERS);
    } catch (restoreErr) {
      restoreError = restoreErr;
    }
  }

  // Se il ripristino è fallito, l'errore non deve MAI essere silenziato
  if (restoreError) {
    throw new WorkerRestoreError(
      restoreError instanceof Error ? restoreError.message : String(restoreError),
      restoreError
    );
  }

  if (recognizeError) {
    throw recognizeError;
  }

  return ocrResult;
}
