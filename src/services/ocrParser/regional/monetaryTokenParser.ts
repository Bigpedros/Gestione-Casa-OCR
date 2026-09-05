/**
 * RC-05E: REGIONAL MONETARY TOKEN EXTRACTION
 *
 * Funzione pura per l'estrazione conservativa dei token monetari da raw text regionale.
 * Conforme alla Regola Ceccotti: ZERO riparazione semantica, divieto di inventare virgole.
 */

import { RegionalMonetaryToken } from './types';
import { TextNormalizationModule } from '../modules/TextNormalizationModule';

/**
 * Regex per token monetario CERTO:
 * 1-4 cifre intere, separatore virgola o punto, esattamente 2 decimali.
 */
const EXACT_MONETARY_REGEX = /[-−]?\b\d{1,4}[.,]\d{2}\b/;

/**
 * Regex per token degradato a 3-5 cifre senza separatore decimale (es. "2599", "2489")
 */
const DEGRADED_NUMERIC_TOKEN_REGEX = /^\d{3,5}$/;

/**
 * Pattern di rifiuto esplicito (Falsi positivi: percentuali, date, orari, codici)
 */
const PERCENTAGE_PATTERN = /\b\d{1,2}(?:[.,]\d{1,2})?\s*%/;
const DATE_PATTERN = /\b\d{1,2}[-/\\]\d{1,2}[-/\\]\d{2,4}\b/;
const TIME_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
const DOCUMENT_CODE_PATTERN = /\b\d{3,5}-\d{3,5}\b/;
const ISOLATED_PUNCTUATION = /^[-–—.:,‘'’|~\\_{}^<>]+$/;

export interface TokenExtractionOptions {
  /**
   * Se fornito, un valore di totale o subtotale noto che se riscontrato
   * in coda al body non deve essere marcato come prezzo articolo.
   */
  readonly knownTotalValue?: number | null;
}

/**
 * Estrae e classifica i token monetari da una stringa raw regionale
 */
export function extractRegionalMonetaryTokens(
  rawText: string,
  options?: TokenExtractionOptions
): RegionalMonetaryToken[] {
  if (!rawText || rawText.trim().length === 0) {
    return [];
  }

  const lines = rawText.split(/\r?\n/);
  const result: RegionalMonetaryToken[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex].trim();
    if (!rawLine || ISOLATED_PUNCTUATION.test(rawLine)) {
      continue;
    }

    // 1. Filtraggio falsi positivi strutturali a livello di riga
    if (PERCENTAGE_PATTERN.test(rawLine)) {
      // Se la riga contiene un'aliquota IVA (es. "00%", "22,00%"),
      // verifichiamo se accanto c'è un token monetario distinto (es. "00% 12,44 PRI")
      // o se l'intera riga è solo una percentuale.
    }
    if (DATE_PATTERN.test(rawLine) || TIME_PATTERN.test(rawLine) || DOCUMENT_CODE_PATTERN.test(rawLine)) {
      // Rifiuto date, ore e numeri documento completi
      result.push({
        rawToken: rawLine,
        parsedValue: null,
        lineIndex,
        confidence: 0,
        classification: 'rejected',
        reason: 'date_time_or_doc_number',
      });
      continue;
    }

    // 2. Suddivisione della riga in parole / token
    const words = rawLine.split(/\s+/).filter((w) => w.length > 0);

    for (const rawWord of words) {
      // Pulizia delimitatori esterni ma conservazione della punteggiatura interna
      const cleaned = rawWord.replace(/^[-–—.:,‘'’|~\\_{}^<>()]+/, '').replace(/[-–—.:,‘'’|~\\_{}^<>()]+$/, '');
      if (!cleaned || ISOLATED_PUNCTUATION.test(cleaned)) {
        continue;
      }

      // Rifiuta percentuali esplicite
      if (PERCENTAGE_PATTERN.test(cleaned) || cleaned.endsWith('%')) {
        result.push({
          rawToken: rawWord,
          parsedValue: null,
          lineIndex,
          confidence: 0,
          classification: 'rejected',
          reason: 'percentage',
        });
        continue;
      }

      // Rifiuta token alfanumerici non monetari o intestazioni di reparto (es. "PRI", "SG", "PARIS")
      if (/^[a-zA-Z]{1,10}$/.test(cleaned)) {
        continue;
      }

      // Rifiuta codici lunghi o barcode (es. "799ÎEB065409")
      if (cleaned.length > 8 && /[a-zA-Z]/.test(cleaned) && /\d/.test(cleaned)) {
        result.push({
          rawToken: rawWord,
          parsedValue: null,
          lineIndex,
          confidence: 0,
          classification: 'rejected',
          reason: 'alphanumeric_code',
        });
        continue;
      }

      // 3. Verifica corrispondenza EXACT MONETARY (1-4 cifre, separatore, 2 decimali)
      const exactMatch = cleaned.match(EXACT_MONETARY_REGEX);
      if (exactMatch) {
        const tokenStr = exactMatch[0];
        const isNeg = tokenStr.startsWith('-') || tokenStr.startsWith('−');
        const parsedVal = TextNormalizationModule.parseItalianNumber(tokenStr);

        if (parsedVal !== null && !isNaN(parsedVal)) {
          // Se corrisponde al totale noto passato nelle options, lo annotiamo
          const isKnownTotal =
            options?.knownTotalValue !== undefined &&
            options.knownTotalValue !== null &&
            Math.abs(parsedVal - options.knownTotalValue) < 0.01;

          result.push({
            rawToken: tokenStr,
            parsedValue: parsedVal,
            lineIndex,
            confidence: 90,
            classification: 'exact_monetary',
            isNegative: isNeg,
            reason: isKnownTotal ? 'matches_known_total' : 'standard_exact_price',
          });
          continue;
        }
      }

      // 4. Verifica DEGRADED NUMERIC TOKEN (3-5 cifre senza virgola/punto, es. "2599", "2489")
      if (DEGRADED_NUMERIC_TOKEN_REGEX.test(cleaned)) {
        result.push({
          rawToken: cleaned,
          parsedValue: null, // REGOLA CECCOTTI: ZERO virgole inventate
          lineIndex,
          confidence: 40,
          classification: 'degraded',
          reason: 'missing_decimal_separator',
        });
        continue;
      }

      // 5. Tutti gli altri token non conformi
      if (/\d/.test(cleaned)) {
        result.push({
          rawToken: cleaned,
          parsedValue: null,
          lineIndex,
          confidence: 10,
          classification: 'rejected',
          reason: 'non_conforming_numeric',
        });
      }
    }
  }

  return result;
}
