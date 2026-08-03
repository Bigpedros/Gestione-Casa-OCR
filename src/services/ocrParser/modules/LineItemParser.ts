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
  ];

  private footerExclusions = [
    'TOTALE EURO',
    'TOTALE COMPLESSIVO',
    'TOTALE',
    'SUBTOTALE',
    'SUB-TOTALE',
    'CONTANTI',
    'RESTO',
    'CARTA',
    'BANCOMAT',
    'POS',
    'PAGAMENTO',
    'TOTALE IVA',
    'GRAZIE E ARRIVEDERCI',
    'IMPORTO DICHIARATO',
    'TRANSAZIONE',
    'TICKET',
    'SERVIZIO CLIENTE',
    'PUNTI FEDELTA',
    'SALDO PUNTI',
  ];

  public parse(context: ReceiptParserContext): ParsedReceiptLine[] {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) return [];

    const parsedLines: ParsedReceiptLine[] = [];

    // Pattern 1: Quantità x Prezzo Unitario (es. 2 x 1,50 o 0,750 kg x 3,99 o 2 X 1.50)
    const qtyPriceRegex = /(\d+(?:[.,]\d{1,3})?)\s*(kg|g|l|ml|pz)?\s*[xX*]\s*(\d+(?:[.,]\d{1,2})?)/i;

    // Pattern 2: Importo finale alla fine della riga (es. "PANE FRESCO 2,50 A" oppure "PASTA RUMMO 1.20")
    const priceEndRegex = /(.*?)\s+(-?\d{1,4}(?:[.,]\d{3})*[.,]\d{2})(?:\s+[A-Z0-9%]+)?$/;

    // Pattern 3: Sconto riga (es. "SCONTO -0,50" o "SCONTO 20% -0,30")
    const lineDiscountRegex = /SCONTO|ABBUONO|PROMO/i;

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
        // Se troviamo TOTALE, ci fermiamo
        if (upper.includes('TOTALE') || upper.includes('CONTANTI') || upper.includes('RESTO')) {
          break;
        }
        continue;
      }

      // Gestione sconti associati alla riga precedente
      if (lineDiscountRegex.test(line) && parsedLines.length > 0) {
        const discountMatch = line.match(/(-?\d+[.,]\d{2})/);
        if (discountMatch) {
          const discVal = Math.abs(TextNormalizationModule.parseItalianNumber(discountMatch[1]) || 0);
          const lastLine = parsedLines[parsedLines.length - 1];
          lastLine.discount = discVal;
          lastLine.lineTotal = Math.max(0, lastLine.lineTotal - discVal);
          lastLine.originalText += ` | ${line}`;
          continue;
        }
      }

      // Prova a fare il match di quantità x prezzo unitario
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

          if (parsedTotal < 0 || upper.includes('RESO') || upper.includes('STORNO')) {
            isNegative = true;
            parsedTotal = Math.abs(parsedTotal);
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

          // Se la riga conteneva solo la formula Qty x Price, usa la riga precedente come descrizione
          if (!description || description.length < 2) {
            if (i > 0 && !this.headerExclusions.some((h) => lines[i - 1].toUpperCase().includes(h))) {
              description = lines[i - 1].trim();
            }
          }
        }

        // Se descrizione è ancora vuota, usa la riga grezza
        if (!description) {
          description = line.replace(/(-?\d+[.,]\d{2}).*/, '').trim() || line;
          confidence = 60;
        }

        // Pulisci eventuale testo residuo nella descrizione
        description = description
          .replace(/^[0-9*.\-\s]+/, '')
          .replace(/\s+[A-Z0-9%]$/, '')
          .trim();

        if (description.length > 0) {
          parsedLines.push({
            originalText: line,
            normalizedDescription: description,
            quantity: Math.round(quantity * 1000) / 1000,
            unitOfMeasure,
            unitPrice: Math.round(unitPrice * 100) / 100,
            lineTotal: isNegative ? -Math.round(lineTotal * 100) / 100 : Math.round(lineTotal * 100) / 100,
            isNegative,
            pageIndex: 0,
            lineIndex: i,
            confidence,
            reviewStatus: 'pending',
          });
        }
      } else if (inLineItemSection && line.length > 3 && !/^\d+$/.test(line)) {
        // Riga d'acquisto potenziale senza prezzo rilevato in modo chiaro (es. descrizione lunga)
        // La manteniamo come proposta incerta anziché scartarla
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
