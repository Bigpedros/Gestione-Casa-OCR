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
    'LOTTO',
    'SCADENZA',
  ];

  private footerExclusions = [
    'TOTALE EURO',
    'TOTALE COMPLESSIVO',
    'TOTALE €',
    'TOTALE EUR',
    'TOTALE',
    'SUBTOTALE',
    'SUB-TOTALE',
    'CONTANTI',
    'RESTO',
    'CARTA CREDITO',
    'CARTA DI CREDITO',
    'PAGAMENTO CARTA',
    'BANCOMAT',
    'POS',
    'PAGAMENTO',
    'TOTALE IVA',
    'IMPORTO DICHIARATO',
    'TRANSAZIONE',
    'TICKET',
    'SERVIZIO CLIENTE',
    'PUNTI FEDELTA',
    'SALDO PUNTI',
    'PUNTI GUADAGNATI',
    'ARTICOLI',
    'GRAZIE E ARRIVEDERCI',
    'ARRIVEDERCI E GRAZIE',
  ];

  public parse(context: ReceiptParserContext): ParsedReceiptLine[] {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) return [];

    const parsedLines: ParsedReceiptLine[] = [];

    // Pattern 1: Quantità x Prezzo Unitario (es. 2 x 1,50 o 0,750 kg x 3,99 o 2 X 1.50)
    const qtyPriceRegex = /(\d+(?:[.,]\d{1,3})?)\s*(kg|g|l|ml|pz)?\s*[xX*]\s*(\d+(?:[.,]\d{1,2})?)/i;

    // Pattern 2: Importo finale alla fine della riga (es. "PANE FRESCO 2,50 A" oppure "PASTA RUMMO 1.20" o "-2,50" o "2,50-")
    const priceEndRegex = /(.*?)\s+(-?\d{1,4}(?:[.,]\d{3})*[.,]\d{2}|-?\d{1,4}[.,]\d{2}-)(?:\s+[A-Z0-9%]+)?$/;

    // Pattern 3: Sconto riga / Buono / Promo / Arrotondamento
    const lineDiscountRegex = /SCONTO|ABBUONO|PROMO|PROMOZIONE|COUPON|BUONO|ARROTONDAMENTO/i;

    // Pattern 4: Reso / Storno
    const returnRegex = /RESO|STORNO|RESTITUITO/i;

    let inLineItemSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // Esclusione intestazione
      if (this.headerExclusions.some((exc) => upper.includes(exc))) {
        continue;
      }

      // Interruzione alla sezione footer / totale
      if (this.footerExclusions.some((exc) => upper.includes(exc))) {
        inLineItemSection = false;
        // Se troviamo TOTALE (non SUBTOTALE), CONTANTI o RESTO, ci fermiamo
        if ((upper.includes('TOTALE') && !upper.includes('SUBTOTALE')) || upper.includes('CONTANTI') || upper.includes('RESTO')) {
          break;
        }
        continue;
      }

      // 1. Gestione sconti e promozioni
      if (lineDiscountRegex.test(line)) {
        const discountMatch = line.match(/(-?\d+[.,]\d{2}-?)/);
        if (discountMatch) {
          const rawDiscVal = TextNormalizationModule.parseItalianNumber(discountMatch[1]) || 0;
          const discVal = Math.abs(rawDiscVal);

          // Se è uno sconto riga e c'è un elemento precedente valido, associalo
          const isItemSpecific = !upper.includes('BUONO SCONTO SPESA') && !upper.includes('ARROTONDAMENTO') && !upper.includes('COUPON');

          if (isItemSpecific && parsedLines.length > 0) {
            const lastLine = parsedLines[parsedLines.length - 1];
            if (lastLine.unitPrice > 0 || lastLine.lineTotal !== 0) {
              lastLine.discount = (lastLine.discount || 0) + discVal;
              lastLine.lineTotal = Math.round((lastLine.lineTotal - discVal) * 100) / 100;
              lastLine.originalText += ` | ${line}`;
              continue;
            }
          }

          // Altrimenti, trattalo come riga di sconto/buono/arrotondamento distinta (importo negativo o di aggiustamento)
          const isNegative = rawDiscVal <= 0 || upper.includes('SCONTO') || upper.includes('BUONO') || upper.includes('PROMO') || upper.includes('COUPON');
          const finalAmount = isNegative ? -discVal : discVal;

          parsedLines.push({
            originalText: line,
            normalizedDescription: line.replace(/(-?\d+[.,]\d{2}-?).*/, '').trim() || line,
            quantity: 1,
            unitPrice: Math.round(finalAmount * 100) / 100,
            lineTotal: Math.round(finalAmount * 100) / 100,
            isNegative: finalAmount < 0,
            pageIndex: 0,
            lineIndex: i,
            confidence: 85,
            reviewStatus: 'pending',
            warnings: ['DISCOUNT_LINE'],
          });
          continue;
        }
      }

      // Prova a fare il match di quantità x prezzo unitario o prezzo finale
      const qtyMatch = line.match(qtyPriceRegex);
      const endPriceMatch = line.match(priceEndRegex);

      if (qtyMatch || endPriceMatch) {
        inLineItemSection = true;

        let description = '';
        let quantity = 1;
        let unitOfMeasure: string | null = null;
        let unitPrice = 0;
        let lineTotal = 0;
        let isNegative = false;
        let confidence = 85;

        if (endPriceMatch) {
          description = endPriceMatch[1].trim();
          let parsedTotal = TextNormalizationModule.parseItalianNumber(endPriceMatch[2]) || 0;

          if (parsedTotal < 0 || returnRegex.test(upper)) {
            isNegative = true;
            parsedTotal = -Math.abs(parsedTotal);
          }

          lineTotal = parsedTotal;
          unitPrice = parsedTotal;
        }

        if (qtyMatch) {
          const qVal = TextNormalizationModule.parseItalianNumber(qtyMatch[1]);
          if (qVal && qVal > 0) quantity = qVal;
          if (qtyMatch[2]) unitOfMeasure = qtyMatch[2].toLowerCase();

          const uPrice = TextNormalizationModule.parseItalianNumber(qtyMatch[3]);
          if (uPrice && uPrice > 0) unitPrice = uPrice;

          if (lineTotal === 0) {
            lineTotal = Math.round(quantity * unitPrice * 100) / 100;
          }
        }

        // Controllo e Unificazione con riga spezzata precedente (se la riga precedente era senza prezzo 0.00€)
        if (parsedLines.length > 0) {
          const lastLine = parsedLines[parsedLines.length - 1];
          if (lastLine.unitPrice === 0 && lastLine.lineTotal === 0 && (!lastLine.warnings || lastLine.warnings.includes('prezzo_riga_non_rilevato'))) {
            // Unifica la descrizione precedente con quella attuale
            const combinedDesc = `${lastLine.normalizedDescription} ${description || line}`.trim();
            description = combinedDesc;
            // Rimuovi la riga orfana a 0.00€
            parsedLines.pop();
          }
        }

        // Se la descrizione è molto breve o contiene solo quantitativo/unita di misura (es. "500G"), unisci con la riga precedente
        if (!description || description.length < 3 || /^\d+\s*(kg|g|l|ml|pz)?$/i.test(description)) {
          if (i > 0 && !this.headerExclusions.some((h) => lines[i - 1].toUpperCase().includes(h))) {
            const prevLine = lines[i - 1].trim();
            if (prevLine.length > 2) {
              description = `${prevLine} ${description || ''}`.trim();
            }
          }
        }

        // Se descrizione è ancora vuota, usa la riga stessa
        if (!description || description.length < 2) {
          description = line.replace(/(-?\d+[.,]\d{2}-?).*/, '').trim() || line;
          confidence = 60;
        }

        // Pulisci eventuale testo residuo nella descrizione
        description = description
          .replace(/^[0-9*.\-\s]+/, '')
          .replace(/\s+(?:[A-D]|\d{1,2}%)$/i, '')
          .trim();

        if (description.length > 0) {
          parsedLines.push({
            originalText: line,
            normalizedDescription: description,
            quantity: Math.round(quantity * 1000) / 1000,
            unitOfMeasure,
            unitPrice: Math.round(unitPrice * 100) / 100,
            lineTotal: isNegative ? -Math.abs(lineTotal) : Math.round(lineTotal * 100) / 100,
            isNegative: isNegative || lineTotal < 0,
            pageIndex: 0,
            lineIndex: i,
            confidence,
            reviewStatus: 'pending',
            warnings: returnRegex.test(upper) ? ['RETURN_LINE'] : undefined,
          });
        }
      } else if (inLineItemSection && line.length > 3 && !/^\d+$/.test(line)) {
        // Riga d'acquisto potenziale senza prezzo rilevato in modo chiaro (es. descrizione lunga o spezzata)
        // La manteniamo temporaneamente come proposta incerta, che potrà essere unificata dalla riga successiva
        parsedLines.push({
          originalText: line,
          normalizedDescription: line.trim(),
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
          pageIndex: 0,
          lineIndex: i,
          confidence: 40,
          reviewStatus: 'pending',
          warnings: ['prezzo_riga_non_rilevato'],
        });
      }
    }

    return parsedLines;
  }
}
