// Polyfill Promise.try, Promise.withResolvers and Uint8Array.prototype.toHex for environments lacking latest TC39 proposals
if (typeof (Promise as any).try !== 'function') {
  (Promise as any).try = function (fn: any, ...args: any[]) {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}
if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function () {
    let resolve: any, reject: any;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
if (typeof (Uint8Array.prototype as any).toHex !== 'function') {
  (Uint8Array.prototype as any).toHex = function () {
    return Array.from(this)
      .map((b: any) => (b as number).toString(16).padStart(2, '0'))
      .join('');
  };
}
if (typeof (Uint8Array as any).fromHex !== 'function') {
  (Uint8Array as any).fromHex = function (hexString: string) {
    const bytes = new Uint8Array(Math.floor(hexString.length / 2));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  };
}

import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/build/pdf.worker.mjs';

export interface PdfPageProcessed {
  pageNumber: number; // 1-indexed
  pageText: string;
  hasUsableText: boolean;
  imageDataUrl: string;
  width: number;
  height: number;
}

export interface PdfDocumentProcessed {
  totalPages: number;
  isTextNative: boolean;
  extractedRawText: string;
  pages: PdfPageProcessed[];
  originalFileName?: string;
  originalFileSize?: number;
}

export interface TextItemData {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Checks if the extracted text meets the conservative threshold for usable digital text.
 * Distinguishes true digital/text-native PDFs from scanned PDFs with 1-2 random artifact characters.
 */
export function isUsableDigitalText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  
  // Count alphanumeric characters
  const alphanumericMatches = text.match(/[a-zA-Z0-9]/g);
  const alphanumericCount = alphanumericMatches ? alphanumericMatches.length : 0;
  
  // A genuine receipt or document has at least ~25 alphanumeric characters
  if (alphanumericCount < 25) return false;
  
  // Require at least 3 distinct words of at least 2 characters each
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
    
  return words.length >= 3;
}

/**
 * Extracts structured text from a single PDF page, grouping items on the same vertical line
 * with a tolerance, sorting lines top-to-bottom (Y descending in PDF) and sorting items
 * within lines left-to-right (X ascending).
 */
export async function extractStructuredTextFromPage(
  page: pdfjsLib.PDFPageProxy,
  lineTolerance: number = 3.5
): Promise<{ text: string; lineCount: number; hasUsableText: boolean }> {
  try {
    const textContent = await page.getTextContent();
    const items: TextItemData[] = [];

    for (const item of textContent.items) {
      if ('str' in item && typeof item.str === 'string') {
        const str = item.str;
        const transform = item.transform;
        const x = transform ? transform[4] : 0;
        const y = transform ? transform[5] : 0;
        const height = item.height || (transform ? Math.abs(transform[3]) : 10);
        const width = item.width || 0;
        items.push({ str, x, y, width, height });
      }
    }

    if (items.length === 0) {
      return { text: '', lineCount: 0, hasUsableText: false };
    }

    // Group items into lines based on Y coordinate with tolerance
    const lineBuckets: { y: number; items: TextItemData[] }[] = [];

    for (const item of items) {
      let matchedLine = lineBuckets.find((l) => Math.abs(l.y - item.y) <= lineTolerance);
      if (!matchedLine) {
        matchedLine = { y: item.y, items: [] };
        lineBuckets.push(matchedLine);
      }
      matchedLine.items.push(item);
    }

    // Sort lines top-to-bottom: In PDF coordinate system, Y=0 is bottom, so higher Y is top
    lineBuckets.sort((a, b) => b.y - a.y);

    // Reconstruct each line by sorting items X ascending (left-to-right)
    const lineStrings = lineBuckets
      .map((bucket) => {
        bucket.items.sort((a, b) => a.x - b.x);
        let lineStr = '';
        let lastX = -1;
        let lastWidth = 0;

        for (const it of bucket.items) {
          const text = it.str;
          if (!text) continue;

          if (lineStr.length === 0) {
            lineStr = text;
          } else {
            const gap = it.x - (lastX + lastWidth);
            const hasLeadingSpace = text.startsWith(' ');
            const hasTrailingSpace = lineStr.endsWith(' ');
            if (gap > 2 && !hasLeadingSpace && !hasTrailingSpace) {
              lineStr += ' ' + text;
            } else {
              lineStr += text;
            }
          }
          lastX = it.x;
          lastWidth = it.width || 0;
        }
        return lineStr.trim();
      })
      .filter((line) => line.length > 0);

    const pageText = lineStrings.join('\n');
    return {
      text: pageText,
      lineCount: lineStrings.length,
      hasUsableText: isUsableDigitalText(pageText),
    };
  } catch (err) {
    console.warn('[pdfProcessingService] Errore estrazione testo pagina:', err);
    return { text: '', lineCount: 0, hasUsableText: false };
  }
}

/**
 * Renders a PDF page to an HTMLCanvasElement at high resolution (~200-300 DPI)
 * with a conservative maximum dimension limit to protect browser memory.
 */
export async function renderPdfPageToCanvas(
  page: pdfjsLib.PDFPageProxy,
  targetDpi: number = 200,
  maxDimension: number = 2400
): Promise<HTMLCanvasElement> {
  // Standard PDF is 72 DPI. Target DPI scale:
  const baseScale = targetDpi / 72;
  const initialViewport = page.getViewport({ scale: baseScale });

  let scale = baseScale;
  if (initialViewport.width > maxDimension || initialViewport.height > maxDimension) {
    const maxSide = Math.max(initialViewport.width, initialViewport.height);
    scale = (baseScale * maxDimension) / maxSide;
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    // If running in an environment without 2d context (e.g. basic jsdom test), fallback
    return canvas;
  }

  // Draw solid white background
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: context,
    viewport,
  };

  try {
    await (page.render(renderContext as any) as any).promise;
  } catch (renderErr) {
    console.warn('[pdfProcessingService] Errore render pagina su canvas:', renderErr);
  }

  return canvas;
}

/**
 * Converts a canvas element to a JPEG data URL.
 */
export function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number = 0.92): string {
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return '';
  }
}

/**
 * Helper to convert File, Blob, ArrayBuffer, or base64 dataUrl into Uint8Array.
 */
export async function convertPdfInputToUint8Array(
  input: File | Blob | ArrayBuffer | Uint8Array | string
): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (typeof input === 'string') {
    if (input.startsWith('data:')) {
      const base64Data = input.split(',')[1] || '';
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    // Plain string, encode
    return new TextEncoder().encode(input);
  }
  if (input && typeof (input as any).arrayBuffer === 'function') {
    try {
      const buffer = await (input as any).arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      // fallback to FileReader below
    }
  }
  if ((typeof Blob !== 'undefined' && input instanceof Blob) || (input && typeof (input as any).size === 'number')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result;
        if (res instanceof ArrayBuffer) {
          resolve(new Uint8Array(res));
        } else if (typeof res === 'string') {
          resolve(new TextEncoder().encode(res));
        } else {
          reject(new Error('Impossibile convertire Blob in ArrayBuffer'));
        }
      };
      reader.onerror = () => reject(new Error('Errore nella lettura del file'));
      reader.readAsArrayBuffer(input as Blob);
    });
  }
  throw new Error('Formato input PDF non riconosciuto');
}

/**
 * Primary orchestrator for processing a PDF document locally.
 * - Extracts structured text per page with line reconstruction
 * - Renders high-quality preview/OCR images per page
 * - Classifies whether the document is text-native or scanned image
 */
export async function processPdfDocument(
  input: File | Blob | ArrayBuffer | Uint8Array | string,
  options?: {
    fileName?: string;
    targetDpi?: number;
    maxDimension?: number;
    onProgress?: (progressText: string, current: number, total: number) => void;
  }
): Promise<PdfDocumentProcessed> {
  let uint8Data: Uint8Array;
  try {
    uint8Data = await convertPdfInputToUint8Array(input);
  } catch {
    throw new Error(
      'Non è stato possibile leggere questo PDF. Puoi provare a convertirlo in immagine oppure inserire i dati manualmente.'
    );
  }

  let pdfDoc: pdfjsLib.PDFDocumentProxy;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Data,
      useSystemFonts: true,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err: any) {
    console.error('[pdfProcessingService] Errore caricamento PDF:', err);
    throw new Error(
      'Non è stato possibile leggere questo PDF. Puoi provare a convertirlo in immagine oppure inserire i dati manualmente.'
    );
  }

  const totalPages = pdfDoc.numPages || 1;
  const processedPages: PdfPageProcessed[] = [];
  const pageTexts: string[] = [];

  for (let i = 1; i <= totalPages; i++) {
    if (options?.onProgress) {
      options.onProgress(
        `Preparazione pagina ${i} di ${totalPages}...`,
        i,
        totalPages
      );
    }

    try {
      const page = await pdfDoc.getPage(i);
      
      // 1. Extract structured digital text
      let pageText = '';
      let hasUsableText = false;
      try {
        const textRes = await extractStructuredTextFromPage(page);
        pageText = textRes.text;
        hasUsableText = textRes.hasUsableText;
        if (pageText) {
          pageTexts.push(pageText);
        }
      } catch (textErr) {
        console.warn(`[pdfProcessingService] Errore estrazione testo pagina ${i}:`, textErr);
      }

      // 2. Render page to canvas for preview / fallback OCR
      let dataUrl = '';
      let canvasWidth = 800;
      let canvasHeight = 1100;
      try {
        const canvas = await renderPdfPageToCanvas(
          page,
          options?.targetDpi ?? 200,
          options?.maxDimension ?? 2400
        );
        dataUrl = canvasToJpegDataUrl(canvas, 0.92);
        canvasWidth = canvas.width || 800;
        canvasHeight = canvas.height || 1100;
      } catch (renderErr) {
        console.warn(`[pdfProcessingService] Errore rendering canvas pagina ${i}:`, renderErr);
      }

      processedPages.push({
        pageNumber: i,
        pageText,
        hasUsableText,
        imageDataUrl: dataUrl || (typeof input === 'string' && input.startsWith('data:') ? input : ''),
        width: canvasWidth,
        height: canvasHeight,
      });
    } catch (pageErr) {
      console.warn(`[pdfProcessingService] Errore elaborazione pagina ${i}:`, pageErr);
      processedPages.push({
        pageNumber: i,
        pageText: '',
        hasUsableText: false,
        imageDataUrl: '',
        width: 800,
        height: 1100,
      });
    }
  }

  const combinedRawText = pageTexts.join('\n\n');
  const isOverallTextNative = isUsableDigitalText(combinedRawText);

  let originalFileSize = uint8Data.byteLength;
  if (input instanceof File) {
    originalFileSize = input.size;
  }

  return {
    totalPages,
    isTextNative: isOverallTextNative,
    extractedRawText: combinedRawText,
    pages: processedPages,
    originalFileName: options?.fileName || (input instanceof File ? input.name : 'documento.pdf'),
    originalFileSize,
  };
}
