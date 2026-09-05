/**
 * RC-05E: REGIONAL GEOMETRY MECHANISM & SHADOW POLICY
 *
 * Meccanismo puro per il calcolo e la validazione dei rettangoli di ritaglio.
 * Totalmente indipendente da merchant specifici.
 */

import { RelativeCropBox, PixelCropBox } from './types';

/**
 * Errore lanciato in caso di parametri geometrici non validi
 */
export class InvalidGeometryError extends Error {
  constructor(message: string) {
    super(`[RegionalGeometry] ${message}`);
    this.name = 'InvalidGeometryError';
  }
}

/**
 * GEOMETRY MECHANISM: Funzione pura per convertire e validare un RelativeCropBox
 * in coordinate pixel assolute garantite all'interno delle dimensioni dell'immagine.
 */
export function resolveRelativeCropBox(
  imageWidth: number,
  imageHeight: number,
  box: RelativeCropBox
): PixelCropBox {
  // 1. Validazione dimensioni immagine
  if (
    typeof imageWidth !== 'number' ||
    typeof imageHeight !== 'number' ||
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight)
  ) {
    throw new InvalidGeometryError('Image dimensions must be finite numbers');
  }

  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new InvalidGeometryError(`Image dimensions must be strictly positive (got ${imageWidth}x${imageHeight})`);
  }

  // 2. Validazione parametri relativi
  const { xPct, yPct, widthPct, heightPct } = box;
  if (
    !Number.isFinite(xPct) ||
    !Number.isFinite(yPct) ||
    !Number.isFinite(widthPct) ||
    !Number.isFinite(heightPct)
  ) {
    throw new InvalidGeometryError('RelativeCropBox parameters must be finite numbers');
  }

  if (xPct < 0 || xPct >= 100 || yPct < 0 || yPct >= 100) {
    throw new InvalidGeometryError(
      `Crop starting percentages out of range [0, 100): xPct=${xPct}, yPct=${yPct}`
    );
  }

  if (widthPct <= 0 || heightPct <= 0) {
    throw new InvalidGeometryError(
      `Crop dimensions must be strictly positive: widthPct=${widthPct}, heightPct=${heightPct}`
    );
  }

  // 3. Conversione in pixel con arrotondamento deterministico
  const left = Math.round((xPct / 100) * imageWidth);
  const top = Math.round((yPct / 100) * imageHeight);

  // Calcolo ampiezza con clamping rigido ai bordi del canvas
  const maxWidth = imageWidth - left;
  const maxHeight = imageHeight - top;

  const rawWidth = Math.round((widthPct / 100) * imageWidth);
  const rawHeight = Math.round((heightPct / 100) * imageHeight);

  const width = Math.min(rawWidth, maxWidth);
  const height = Math.min(rawHeight, maxHeight);

  if (width <= 0 || height <= 0) {
    throw new InvalidGeometryError(
      `Resolved pixel crop has zero or negative dimension: ${width}x${height}`
    );
  }

  return {
    left,
    top,
    width,
    height,
  };
}

/**
 * =========================================================================
 * SHADOW REFERENCE POLICY (EXPERIMENTAL / NOT PRODUCTION-GENERALIZED)
 * =========================================================================
 *
 * Coordinate sperimentali utilizzate esclusivamente per shadow testing e
 * per riprodurre le evidenze diagnostiche certificate in RC-05C-R2.
 * NON SONO POLICIES DI PRODUZIONE GENERALIZZATE.
 */
export const SHADOW_REFERENCE_POLICY = {
  label: 'EXPERIMENTAL_SHADOW_REFERENCE_POLICY',
  bodyBox: {
    xPct: 55, // 55% -> 100% (widthPct = 45)
    yPct: 22, // 22% -> 72% (heightPct = 50)
    widthPct: 45,
    heightPct: 50,
  } as RelativeCropBox,
  footerBox: {
    xPct: 25, // 25% -> 100% (widthPct = 75)
    yPct: 65, // 65% -> 85% (heightPct = 20)
    widthPct: 75,
    heightPct: 20,
  } as RelativeCropBox,
} as const;
