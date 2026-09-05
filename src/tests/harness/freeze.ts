import crypto from 'crypto';
import { RealReceiptGroundTruth } from './types';

export interface FreezeRawOcrOptions {
  id: string;
  label: string;
  rawText: string;
  groundTruth: RealReceiptGroundTruth;
  layoutNotes?: string;
  ocrEngineVersion?: string;
  sourceVariant?: string;
  imagePath?: string;
}

/**
 * Congela il rawText prodotto da un'acquisizione OCR reale come codice sorgente fixture TypeScript.
 * Mantiene:
 * - Ordine esatto delle righe;
 * - Caratteri prodotti dall'OCR (inclusi refusi, noise, punteggiatura imperfetta);
 * - Separatori e righe vuote significative;
 * - Calcolo di SHA-256, byte count, char count e line count per immutabilità.
 */
export function generateFrozenFixtureSource(options: FreezeRawOcrOptions): string {
  const {
    id,
    label,
    rawText,
    groundTruth,
    layoutNotes = '',
    ocrEngineVersion = 'Tesseract.js v7.0.0 (ita)',
    sourceVariant = 'original',
    imagePath,
  } = options;

  const lines = rawText.split('\n');
  const lineCount = lines.length;
  const charCount = rawText.length;
  const byteCount = new TextEncoder().encode(rawText).length;
  const sha256 = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex');
  const frozenAt = new Date().toISOString();

  // Escaping sicuro del backtick all'interno del raw text template
  const escapedRawText = rawText.replace(/`/g, '\\`').replace(/\${/g, '\\${');

  return `/**
 * REAL RECEIPTS BATCH HARNESS — FROZEN RAW OCR FIXTURE
 * Document ID: ${id}
 * Label: ${label}
 *
 * Line Count: ${lineCount}
 * Chars: ${charCount}
 * Bytes (UTF-8): ${byteCount}
 * SHA-256: ${sha256}
 * Frozen At: ${frozenAt}
 * Engine: ${ocrEngineVersion}
 * Variant: ${sourceVariant}
 *
 * NOTA: Questo file rappresenta il testo grezzo prodotto dall'OCR reale.
 * NON MODIFICARE MANUALMENTE IL RAW TEXT.
 */

import { RealReceiptFixture } from '../../harness/types';

export const ${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_FIXTURE: RealReceiptFixture = {
  id: ${JSON.stringify(id)},
  label: ${JSON.stringify(label)},
  ${imagePath ? `imagePath: ${JSON.stringify(imagePath)},` : ''}
  rawText: \`${escapedRawText}\`,
  groundTruth: ${JSON.stringify(groundTruth, null, 2)},
  layoutNotes: ${JSON.stringify(layoutNotes)},
  metadata: {
    acquisitionDate: ${JSON.stringify(frozenAt.split('T')[0])},
    rawFrozenAt: ${JSON.stringify(frozenAt)},
    ocrEngineVersion: ${JSON.stringify(ocrEngineVersion)},
    sourceVariant: ${JSON.stringify(sourceVariant)},
    sha256: ${JSON.stringify(sha256)},
  },
};
`;
}
