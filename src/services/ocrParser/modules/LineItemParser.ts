import { ReceiptParserContext, ParsedReceiptLine, ReceiptParserModule } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

export class LineItemParser implements ReceiptParserModule<ParsedReceiptLine> {
  public name = 'LineItemParser';

  private headerExclusions = [
    'DOCUMENTO COMMERCIALE',
    'SCONTRINO FISCALE',
    'RICEVUTA FISCALE',
    'FATTURA ELETTRONICA',
    'FATTURA',
    'P.IVA',
    'PARTITA IVA',
    'CODICE FISCALE',
    'C.F.',
    'VIA ',
    'CORSO ',
    'PIAZZA ',
    'VIALE ',
    'STRADA ',
    'LARGO ',
    'TEL.',
    'TELEFONO',
    'BENVENUTO',
    'ARRIVEDERCI',
    'OPERATORE',
    'CASSA',
    'MATRICOLA',
    'PUNTO VENDITA',
    'ESERCIZIO',
    'SCONTRINO N.',
    'DOC. N.',
    'DOC N',
    'LOTTO',
    'SCADENZA',
    'DESCRIZIONE',
    'DESCRIZIONE IVA EURO',
    'DESCRIZIONE PREZZO',
    'DESCRIZIONE IMPORTO',
    'DI VENDITA O PRESTAZIONE',
    'VENDITA O PRESTAZIONE',
  ];

  private footerExclusions = [
    'SUBTOTALE',
    'SUB-TOTALE',
    'SUB TOTALE',
    'TOTALE COMPLESSIVO',
    'TOTALE EURO',
    'TOTALE €',
    'TOTALE EUR',
    'TOTALE DOVUTO',
    'IMPORTO PAGATO',
    'IMPORTO DOVUTO',
    'DA PAGARE',
    'TOTALE SPESA',
    'TOTALE CONTO',
    'PAGAMENTO CONTANTE',
    'CONTANTI',
    'RESTO',
    'CARTA CREDITO',
    'CARTA DI CREDITO',
    'PAGAMENTO CARTA',
    'PAGAMENTO BANCOMAT',
    'PAGOBANCOMAT',
    'BANCOMAT',
    'POS',
    'TOTALE IVA',
    'DI CUI IVA',
    'IMPORTO DICHIARATO',
    'TRANSAZIONE',
    'TICKET',
    'SERVIZIO CLIENTE',
    'PUNTI FEDELTA',
    'SALDO PUNTI',
    'PUNTI GUADAGNATI',
    'NUMERO ARTICOLI',
    'N. ARTICOLI',
    'TOTALE ARTICOLI',
    'ARTICOLI DICH',
    'GRAZIE E ARRIVEDERCI',
    'ARRIVEDERCI E GRAZIE',
    'ARRIVEDERCI',
    'GRAZIE PER LA VISITA',
    'RT ',
    'ESENTE ART',
  ];

  public parse(context: ReceiptParserContext): ParsedReceiptLine[] {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) return [];

    const parsedLines: ParsedReceiptLine[] = [];

    // Pattern resi / storni
    const returnRegex = /\b(?:RESO|STORNO|RESTITUITO)\b/i;

    let hasEncounteredTableHeader = false;
    let hasEncounteredFirstItem = false;
    let isFooterZone = false;
    let pendingMultiplier: { quantity: number; unitPrice: number; unitOfMeasure?: string } | null = null;

    // Helper per identificare se una riga è puramente numerica / IVA + Prezzo (senza nome articolo né specifiche quantità/moltiplicatori)
    const isPurePriceOrVatLine = (str: string): boolean => {
      const upper = str.toUpperCase().trim();
      // Se contiene moltiplicatori o indicazioni esplicite di peso/quantità, non è solo prezzo/IVA
      if (
        /\d+\s*[xX*]/.test(upper) ||
        /[xX*]\s*\d+/.test(upper) ||
        /\b(?:KG|GR|ML|PZ|PEZZI|CT|CF)\b/i.test(upper) ||
        /\d+\s*(?:KG|G|GR|L|ML|PZ|CT|CF)\b/i.test(upper)
      ) {
        return false;
      }
      // Rimuoviamo IVA %, prezzi, simboli valuta, codici reparto
      const cleaned = upper
        .replace(/\b\d{1,2}(?:[.,]\d{1,2})?\s*%/g, ' ')
        .replace(/[-−]?\s*\d{1,4}[.,]\d{2}-?/g, ' ')
        .replace(/\b(?:EUR|EURO|[€$])\b/g, ' ')
        .replace(/\b[A-D1-9]\b/g, ' ')
        .replace(/[^A-Z]/g, '')
        .trim();
      // Se non rimangono lettere di testo di prodotto
      return cleaned.length === 0;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const upper = line.toUpperCase();

      // Se siamo già entrati nella zona del piede/totale, nessuna riga successiva può essere un prodotto
      if (isFooterZone) {
        break;
      }

      // Se incontriamo un SUBTOTALE, controlliamo se la riga immediatamente successiva è uno SCONTO o ARROTONDAMENTO valido
      const isSubtotalLine = /^SUBTOTALE|^SUB-TOTALE/i.test(upper);
      if (isSubtotalLine) {
        // Ipotizziamo chiusura se non ci sono sconti successivi
        let hasSubsequentDiscount = false;
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          const nextTrim = lines[j].trim();
          if (/^(?:SCONTO|ABBUONO|PROMO|PROMOZIONE|COUPON|BUONO|ARROTONDAMENTO)\b/i.test(nextTrim)) {
            hasSubsequentDiscount = true;
            break;
          }
          if (/\bTOTALE\b/i.test(nextTrim)) {
            break;
          }
        }
        if (!hasSubsequentDiscount && (hasEncounteredTableHeader || hasEncounteredFirstItem)) {
          isFooterZone = true;
          break;
        }
        continue;
      }

      // Controllo ingresso nella zona Footer / Totali
      const isFooterMatch = this.footerExclusions.some((exc) => upper.includes(exc));
      const isIsolatedTotal = /\bTOTALE\b/i.test(upper) && !upper.includes('SCONTO');

      if ((hasEncounteredTableHeader || hasEncounteredFirstItem) && (isFooterMatch || isIsolatedTotal)) {
        isFooterZone = true;
        break;
      }

      // Se la riga è chiaramente intestazione tabella (es. DESCRIZIONE, IVA, EURO)
      if (
        /^(?:DESCRIZIONE|ARTICOLO|QTA|QUANTITA'?|PREZZO|IMPORTO|IVA|EURO)\b/i.test(upper) ||
        upper.includes('DESCRIZIONE IVA EURO') ||
        upper.includes('DESCRIZIONE PREZZO') ||
        upper.includes('DESCRIZIONE IMPORTO')
      ) {
        hasEncounteredTableHeader = true;
        continue;
      }

      // Esclusione intestazione iniziale e righe decorative
      if (
        this.headerExclusions.some((exc) => upper.includes(exc)) ||
        /^[=\-*#_~.\s]+$/.test(line) ||
        /^ARTICOLI\s+\d+$/i.test(line)
      ) {
        continue;
      }

      // Se la riga contiene indizi di intestazione aziendale/documentale
      const headerCheck = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}:\d{2}|S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|P\.?\s*IVA|C\.?\s*F\.?|DOC\.?\s*N\.?|MATR\.?|CASSA\s*\d+)\b/i;
      if (!hasEncounteredTableHeader && !hasEncounteredFirstItem && headerCheck.test(upper)) {
        continue;
      }

      // Se la riga è corruzione evidente del footer (es. "ATAL E ANUDEFOOTUA 5 O EEE SS")
      if (this.isSuspectFooterNoise(line)) {
        if (hasEncounteredTableHeader || hasEncounteredFirstItem) {
          isFooterZone = true;
          break;
        }
        continue;
      }

      // 1. Controllo riga di solo moltiplicatore / peso (es. "2 x 1,50" o "0,500 kg x 4,00" o "2 PZ X 1,50")
      const pureMultiplierRegex = /^(?:QT\.?|QUANTITA'?\s*)?(\d+(?:[.,]\d{1,3})?)\s*(kg|g|l|ml|pz|pezzi)?\s*[xX*]\s*(\d+[.,]\d{2})(?:\s*[A-D])?$/i;
      if (pureMultiplierRegex.test(line)) {
        const match = line.match(pureMultiplierRegex);
        if (match) {
          const qty = TextNormalizationModule.parseItalianNumber(match[1]);
          const unitP = TextNormalizationModule.parseItalianNumber(match[3]);
          if (qty && qty > 0 && unitP && unitP > 0) {
            // Se la riga precedente era un articolo a prezzo 0, applicalo subito alla riga precedente
            const lastItem = parsedLines.length > 0 ? parsedLines[parsedLines.length - 1] : null;
            if (lastItem && lastItem.unitPrice === 0 && !lastItem.isNegative) {
              lastItem.quantity = qty;
              lastItem.unitPrice = unitP;
              lastItem.lineTotal = Math.round(qty * unitP * 100) / 100;
              if (match[2]) lastItem.unitOfMeasure = match[2].toLowerCase();
              lastItem.warnings = (lastItem.warnings || []).filter(
                (w) => w !== 'PRICE_NOT_DETECTED' && w !== 'LOW_CONFIDENCE'
              );
              lastItem.confidence = 90;
            } else {
              pendingMultiplier = {
                quantity: qty,
                unitPrice: unitP,
                unitOfMeasure: match[2] ? match[2].toLowerCase() : undefined,
              };
            }
            continue;
          }
        }
      }

      // 2. Gestione Riga di solo Prezzo / IVA isolata (es. "22,00% 0,13" o "0,13" o "10,00% 2,49")
      if (isPurePriceOrVatLine(line)) {
        const lastItem = parsedLines.length > 0 ? parsedLines[parsedLines.length - 1] : null;
        if (lastItem && lastItem.unitPrice === 0) {
          if (!lastItem.warnings) lastItem.warnings = [];
          if (!lastItem.warnings.includes('PRICE_ASSOCIATION_UNCERTAIN')) {
            lastItem.warnings.push('PRICE_ASSOCIATION_UNCERTAIN');
          }
          lastItem.confidence = Math.min(lastItem.confidence, 35);
        }
        continue;
      }

      // 3. Gestione Righe SCONTO / ARROTONDAMENTO / PROMOZIONE DEDICATE
      const isPureDiscountLine =
        /^(?:SCONTO|ABBUONO|PROMO|PROMOZIONE|COUPON|BUONO|ARROTONDAMENTO)\b/i.test(line) &&
        !/\b[A-Za-z]{3,}\s+SCONTO/i.test(line);

      if (isPureDiscountLine) {
        this.parseDiscountLine(line, i, parsedLines);
        hasEncounteredFirstItem = true;
        pendingMultiplier = null;
        continue;
      }

      // 4. Gestione Riga Articolo Standard (anche con sconto inline)
      const itemLine = this.parseItemLine(line, i, returnRegex.test(upper));

      if (itemLine) {
        // Se c'è un moltiplicatore in attesa applicabile (es. "2 x 1,50" precedente a "LATTE FRESCO 1L 3,00 A")
        if (pendingMultiplier) {
          itemLine.quantity = pendingMultiplier.quantity;
          itemLine.unitPrice = pendingMultiplier.unitPrice;
          if (pendingMultiplier.unitOfMeasure) itemLine.unitOfMeasure = pendingMultiplier.unitOfMeasure;
          pendingMultiplier = null;
        }

        // Se la riga precedente era un articolo con prezzo 0 (descrizione pura) e questa riga è una specifica quantità/peso/moltiplicatore/prezzo senza una nuova descrizione distinta
        const lastItem = parsedLines.length > 0 ? parsedLines[parsedLines.length - 1] : null;
        const isSpecificationOnly =
          /^(?:(?:\d+(?:[.,]\d{1,3})?)\s*(?:kg|g|gr|l|ml|pz|pezzi)?\s*(?:[xX*]\s*\d+[.,]\d{2}\s*)?)?-?\d+[.,]\d{2}(?:\s*[A-D])?$/i.test(
            line.trim()
          );
        if (lastItem && lastItem.unitPrice === 0 && !lastItem.isNegative && isSpecificationOnly) {
          lastItem.quantity = itemLine.quantity;
          lastItem.unitPrice = itemLine.unitPrice;
          lastItem.lineTotal = itemLine.lineTotal;
          if (itemLine.unitOfMeasure) lastItem.unitOfMeasure = itemLine.unitOfMeasure;
          lastItem.warnings = (lastItem.warnings || []).filter(
            (w) => w !== 'PRICE_NOT_DETECTED' && w !== 'LOW_CONFIDENCE'
          );
          lastItem.confidence = 90;
        } else {
          parsedLines.push(itemLine);
        }
        hasEncounteredFirstItem = true;
      } else {
        // Se la riga non ha prezzo ma è il nome di un prodotto (es. SHOPPERS, PATATINE, PANE TRAMEZZINI)
        const hasMinLetters = line.replace(/[^A-Za-z]/g, '').length >= 3;
        const isSuspect = this.isSuspectNoise(line);

        if (
          (hasEncounteredTableHeader || hasEncounteredFirstItem || i > 0) &&
          hasMinLetters &&
          !headerCheck.test(upper) &&
          !isFooterMatch &&
          !isSuspect
        ) {
          parsedLines.push({
            originalText: line,
            normalizedDescription: line.replace(/^[0-9*.\-\s]+(?=[A-Za-z])/, '').trim(),
            quantity: 1,
            unitPrice: 0,
            lineTotal: 0,
            isNegative: false,
            pageIndex: 0,
            lineIndex: i,
            confidence: 35,
            reviewStatus: 'pending',
            warnings: ['PRICE_NOT_DETECTED', 'LOW_CONFIDENCE'],
          });
          hasEncounteredFirstItem = true;
        }
      }
    }

    return parsedLines;
  }

  /**
   * Rileva rumore o testo corrotto derivante dalla sezione totali/piede
   */
  private isSuspectFooterNoise(line: string): boolean {
    const upper = line.toUpperCase();
    if (upper.includes('FOOT') || upper.includes('ANUDE') || upper.includes('ATAL E')) {
      return true;
    }
    // Sequenza di simboli o lettere singole ripetute prive di senso (es. "ATAL E ANUDEFOOTUA 5 O EEE SS")
    const words = line.split(/\s+/).filter(Boolean);
    const nonNumericWords = words.filter((w) => !/\d/.test(w) && !/^[xX*]$/.test(w));
    if (nonNumericWords.length >= 4) {
      const singleCharWords = nonNumericWords.filter((w) => w.length <= 2).length;
      if (singleCharWords / nonNumericWords.length > 0.6) {
        return true;
      }
    }
    return false;
  }

  /**
   * Rileva se una stringa è testo OCR fortemente sospetto o corrotto
   */
  private isSuspectNoise(line: string): boolean {
    const weirdSymbols = (line.match(/[~|\\{}_^<>]/g) || []).length;
    if (weirdSymbols > 3) return true;
    return false;
  }

  /**
   * Parsing dedicato per righe di Sconto o Arrotondamento.
   */
  private parseDiscountLine(line: string, lineIndex: number, parsedLines: ParsedReceiptLine[]): void {
    const upper = line.toUpperCase();
    const isArrotondamento = upper.includes('ARROTONDAMENTO');

    // Rimuoviamo prima le aliquote IVA standard esplicite con %
    const vatRegex = /\b(?:22(?:[.,]00)?|10(?:[.,]00)?|4(?:[.,]00)?|5(?:[.,]00)?|0(?:[.,]00)?)\s*%/gi;
    const genericVatRegex = /\b\d{1,2}(?:[.,]\d{1,2})?\s*%/g;
    let cleaned = line.replace(vatRegex, ' ').replace(genericVatRegex, ' ');

    // Troviamo tutti i numeri decimali o importi monetari presenti nella riga
    const moneyRegex = /(-?\s*\d{1,4}(?:[.,]\d{3})*[.,]\d{2}|-?\s*\d{1,4}[.,]\d{2}-|\d{1,4}[.,]\d{2})/g;
    const matches = Array.from(cleaned.matchAll(moneyRegex));

    let discountAmount = 0;
    let isAnomalous = false;

    if (matches.length > 0) {
      const candidateVals = matches.map((m) => {
        const val = TextNormalizationModule.parseItalianNumber(m[0]) || 0;
        return { raw: m[0], val: Math.abs(val) };
      });

      if (isArrotondamento) {
        // Un arrotondamento in centesimi è compreso tra 0.01 e 0.99 €
        const centCandidate = candidateVals.find((c) => c.val > 0 && c.val < 1.0);
        if (centCandidate) {
          discountAmount = centCandidate.val;
        } else {
          // Nessun centesimo trovato: se l'unico numero è ad es. 22.00 IVA, non è un arrotondamento
          discountAmount = 0;
          isAnomalous = true;
        }
      } else {
        const lastCand = candidateVals[candidateVals.length - 1];
        // Se il valore è un'aliquota IVA standard (22, 10, 4) senza segno meno
        if ((lastCand.val === 22 || lastCand.val === 10 || lastCand.val === 4) && !lastCand.raw.includes('-')) {
          isAnomalous = true;
          discountAmount = 0;
        } else {
          discountAmount = lastCand.val;
        }
      }
    } else {
      const fallbackMatch = line.match(/[-−]\s*0[.,]\d{2}/);
      if (fallbackMatch) {
        discountAmount = Math.abs(TextNormalizationModule.parseItalianNumber(fallbackMatch[0]) || 0);
      } else if (isArrotondamento) {
        isAnomalous = true;
      }
    }

    // Pulizia descrizione sconto
    let cleanDesc = line
      .replace(vatRegex, ' ')
      .replace(genericVatRegex, ' ')
      .replace(/[-−]\s*\d+[.,]\d{2}-?/g, ' ')
      .replace(/\b\d{1,4}[.,]\d{2}\b/g, ' ')
      .replace(/[-−]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanDesc || cleanDesc.length < 3) {
      cleanDesc = isArrotondamento ? 'SCONTO ARROTONDAMENTO' : 'SCONTO';
    }

    const isStandalone =
      isArrotondamento ||
      upper.includes('BUONO') ||
      upper.includes('SPESA') ||
      parsedLines.length === 0;

    if (!isStandalone && parsedLines.length > 0 && discountAmount > 0 && !isAnomalous) {
      // Sconto di riga applicato all'articolo precedente
      const prevLine = parsedLines[parsedLines.length - 1];
      prevLine.discount = discountAmount;
      prevLine.lineTotal = Math.round((prevLine.unitPrice * prevLine.quantity - discountAmount) * 100) / 100;
    } else {
      // Sconto autonomo / arrotondamento
      const finalAmount = discountAmount === 0 ? 0 : -Math.abs(discountAmount);
      const warnings: string[] = ['DISCOUNT_LINE'];
      let confidence = 95;

      if (discountAmount <= 0 || isAnomalous) {
        warnings.push('DISCOUNT_VALUE_NOT_DETECTED');
        warnings.push('LOW_CONFIDENCE');
        confidence = 30;
      }

      parsedLines.push({
        originalText: line,
        normalizedDescription: cleanDesc,
        quantity: 1,
        unitPrice: Math.round(finalAmount * 100) / 100,
        lineTotal: Math.round(finalAmount * 100) / 100,
        isNegative: finalAmount < 0,
        pageIndex: 0,
        lineIndex,
        confidence,
        reviewStatus: 'pending',
        warnings,
      });
    }
  }

  /**
   * Parsing di una riga di articolo standard con protezione IVA / Prezzo ambiguo.
   */
  private parseItemLine(line: string, lineIndex: number, isReturn: boolean): ParsedReceiptLine | null {
    // Rimuoviamo le aliquote IVA standard esplicite con %
    const vatRegex = /\b(?:22(?:[.,]00)?|10(?:[.,]00)?|4(?:[.,]00)?|5(?:[.,]00)?|0(?:[.,]00)?)\s*%/gi;
    const genericVatRegex = /\b\d{1,2}(?:[.,]\d{1,2})?\s*%/g;
    let lineWithoutVat = line.replace(vatRegex, ' ').replace(genericVatRegex, ' ');

    // Cerchiamo tutti i token monetari decimali nella riga
    let moneyMatches = Array.from(
      lineWithoutVat.matchAll(/(-?\s*\d{1,4}(?:[.,]\d{3})*[.,]\d{2}|-?\s*\d{1,4}[.,]\d{2}-|\d{1,4}[.,]\d{2})/g)
    );

    if (moneyMatches.length === 0) {
      return null;
    }

    // L'importo monetario finale della riga è l'ultimo token a destra
    const lastMoneyMatch = moneyMatches[moneyMatches.length - 1];
    const rawPriceStr = lastMoneyMatch[0];
    let parsedPrice = TextNormalizationModule.parseItalianNumber(rawPriceStr) || 0;

    // Controllo Ambiguity IVA (Requisito 6):
    // Se il numero estratto è esattamente 22.00, 10.00, 4.00 o 5.00 e:
    // a) è seguito da altri token come codici reparto (es. "002 A", "1 A", "A") o
    // b) è l'unico numero e si trova in posizione IVA centrale senza un prezzo finale a destra
    const textAfterPrice = lineWithoutVat.slice((lastMoneyMatch.index ?? 0) + rawPriceStr.length).trim();
    const isStandardVatRate =
      parsedPrice === 22 ||
      parsedPrice === 10 ||
      parsedPrice === 4 ||
      parsedPrice === 5 ||
      rawPriceStr === '22,00' ||
      rawPriceStr === '10,00' ||
      rawPriceStr === '4,00' ||
      rawPriceStr === '5,00';

    let isVatAmbiguous = false;
    if (isStandardVatRate) {
      // Se dopo il numero c'è una combinazione di cifre/lettere reparto (es. "002 A", "A", "1 A", "001")
      if (/\b\d{1,4}\s*[A-D]\b/i.test(textAfterPrice) || /^[A-D]\b/i.test(textAfterPrice)) {
        isVatAmbiguous = true;
      }
    }

    let isNegative = isReturn || parsedPrice < 0 || rawPriceStr.startsWith('-') || rawPriceStr.endsWith('-');
    if (isNegative) {
      parsedPrice = -Math.abs(parsedPrice);
    }

    let quantity = 1;
    let unitOfMeasure: string | null = null;
    let unitPrice = isVatAmbiguous ? 0 : Math.abs(parsedPrice);
    let lineTotal = isVatAmbiguous ? 0 : parsedPrice;

    // Estraiamo la porzione di testo prima dell'ultimo importo
    const textBeforePrice = lineWithoutVat.slice(0, lastMoneyMatch.index).trim();

    // Controllo Quantità Multipla Commerciale Reale
    const explicitQtyRegex = /(?:^|\s)(?:QT\.?|QUANTITA'?\s*)?(\d+(?:[.,]\d{1,3})?)\s*(kg|g|l|ml|pz|pezzi)?\s*[xX*]\s*(\d+[.,]\d{2})/i;
    const explicitQtyMatch = textBeforePrice.match(explicitQtyRegex);

    if (explicitQtyMatch && !isVatAmbiguous) {
      const candQty = TextNormalizationModule.parseItalianNumber(explicitQtyMatch[1]);
      const candUnitPrice = TextNormalizationModule.parseItalianNumber(explicitQtyMatch[3]);

      if (candQty && candQty > 0 && candUnitPrice && candUnitPrice > 0) {
        const expectedTotal = Math.round(candQty * candUnitPrice * 100) / 100;
        if (Math.abs(expectedTotal - Math.abs(parsedPrice)) <= 0.05) {
          quantity = candQty;
          unitPrice = candUnitPrice;
          if (explicitQtyMatch[2]) {
            unitOfMeasure = explicitQtyMatch[2].toLowerCase();
          }
        }
      }
    }

    // Pulizia della descrizione
    let cleanDescription = line
      .replace(vatRegex, ' ')
      .replace(genericVatRegex, ' ')
      .replace(new RegExp(`${rawPriceStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:[A-D1-9]|EUR|€)?$`), '')
      .replace(/\s+[A-D]$/i, '')
      .replace(/^[0-9*.\-\s]+(?=[A-Za-z])/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (isVatAmbiguous) {
      // Rimuovi anche la parte IVA e codici spuri dalla descrizione
      cleanDescription = cleanDescription
        .replace(/\b(?:22|10|4|5)[.,]00\b/g, '')
        .replace(/\b\d{1,4}\s*[A-D]\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (explicitQtyMatch) {
      cleanDescription = cleanDescription.replace(explicitQtyRegex, '').trim();
    }

    if (cleanDescription.length < 2) {
      cleanDescription = textBeforePrice.replace(/\s+/g, ' ').trim() || line;
    }

    const warnings: string[] = [];
    if (isNegative) warnings.push('RETURN_LINE');
    if (isVatAmbiguous) {
      warnings.push('VAT_PRICE_AMBIGUOUS');
      warnings.push('PRICE_NOT_DETECTED');
      warnings.push('LOW_CONFIDENCE');
    } else if (unitPrice === 0 || lineTotal === 0) {
      warnings.push('PRICE_NOT_DETECTED');
      warnings.push('LOW_CONFIDENCE');
    }

    if (this.isSuspectNoise(cleanDescription)) {
      warnings.push('OCR_TEXT_SUSPECT');
    }

    const confidence = isVatAmbiguous ? 30 : unitPrice > 0 ? 90 : 35;

    return {
      originalText: line,
      normalizedDescription: cleanDescription,
      quantity: Math.round(quantity * 1000) / 1000,
      unitOfMeasure,
      unitPrice: Math.round(unitPrice * 100) / 100,
      lineTotal: isNegative ? -Math.abs(lineTotal) : Math.round(lineTotal * 100) / 100,
      isNegative,
      pageIndex: 0,
      lineIndex,
      confidence,
      reviewStatus: 'pending',
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

