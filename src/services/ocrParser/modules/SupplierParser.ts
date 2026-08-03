import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';

export class SupplierParser implements ReceiptParserModule<string> {
  public name = 'SupplierParser';

  private genericExclusions = [
    'DOCUMENTO COMMERCIALE',
    'SCONTRINO FISCALE',
    'RICEVUTA FISCALE',
    'FATTURA ELETTRONICA',
    'FATTURA N',
    'FATTURA NO',
    'FATTURA',
    'TOTALE',
    'SUBTOTALE',
    'BENVENUTO',
    'BENVENUTI',
    'ARRIVEDERCI',
    'GRAZIE E ARRIVEDERCI',
    'GRAZIE E BUONA GIORNATA',
    'P.IVA',
    'PARTITA IVA',
    'CODICE FISCALE',
    'C.F.',
    'TEL.',
    'TELEFONO',
    'CASSA',
    'CASSIR',
    'OPERATORE',
    'SPETT.LE',
    'CLIENTE',
  ];

  private knownBrands = [
    'DESPAR',
    'EUROSPAR',
    'INTERSPAR',
    'ESSELUNGA',
    'CONAD',
    'COOP',
    'IPERCOOP',
    'LIDL',
    'ALDI',
    'CARREFOUR',
    'EUROSPIN',
    'PENNY',
    'PAM',
    'PANORAMA',
    'TIGOTA',
    'ACQUA & SAPONE',
    'DECATHLON',
    'LEROY MERLIN',
    'MEDIAWORLD',
    'UNIEURO',
    'IKEA',
    'MD',
    'TODIS',
    'CRAI',
    'SELEX',
    'TIGROS',
    'BENNET',
    'FARMACIA',
    'PARAFARMACIA',
    'AUTOGRILL',
    'CHEF EXPRESS',
    'MCDONALD',
    'BURGER KING',
  ];

  public parse(context: ReceiptParserContext): ParsedField<string> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return {
        value: null,
        confidence: 0,
        warnings: ['nessun_testo_disponibile'],
      };
    }

    const maxLines = Math.min(8, lines.length);
    const candidates: Array<{ name: string; score: number; lineIndex: number; sourceText: string }> = [];

    for (let i = 0; i < maxLines; i++) {
      const line = lines[i];
      const upperLine = line.toUpperCase();

      // Controlla se è una riga da escludere (es. DOCUMENTO COMMERCIALE)
      const isExcluded = this.genericExclusions.some((exc) => upperLine.includes(exc));
      if (isExcluded) continue;

      // Se la riga è troppo corta o contiene solo numeri/date/punteggiatura
      if (line.replace(/[^a-zA-Zà-ùÀ-Ù]/g, '').length < 3) continue;

      let score = 50 - i * 5; // Punteggio base decrescente con la posizione

      // Punti extra per forme societarie (S.R.L., S.P.A., ecc.)
      if (/\b(S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|SOC\.?\s*COOP\.?)\b/i.test(line)) {
        score += 40;
      }

      // Punti extra per brand o marchi noti
      const brandFound = this.knownBrands.find((b) => upperLine.includes(b));
      if (brandFound) {
        score += 45;
      }

      // Prossimità a P.IVA o indirizzo nelle righe successive (+15 punti)
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/P\.?IVA|VIA|CORSO|PIAZZA|TEL/i.test(lines[j])) {
          score += 15;
          break;
        }
      }

      // Pulizia nome candidato (rimuovi eventuali caratteri di disturbo iniziali)
      const cleanName = line.replace(/^[*\-_.\s]+/, '').trim();

      candidates.push({
        name: cleanName,
        score,
        lineIndex: i,
        sourceText: line,
      });
    }

    if (candidates.length === 0) {
      return {
        value: null,
        confidence: 0,
        warnings: ['fornitore_non_identificato'],
      };
    }

    // Ordina per punteggio decrescente
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const confidence = Math.min(95, Math.max(20, best.score));
    const alternatives = candidates.slice(1, 4).map((c) => c.name);

    return {
      value: best.name,
      confidence,
      lineIndex: best.lineIndex,
      sourceText: best.sourceText,
      alternatives,
    };
  }
}
