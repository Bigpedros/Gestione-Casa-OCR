import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';

export class PaymentMethodParser implements ReceiptParserModule<string> {
  public name = 'PaymentMethodParser';

  private patterns = [
    { key: 'contanti', regex: /\b(?:CONTANTI|CASH|CONTANTE)\b/i, confidence: 90 },
    { key: 'bancomat', regex: /\b(?:BANCOMAT|PAGOBANCOMAT|DEBITO)\b/i, confidence: 90 },
    { key: 'carta', regex: /\b(?:CARTA|CARTE|CREDITO|CONTACTLESS|POS|VISA|MASTERCARD|PAYPASS|MAESTRO|POSTEPAY)\b/i, confidence: 85 },
    { key: 'bonifico', regex: /\b(?:BONIFICO|IBAN)\b/i, confidence: 90 },
    { key: 'buono', regex: /\b(?:BUONO\s+PASTO|BUONI\s+PASTO|TICKET|TICKET\s*RESTAURANT)\b/i, confidence: 90 },
    { key: 'misto', regex: /\b(?:PAGAMENTO\s*MISTO|MISTO)\b/i, confidence: 85 },
  ];

  public parse(context: ReceiptParserContext): ParsedField<string> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0 };
    }

    // Cerca prevalentemente nella metà inferiore del documento
    const startLine = Math.max(0, Math.floor(lines.length * 0.4));

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (const item of this.patterns) {
        if (item.regex.test(line)) {
          return {
            value: item.key,
            confidence: item.confidence,
            lineIndex: i,
            sourceText: line,
          };
        }
      }
    }

    // Fallback: cerca in tutto il testo se non trovato in fondo
    for (let i = 0; i < startLine; i++) {
      const line = lines[i];
      for (const item of this.patterns) {
        if (item.regex.test(line)) {
          return {
            value: item.key,
            confidence: item.confidence - 10,
            lineIndex: i,
            sourceText: line,
          };
        }
      }
    }

    return { value: null, confidence: 0 };
  }
}
