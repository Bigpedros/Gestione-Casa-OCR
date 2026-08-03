import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

export class VatParser implements ReceiptParserModule<number> {
  public name = 'VatParser';

  public parse(context: ReceiptParserContext): ParsedField<number> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0 };
    }

    const vatKeywords = /TOTALE\s+IVA|TOT\.\s*IVA|IMPOSTA|IVA\s+\d{1,2}%/i;
    const amountRegex = /(?:€\s*)?(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\b/;

    let vatSum = 0;
    let found = false;
    let lastIdx = -1;
    let lastSource = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (vatKeywords.test(line)) {
        const match = line.match(amountRegex);
        if (match) {
          const val = TextNormalizationModule.parseItalianNumber(match[1]);
          if (val !== null && val >= 0) {
            vatSum += val;
            found = true;
            lastIdx = i;
            lastSource = line;
          }
        }
      }
    }

    if (!found) {
      return { value: null, confidence: 0 };
    }

    return {
      value: Math.round(vatSum * 100) / 100,
      confidence: 80,
      lineIndex: lastIdx,
      sourceText: lastSource,
    };
  }
}
