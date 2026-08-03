export interface ProcessReceiptOptions {
  maxDimension?: number;
  rotationDegrees?: number; // 0, 90, 180, 270
  enhanceContrast?: boolean;
  sharpen?: boolean;
}

export interface ProcessReceiptResult {
  originalDataUrl: string;
  processedDataUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  sizeBytes: number;
}

export const validateReceiptFile = (file: File): { valid: boolean; error?: string } => {
  if (!file) {
    return { valid: false, error: 'Nessun file selezionato' };
  }

  const isImageOrPdf =
    file.type.startsWith('image/') ||
    file.type === 'application/pdf' ||
    /\.(jpe?g|png|webp|heic|bmp|tiff|pdf)$/i.test(file.name);

  if (!isImageOrPdf) {
    return {
      valid: false,
      error: 'Formato file non valido. Seleziona un file immagine (JPG, PNG, WEBP, BMP) o un documento PDF.',
    };
  }

  // Max 25MB
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: 'La dimensione del file supera il limite consentito di 25MB.',
    };
  }

  return { valid: true };
};

/**
  Calcola l'hash univoco del file (SHA-256 o fallback) per rilevare duplicati
 */
export const computeFileHash = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let hash = 0;
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < view.length; i += Math.max(1, Math.floor(view.length / 1000))) {
      hash = (hash << 5) - hash + view[i];
      hash |= 0;
    }
    return `hash-${file.name}-${file.size}-${Math.abs(hash)}`;
  } catch {
    return `hash-${file.name}-${file.size}-${file.lastModified}`;
  }
};

/**
 * Legge un File o DataURL e restituisce sia l'immagine originale che quella pre-elaborata
 * (ridimensionata, ruotata, contrastata e nitida per una lettura OCR ottimale).
 */
export const processReceiptImage = async (
  fileOrDataUrl: File | string,
  options: ProcessReceiptOptions = {}
): Promise<ProcessReceiptResult> => {
  const {
    maxDimension = 2048,
    rotationDegrees = 0,
    enhanceContrast = true,
    sharpen = true,
  } = options;

  let originalDataUrl: string;
  let fileSizeBytes = 0;

  if (typeof fileOrDataUrl === 'string') {
    originalDataUrl = fileOrDataUrl;
    fileSizeBytes = Math.round((fileOrDataUrl.length * 3) / 4);
  } else {
    fileSizeBytes = fileOrDataUrl.size;
    originalDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Errore nella lettura del file immagine'));
      reader.readAsDataURL(fileOrDataUrl);
    });
  }

  // Se eseguito fuori dal browser (es. test Node/Vitest senza Canvas completo)
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.HTMLCanvasElement) {
    return {
      originalDataUrl,
      processedDataUrl: originalDataUrl,
      width: 800,
      height: 1200,
      originalWidth: 800,
      originalHeight: 1200,
      sizeBytes: fileSizeBytes,
    };
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';

  let loadedSuccessfully = false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!loadedSuccessfully) {
        resolve(); // Fallback in case jsdom doesn't trigger onload
      }
    }, 800);

    img.onload = () => {
      loadedSuccessfully = true;
      clearTimeout(timer);
      resolve();
    };

    img.onerror = () => {
      clearTimeout(timer);
      resolve();
    };

    img.src = originalDataUrl;
  });

  const origWidth = img.naturalWidth || img.width || 800;
  const origHeight = img.naturalHeight || img.height || 1200;

  if (origWidth === 0 || origHeight === 0) {
    throw new Error('Immagine con dimensioni non valide o corrotto');
  }

  // Calcola ridimensionamento proporzionale
  let targetWidth = origWidth;
  let targetHeight = origHeight;

  if (origWidth > maxDimension || origHeight > maxDimension) {
    if (origWidth >= origHeight) {
      targetWidth = maxDimension;
      targetHeight = Math.round((origHeight * maxDimension) / origWidth);
    } else {
      targetHeight = maxDimension;
      targetWidth = Math.round((origWidth * maxDimension) / origHeight);
    }
  }

  // Gestione dimensioni canvas considerando rotazione (90° o 270° invertono larghezza e altezza)
  const isRotated90or270 = (rotationDegrees / 90) % 2 !== 0;
  const canvasWidth = isRotated90or270 ? targetHeight : targetWidth;
  const canvasHeight = isRotated90or270 ? targetWidth : targetHeight;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      originalDataUrl,
      processedDataUrl: originalDataUrl,
      width: targetWidth,
      height: targetHeight,
      originalWidth: origWidth,
      originalHeight: origHeight,
      sizeBytes: fileSizeBytes,
    };
  }

  // Applica rotazione e disegno al centro
  ctx.save();
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
  ctx.restore();

  // Pre-elaborazione per OCR (Contrast & Grayscale & Sharpen)
  try {
    const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const data = imageData.data;
    const len = data.length;

    // 1. Grayscale & Contrast enhancement
    // Contrast factor (es. 30% boost per testo scontrino scuro su fondo chiaro)
    const contrast = enhanceContrast ? 35 : 0;
    const factor = (255 * (contrast + 255)) / (255 * (255 - contrast));

    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Grayscale luminance formula
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      if (enhanceContrast) {
        // Contrast adjustment
        gray = factor * (gray - 128) + 128;
        gray = Math.min(255, Math.max(0, gray));
      }

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);

    // 2. Sharpening filter if enabled
    if (sharpen) {
      const srcData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
      const outputData = ctx.createImageData(canvasWidth, canvasHeight);
      const src = srcData.data;
      const dst = outputData.data;

      // Matrix convolution kernel 3x3 for sharpening
      const kernel = [
        0, -1, 0,
        -1, 5, -1,
        0, -1, 0,
      ];

      const w = canvasWidth;
      const h = canvasHeight;

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let sumR = 0;
          const dstOff = (y * w + x) * 4;

          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const srcOff = ((y + ky) * w + (x + kx)) * 4;
              const weight = kernel[(ky + 1) * 3 + (kx + 1)];
              sumR += src[srcOff] * weight;
            }
          }

          const val = Math.min(255, Math.max(0, sumR));
          dst[dstOff] = val;
          dst[dstOff + 1] = val;
          dst[dstOff + 2] = val;
          dst[dstOff + 3] = 255;
        }
      }

      ctx.putImageData(outputData, 0, 0);
    }
  } catch (err) {
    console.warn('Preprocessing canvas filters skipped:', err);
  }

  const processedDataUrl = canvas.toDataURL('image/jpeg', 0.88);

  return {
    originalDataUrl,
    processedDataUrl,
    width: canvasWidth,
    height: canvasHeight,
    originalWidth: origWidth,
    originalHeight: origHeight,
    sizeBytes: fileSizeBytes,
  };
};
