import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

export class SubtotalParser implements ReceiptParserModule<number> {
  public name = 'SubtotalParser';

  public parse(context: ReceiptParserContext): ParsedField<number> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0 };
    }

    const subtotalKeywords = /SUBTOTALE|SUB-TOTALE|PARZIALE|SOMMANO|IMPONIBILE/i;
    const amountRegex = /(?:€\s*)?(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\b/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (subtotalKeywords.test(line)) {
        const match = line.match(amountRegex);
        if (match) {
          const val = TextNormalizationModule.parseItalianNumber(match[1]);
          if (val !== null && val > 0) {
            return {
              value: Math.round(val * 100) / 100,
              confidence: 85,
              lineIndex: i,
              sourceText: line,
            };
          }
        }
      }
    }

    return { value: null, confidence: 0 };
  }
}
