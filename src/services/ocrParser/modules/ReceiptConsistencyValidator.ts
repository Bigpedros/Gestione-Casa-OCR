import { ParsedReceiptDraft, ParserWarning } from '../types';

export const MONEY_TOLERANCE = 0.05; // Tolleranza monetaria centralizzata (5 centesimi)

export class ReceiptConsistencyValidator {
  public name = 'ReceiptConsistencyValidator';

  public static validate(draft: ParsedReceiptDraft): { warnings: ParserWarning[]; adjustedConfidence: number } {
    const warnings: ParserWarning[] = [...draft.warnings];
    let penalty = 0;

    // 1. Verifica testo troppo scarso
    if (draft.lines.length === 0 && !draft.total.value) {
      warnings.push({
        code: 'SCANTY_TEXT_WARNING',
        message: 'Testo estratto insufficiente per comporre un documento di spesa valido',
        severity: 'high',
      });
      penalty += 30;
    }

    // 2. Verifica totale mancante
    if (!draft.total.value || draft.total.value <= 0) {
      warnings.push({
        code: 'MISSING_TOTAL_WARNING',
        message: 'Importo totale del documento non individuato',
        severity: 'high',
        field: 'total',
      });
      penalty += 25;
    }

    // 3. Somma delle righe vs Totale
    if (draft.total.value && draft.lines.length > 0) {
      const sumLines = draft.lines.reduce((acc, line) => acc + line.lineTotal, 0);
      const roundedSum = Math.round(sumLines * 100) / 100;
      const diff = Math.abs(roundedSum - draft.total.value);

      if (diff > MONEY_TOLERANCE) {
        warnings.push({
          code: 'LINE_SUM_MISMATCH',
          message: `Discrepanza tra somma delle righe (${roundedSum.toFixed(2)} €) e totale rilevato (${draft.total.value.toFixed(2)} €)`,
          severity: 'medium',
          field: 'total',
          details: { sumLines: roundedSum, detectedTotal: draft.total.value, diff },
        });
        penalty += 15;
      }
    }

    // 4. Subtotale - Sconti vs Totale
    if (draft.subtotal.value && draft.total.value) {
      const expectedTotal = draft.subtotal.value - (draft.discounts.value || 0);
      const diff = Math.abs(expectedTotal - draft.total.value);

      if (diff > MONEY_TOLERANCE) {
        warnings.push({
          code: 'SUBTOTAL_MISMATCH',
          message: `Discrepanza tra subtotale al netto sconti (${expectedTotal.toFixed(2)} €) e totale (${draft.total.value.toFixed(2)} €)`,
          severity: 'medium',
          field: 'subtotal',
        });
        penalty += 10;
      }
    }

    // 5. Coerenza Quantità x Prezzo Unitario vs Totale Riga
    for (const line of draft.lines) {
      if (line.quantity > 0 && line.unitPrice > 0 && line.lineTotal !== 0) {
        const expectedLineTotal = Math.round(line.quantity * line.unitPrice * 100) / 100;
        const lineDiff = Math.abs(Math.abs(line.lineTotal) - expectedLineTotal);

        if (lineDiff > MONEY_TOLERANCE) {
          if (!line.warnings) line.warnings = [];
          line.warnings.push('QTY_PRICE_MISMATCH');
          warnings.push({
            code: 'QTY_PRICE_MISMATCH',
            message: `Riga "${line.normalizedDescription}": Quantità (${line.quantity}) x Prezzo (${line.unitPrice.toFixed(2)} €) non corrisponde al totale riga (${line.lineTotal.toFixed(2)} €)`,
            severity: 'low',
            field: 'lines',
          });
          penalty += 5;
        }
      }
    }

    // 6. Data futura improbabile (> 1 anno nel futuro)
    if (draft.date.value) {
      const parsedDate = new Date(draft.date.value);
      const now = new Date();
      const oneYearFuture = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

      if (parsedDate > oneYearFuture) {
        warnings.push({
          code: 'FUTURE_DATE_WARNING',
          message: `Data rilevata (${draft.date.value}) è improbabile perché troppo distante nel futuro`,
          severity: 'medium',
          field: 'date',
        });
        penalty += 15;
      }
    }

    // 7. Rilevamento righe duplicate (es. da sovrapposizione scontrino lungo)
    const lineMap = new Map<string, number>();
    for (const line of draft.lines) {
      const key = `${line.normalizedDescription.toLowerCase()}_${line.lineTotal}`;
      lineMap.set(key, (lineMap.get(key) || 0) + 1);
    }

    for (const [key, count] of lineMap.entries()) {
      if (count > 1) {
        const desc = key.split('_')[0];
        warnings.push({
          code: 'POSSIBLE_DUPLICATE_LINES',
          message: `Possibile riga duplicata rilevata da sovrapposizione: "${desc}" (${count} occorrenze)`,
          severity: 'low',
          field: 'lines',
        });
      }
    }

    const calculatedConfidence = Math.max(0, Math.min(100, draft.overallConfidence - penalty));

    return {
      warnings,
      adjustedConfidence: calculatedConfidence,
    };
  }
}
