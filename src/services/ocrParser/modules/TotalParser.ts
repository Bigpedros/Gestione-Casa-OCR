import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

interface TotalCandidate {
  type: 'direct_total' | 'paid_amount' | 'subtotal' | 'cash_minus_change';
  value: number;
  score: number;
  lineIndex: number;
  sourceText: string;
  explanation: string;
}

export class TotalParser implements ReceiptParserModule<number> {
  public name = 'TotalParser';

  private directTotalKeywords = [
    { pattern: /\bTOTALE\s+COMPLESSIVO\b/i, scoreBonus: 95 },
    { pattern: /\bTOTALE\s+EURO\b/i, scoreBonus: 95 },
    { pattern: /\bTOTALE\s*€/i, scoreBonus: 90 },
    { pattern: /\bTOTALE\s+EUR\b/i, scoreBonus: 90 },
    { pattern: /\bTOTALE\s+DOVUTO\b/i, scoreBonus: 85 },
    { pattern: /\bTOTALE\s+DOC(?:UMENTO)?\b/i, scoreBonus: 80 },
    { pattern: /\bDA\s+PAGARE\b/i, scoreBonus: 80 },
    { pattern: /\bTOTALE\s+SPESA\b/i, scoreBonus: 80 },
    { pattern: /\bTOTALE\s+CONTO\b/i, scoreBonus: 80 },
    { pattern: /\bIMPORTO\s+TOTALE\b/i, scoreBonus: 80 },
    { pattern: /\bTOTALE\b/i, scoreBonus: 70 },
    { pattern: /\bTOT\.\s*€?/i, scoreBonus: 65 },
  ];

  public parse(context: ReceiptParserContext): ParsedField<number> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0, warnings: ['totale_non_identificato'] };
    }

    const candidates: TotalCandidate[] = [];
    const amountRegex = /(?:€\s*)?(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\b/g;

    // Helper per estrarre l'ultimo importo decimale valido da una stringa
    const extractAmount = (text: string): number | null => {
      // Pulizia typo OCR comuni nei numeri (es. '21,9O' o '21,9)' o '21,9o')
      const sanitized = text
        .replace(/([0-9],[0-9])[oO)]/g, '$10')
        .replace(/([0-9])\.([0-9])[oO)]/g, '$1.$20');

      const matches = Array.from(sanitized.matchAll(amountRegex));
      if (matches.length === 0) return null;
      const raw = matches[matches.length - 1][1];
      const parsed = TextNormalizationModule.parseItalianNumber(raw);
      if (parsed !== null && parsed > 0 && parsed < 100000) {
        return Math.round(parsed * 100) / 100;
      }
      return null;
    };

    let cashValue: { val: number; lineIndex: number; text: string } | null = null;
    let changeValue: { val: number; lineIndex: number; text: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // Salta righe di totale IVA per evitare confusioni
      if (upper.includes('TOTALE IVA') || upper.includes('DI CUI IVA')) {
        continue;
      }

      // 1. Candidato: TOTALE Diretto
      let isDirectTotal = false;
      let directScore = 0;
      for (const kw of this.directTotalKeywords) {
        if (kw.pattern.test(line)) {
          isDirectTotal = true;
          directScore = kw.scoreBonus;
          break;
        }
      }

      if (isDirectTotal) {
        let amt = extractAmount(line);
        let targetIdx = i;
        let targetText = line;

        if (amt === null && i + 1 < lines.length) {
          amt = extractAmount(lines[i + 1]);
          if (amt !== null) {
            targetIdx = i + 1;
            targetText = `${line} ${lines[i + 1]}`;
          }
        }

        if (amt !== null) {
          if (i > lines.length * 0.4) directScore += 10;
          candidates.push({
            type: 'direct_total',
            value: amt,
            score: directScore,
            lineIndex: targetIdx,
            sourceText: targetText,
            explanation: `Letto da ${targetText}`,
          });
        }
      }

      // 2. Candidato: IMPORTO PAGATO / DOVUTO
      if (
        (upper.includes('IMPORTO PAGATO') || upper.includes('IMPORTO DOVUTO') || upper.includes('PAGATO')) &&
        !upper.includes('IVA')
      ) {
        const amt = extractAmount(line) ?? (i + 1 < lines.length ? extractAmount(lines[i + 1]) : null);
        if (amt !== null) {
          candidates.push({
            type: 'paid_amount',
            value: amt,
            score: 75,
            lineIndex: i,
            sourceText: line,
            explanation: `Importo pagato rilevato: ${line}`,
          });
        }
      }

      // 3. Candidato: SUBTOTALE
      if (upper.includes('SUBTOTALE') || upper.includes('SUB-TOTALE')) {
        const amt = extractAmount(line) ?? (i + 1 < lines.length ? extractAmount(lines[i + 1]) : null);
        if (amt !== null) {
          candidates.push({
            type: 'subtotal',
            value: amt,
            score: 65,
            lineIndex: i,
            sourceText: line,
            explanation: `Subtotale rilevato: ${line}`,
          });
        }
      }

      // 4. Candidato: Rilevamento CONTANTI e RESTO
      if (
        (upper.includes('CONTANTI') || upper.includes('PAGAMENTO CONTANTE') || upper.includes('CASH')) &&
        !upper.includes('RESTO')
      ) {
        const amt = extractAmount(line);
        if (amt !== null) {
          cashValue = { val: amt, lineIndex: i, text: line };
        }
      }

      if (upper.includes('RESTO') && !upper.includes('TOTALE')) {
        const amt = extractAmount(line);
        if (amt !== null) {
          changeValue = { val: amt, lineIndex: i, text: line };
        }
      }
    }

    // Se abbiamo sia contanti che resto, calcoliamo l'importo pagato netto (CONTANTI - RESTO)
    if (cashValue && changeValue && cashValue.val > changeValue.val) {
      const netPaid = Math.round((cashValue.val - changeValue.val) * 100) / 100;
      if (netPaid > 0) {
        candidates.push({
          type: 'cash_minus_change',
          value: netPaid,
          score: 80,
          lineIndex: cashValue.lineIndex,
          sourceText: `${cashValue.text} | ${changeValue.text}`,
          explanation: `Calcolato da Contanti (${cashValue.val.toFixed(2)}) - Resto (${changeValue.val.toFixed(2)}) = ${netPaid.toFixed(2)} €`,
        });
      }
    }

    if (candidates.length === 0) {
      // Fallback finale estremo: cerca l'ultimo importo decimale nelle ultime 8 righe
      for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
        const line = lines[i];
        const upper = line.toUpperCase();
        if (
          upper.includes('RESTO') ||
          upper.includes('CONTANTI') ||
          upper.includes('PUNTI') ||
          upper.includes('IVA') ||
          upper.includes('ARTICOLI')
        ) {
          continue;
        }
        const amt = extractAmount(line);
        if (amt !== null) {
          candidates.push({
            type: 'direct_total',
            value: amt,
            score: 30,
            lineIndex: i,
            sourceText: line,
            explanation: `Ultimo importo rilevato nel piede: ${line}`,
          });
        }
      }
    }

    if (candidates.length === 0) {
      return {
        value: null,
        confidence: 0,
        warnings: ['totale_non_identificato'],
      };
    }

    // Valutazione del consenso tra le fonti
    const directCandidate = candidates.find((c) => c.type === 'direct_total' && c.score >= 70);
    const subtotalCandidate = candidates.find((c) => c.type === 'subtotal');
    const cashMinusChangeCandidate = candidates.find((c) => c.type === 'cash_minus_change');
    const paidAmountCandidate = candidates.find((c) => c.type === 'paid_amount');

    const warnings: string[] = [];

    // CASO 1: Totale diretto con score elevato (> 85)
    if (directCandidate && directCandidate.score >= 85) {
      const alternatives = Array.from(new Set(candidates.map((c) => c.value))).filter(
        (v) => Math.abs(v - directCandidate.value) > 0.02
      );

      return {
        value: directCandidate.value,
        confidence: Math.min(95, directCandidate.score),
        lineIndex: directCandidate.lineIndex,
        sourceText: directCandidate.sourceText,
        alternatives: alternatives.length > 0 ? alternatives : undefined,
      };
    }

    // CASO 2: Due o più fonti indipendenti concordano entro ±0.02 €
    const independentSources = [
      directCandidate,
      subtotalCandidate,
      cashMinusChangeCandidate,
      paidAmountCandidate,
    ].filter(Boolean) as TotalCandidate[];

    if (independentSources.length >= 2) {
      // Cerca se almeno 2 concordano
      for (let i = 0; i < independentSources.length; i++) {
        for (let j = i + 1; j < independentSources.length; j++) {
          const s1 = independentSources[i];
          const s2 = independentSources[j];
          if (Math.abs(s1.value - s2.value) <= 0.02) {
            const consensusVal = s1.value;
            return {
              value: consensusVal,
              confidence: 85,
              lineIndex: s1.lineIndex,
              sourceText: `${s1.explanation} e ${s2.explanation}`,
              warnings: s1.type !== 'direct_total' ? ['TOTALE_RICONCILIATO_DA_FONTI_MULTIPLE'] : undefined,
            };
          }
        }
      }
    }

    // CASO 3: Solo subtotale presente o totale a bassa confidenza
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (best.type === 'subtotal') {
      warnings.push('TOTALE_DA_SUBTOTALE');
    }
    if (best.score < 50) {
      warnings.push('LOW_CONFIDENCE');
    }

    return {
      value: best.value,
      confidence: Math.min(90, Math.max(30, best.score)),
      lineIndex: best.lineIndex,
      sourceText: best.sourceText,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}


