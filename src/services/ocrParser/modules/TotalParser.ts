import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

export type CandidateRole =
  | 'fiscal_total'
  | 'subtotal'
  | 'paid_amount'
  | 'payment_pos'
  | 'cash_minus_change'
  | 'composite_total'
  | 'fallback_footer';

export interface TotalCandidate {
  type: 'direct_total' | 'paid_amount' | 'subtotal' | 'cash_minus_change' | 'payment_pos' | 'composite_total' | 'fallback_footer';
  role: CandidateRole;
  value: number;
  score: number;
  lineIndex: number;
  sourceText: string;
  explanation: string;
}

interface OtherAmountCandidate {
  value: number;
  lineIndex: number;
  sourceText: string;
}

interface ValueCluster {
  value: number;
  candidates: TotalCandidate[];
  distinctRoles: Set<CandidateRole>;
  hasFiscalTotal: boolean;
  hasCompositeTotal: boolean;
  maxScore: number;
  effectiveScore: number;
  primaryCandidate: TotalCandidate;
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
    { pattern: /\[?OLE\s+COMPLESSIVO\b/i, scoreBonus: 80 },
    { pattern: /\(?UTALE\s+COMPLESSIVO\b/i, scoreBonus: 80 },
    { pattern: /\bTOTALE\b/i, scoreBonus: 70 },
    { pattern: /\bTOT\.\s*€?/i, scoreBonus: 65 },
  ];

  public parse(context: ReceiptParserContext): ParsedField<number> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return { value: null, confidence: 0, warnings: ['totale_non_identificato'] };
    }

    const candidates: TotalCandidate[] = [];
    const otherAmounts: OtherAmountCandidate[] = [];
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

    // Helper interno conservativo per escludere righe di imposta/scorporo o classi incompatibili dal lookahead
    const isTaxBreakdownOrNonTotalLine = (text: string): boolean => {
      const u = text.toUpperCase();
      if (
        u.includes('TOTALE IVA') ||
        u.includes('DI CUI IVA') ||
        u.includes('IVA TOTALE') ||
        u.includes('RESTO') ||
        u.includes('ALTRI IMPORTI') ||
        u.includes('ALTRO IMPORTO')
      ) {
        return true;
      }

      // Pattern robusti e conservativi per ripartizioni/imposte anche con degradazione OCR tipica
      if (
        /\bDI\s+(?:CUI|UE|CU\s*I|CVI)\b/i.test(text) ||
        /\bIVA\s*(?:\d{1,2}%|AL|COMMERCIALE|VENTILAZIONE)?\b/i.test(text) ||
        /\b(?:IMPOSTA|ALIQUOTA|VENTILAZIONE)\b/i.test(text)
      ) {
        return true;
      }

      return false;
    };

    // Helper per saltare righe di imposta/IVA nel loop principale (senza saltare ALTRI IMPORTI o RESTO che hanno gestori dedicati)
    const isTaxOrIvaLine = (text: string): boolean => {
      const u = text.toUpperCase();
      if (
        u.includes('TOTALE IVA') ||
        u.includes('DI CUI IVA') ||
        u.includes('IVA TOTALE')
      ) {
        return true;
      }

      if (
        /\bDI\s+(?:CUI|UE|CU\s*I|CVI)\b/i.test(text) ||
        /\bIVA\s*(?:\d{1,2}%|AL|COMMERCIALE|VENTILAZIONE)?\b/i.test(text) ||
        /\b(?:IMPOSTA|ALIQUOTA|VENTILAZIONE)\b/i.test(text)
      ) {
        return true;
      }

      return false;
    };

    let cashValue: { val: number; lineIndex: number; text: string } | null = null;
    let changeValue: { val: number; lineIndex: number; text: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // Salta righe di imposta/scorporo/IVA per evitare catture improprie come totale
      if (isTaxOrIvaLine(line)) {
        continue;
      }

      // 1. Candidato: TOTALE Diretto (Fiscale)
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
          const nextLine = lines[i + 1];
          if (!isTaxBreakdownOrNonTotalLine(nextLine)) {
            amt = extractAmount(nextLine);
            if (amt !== null) {
              targetIdx = i + 1;
              targetText = `${line} ${nextLine}`;
            }
          }
        }

        if (amt !== null) {
          if (i > lines.length * 0.4) directScore += 10;
          candidates.push({
            type: 'direct_total',
            role: 'fiscal_total',
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
        (/\bIMPORTO\s+(?:PAGATO|DOVUTO)\b/i.test(line) || /\bPAGATO\b/i.test(line)) &&
        !upper.includes('IVA') &&
        !upper.includes('RESTO')
      ) {
        const nextAmt = (i + 1 < lines.length && !isTaxBreakdownOrNonTotalLine(lines[i + 1])) ? extractAmount(lines[i + 1]) : null;
        const amt = extractAmount(line) ?? nextAmt;
        if (amt !== null) {
          candidates.push({
            type: 'paid_amount',
            role: 'paid_amount',
            value: amt,
            score: 75,
            lineIndex: i,
            sourceText: line,
            explanation: `Importo pagato rilevato: ${line}`,
          });
        }
      }

      // 3. Candidato: SUBTOTALE (inclusi SUBTOTAL, SUB-TOTAL, SUB-TOTALE)
      if (
        /\bSUB[- ]?TOTAL[E]?\b/i.test(line) &&
        !upper.includes('IVA') &&
        !upper.includes('RESTO')
      ) {
        const nextAmt = (i + 1 < lines.length && !isTaxBreakdownOrNonTotalLine(lines[i + 1])) ? extractAmount(lines[i + 1]) : null;
        const amt = extractAmount(line) ?? nextAmt;
        if (amt !== null) {
          candidates.push({
            type: 'subtotal',
            role: 'subtotal',
            value: amt,
            score: 65,
            lineIndex: i,
            sourceText: line,
            explanation: `Subtotale rilevato: ${line}`,
          });
        }
      }

      // 4. Candidato: PAGAMENTO ELETTRONICO / POS / CARTE / CONTANTE
      if (
        (/\b(?:PAGAMENTO|PAGAMENTI)\s+(?:ELETTRONICO|CONTANTE|CARTA|BANCOMAT)\b/i.test(line) ||
          /\bPOS(?:\s+BANCOMAT)?\b/i.test(line) ||
          /\b(?:C\.?CREDITO|CARTA\s+DI\s+CREDITO|BANCOMAT)\b/i.test(line) ||
          /\bDETTAGLIO\s+(?:FORME\s+DI\s+)?PAGAMENT[OI]\b/i.test(line) ||
          (/\bPAGAMENTO\b/i.test(line) && !/\bPAGAMENTO\s+(?:NON\s+RIUSCITO|ANNULLATO)\b/i.test(line))) &&
        !upper.includes('IVA') &&
        !upper.includes('RESTO') &&
        !/\bSUB[- ]?TOTAL[E]?\b/i.test(line) &&
        !/\bIMPORTO\s+PAGATO\b/i.test(line)
      ) {
        const nextAmt = (i + 1 < lines.length && !isTaxBreakdownOrNonTotalLine(lines[i + 1])) ? extractAmount(lines[i + 1]) : null;
        const amt = extractAmount(line) ?? nextAmt;
        if (amt !== null) {
          candidates.push({
            type: 'payment_pos',
            role: 'payment_pos',
            value: amt,
            score: 75,
            lineIndex: i,
            sourceText: line,
            explanation: `Pagamento/POS rilevato: ${line}`,
          });
        }
      }

      // 5. Candidato: Rilevamento CONTANTI e RESTO
      if (
        (/\b(?:CONTANTI|PAGAMENTO\s+CONTANTE|CASH)\b/i.test(line)) &&
        !upper.includes('RESTO') &&
        !upper.includes('IVA')
      ) {
        const amt = extractAmount(line);
        if (amt !== null) {
          cashValue = { val: amt, lineIndex: i, text: line };
        }
      }

      if (upper.includes('RESTO') && !upper.includes('TOTALE') && !upper.includes('IVA')) {
        const amt = extractAmount(line);
        if (amt !== null) {
          changeValue = { val: amt, lineIndex: i, text: line };
        }
      }

      // 6. Rilevamento ALTRI IMPORTI (Famiglia I)
      // Solo per ancore esplicite 'altri importi' (MAI per IVA, Subtotale, o righe ordinarie)
      if (
        /\b(?:ALTRI\s+IMPORTI|ALTRO\s+IMPORTO|ALTRI\s+ADDEBITI|ALTRI\s+PAGAMENTI)\b/i.test(line) &&
        !upper.includes('IVA') &&
        !upper.includes('RESTO') &&
        !/\bSUB[- ]?TOTAL[E]?\b/i.test(line)
      ) {
        const amt = extractAmount(line) ?? (i + 1 < lines.length ? extractAmount(lines[i + 1]) : null);
        if (amt !== null && amt > 0) {
          otherAmounts.push({
            value: amt,
            lineIndex: i,
            sourceText: line,
          });
        }
      }
    }

    // Se abbiamo sia contanti che resto, calcoliamo l'importo pagato netto (CONTANTI - RESTO)
    if (cashValue && changeValue && cashValue.val > changeValue.val) {
      const netPaid = Math.round((cashValue.val - changeValue.val) * 100) / 100;
      if (netPaid > 0) {
        candidates.push({
          type: 'cash_minus_change',
          role: 'cash_minus_change',
          value: netPaid,
          score: 80,
          lineIndex: cashValue.lineIndex,
          sourceText: `${cashValue.text} | ${changeValue.text}`,
          explanation: `Calcolato da Contanti (${cashValue.val.toFixed(2)}) - Resto (${changeValue.val.toFixed(2)}) = ${netPaid.toFixed(2)} €`,
        });
      }
    }

    // =========================================================================
    // FAMIGLIA I: COMPOSIZIONE FISCAL TOTAL + OTHER AMOUNTS
    // La composizione F + O viene promossa a compositeTotal SOLO se una terza
    // evidenza reale indipendente di pagamento conferma la somma (|F + O - P| <= 0.02).
    // In assenza di terza evidenza, NON si compone e il totale fiscale resta inalterato.
    // =========================================================================
    if (otherAmounts.length > 0) {
      const fiscalTotals = candidates.filter((c) => c.role === 'fiscal_total');
      const paymentEvidences = candidates.filter(
        (c) => c.role === 'paid_amount' || c.role === 'payment_pos' || c.role === 'cash_minus_change'
      );

      for (const F of fiscalTotals) {
        for (const O of otherAmounts) {
          const sum = Math.round((F.value + O.value) * 100) / 100;
          const matchingPayment = paymentEvidences.find((P) => Math.abs(P.value - sum) <= 0.02);
          if (matchingPayment) {
            candidates.push({
              type: 'composite_total',
              role: 'composite_total',
              value: matchingPayment.value,
              score: 110,
              lineIndex: F.lineIndex,
              sourceText: `${F.sourceText} + ${O.sourceText} => ${matchingPayment.sourceText}`,
              explanation: `Totale composto riconciliato: Totale Fiscale (${F.value.toFixed(2)}) + Altri Importi (${O.value.toFixed(2)}) confermato da Pagamento (${matchingPayment.value.toFixed(2)})`,
            });
          }
        }
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
            type: 'fallback_footer',
            role: 'fallback_footer',
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

    // =========================================================================
    // RECONCILIATION & CORROBORATION ENGINE (Famiglia A)
    // Raggruppa i candidati per cluster di valore entro ±0.02 € e calcola
    // il supporto da ruoli semantici indipendenti (anti-duplicazione stessa fonte).
    // =========================================================================
    const clusters: ValueCluster[] = [];

    for (const candidate of candidates) {
      let cluster = clusters.find((cl) => Math.abs(cl.value - candidate.value) <= 0.02);
      if (!cluster) {
        cluster = {
          value: candidate.value,
          candidates: [],
          distinctRoles: new Set(),
          hasFiscalTotal: false,
          hasCompositeTotal: false,
          maxScore: 0,
          effectiveScore: 0,
          primaryCandidate: candidate,
        };
        clusters.push(cluster);
      }
      cluster.candidates.push(candidate);
      cluster.distinctRoles.add(candidate.role);
      if (candidate.role === 'fiscal_total') cluster.hasFiscalTotal = true;
      if (candidate.role === 'composite_total') cluster.hasCompositeTotal = true;
      if (candidate.score > cluster.maxScore) {
        cluster.maxScore = candidate.score;
        cluster.primaryCandidate = candidate;
      }
    }

    for (const cluster of clusters) {
      if (cluster.hasCompositeTotal) {
        // La composizione triangolata certificata ha massima autorità
        cluster.effectiveScore = 150;
        continue;
      }

      let score = cluster.maxScore;
      const roleCount = cluster.distinctRoles.size;

      if (cluster.hasFiscalTotal) {
        if (cluster.maxScore >= 85) {
          // Fiscal total con score elevato: corroborazione da fonti indipendenti
          if (roleCount >= 2) {
            score += 25 * (roleCount - 1);
          }
        } else {
          if (roleCount >= 2) {
            score += 20 * (roleCount - 1);
          }
        }
      } else {
        // Cluster senza totale fiscale diretto (es. Eurospin, Leroy Merlin)
        if (roleCount >= 2) {
          score += 15 * (roleCount - 1);
        }
      }

      cluster.effectiveScore = score;
    }

    // Ordina i cluster per score effettivo decrescente
    clusters.sort((a, b) => b.effectiveScore - a.effectiveScore);
    const bestCluster = clusters[0];

    const warnings: string[] = [];

    if (bestCluster.primaryCandidate.type === 'subtotal') {
      warnings.push('TOTALE_DA_SUBTOTALE');
    }

    if (
      bestCluster.distinctRoles.size >= 2 &&
      !bestCluster.hasFiscalTotal &&
      !bestCluster.hasCompositeTotal
    ) {
      warnings.push('TOTALE_RICONCILIATO_DA_FONTI_MULTIPLE');
    }

    if (bestCluster.maxScore < 50 && bestCluster.distinctRoles.size < 2) {
      warnings.push('LOW_CONFIDENCE');
    }

    let confidence = Math.min(95, Math.max(30, bestCluster.maxScore));
    if (bestCluster.hasCompositeTotal) {
      confidence = 95;
    } else if (bestCluster.distinctRoles.size >= 2) {
      confidence = Math.min(95, Math.max(85, bestCluster.maxScore));
    }

    const alternatives = Array.from(new Set(candidates.map((c) => c.value))).filter(
      (v) => Math.abs(v - bestCluster.value) > 0.02
    );

    return {
      value: bestCluster.value,
      confidence,
      lineIndex: bestCluster.primaryCandidate.lineIndex,
      sourceText: bestCluster.primaryCandidate.sourceText,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}


