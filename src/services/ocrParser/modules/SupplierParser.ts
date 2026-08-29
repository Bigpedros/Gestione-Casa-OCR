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

  /**
   * Normalizzazione generica OCR di caratteri confusi frequenti (0/O, 1/I, 5/S)
   */
  private normalizeOcrLetters(text: string): string {
    return text
      .toUpperCase()
      .replace(/\b0([A-Z]+)\b/g, 'O$1')
      .replace(/\b([A-Z]+)0\b/g, '$1O')
      .replace(/\b1([A-Z]+)\b/g, 'I$1')
      .replace(/\b([A-Z]+)1\b/g, '$1I');
  }

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
    const candidates: Array<{
      name: string;
      score: number;
      lineIndex: number;
      sourceText: string;
      isLowConfidence?: boolean;
    }> = [];

    for (let i = 0; i < maxLines; i++) {
      const line = lines[i];
      const upperLine = line.toUpperCase();

      // Controlla se è una riga da escludere (es. DOCUMENTO COMMERCIALE)
      const isExcluded = this.genericExclusions.some((exc) => upperLine.includes(exc));
      if (isExcluded) continue;

      // Se la riga è troppo corta o contiene solo numeri/date/punteggiatura
      if (line.replace(/[^a-zA-Zà-ùÀ-Ù0-9]/g, '').length < 3) continue;

      let score = 50 - i * 5; // Punteggio base decrescente con la posizione

      // Punti per forme societarie (S.R.L., S.P.A., ecc.)
      const isCorporateForm = /\b(S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|SOC\.?\s*COOP\.?)\b/i.test(line);
      if (isCorporateForm) {
        score += 30;
      }

      // Prossimità a P.IVA o indirizzo nelle righe successive (+15 punti)
      let hasAddressOrVatNearby = false;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/\b(?:P\.?\s*IVA|PARTITA\s*IVA|VIA|CORSO|PIAZZA|VIALE|TEL)\b/i.test(lines[j])) {
          score += 15;
          hasAddressOrVatNearby = true;
          break;
        }
      }

      // Se è in prima/seconda riga con caratteri alfabetici validi
      if (i === 0 && line.replace(/[^A-Za-z]/g, '').length >= 3) {
        score += 20;
      }

      // Pulizia nome candidato (rimuovi eventuali caratteri di disturbo iniziali/finali)
      const cleanName = line.replace(/^[*\-_\s]+/, '').replace(/[*\-_\s]+$/, '').trim();

      // Applica normalizzazione contestuale dei caratteri
      const contextualName = this.normalizeOcrLetters(cleanName);

      const isLowConf = !isCorporateForm && !hasAddressOrVatNearby && i > 2;

      candidates.push({
        name: contextualName,
        score,
        lineIndex: i,
        sourceText: line,
        isLowConfidence: isLowConf,
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
    const confidence = Math.min(90, Math.max(20, best.score));
    const alternatives = candidates.slice(1, 4).map((c) => c.name);

    const warnings: string[] = [];
    if (confidence < 60 || best.isLowConfidence) {
      warnings.push('fornitore_da_verificare');
    }

    return {
      value: best.name,
      confidence,
      lineIndex: best.lineIndex,
      sourceText: best.sourceText,
      alternatives,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
