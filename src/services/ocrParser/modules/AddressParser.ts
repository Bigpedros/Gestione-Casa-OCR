import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';

export class AddressParser implements ReceiptParserModule<string> {
  public name = 'AddressParser';

  public parse(context: ReceiptParserContext): ParsedField<string> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0 };
    }

    const streetPattern = /\b(?:VIA|VIALE|CORSO|PIAZZA|PIAZZALE|LARGO|V\.LE|C\.SO|P\.ZZA|P\.ZA|STRADA|FRAZIONE)\s+[^,\n\r]+/i;
    const capPattern = /\b\d{5}\b/;
    const provincePattern = /\b\(?[A-Z]{2}\)?\b/;

    let foundStreet: string | null = null;
    let foundCapCity: string | null = null;
    let lineIdx = -1;

    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];

      // Cerca indirizzo stradale
      if (!foundStreet && streetPattern.test(line)) {
        foundStreet = line.trim();
        lineIdx = i;

        // Se la riga successiva contiene CAP e Città, unisci
        if (i + 1 < lines.length && (capPattern.test(lines[i + 1]) || provincePattern.test(lines[i + 1]))) {
          foundCapCity = lines[i + 1].trim();
        }
        break;
      }
    }

    // Se non ha trovato VIA/PIAZZA, cerca righe con CAP a 5 cifre seguito da città
    if (!foundStreet) {
      for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i];
        if (capPattern.test(line) && /[A-Za-z]/.test(line)) {
          foundCapCity = line.trim();
          lineIdx = i;
          break;
        }
      }
    }

    if (!foundStreet && !foundCapCity) {
      return { value: null, confidence: 0 };
    }

    const fullAddress = [foundStreet, foundCapCity].filter(Boolean).join(' - ');
    const confidence = foundStreet && foundCapCity ? 85 : 60;

    return {
      value: fullAddress,
      confidence,
      lineIndex: lineIdx,
      sourceText: fullAddress,
    };
  }
}
