export type ReceiptVariantName = 'original' | 'gentle_contrast' | 'sharpened_light';

export interface ProcessReceiptOptions {
  maxDimension?: number;
  rotationDegrees?: number; // 0, 90, 180, 270
  enhanceContrast?: boolean;
  sharpen?: boolean;
  variant?: ReceiptVariantName;
}

export interface ReceiptImageVariant {
  name: ReceiptVariantName;
  dataUrl: string;
  label: string;
  description: string;
}

export interface ProcessReceiptResult {
  originalDataUrl: string;
  processedDataUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  sizeBytes: number;
  variant?: ReceiptVariantName;
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
 * (ridimensionata, ruotata, con correzione dell'illuminazione locale, contrasto ottimizzato e nitidezza per Tesseract OCR).
 */
export const processReceiptImage = async (
  fileOrDataUrl: File | string,
  options: ProcessReceiptOptions = {}
): Promise<ProcessReceiptResult> => {
  const {
    maxDimension = 2400,
    rotationDegrees = 0,
    enhanceContrast = true,
    sharpen = false,
    variant = 'gentle_contrast',
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
      variant,
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
  } else if (origWidth < 1000 && origHeight < 1400 && origWidth > 0 && origHeight > 0) {
    // Upscaling moderato per scontrini a bassa risoluzione
    const scale = Math.min(1.75, maxDimension / Math.max(origWidth, origHeight));
    targetWidth = Math.round(origWidth * scale);
    targetHeight = Math.round(origHeight * scale);
  }

  // Gestione dimensioni canvas considerando rotazione
  const isRotated90or270 = (rotationDegrees / 90) % 2 !== 0;
  const canvasWidth = isRotated90or270 ? targetHeight : targetWidth;
  const canvasHeight = isRotated90or270 ? targetWidth : targetHeight;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      originalDataUrl,
      processedDataUrl: originalDataUrl,
      width: targetWidth,
      height: targetHeight,
      originalWidth: origWidth,
      originalHeight: origHeight,
      sizeBytes: fileSizeBytes,
      variant,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Applica rotazione e disegno al centro
  ctx.save();
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
  ctx.restore();

  // Se la variante richiesta è 'original', restituisci l'immagine disegnata senza filtri distruttivi
  if (variant === 'original') {
    const originalProcessedDataUrl = canvas.toDataURL('image/png');
    return {
      originalDataUrl,
      processedDataUrl: originalProcessedDataUrl,
      width: canvasWidth,
      height: canvasHeight,
      originalWidth: origWidth,
      originalHeight: origHeight,
      sizeBytes: fileSizeBytes,
      variant: 'original',
    };
  }

  // Pre-elaborazione per le varianti 'gentle_contrast' e 'sharpened_light'
  try {
    const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const data = imageData.data;
    const len = data.length;
    const w = canvasWidth;
    const h = canvasHeight;

    // Buffer scala di grigi con formula ITU-R BT.709
    const grayBuffer = new Float32Array(w * h);

    for (let i = 0, p = 0; i < len; i += 4, p++) {
      grayBuffer[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }

    if (variant === 'gentle_contrast' || enhanceContrast) {
      // Calcola min e max per histogram stretching gentile (evita binarizzazione brutale che distrugge matrice di punti)
      let minLum = 255;
      let maxLum = 0;
      for (let p = 0; p < w * h; p += 4) {
        const v = grayBuffer[p];
        if (v < minLum) minLum = v;
        if (v > maxLum) maxLum = v;
      }

      const lumRange = Math.max(30, maxLum - minLum);
      const gamma = 0.92; // Leggero contrasto sui caratteri scuri

      for (let p = 0; p < w * h; p++) {
        // Normalizzazione lineare e curva gamma per preservare virgole, punti e decimali
        const normalized = (grayBuffer[p] - minLum) / lumRange;
        const clampedNorm = Math.min(1, Math.max(0, normalized));
        const transformed = Math.pow(clampedNorm, gamma) * 255;
        const finalVal = Math.min(255, Math.max(0, transformed));

        const idx = p * 4;
        data[idx] = finalVal;
        data[idx + 1] = finalVal;
        data[idx + 2] = finalVal;
      }
    } else {
      for (let p = 0; p < w * h; p++) {
        const val = Math.min(255, Math.max(0, grayBuffer[p]));
        const idx = p * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Filtro di nitidezza leggero (Sharpening / Unsharp Masking conservativo)
    if (variant === 'sharpened_light' || sharpen) {
      const srcData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
      const outputData = ctx.createImageData(canvasWidth, canvasHeight);
      const src = srcData.data;
      const dst = outputData.data;

      // Kernel conservativo per evitare artefatti o rottura dei caratteri termici
      const kernel = [
        0, -0.35, 0,
        -0.35, 2.4, -0.35,
        0, -0.35, 0,
      ];

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let sumVal = 0;
          const dstOff = (y * w + x) * 4;

          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const srcOff = ((y + ky) * w + (x + kx)) * 4;
              const weight = kernel[(ky + 1) * 3 + (kx + 1)];
              sumVal += src[srcOff] * weight;
            }
          }

          const clamped = Math.min(255, Math.max(0, sumVal));
          dst[dstOff] = clamped;
          dst[dstOff + 1] = clamped;
          dst[dstOff + 2] = clamped;
          dst[dstOff + 3] = 255;
        }
      }

      ctx.putImageData(outputData, 0, 0);
    }
  } catch (err) {
    console.warn('[imagePreprocessing] Errore filtri Canvas, fallback su immagine originale:', err);
  }

  const processedDataUrl = canvas.toDataURL('image/png');

  return {
    originalDataUrl,
    processedDataUrl,
    width: canvasWidth,
    height: canvasHeight,
    originalWidth: origWidth,
    originalHeight: origHeight,
    sizeBytes: fileSizeBytes,
    variant,
  };
};

/**
 * Genera il set di varianti per il confronto multivariato dell'OCR.
 * Non sostituisce mai in modo distruttivo l'immagine originale memorizzata nel database.
 */
export const createReceiptImageVariants = async (
  fileOrDataUrl: File | string,
  options: ProcessReceiptOptions = {}
): Promise<ReceiptImageVariant[]> => {
  const variants: ReceiptImageVariant[] = [];

  // Variante 1: Originale (nessun filtro distruttivo)
  try {
    const origResult = await processReceiptImage(fileOrDataUrl, {
      ...options,
      variant: 'original',
      enhanceContrast: false,
      sharpen: false,
    });
    variants.push({
      name: 'original',
      dataUrl: origResult.processedDataUrl,
      label: 'Originale (Senza filtri)',
      description: 'Immagine intatta con orientamento e risoluzione ottimali',
    });
  } catch (err) {
    console.warn('[createReceiptImageVariants] Errore variante originale:', err);
  }

  // Variante 2: Contrasto dolce (scala di grigi e dinamica preservata)
  try {
    const gentleResult = await processReceiptImage(fileOrDataUrl, {
      ...options,
      variant: 'gentle_contrast',
      enhanceContrast: true,
      sharpen: false,
    });
    variants.push({
      name: 'gentle_contrast',
      dataUrl: gentleResult.processedDataUrl,
      label: 'Contrasto Dolce',
      description: 'Miglioramento dinamica e conservazione matrice di punti termica',
    });
  } catch (err) {
    console.warn('[createReceiptImageVariants] Errore variante gentle_contrast:', err);
  }

  // Variante 3: Nitidezza calibrata
  try {
    const sharpResult = await processReceiptImage(fileOrDataUrl, {
      ...options,
      variant: 'sharpened_light',
      enhanceContrast: true,
      sharpen: true,
    });
    variants.push({
      name: 'sharpened_light',
      dataUrl: sharpResult.processedDataUrl,
      label: 'Nitidezza Calibrata',
      description: 'Filtro di contrasto e sharpening conservativo',
    });
  } catch (err) {
    console.warn('[createReceiptImageVariants] Errore variante sharpened_light:', err);
  }

  // Fallback se nessuna variante generata
  if (variants.length === 0) {
    const fallbackUrl = typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '';
    variants.push({
      name: 'original',
      dataUrl: fallbackUrl,
      label: 'Originale (Fallback)',
      description: 'Sorgente originale',
    });
  }

  return variants;
};

export interface OcrQualityEvaluation {
  overallScore: number;
  confidenceScore: number;
  headerScore: number;
  dateScore: number;
  totalScore: number;
  paymentScore: number;
  itemCountScore: number;
  garbagePenalty: number;
  accountingConsistencyScore: number;
  reasons: string[];
}

/**
 * Valuta oggettivamente la qualità del riconoscimento OCR per selezionare la variante migliore.
 * Criteri di punteggio:
 * - Confidenza Tesseract (peso 25)
 * - Presenza fornitore/intestazione credibile (peso 20)
 * - Presenza data valida (peso 15)
 * - Presenza totale/subtotale/importo dovuto (peso 20)
 * - Presenza metodo pagamento (peso 5)
 * - Presenza righe articolo con prezzo (peso 15)
 * - Penalità caratteri spuri/rumore isolato (-20)
 * - Consistenza contabile righe vs totale (+10)
 */
export const evaluateReceiptOcrQuality = (
  rawText: string,
  tesseractConfidence: number
): OcrQualityEvaluation => {
  const upper = (rawText || '').toUpperCase();
  const reasons: string[] = [];

  // 1. Punteggio Confidenza Tesseract (0 - 25)
  const confClamped = Math.min(100, Math.max(0, tesseractConfidence));
  const confidenceScore = Math.round((confClamped / 100) * 25);
  reasons.push(`Confidenza Tesseract: ${confClamped}% (${confidenceScore}/25)`);

  // 2. Intestazione / Fornitore (0 - 20)
  let headerScore = 0;
  const knownSuppliers = ['TODIS', 'CONAD', 'COOP', 'LIDL', 'CARREFOUR', 'ESSELUNGA', 'EUROSPIN', 'MD', 'PAM', 'TIGROS', 'IPER', 'DESPAR', 'CRAI', 'PENNY', 'ALDI', 'SELEX'];
  const hasKnownSupplier = knownSuppliers.some((s) => upper.includes(s));
  const hasDocCommerciale = upper.includes('DOCUMENTO COMMERCIALE') || upper.includes('SCONTRINO') || upper.includes('RICEVUTA');
  const hasVatOrTax = /\b(?:P\.?\s*IVA|PARTITA\s+IVA|CODICE\s+FISCALE|C\.?\s*F\.?)\b/i.test(upper) || /\b\d{11}\b/.test(upper);

  if (hasKnownSupplier) {
    headerScore += 12;
    reasons.push('Fornitore noto individuato (+12)');
  } else if (hasDocCommerciale) {
    headerScore += 6;
    reasons.push('Documento commerciale individuato (+6)');
  }
  if (hasVatOrTax) {
    headerScore += 8;
    reasons.push('P.IVA o Codice Fiscale individuato (+8)');
  }
  headerScore = Math.min(20, headerScore);

  // 3. Data Valida (0 - 15)
  let dateScore = 0;
  const dateMatch = upper.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    const yearStr = dateMatch[3];
    const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2015 && year <= 2035) {
      dateScore = 15;
      reasons.push(`Data valida individuata: ${dateMatch[0]} (+15)`);
    } else {
      dateScore = 5;
      reasons.push(`Data parziale/dubbia: ${dateMatch[0]} (+5)`);
    }
  }

  // 4. Totale / Subtotale / Contanti / Resto (0 - 20)
  let totalScore = 0;
  const hasTotale = /\bTOTALE(?:\s+COMPLESSIVO|\s+EURO|\s+EUR|\s*€)?\b/i.test(upper);
  const hasSubtotale = /\bSUBTOTALE\b/i.test(upper);
  const hasContanti = /\b(?:CONTANT[EI]|PAGAMENTO\s+CONTANTE|CASH)\b/i.test(upper);
  const hasResto = /\bRESTO\b/i.test(upper);

  if (hasTotale) {
    totalScore += 10;
    reasons.push('Sezione Totale presente (+10)');
  }
  if (hasSubtotale) {
    totalScore += 4;
    reasons.push('Subtotale presente (+4)');
  }
  if (hasContanti && hasResto) {
    totalScore += 6;
    reasons.push('Coppia Contanti/Resto presente (+6)');
  } else if (hasContanti || hasResto) {
    totalScore += 3;
    reasons.push('Dettaglio pagamento presente (+3)');
  }
  totalScore = Math.min(20, totalScore);

  // 5. Metodo di Pagamento (0 - 5)
  let paymentScore = 0;
  if (/\b(?:CONTANT[EI]|PAGOBANCOMAT|BANCOMAT|CARTA|POS|VISA|MASTERCARD)\b/i.test(upper)) {
    paymentScore = 5;
    reasons.push('Metodo di pagamento individuato (+5)');
  }

  // 6. Righe Articolo con Prezzo Riconoscibili (0 - 15)
  let itemCountScore = 0;
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let validProductLines = 0;

  for (const line of lines) {
    const hasPrice = /\b\d{1,4}[.,]\d{2}\b/.test(line);
    const hasAlpha = line.replace(/[^A-Za-z]/g, '').length >= 3;
    const isExcluded = /\b(?:TOTALE|SUBTOTALE|CONTANTI|RESTO|P\.IVA|DOCUMENTO|ARRIVEDERCI)\b/i.test(line);
    if (hasPrice && hasAlpha && !isExcluded) {
      validProductLines++;
    }
  }

  itemCountScore = Math.min(15, validProductLines * 2);
  reasons.push(`Righe prodotto stimate: ${validProductLines} (+${itemCountScore}/15)`);

  // 7. Penalità Rumore / Caratteri Spuri (-20)
  let garbagePenalty = 0;
  // Conta sequenze di frammenti corrotti come "E - E p 1" o caratteri isolati
  const isolatedSingleChars = (rawText.match(/(?:^|\s)[a-zA-Z0-9](?=\s|$)/g) || []).length;
  const weirdSymbols = (rawText.match(/[~|\\{}_^<>]/g) || []).length;

  if (isolatedSingleChars > 12) {
    garbagePenalty += 10;
  }
  if (weirdSymbols > 5) {
    garbagePenalty += 10;
  }
  if (garbagePenalty > 0) {
    reasons.push(`Penalità caratteri corrotti/frammentati: -${garbagePenalty}`);
  }

  // 8. Consistenza Contabile (+10)
  let accountingConsistencyScore = 0;
  // Se sono presenti subtotale e contanti-resto coerenti
  const contantiMatch = upper.match(/CONTANT[EI]\s*[:=]?\s*(\d+[.,]\d{2})/);
  const restoMatch = upper.match(/RESTO\s*[:=]?\s*(\d+[.,]\d{2})/);
  const subTotMatch = upper.match(/SUBTOTALE\s*[:=]?\s*(\d+[.,]\d{2})/);
  if (contantiMatch && restoMatch && subTotMatch) {
    const cVal = parseFloat(contantiMatch[1].replace(',', '.'));
    const rVal = parseFloat(restoMatch[1].replace(',', '.'));
    const sVal = parseFloat(subTotMatch[1].replace(',', '.'));
    if (Math.abs((cVal - rVal) - sVal) <= 0.05) {
      accountingConsistencyScore = 10;
      reasons.push('Quadratura perfetta tra Subtotale e Contanti - Resto (+10)');
    }
  }

  const overallScore = Math.max(
    0,
    Math.min(
      100,
      confidenceScore +
        headerScore +
        dateScore +
        totalScore +
        paymentScore +
        itemCountScore +
        accountingConsistencyScore -
        garbagePenalty
    )
  );

  return {
    overallScore,
    confidenceScore,
    headerScore,
    dateScore,
    totalScore,
    paymentScore,
    itemCountScore,
    garbagePenalty,
    accountingConsistencyScore,
    reasons,
  };
};
