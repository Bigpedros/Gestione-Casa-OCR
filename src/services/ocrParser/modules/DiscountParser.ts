import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

export class DiscountParser implements ReceiptParserModule<number> {
  public name = 'DiscountParser';

  public parse(context: ReceiptParserContext): ParsedField<number> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0 };
    }

    const discountKeywords = /SCONTO\s+TOTALE|TOTALE\s+SCONTI|BUONO\s+SCONTO|ABBUONO|SCONTO\s+CARTA|SCONTO\s*€?/i;
    const amountRegex = /(?:-|\s)?(?:€\s*)?(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\b/;

    let totalDiscount = 0;
    let found = false;
    let lastIdx = -1;
    let lastSource = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (discountKeywords.test(line)) {
        const match = line.match(amountRegex);
        if (match) {
          const val = TextNormalizationModule.parseItalianNumber(match[1]);
          if (val !== null && val > 0) {
            totalDiscount += val;
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
      value: Math.round(totalDiscount * 100) / 100,
      confidence: 80,
      lineIndex: lastIdx,
      sourceText: lastSource,
    };
  }
}
