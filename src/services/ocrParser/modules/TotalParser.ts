import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

export class TotalParser implements ReceiptParserModule<number> {
  public name = 'TotalParser';

  private totalKeywords = [
    { pattern: /\bTOTALE\s+EURO\b/i, scoreBonus: 85 },
    { pattern: /\bTOTALE\s+COMPLESSIVO\b/i, scoreBonus: 80 },
    { pattern: /\bTOTALE\s+DOC(?:UMENTO)?\b/i, scoreBonus: 70 },
    { pattern: /\bTOTALE\s*€/i, scoreBonus: 70 },
    { pattern: /\bTOTALE\b/i, scoreBonus: 65 },
    { pattern: /\bDA\s+PAGARE\b/i, scoreBonus: 65 },
    { pattern: /\bIMPORTO\s+TOTALE\b/i, scoreBonus: 70 },
    { pattern: /\bTOT\.\s*€?/i, scoreBonus: 60 },
  ];

  private excludeKeywords = [
    'SUBTOTALE',
    'SUB-TOTALE',
    'TOTALE IVA',
    'CONTANTI',
    'RESTO',
    'CARTA',
    'BANCOMAT',
    'POS',
    'PUNTI',
    'IMPONIBILE',
    'ESENTE',
    'ABBUONO',
    'SCONTO TOTALE',
  ];

  public parse(context: ReceiptParserContext): ParsedField<number> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0 };
    }

    const candidates: Array<{
      value: number;
      score: number;
      lineIndex: number;
      sourceText: string;
    }> = [];

    // Pattern importo numerico italiano (es. 24,50, 1.234,56, 24.50)
    const amountRegex = /(?:€\s*)?(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\b/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // Esclusioni esplicite (es. SUBTOTALE, CONTANTI, RESTO)
      const isExcluded = this.excludeKeywords.some((exc) => upper.includes(exc));
      if (isExcluded) continue;

      let score = 0;
      let matchedKeyword = false;

      for (const kw of this.totalKeywords) {
        if (kw.pattern.test(line)) {
          score += kw.scoreBonus;
          matchedKeyword = true;
          break;
        }
      }

      if (!matchedKeyword) continue;

      // Cerca l'importo nella riga corrente o nella riga immediatamente successiva (es. TOTALE \n 24.50)
      let match = line.match(amountRegex);
      let targetLine = line;
      let targetIdx = i;

      if (!match && i + 1 < lines.length) {
        match = lines[i + 1].match(amountRegex);
        if (match) {
          targetLine = `${line} ${lines[i + 1]}`;
          targetIdx = i + 1;
        }
      }

      if (match) {
        const parsedVal = TextNormalizationModule.parseItalianNumber(match[1]);
        if (parsedVal !== null && parsedVal > 0 && parsedVal < 100000) {
          // Bonus per posizione nel terzo inferiore dello scontrino
          if (i > lines.length * 0.5) {
            score += 15;
          }

          candidates.push({
            value: Math.round(parsedVal * 100) / 100,
            score,
            lineIndex: targetIdx,
            sourceText: targetLine,
          });
        }
      }
    }

    if (candidates.length === 0) {
      // Fallback: cerca la cifra numerica più alta nelle ultime 8 righe (escludendo contanti/resto)
      for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
        const line = lines[i];
        const upper = line.toUpperCase();
        if (upper.includes('RESTO') || upper.includes('CONTANTI') || upper.includes('PUNTI')) continue;

        const match = line.match(amountRegex);
        if (match) {
          const val = TextNormalizationModule.parseItalianNumber(match[1]);
          if (val !== null && val > 0 && val < 50000) {
            candidates.push({
              value: Math.round(val * 100) / 100,
              score: 25,
              lineIndex: i,
              sourceText: line,
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      return {
        value: null,
        confidence: 0,
        warnings: ['totale_non_identificato'],
      };
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    const alternatives = Array.from(new Set(candidates.slice(1).map((c) => c.value))).filter(
      (v) => v !== best.value
    );

    return {
      value: best.value,
      confidence: Math.min(95, Math.max(30, best.score)),
      lineIndex: best.lineIndex,
      sourceText: best.sourceText,
      alternatives,
    };
  }
}
