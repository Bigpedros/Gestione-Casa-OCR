import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';

export class PaymentMethodParser implements ReceiptParserModule<string> {
  public name = 'PaymentMethodParser';

  private patterns = [
    {
      key: 'contanti',
      regex: /\b(?:CONTANT[EI]|PAGAMENTO\s+CONTANT[EI]|PAGATO\s+CONTANT[EI]|PAG\.?\s*CONTANT[EI]|PAGAMENTO\s+IN\s+CONTANT[EI]|CASH|RESTO\b|RESTO\s*[:=]?\s*\d)\b/i,
      confidence: 95,
    },
    {
      key: 'bancomat',
      regex: /\b(?:BANCOMAT|PAGOBANCOMAT|DEBITO|CARTA\s+DEBITO|CARTA\s+DI\s+DEBITO)\b/i,
      confidence: 90,
    },
    {
      key: 'carta',
      regex: /\b(?:PAGAMENTO\s+ELETTRONICO|PAG\.?\s*ELETTRONICO|ELETTRONICO|CARTA\s+ELETTRONICA|CARTA\s+CREDITO|CARTA\s+DI\s+CREDITO|CREDITO|CONTACTLESS|POS|VISA|MASTERCARD|PAYPASS|MAESTRO|POSTEPAY)\b/i,
      confidence: 90,
    },
    {
      key: 'bonifico',
      regex: /\b(?:BONIFICO|IBAN)\b/i,
      confidence: 90,
    },
    {
      key: 'buono',
      regex: /\b(?:BUONO\s+PASTO|BUONI\s+PASTO|TICKET|TICKET\s*RESTAURANT)\b/i,
      confidence: 90,
    },
    {
      key: 'digitalWallet',
      regex: /\b(?:SATISPAY|APPLE\s*PAY|GOOGLE\s*PAY|PAYPAL|WALLET)\b/i,
      confidence: 90,
    },
    {
      key: 'misto',
      regex: /\b(?:PAGAMENTO\s*MISTO|MISTO)\b/i,
      confidence: 85,
    },
  ];

  public parse(context: ReceiptParserContext): ParsedField<string> {
    const rawLines = context.normalizedLines;
    if (!rawLines || rawLines.length === 0) {
      return { value: null, confidence: 0 };
    }

    const lines = rawLines.map((l) => l.replace(/^[‘'"`«“\s*_\-|]+/, '').trim());

    // 1. Controllo prioritario sui contanti: se compare RESTO o CONTANTI nel documento, è contanti al 100%
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (this.patterns[0].regex.test(line)) {
        return {
          value: 'contanti',
          confidence: 95,
          lineIndex: i,
          sourceText: rawLines[i],
        };
      }
    }

    // 2. Cerca gli altri metodi prevalentemente nella metà inferiore del documento
    const startLine = Math.max(0, Math.floor(lines.length * 0.3));

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (let p = 1; p < this.patterns.length; p++) {
        const item = this.patterns[p];
        if (item.regex.test(line)) {
          return {
            value: item.key,
            confidence: item.confidence,
            lineIndex: i,
            sourceText: rawLines[i],
          };
        }
      }
    }

    // 3. Fallback: cerca in tutto il testo se non trovato
    for (let i = 0; i < startLine; i++) {
      const line = lines[i];
      for (let p = 1; p < this.patterns.length; p++) {
        const item = this.patterns[p];
        if (item.regex.test(line)) {
          return {
            value: item.key,
            confidence: item.confidence - 10,
            lineIndex: i,
            sourceText: rawLines[i],
          };
        }
      }
    }

    return { value: null, confidence: 0 };
  }
}
