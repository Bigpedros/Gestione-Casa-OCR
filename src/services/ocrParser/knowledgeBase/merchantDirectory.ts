/**
 * =========================================================================
 * RECEIPT KNOWLEDGE BASE v1 — MERCHANT DIRECTORY
 * =========================================================================
 *
 * Archivio dei fornitori noti del corpus reale per il supporto alla disambiguazione
 * semantica e fuzzy del candidato fornitore estratto dal parser.
 *
 * PRINCIPIO ARCHITETTURALE FONDAMENTALE:
 * - Il Merchant Directory NON è l'autorità decisionale: il parser decide.
 * - Serve ESCLUSIVAMENTE come supporto semantico/fuzzy per risolvere letture OCR ambigue.
 * - NON effettua sostituzioni automatiche senza supporto contestuale.
 * - NON crea branch comportamentali specifici per insegna (`if (merchant === 'EUROSPIN')`).
 */

import { MerchantDirectoryEntry, MerchantMatchResult } from './types';

export const BUILTIN_MERCHANT_DIRECTORY: MerchantDirectoryEntry[] = [
  {
    id: 'merch-eurospin',
    canonicalName: 'EUROSPIN',
    legalName: 'GRUPPO CAUCCI SRL',
    aliases: ['EUROSPIN', 'GRUPPO CAUCCI SRL', 'EURO SPIN', 'CAUCCI SRL'],
    categoryHint: 'SUPERMARKET',
    notes: 'Insegna discount alimentare',
  },
  {
    id: 'merch-todis',
    canonicalName: 'TODIS',
    legalName: 'IGEA COMMERCIALE S.R.L.',
    aliases: ['TODIS', 'T00IS', 'IGEA COMMERCIALE', 'IGEA COMMERCIALE S.R.L.'],
    categoryHint: 'SUPERMARKET',
    notes: 'Insegna supermercati Todis (OCR frequente T00IS)',
  },
  {
    id: 'merch-pewex',
    canonicalName: 'PEWEX SUPERMERCATI',
    legalName: 'MGDR S.R.L.',
    aliases: ['PEWEX', 'PEWEX SUPERMERCATI', 'MGDR S.R.L.', 'MGDR SRL'],
    categoryHint: 'SUPERMARKET',
  },
  {
    id: 'merch-leroy-merlin',
    canonicalName: 'LEROY MERLIN',
    legalName: 'LEROY MERLIN ITALIA S.R.L.',
    aliases: ['LEROY MERLIN', 'LEROY MERLIN ITALIA S.R.L.', 'LEROY MERLIN ITALIA'],
    categoryHint: 'HOME_IMPROVEMENT',
  },
  {
    id: 'merch-orizzonte',
    canonicalName: 'ORIZZONTE',
    legalName: '15 SETTEMBRE S.R.L.',
    aliases: ['ORIZZONTE', '15 SETTEMBRE S.R.L.', '15 SETTEMBRE SRL'],
    categoryHint: 'GENERAL_STORE',
  },
  {
    id: 'merch-carrefour',
    canonicalName: 'CARREFOUR CONTACT',
    legalName: 'GS SPA',
    aliases: ['CARREFOUR CONTACT', 'CARREFOUR', 'GS SPA', 'CARREFOUR EXPRESS'],
    categoryHint: 'SUPERMARKET',
  },
  {
    id: 'merch-de-caffe',
    canonicalName: 'D.E. CAFFE\'',
    legalName: 'D.E. CAFFE\' S.R.L.',
    aliases: ['D.E. CAFFE\'', 'D.E. CAFFE\' S.R.L.', 'D.E. CAFFE', 'DE CAFFE'],
    categoryHint: 'BAR_CAFE',
  },
  {
    id: 'merch-r-store',
    canonicalName: 'R-STORE',
    legalName: 'R-STORE S.P.A.',
    aliases: ['R-STORE', 'R-STORE S.P.A.', 'R-STORE SPA', 'R STORE'],
    categoryHint: 'ELECTRONICS',
  },
  {
    id: 'merch-panzieri',
    canonicalName: 'PANIFICIO PANZIERI',
    legalName: 'DA.MA. SRL',
    aliases: ['PANIFICIO PANZIERI', 'DA.MA. SRL', 'DA.MA. S.R.L.', 'PANZIERI'],
    categoryHint: 'BAKERY',
  },
  {
    id: 'merch-eurorisparmio',
    canonicalName: 'EURORISPARMIO CASA',
    aliases: ['EURORISPARMIO CASA', 'EURORISPARMIO'],
    categoryHint: 'HOME_GOODS',
  },
  {
    id: 'merch-farmacia-la-nave',
    canonicalName: 'FARMACIA LA NAVE',
    legalName: 'FARMACIA LA NAVE SNC',
    aliases: ['FARMACIA LA NAVE', 'FARMACIA LA NAVE SNC', 'LA NAVE SNC'],
    categoryHint: 'PHARMACY',
  },
  {
    id: 'merch-tuo-espresso',
    canonicalName: 'TUO ESPRESSO SHOP',
    legalName: 'TUO ESPRESSO SHOP SRLS',
    aliases: ['TUO ESPRESSO SHOP', 'TUO ESPRESSO SHOP SRLS', 'TUO ESPRESSO'],
    categoryHint: 'SPECIALTY_STORE',
  },
  {
    id: 'merch-i-quadri',
    canonicalName: 'I QUADRI',
    legalName: 'I BERGANTARI S.R.L.',
    aliases: ['I QUADRI', 'I BERGANTARI S.R.L.', 'I BERGANTARI SRL'],
    categoryHint: 'RESTAURANT',
  },
];

/**
 * Calcola la distanza di Levenshtein tra due stringhe normalizzate
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // cancellazione
        d[i][j - 1] + 1, // inserimento
        d[i - 1][j - 1] + cost // sostituzione
      );
    }
  }
  return d[m][n];
}

/**
 * Calcola la similarità normalizzata (0.0 - 1.0)
 */
function calculateSimilarity(strA: string, strB: string): number {
  const normA = strA.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normB = strB.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // Se una è sottostringa esatta dell'altra con lunghezza significativa
  if ((normA.includes(normB) || normB.includes(normA)) && Math.min(normA.length, normB.length) >= 4) {
    return Math.min(normA.length, normB.length) / Math.max(normA.length, normB.length);
  }

  const maxLen = Math.max(normA.length, normB.length);
  const distance = levenshteinDistance(normA, normB);
  return Math.max(0, 1 - distance / maxLen);
}

export const MERCHANT_MIN_SIMILARITY = 0.80;
export const MERCHANT_AMBIGUITY_MARGIN = 0.05;

/**
 * Servizio di consultazione del Merchant Directory per supporto alla disambiguazione
 */
export class MerchantDirectoryService {
  private static entries: MerchantDirectoryEntry[] = BUILTIN_MERCHANT_DIRECTORY;

  /**
   * Cerca una corrispondenza esatta o fuzzy per un candidato merchant.
   * Restituisce il punteggio di similarità, l'eventuale ambiguità e la regolazione consigliata di confidenza.
   */
  public static matchMerchant(
    candidateName: string,
    customEntries?: MerchantDirectoryEntry[]
  ): MerchantMatchResult {
    const entriesToSearch = customEntries ?? this.entries;

    if (!candidateName || candidateName.trim().length < 3) {
      return {
        matched: false,
        canonicalName: null,
        matchedEntry: null,
        similarity: 0,
        confidenceAdjustment: 0,
        isFuzzyMatch: false,
        isAmbiguous: false,
        secondBestSimilarity: 0,
        secondBestEntry: null,
        ambiguityMargin: MERCHANT_AMBIGUITY_MARGIN,
      };
    }

    const cleanCandidate = candidateName.trim().toUpperCase();

    // 1. Ricerca corrispondenza esatta su canonical o alias (Exact Match = 1.00)
    for (const entry of entriesToSearch) {
      if (entry.canonicalName.toUpperCase() === cleanCandidate) {
        return {
          matched: true,
          canonicalName: entry.canonicalName,
          matchedEntry: entry,
          similarity: 1.0,
          confidenceAdjustment: 15,
          isFuzzyMatch: false,
          isAmbiguous: false,
          secondBestSimilarity: 0,
          secondBestEntry: null,
          ambiguityMargin: MERCHANT_AMBIGUITY_MARGIN,
        };
      }

      for (const alias of entry.aliases) {
        if (alias.toUpperCase() === cleanCandidate) {
          return {
            matched: true,
            canonicalName: entry.canonicalName,
            matchedEntry: entry,
            similarity: 1.0,
            confidenceAdjustment: 12,
            isFuzzyMatch: false,
            isAmbiguous: false,
            secondBestSimilarity: 0,
            secondBestEntry: null,
            ambiguityMargin: MERCHANT_AMBIGUITY_MARGIN,
          };
        }
      }
    }

    // 2. Ricerca fuzzy con aggregazione per merchant entry
    // Per ogni merchant entry calcoliamo il punteggio massimo tra nome canonico e tutti i suoi alias.
    // In questo modo il nome canonico e gli alias dello STESSO merchant non competono tra loro come rivali.
    interface ScoredMerchant {
      entry: MerchantDirectoryEntry;
      similarity: number;
    }

    const scoredMerchants: ScoredMerchant[] = [];

    for (const entry of entriesToSearch) {
      let maxSim = calculateSimilarity(cleanCandidate, entry.canonicalName);
      for (const alias of entry.aliases) {
        const aliasSim = calculateSimilarity(cleanCandidate, alias);
        if (aliasSim > maxSim) {
          maxSim = aliasSim;
        }
      }
      scoredMerchants.push({
        entry,
        similarity: maxSim,
      });
    }

    // Ordinamento deterministico per similarità decrescente
    scoredMerchants.sort((a, b) => b.similarity - a.similarity);

    if (scoredMerchants.length === 0) {
      return {
        matched: false,
        canonicalName: null,
        matchedEntry: null,
        similarity: 0,
        confidenceAdjustment: 0,
        isFuzzyMatch: false,
        isAmbiguous: false,
        secondBestSimilarity: 0,
        secondBestEntry: null,
        ambiguityMargin: MERCHANT_AMBIGUITY_MARGIN,
      };
    }

    const best = scoredMerchants[0];
    const second = scoredMerchants.length > 1 ? scoredMerchants[1] : null;

    const bestSimilarity = best.similarity;
    const secondBestSimilarity = second ? second.similarity : 0;
    const secondBestEntry = second ? second.entry : null;

    // Se il miglior candidato è sotto la soglia minima assoluta (0.80)
    if (bestSimilarity < MERCHANT_MIN_SIMILARITY) {
      return {
        matched: false,
        canonicalName: null,
        matchedEntry: null,
        similarity: Math.round(bestSimilarity * 100) / 100,
        confidenceAdjustment: 0,
        isFuzzyMatch: false,
        isAmbiguous: false,
        secondBestSimilarity: Math.round(secondBestSimilarity * 100) / 100,
        secondBestEntry,
        ambiguityMargin: MERCHANT_AMBIGUITY_MARGIN,
      };
    }

    // Guardia di ambiguità:
    // Se esiste un secondo candidato appartenente a un merchant diverso
    // e la differenza tra best e secondBest è inferiore a MERCHANT_AMBIGUITY_MARGIN (0.05),
    // il match è considerato ambiguo.
    const marginDiff = Math.round((bestSimilarity - secondBestSimilarity) * 10000) / 10000;
    const isAmbiguous = second !== null && marginDiff < MERCHANT_AMBIGUITY_MARGIN;

    if (isAmbiguous) {
      return {
        matched: false,
        canonicalName: null,
        matchedEntry: null,
        similarity: Math.round(bestSimilarity * 100) / 100,
        confidenceAdjustment: 0,
        isFuzzyMatch: true,
        isAmbiguous: true,
        secondBestSimilarity: Math.round(secondBestSimilarity * 100) / 100,
        secondBestEntry,
        ambiguityMargin: MERCHANT_AMBIGUITY_MARGIN,
      };
    }

    // Match fuzzy valido e non ambiguo
    return {
      matched: true,
      canonicalName: best.entry.canonicalName,
      matchedEntry: best.entry,
      similarity: Math.round(bestSimilarity * 100) / 100,
      confidenceAdjustment: bestSimilarity >= 0.90 ? 10 : 5,
      isFuzzyMatch: true,
      isAmbiguous: false,
      secondBestSimilarity: Math.round(secondBestSimilarity * 100) / 100,
      secondBestEntry,
      ambiguityMargin: MERCHANT_AMBIGUITY_MARGIN,
    };
  }

  /**
   * Restituisce tutti i merchant registrati
   */
  public static getAllEntries(): MerchantDirectoryEntry[] {
    return [...this.entries];
  }
}
