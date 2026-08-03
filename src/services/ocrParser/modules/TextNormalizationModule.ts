export interface TextNormalizationResult {
  originalText: string;
  normalizedText: string;
  lines: string[];
  normalizedLines: string[];
  transformations: string[];
}

export class TextNormalizationModule {
  public name = 'TextNormalizationModule';

  public static normalize(rawText: string): TextNormalizationResult {
    if (!rawText || rawText.trim().length === 0) {
      return {
        originalText: rawText || '',
        normalizedText: '',
        lines: [],
        normalizedLines: [],
        transformations: ['empty_input'],
      };
    }

    const transformations: string[] = [];

    // 1. Rimozione caratteri invisibili e di controllo (BOM, zero-width spaces, ecc.)
    let text = rawText.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
    if (text !== rawText) transformations.push('removed_invisible_chars');

    // 2. Normalizzazione trattini e trattini lunghi
    const dashNormalized = text.replace(/[\u2013\u2014\u2212]/g, '-');
    if (dashNormalized !== text) {
      text = dashNormalized;
      transformations.push('normalized_dashes');
    }

    // 3. Normalizzazione simbolo Euro e valuta
    const euroNormalized = text.replace(/(?:EUR|Euro|€)\s*/gi, '€ ');
    if (euroNormalized !== text) {
      text = euroNormalized;
      transformations.push('normalized_currency_symbol');
    }

    // 4. Divisione in righe e pulizia whitespace riga per riga
    const rawLines = rawText.split(/\r?\n/);
    let normalizedLines = text
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/[ \t]+/g, ' '))
      .filter((line) => line.length > 0 && !/^[*=\-_.~#]+$/.test(line));

    // 5. Rimozione intestazioni/piè di pagina identici duplicati su scontrini lunghi o multipagina
    const deDuplicatedLines = this.deduplicateRepeatedHeaders(normalizedLines);
    if (deDuplicatedLines.length !== normalizedLines.length) {
      normalizedLines = deDuplicatedLines;
      transformations.push('deduplicated_repeated_headers');
    }

    // 6. Testo finale ricomposto
    const normalizedText = normalizedLines.join('\n');

    return {
      originalText: rawText,
      normalizedText,
      lines: rawLines,
      normalizedLines,
      transformations,
    };
  }

  /**
   * Converte una stringa numerica italiana (es. "24,50", "1.234,56", "24.50", "-2,50", "2,50-") in un numero float valido.
   */
  public static parseItalianNumber(valStr: string): number | null {
    if (!valStr) return null;
    let s = valStr.trim().replace(/€/g, '').replace(/\s+/g, '');

    let isNegative = false;
    if (s.endsWith('-')) {
      isNegative = true;
      s = s.slice(0, -1);
    } else if (s.startsWith('-')) {
      isNegative = true;
      s = s.slice(1);
    }

    // Correzione OCR mirata nei numeri (es. O/o -> 0, I/l/i -> 1, S/s -> 5, B -> 8)
    s = s.replace(/^[Oo]/, '0').replace(/^[Ii|l]/, '1');

    // Gestisci formato tipo 1.234,56 oppure 24,50
    if (s.includes(',') && s.includes('.')) {
      if (s.indexOf('.') < s.indexOf(',')) {
        // Formato 1.234,56 -> rimuovi punti, punto decimale alla virgola
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        // Formato 1,234.56 -> rimuovi virgole
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      // Solo virgola -> sostituisci con punto
      s = s.replace(',', '.');
    }

    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return isNegative ? -Math.abs(n) : n;
  }

  private static deduplicateRepeatedHeaders(lines: string[]): string[] {
    if (lines.length <= 10) return lines;

    const result: string[] = [];
    const seenHeaders = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Controlla se le prime righe del negozio si ripetono esattamente su nuove sezioni
      if (i > 5 && seenHeaders.has(line) && (line.includes('P.IVA') || line.includes('VIA') || line.includes('DOCUMENTO COMMERCIALE'))) {
        // Salta la riga duplicata
        continue;
      }
      if (i < 5) {
        seenHeaders.add(line);
      }
      result.push(line);
    }

    return result;
  }
}
