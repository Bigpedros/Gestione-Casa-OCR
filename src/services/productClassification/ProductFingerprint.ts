import type { Product, ProductAlias, MoneyAmount } from '../../types';
import type { ProductFingerprintData } from './types';

// Common Italian food & grocery brands for auto-detection
const KNOWN_BRANDS = [
  'BARILLA',
  'MULINO BIANCO',
  'PARMALAT',
  'BOERO',
  'SAN BENEDETTO',
  'VALFRUTTA',
  'RIGONI',
  'LAVAZZA',
  'FINDUS',
  'COOP',
  'ESSELUNGA',
  'CONAD',
  'DESPAR',
  'EUROSPIN',
  'LIDL',
  'CARREFOUR',
  'PAM',
  'SELEX',
  'DE CECCO',
  'DIVella',
  'MUTTI',
  'GRANAROLO',
  'KIMBO',
  'ILLY',
  'FERRERO',
  'KINDER',
  'NESTLE',
  'GALBANI',
  'INVERNIZZI',
  'SAN PELLEGRINO',
  'FERRARELLE',
  'LETE',
  'ULIVETO',
  'ROCCHETTA',
  'SANTAL',
  'YOMO',
  'MULLER',
  'ZUEGG',
  'STAR',
  'BAULI',
  'MOTTA',
  'MELEGATTI',
  'BALOCCO',
  'MISURA',
  'COLUSSI',
  'PAVESI',
  'SAIWA',
  'ALPRO',
  'VALSOIA',
  'RIO MARE',
  'NOSTROMO',
  'ASDOMAR',
  'CALVE',
  'HEINZ',
  'KNORR',
  'DURACELL',
  'NIVEA',
  'DOVE',
  'BOROTALCO',
  'PALMOLIVE',
  'PANTENE',
  'HEAD & SHOULDERS',
  'DASH',
  'DIXAN',
  'ACE',
  'CHANTECLAIR',
  'SOFLAN',
  'FELCE AZZURRA',
  'SWIFFER',
  'SCOTTEX',
  'FOXY',
  'REGINA',
  'TENDERLY',
];

const STOPWORDS = new Set([
  'E',
  'ED',
  'DI',
  'DEL',
  'DELLA',
  'DEGLI',
  'DEI',
  'DAL',
  'DALLA',
  'IN',
  'CON',
  'SU',
  'PER',
  'TRA',
  'FRA',
  'UN',
  'UNO',
  'UNA',
  'IL',
  'LO',
  'LA',
  'I',
  'GLI',
  'LE',
  'ART',
  'CONF',
  'PK',
  'PZ',
  'KG',
  'GR',
  'G',
  'ML',
  'CL',
  'L',
  'LT',
  'VOL',
  'MAXI',
  'PROMO',
  'SCONTO',
  'OFFERTA',
]);

export class ProductFingerprintService {
  /**
   * Normalizza il testo rimuovendo spazi doppi, punteggiatura non rilevante
   */
  public static normalizeText(text: string): string {
    if (!text) return '';
    return text
      .toUpperCase()
      .trim()
      .replace(/[/\\,.:;_\-*="'!@#$%^&()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Genera un nome normalizzato pulito per il catalogo prodotti, rimuovendo prefissi e rumore OCR
   */
  public static computeCleanNormalizedName(text: string): string {
    const norm = this.normalizeText(text);
    if (!norm) return '';
    const tokens = norm.split(' ').filter((t) => t.length > 0);
    const cleaned = tokens.filter((t) => !STOPWORDS.has(t) || t === 'DI' || t === 'CON' || t === 'IN');
    return cleaned.length > 0 ? cleaned.join(' ') : norm;
  }

  /**
   * Estrae eventuali codici EAN/GTIN (8, 12, 13 o 14 cifre consecutive)
   */
  public static extractBarcode(text: string): string | null {
    if (!text) return null;
    const match = text.match(/\b(\d{8}|\d{12,14})\b/);
    return match ? match[1] : null;
  }

  /**
   * Estrae il brand conosciuto presente nel testo
   */
  public static extractBrand(text: string): string | null {
    const norm = this.normalizeText(text);
    for (const brand of KNOWN_BRANDS) {
      const regex = new RegExp(`\\b${brand}\\b`, 'i');
      if (regex.test(norm)) {
        return brand;
      }
    }
    return null;
  }

  /**
   * Estrae unità di misura e quantità (es. "1L", "500G", "6X33CL", "75CL", "2KG")
   */
  public static extractUnitOfMeasure(text: string): { unitOfMeasure: string | null; unitQuantity: number | null } {
    const norm = this.normalizeText(text);
    // Pattern es. 6X33CL o 6X33 CL
    const multiMatch = norm.match(/\b(\d+)\s*X\s*(\d+(?:[.,]\d+)?)\s*(KG|G|GR|ML|CL|L|LT|PZ)\b/);
    if (multiMatch) {
      const count = parseInt(multiMatch[1], 10);
      const size = parseFloat(multiMatch[2].replace(',', '.'));
      const unit = multiMatch[3];
      return {
        unitOfMeasure: `${count}X${size}${unit}`,
        unitQuantity: count * size,
      };
    }

    // Pattern es. 500G, 1.5L, 75CL, 2KG
    const singleMatch = norm.match(/\b(\d+(?:[.,]\d+)?)\s*(KG|G|GR|ML|CL|L|LT|PZ)\b/);
    if (singleMatch) {
      const qty = parseFloat(singleMatch[1].replace(',', '.'));
      let unit = singleMatch[2];
      if (unit === 'GR') unit = 'G';
      if (unit === 'LT') unit = 'L';
      return {
        unitOfMeasure: `${qty}${unit}`,
        unitQuantity: qty,
      };
    }

    return { unitOfMeasure: null, unitQuantity: null };
  }

  /**
   * Genera un set di trigrammi di caratteri per il matching fuzzy resiliente all'OCR
   */
  public static generateTrigrams(text: string): Set<string> {
    const trigrams = new Set<string>();
    const cleaned = `  ${this.normalizeText(text)}  `;
    for (let i = 0; i < cleaned.length - 2; i++) {
      trigrams.add(cleaned.substring(i, i + 3));
    }
    return trigrams;
  }

  /**
   * Estrae i token rilevanti senza stopwords
   */
  public static extractTokens(text: string): string[] {
    const norm = this.normalizeText(text);
    return norm
      .split(' ')
      .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  }

  /**
   * Genera la struttura tecnica ProductFingerprint per una riga scontrino / testo OCR
   */
  public static buildFingerprintFromText(
    description: string,
    options?: {
      supplierId?: string | null;
      unitPrice?: MoneyAmount;
      barcode?: string | null;
      brand?: string | null;
    }
  ): ProductFingerprintData {
    const normDesc = this.normalizeText(description);
    const tokens = this.extractTokens(description);
    const trigrams = this.generateTrigrams(description);
    const brand = options?.brand || this.extractBrand(description);
    const barcode = options?.barcode || this.extractBarcode(description);
    const { unitOfMeasure, unitQuantity } = this.extractUnitOfMeasure(description);
    const price = options?.unitPrice ?? null;

    return {
      rawDescription: description,
      normalizedDescription: normDesc,
      tokens,
      trigrams,
      brand,
      barcode,
      unitOfMeasure,
      unitQuantity,
      supplierId: options?.supplierId ?? null,
      categoryId: null,
      subcategoryId: null,
      historicalPrices: price !== null ? [price] : [],
      averageUnitPrice: price,
      minUnitPrice: price,
      maxUnitPrice: price,
    };
  }

  /**
   * Genera la struttura tecnica ProductFingerprint per un Prodotto in catalogo (inclusi i suoi alias)
   */
  public static buildFingerprintFromProduct(
    product: Product,
    aliases: ProductAlias[] = [],
    options?: {
      supplierId?: string | null;
      historicalPrices?: MoneyAmount[];
    }
  ): ProductFingerprintData {
    const combinedTexts = [
      product.displayName,
      product.normalizedName,
      ...aliases.map((a) => a.originalText),
      ...aliases.map((a) => a.normalizedText),
    ].filter(Boolean);

    const fullText = combinedTexts.join(' ');
    const normDesc = this.normalizeText(product.normalizedName || product.displayName);
    const tokens = Array.from(new Set(combinedTexts.flatMap((t) => this.extractTokens(t))));
    const trigrams = this.generateTrigrams(fullText);

    const brand = product.brand || this.extractBrand(fullText);
    const barcode = product.barcode || this.extractBarcode(fullText);
    const { unitOfMeasure, unitQuantity } = product.unitOfMeasure
      ? { unitOfMeasure: product.unitOfMeasure, unitQuantity: null }
      : this.extractUnitOfMeasure(fullText);

    const prices = options?.historicalPrices || [];
    let avgPrice: number | null = null;
    let minPrice: number | null = null;
    let maxPrice: number | null = null;

    if (prices.length > 0) {
      avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      minPrice = Math.min(...prices);
      maxPrice = Math.max(...prices);
    }

    return {
      rawDescription: product.displayName,
      normalizedDescription: normDesc,
      tokens,
      trigrams,
      brand,
      barcode,
      unitOfMeasure,
      unitQuantity,
      supplierId: options?.supplierId ?? null,
      categoryId: product.categoryId ?? null,
      subcategoryId: product.subcategoryId ?? null,
      historicalPrices: prices,
      averageUnitPrice: avgPrice,
      minUnitPrice: minPrice,
      maxUnitPrice: maxPrice,
    };
  }

  /**
   * Confronta due ProductFingerprint e restituisce un punteggio di confidenza (0 - 100) e i motivi del match
   */
  public static compareFingerprints(
    fpLine: ProductFingerprintData,
    fpProduct: ProductFingerprintData
  ): { score: number; reasons: string[]; isPriceAnomaly: boolean } {
    const reasons: string[] = [];
    let score = 0;
    let isPriceAnomaly = false;

    // 1. EAN / Barcode match assoluto
    if (fpLine.barcode && fpProduct.barcode && fpLine.barcode === fpProduct.barcode) {
      reasons.push('Corrispondenza esatta codice a barre EAN/GTIN');
      return { score: 100, reasons, isPriceAnomaly: false };
    }

    // 2. Exact normalized string match
    if (
      fpLine.normalizedDescription &&
      fpProduct.normalizedDescription &&
      fpLine.normalizedDescription === fpProduct.normalizedDescription
    ) {
      score += 75;
      reasons.push('Corrispondenza esatta descrizione normalizzata');
    } else {
      // 3. Token Jaccard overlap
      const lineTokens = new Set(fpLine.tokens);
      const productTokens = new Set(fpProduct.tokens);
      let intersection = 0;

      for (const t of lineTokens) {
        if (productTokens.has(t)) {
          intersection++;
        }
      }

      const union = new Set([...lineTokens, ...productTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      // 4. Trigram Similarity (Character Jaccard)
      let trigramIntersection = 0;
      for (const tri of fpLine.trigrams) {
        if (fpProduct.trigrams.has(tri)) {
          trigramIntersection++;
        }
      }
      const trigramUnion = new Set([...fpLine.trigrams, ...fpProduct.trigrams]).size;
      const trigramSimilarity = trigramUnion > 0 ? trigramIntersection / trigramUnion : 0;

      const combinedTextScore = Math.round(jaccard * 40 + trigramSimilarity * 35);
      score += combinedTextScore;

      if (combinedTextScore > 30) {
        reasons.push(`Similitudine testuale (tokens ${Math.round(jaccard * 100)}%, trigrammi ${Math.round(trigramSimilarity * 100)}%)`);
      }
    }

    // 5. Brand Match bonus / penalty
    if (fpLine.brand && fpProduct.brand) {
      if (fpLine.brand === fpProduct.brand) {
        score += 15;
        reasons.push(`Marca coincidente (${fpLine.brand})`);
      } else {
        score -= 20;
        reasons.push(`Marca discordante (${fpLine.brand} vs ${fpProduct.brand})`);
      }
    }

    // 6. Unit of Measure bonus
    if (fpLine.unitOfMeasure && fpProduct.unitOfMeasure) {
      if (fpLine.unitOfMeasure === fpProduct.unitOfMeasure) {
        score += 10;
        reasons.push(`Formato/Unità di misura coincidente (${fpLine.unitOfMeasure})`);
      }
    }

    // 7. Supplier context bonus
    if (fpLine.supplierId && fpProduct.supplierId && fpLine.supplierId === fpProduct.supplierId) {
      score += 10;
      reasons.push('Fornitore abituale coincidente');
    }

    // 8. Price Plausibility check
    if (fpLine.averageUnitPrice !== null && fpProduct.averageUnitPrice !== null) {
      const linePrice = fpLine.averageUnitPrice;
      const avgPrice = fpProduct.averageUnitPrice;

      if (avgPrice > 0) {
        const ratio = linePrice / avgPrice;
        if (ratio >= 0.7 && ratio <= 1.4) {
          score += 5;
          reasons.push(`Prezzo coerente con la media storica (€${linePrice.toFixed(2)} vs €${avgPrice.toFixed(2)})`);
        } else if (ratio > 3.0 || ratio < 0.2) {
          // Anomalia di prezzo elevata
          score -= 25;
          isPriceAnomaly = true;
          reasons.push(`Anomalia di prezzo elevata (€${linePrice.toFixed(2)} rispetto a €${avgPrice.toFixed(2)})`);
        }
      }
    }

    // Cap score at 0-100
    const finalScore = Math.max(0, Math.min(100, score));

    return { score: finalScore, reasons, isPriceAnomaly };
  }
}
