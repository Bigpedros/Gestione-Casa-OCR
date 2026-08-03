import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';

export class TaxIdentifierParser implements ReceiptParserModule<string> {
  public name = 'TaxIdentifierParser';

  public parse(context: ReceiptParserContext): ParsedField<string> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0 };
    }

    const pIvaRegex = /(?:P\.?\s*IVA|PIVA|PARTITA\s*IVA|IT)\s*:?\s*([0-9]{11})/i;
    const cfRegex = /(?:C\.?\s*F\.?|COD\.?\s*FISC\.?|CODICE\s*FISCALE)\s*:?\s*([A-Z0-9]{16})/i;

    let foundPIva: { value: string; lineIndex: number; sourceText: string; isValid: boolean } | null = null;
    let foundCf: { value: string; lineIndex: number; sourceText: string; isValid: boolean } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 1. Cerca Partita IVA
      const pIvaMatch = line.match(pIvaRegex) || line.match(/\b([0-9]{11})\b/);
      if (pIvaMatch && !foundPIva) {
        const rawPiva = pIvaMatch[1];
        // Se si trova nel contesto dei primi 10 righi o vicino a P.IVA
        if (line.toUpperCase().includes('IVA') || line.toUpperCase().includes('P.IVA') || i < 10) {
          const isValid = this.validateItalianPIva(rawPiva);
          foundPIva = {
            value: `P.IVA ${rawPiva}`,
            lineIndex: i,
            sourceText: line,
            isValid,
          };
        }
      }

      // 2. Cerca Codice Fiscale
      const cfMatch = line.match(cfRegex) || line.match(/\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/i);
      if (cfMatch && !foundCf) {
        const rawCf = cfMatch[1].toUpperCase();
        foundCf = {
          value: `C.F. ${rawCf}`,
          lineIndex: i,
          sourceText: line,
          isValid: true,
        };
      }
    }

    if (foundPIva) {
      return {
        value: foundPIva.value,
        confidence: foundPIva.isValid ? 95 : 50,
        lineIndex: foundPIva.lineIndex,
        sourceText: foundPIva.sourceText,
        warnings: foundPIva.isValid ? [] : ['checksum_piva_non_valido'],
      };
    }

    if (foundCf) {
      return {
        value: foundCf.value,
        confidence: 90,
        lineIndex: foundCf.lineIndex,
        sourceText: foundCf.sourceText,
      };
    }

    return { value: null, confidence: 0 };
  }

  /**
   * Validazione formale algoritmo Partita IVA italiana (11 cifre).
   */
  public validateItalianPIva(pIva: string): boolean {
    if (!/^\d{11}$/.test(pIva)) return false;

    let s1 = 0;
    let s2 = 0;

    for (let i = 0; i < 10; i += 2) {
      s1 += parseInt(pIva[i], 10);
    }

    for (let i = 1; i < 10; i += 2) {
      const doubled = parseInt(pIva[i], 10) * 2;
      s2 += doubled > 9 ? doubled - 9 : doubled;
    }

    const total = (s1 + s2) % 10;
    const checkDigit = (10 - total) % 10;

    return checkDigit === parseInt(pIva[10], 10);
  }
}
