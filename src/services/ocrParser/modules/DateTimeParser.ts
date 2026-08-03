import { ReceiptParserContext, ParsedField } from '../types';

export interface DateTimeParserResult {
  date: ParsedField<string>;
  time: ParsedField<string>;
}

export class DateTimeParser {
  public name = 'DateTimeParser';

  private promoExclusions = ['VALIDO', 'VOLANTINO', 'SCADENZA', 'OFFERTA', 'DAL', 'FINO AL'];

  public parse(context: ReceiptParserContext): DateTimeParserResult {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return {
        date: { value: null, confidence: 0 },
        time: { value: null, confidence: 0 },
      };
    }

    const dateCandidates: Array<{
      isoDate: string;
      rawDate: string;
      score: number;
      lineIndex: number;
      sourceText: string;
    }> = [];

    let foundTime: { timeStr: string; lineIndex: number; sourceText: string } | null = null;

    // Pattern data: dd/MM/yyyy, dd-MM-yyyy, dd.MM.yyyy, yyyy-MM-dd, dd/MM/yy
    const dateRegexes = [
      /\b([0-3]?\d)[/.-]([0-1]?\d)[/.-](20\d{2})\b/, // 12/05/2026
      /\b(20\d{2})[/.-]([0-1]?\d)[/.-]([0-3]?\d)\b/, // 2026-05-12
      /\b([0-3]?\d)[/.-]([0-1]?\d)[/.-](\d{2})\b/, // 12/05/26
    ];

    // Pattern ora: HH:mm oppure HH:mm:ss
    const timeRegex = /\b([0-2]?\d):([0-5]\d)(?::([0-5]\d))?\b/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // Controllo se la riga contiene keywords promozionali da penalizzare
      const isPromo = this.promoExclusions.some((p) => upper.includes(p));

      // 1. Cerca ORA se non ancora trovata
      if (!foundTime) {
        const timeMatch = line.match(timeRegex);
        if (timeMatch) {
          const hh = timeMatch[1].padStart(2, '0');
          const mm = timeMatch[2];
          const ss = timeMatch[3] ? `:${timeMatch[3]}` : '';
          const hourNum = parseInt(hh, 10);

          if (hourNum >= 0 && hourNum <= 23) {
            foundTime = {
              timeStr: `${hh}:${mm}${ss}`,
              lineIndex: i,
              sourceText: line,
            };
          }
        }
      }

      // 2. Cerca DATE
      for (const regex of dateRegexes) {
        const match = line.match(regex);
        if (match) {
          let day: number, month: number, year: number;

          if (match[0].length === 10 && regex.source.startsWith('\\b(20')) {
            // yyyy-MM-dd
            year = parseInt(match[1], 10);
            month = parseInt(match[2], 10);
            day = parseInt(match[3], 10);
          } else {
            // dd/MM/yyyy o dd/MM/yy
            day = parseInt(match[1], 10);
            month = parseInt(match[2], 10);
            let yRaw = match[3];
            if (yRaw.length === 2) {
              const yNum = parseInt(yRaw, 10);
              year = yNum <= 49 ? 2000 + yNum : 1900 + yNum;
            } else {
              year = parseInt(yRaw, 10);
            }
          }

          // Validazione formale giorno/mese/anno
          if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2040) {
            const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            let score = 50;

            // Parole chiave privilegiate per la data del documento commercial/fiscale
            if (/DEL|DATA|DOC|EMESSO|SCONTRINO|COMMERCIALE|ORA|ORE/i.test(line)) {
              score += 35;
            }

            // Prossimità alle prime righe del documento o al piè di pagina con numero scontrino
            if (i < 8 || i > lines.length - 8) {
              score += 20;
            }

            // Penalità se in riga promozionale
            if (isPromo) {
              score -= 40;
            }

            dateCandidates.push({
              isoDate,
              rawDate: match[0],
              score,
              lineIndex: i,
              sourceText: line,
            });
          }
        }
      }
    }

    // Risultato data
    let dateResult: ParsedField<string>;

    if (dateCandidates.length === 0) {
      dateResult = { value: null, confidence: 0, warnings: ['data_non_trovata'] };
    } else {
      dateCandidates.sort((a, b) => b.score - a.score);
      const best = dateCandidates[0];
      const alternatives = Array.from(new Set(dateCandidates.slice(1).map((c) => c.isoDate))).filter(
        (d) => d !== best.isoDate
      );

      dateResult = {
        value: best.isoDate,
        confidence: Math.min(95, Math.max(30, best.score)),
        lineIndex: best.lineIndex,
        sourceText: best.sourceText,
        alternatives,
      };
    }

    // Risultato ora
    const timeResult: ParsedField<string> = foundTime
      ? {
          value: foundTime.timeStr,
          confidence: 85,
          lineIndex: foundTime.lineIndex,
          sourceText: foundTime.sourceText,
        }
      : { value: null, confidence: 0 };

    return {
      date: dateResult,
      time: timeResult,
    };
  }
}
