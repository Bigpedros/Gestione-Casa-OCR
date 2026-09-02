import {
  SegmentedReceiptLine,
  ParsedLineItemV2,
  LineItemParseResultV2,
  LineItemTypeV2,
  MonetaryTokenEvidence,
  ParsedReceiptLine,
  ReceiptParserContext,
  ReceiptZones,
} from '../types';
import { OCRLineReviewStatus } from '../../../types';
import {
  ITEM_MIN_ALPHA_RATIO,
  ITEM_MAX_NOISE_RATIO,
  ITEM_MIN_LETTERS,
} from '../constants';

/**
 * =========================================================================
 * ARCHITETTURA REGOLA CECCOTTI — BLOCCO 2
 * LINE ITEM PARSER V2 (DETERMINISTICO, CONSERVATIVO, IMMUTABILE)
 * =========================================================================
 * 
 * LineItemParserV2 riceve ESCLUSIVAMENTE la zona BODY prodotta da ReceiptZoneSegmenter.
 * 
 * Regole e Principi Fondamentali:
 * 1. Non inventa prezzi né cerca di far quadrare forzatamente i totali.
 * 2. Riconosce ciò che ha evidenza certa e dichiara esplicitamente ciò che è UNKNOWN / AMBIGUOUS.
 * 3. Conserva per ogni elemento la tracciabilità immutabile di provenienza (`rawIndices`, `rawText`, `rawLines`).
 * 4. Implementa un'architettura a due passate:
 *    - Passata 1: Estrazione candidati strutturali per riga (descrizione, IVA, quantità, moltiplicatori, evidenza monetaria).
 *    - Passata 2: Risoluzione contestuale delle relazioni (multilinea, moltiplicatori/pesi su riga successiva, sconti collegati).
 * 5. Modello di confidenza per campo separato (descrizione, quantità, prezzo unitario, totale riga, IVA).
 */

interface RawLineCandidate {
  readonly line: SegmentedReceiptLine;
  readonly type: LineItemTypeV2;
  readonly descriptionCandidate: string;
  readonly vatRateCandidate: number | null;
  readonly quantityCandidate: number | null;
  readonly unitOfMeasureCandidate: string | null;
  readonly multiplierCandidate: { quantity: number; unitPrice: number; unitOfMeasure?: string } | null;
  readonly unitPriceCandidate: number | null;
  readonly lineTotalCandidate: number | null;
  readonly monetaryEvidence: {
    unitPriceEvidence: MonetaryTokenEvidence;
    lineTotalEvidence: MonetaryTokenEvidence;
    detectedRawToken?: string | null;
    candidateValue?: number | null;
  };
  readonly isNegative: boolean;
  readonly isWeightOnly: boolean;
  readonly isUnitPriceOnly: boolean;
  readonly isPureContinuationOrMultiplier: boolean;
  readonly isNoise: boolean;
  readonly reasons: string[];
  readonly warnings: string[];
}

export class LineItemParserV2 {
  public name = 'LineItemParserV2';

  /**
   * Punto di ingresso canonico: riceve le righe classificate come BODY da ReceiptZoneSegmenter.
   */
  public static parseBody(bodyLines: readonly SegmentedReceiptLine[]): LineItemParseResultV2 {
    if (!bodyLines || bodyLines.length === 0) {
      return {
        items: [],
        legacyLines: [],
        unparsedNoiseLines: [],
        overallConfidence: 0,
        summary: {
          articleCount: 0,
          discountCount: 0,
          unknownCount: 0,
          certainPriceCount: 0,
          uncertainPriceCount: 0,
        },
      };
    }

    // =======================================================================
    // PASSATA 1: ESTRAZIONE CANDIDATI STRUTTURALI PER RIGA
    // =======================================================================
    const candidates: RawLineCandidate[] = bodyLines.map((line) => this.extractLineCandidate(line));

    // =======================================================================
    // PASSATA 2: RISOLUZIONE RELAZIONI, CONTINUAZIONI E AGGREGAZIONE
    // =======================================================================
    const parsedItems: ParsedLineItemV2[] = [];
    const noiseLines: SegmentedReceiptLine[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const current = candidates[i];

      // Se la riga è solo rumore isolato senza alcuna caratteristica di prodotto
      if (current.isNoise) {
        noiseLines.push(current.line);
        continue;
      }

      // Controllo se si aggancia al candidato precedente
      if (parsedItems.length > 0) {
        const lastItem = parsedItems[parsedItems.length - 1];

        // 1. Riga esplicita di continuazione / peso / moltiplicatore / prezzo isolato
        if (current.isPureContinuationOrMultiplier) {
          const mergedItem = this.mergeContinuationLine(lastItem, current);
          parsedItems[parsedItems.length - 1] = mergedItem;
          continue;
        }

        // 2. Descrizione multilinea spezzata su righe consecutive
        // Il genitore precedente era una riga con sola descrizione incompleta (senza IVA, senza prezzo, senza modificatore)
        const lastWasIncompleteHeader =
          lastItem.type === 'ARTICLE' &&
          lastItem.vatRate === null &&
          lastItem.monetaryEvidence.lineTotalEvidence === 'MISSING' &&
          lastItem.quantity === 1 &&
          lastItem.unitOfMeasure === null &&
          !/\b\d+\s*(?:GR|G|KG|L|ML|PZ)\b/i.test(lastItem.description) &&
          lastItem.rawIndices.length === 1 &&
          lastItem.description.length >= 3;

        if (lastWasIncompleteHeader && current.type === 'ARTICLE') {
          const mergedItem = this.mergeContinuationLine(lastItem, current);
          parsedItems[parsedItems.length - 1] = mergedItem;
          continue;
        }
      }

      // Costruzione dell'elemento strutturato ParsedLineItemV2
      const item = this.buildLineItem(current);
      parsedItems.push(item);
    }

    // Costruzione della vista legacy compatibile (senza mutare i dati né forzare zeri certi)
    const legacyLines = parsedItems.map((item, idx) => this.toLegacyParsedReceiptLine(item, idx));

    // Metriche di sintesi
    const articleCount = parsedItems.filter((it) => it.type === 'ARTICLE').length;
    const discountCount = parsedItems.filter((it) => it.type === 'DISCOUNT' || it.type === 'ROUNDING' || it.type === 'RETURN_STORNO').length;
    const unknownCount = parsedItems.filter((it) => it.type === 'UNKNOWN').length;
    const certainPriceCount = parsedItems.filter((it) => it.monetaryEvidence.lineTotalEvidence === 'CERTAIN').length;
    const uncertainPriceCount = parsedItems.length - certainPriceCount;

    const overallConfidence =
      parsedItems.length > 0
        ? Math.round(
            (parsedItems.reduce((acc, curr) => acc + curr.confidence.overall, 0) / parsedItems.length) * 100
          ) / 100
        : 0;

    return {
      items: parsedItems,
      legacyLines,
      unparsedNoiseLines: noiseLines,
      overallConfidence,
      summary: {
        articleCount,
        discountCount,
        unknownCount,
        certainPriceCount,
        uncertainPriceCount,
      },
    };
  }

  /**
   * Interfaccia compatibile con il contesto generale o la receipt zone
   */
  public parse(context: ReceiptParserContext, zones?: ReceiptZones): LineItemParseResultV2 {
    const bodyLines =
      zones?.body && zones.body.length > 0
        ? zones.body
        : (context.lines || []).map((line, idx) => ({
            index: idx,
            rawIndex: idx,
            rawText: line,
            text: line,
            zone: 'BODY' as const,
            confidence: 1.0,
            reasons: ['fallback_context_line'],
          }));
    return LineItemParserV2.parseBody(bodyLines);
  }

  // =========================================================================
  // PASSATA 1: LOGICA DI ESTRAZIONE CANDIDATO
  // =========================================================================
  private static extractLineCandidate(line: SegmentedReceiptLine): RawLineCandidate {
    const normText = line.text.trim();
    const upper = normText.toUpperCase();
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Riconoscimento Modificatori (Sconto, Arrotondamento, Reso/Storno)
    let type: LineItemTypeV2 = 'ARTICLE';
    let isNegative = false;

    if (/\b(?:ARROTONDAMENTO)\b/i.test(upper)) {
      type = 'ROUNDING';
      isNegative = true;
      reasons.push('detected_rounding_modifier');
    } else if (/\b(?:SCONTO|ABBUONO|PROMO|PROMOZIONE|COUPON|BUONO)\b/i.test(upper)) {
      type = 'DISCOUNT';
      isNegative = true;
      reasons.push('detected_discount_modifier');
    } else if (/\b(?:RESO|STORNO|RESTITUITO)\b/i.test(upper)) {
      type = 'RETURN_STORNO';
      isNegative = true;
      reasons.push('detected_return_storno');
    } else {
      type = 'ARTICLE';
      reasons.push('standard_article_candidate');
    }

    // 2. Aliquota IVA
    let vatRateCandidate: number | null = null;
    const vatMatch = upper.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
    if (vatMatch) {
      const parsedVat = parseFloat(vatMatch[1].replace(',', '.'));
      if (!isNaN(parsedVat) && parsedVat >= 0 && parsedVat <= 100) {
        vatRateCandidate = parsedVat;
        reasons.push(`vat_rate_${parsedVat}%`);
      }
    }

    // 3. Moltiplicatore e Peso (es. "2 X 3,00 6,00", "0,500 KG X 4,50", "X 24,00 6,00")
    let multiplierCandidate: { quantity: number; unitPrice: number; unitOfMeasure?: string } | null = null;
    let quantityCandidate: number | null = null;
    let unitOfMeasureCandidate: string | null = null;
    let unitPriceCandidate: number | null = null;

    const multPattern = /\b(\d+(?:[.,]\d+)?)\s*(KG|G|GR|L|ML|PZ|CT|CF)?\s*[xX*]\s*(\d+[.,]\d{2})\b/i;
    const tariffOnlyPattern = /^\s*[xX*]\s*(\d+[.,]\d{2})\b/i;
    const multMatch = upper.match(multPattern);
    const tariffMatch = upper.match(tariffOnlyPattern);

    if (multMatch) {
      const q = parseFloat(multMatch[1].replace(',', '.'));
      const uom = multMatch[2] ? multMatch[2].toUpperCase() : null;
      const up = parseFloat(multMatch[3].replace(',', '.'));
      if (!isNaN(q) && !isNaN(up)) {
        multiplierCandidate = { quantity: q, unitPrice: up, unitOfMeasure: uom ?? undefined };
        quantityCandidate = q;
        unitPriceCandidate = up;
        unitOfMeasureCandidate = uom;
        reasons.push(`detected_multiplier_${q}x${up}`);
      }
    } else if (tariffMatch) {
      const up = parseFloat(tariffMatch[1].replace(',', '.'));
      if (!isNaN(up)) {
        unitPriceCandidate = up;
        reasons.push(`detected_tariff_unit_price_${up}`);
      }
    } else {
      // Peso / Qta isolata (es. "0,500 KG", "2 PZ")
      const isolatedUom = upper.match(/^\s*(\d+(?:[.,]\d+)?)\s*(KG|G|GR|L|ML|PZ|CT|CF)\s*$/i);
      if (isolatedUom) {
        const q = parseFloat(isolatedUom[1].replace(',', '.'));
        if (!isNaN(q)) {
          quantityCandidate = q;
          unitOfMeasureCandidate = isolatedUom[2].toUpperCase();
          reasons.push(`detected_isolated_weight_${q}_${unitOfMeasureCandidate}`);
        }
      }
    }

    // 4. Token Monetari e Classificazione dell'Evidenza
    const monetaryResult = this.detectMonetaryEvidence(upper, isNegative, multiplierCandidate || (unitPriceCandidate !== null ? { quantity: 1, unitPrice: unitPriceCandidate } : null));
    if (monetaryResult.warning) {
      if (monetaryResult.warning === 'VAT_PRICE_AMBIGUOUS') {
        warnings.push('VAT_PRICE_AMBIGUOUS');
        warnings.push('PRICE_NOT_DETECTED');
      } else if ((type === 'DISCOUNT' || type === 'ROUNDING') && monetaryResult.warning === 'PRICE_NOT_DETECTED') {
        warnings.push('DISCOUNT_VALUE_NOT_DETECTED');
        warnings.push('PRICE_NOT_DETECTED');
      } else {
        warnings.push(monetaryResult.warning);
      }
    }

    // 5. Estrazione e Pulizia della Descrizione
    const descriptionCandidate = this.cleanItemDescription(
      normText,
      vatRateCandidate,
      monetaryResult.rawToken,
      multiplierCandidate
    );

    // 6. Verifica se è rumore isolato o continuazione pura / multilinea
    const cleanDesc = descriptionCandidate.trim();
    const lettersCount = (cleanDesc.match(/[A-Za-z\u00C0-\u017F]/g) || []).length;
    const hasLetters = lettersCount >= ITEM_MIN_LETTERS;
    const alphaRatio = cleanDesc.length > 0 ? lettersCount / cleanDesc.length : 0;
    const noiseCount = (cleanDesc.match(/[~|\\{}_^<>*+=$"“'‘`()[\]@!%#?]/g) || []).length;
    const noiseRatio = cleanDesc.length > 0 ? noiseCount / cleanDesc.length : 0;
    const words = cleanDesc.split(/\s+/).filter((w) => w.replace(/[^A-Za-z\u00C0-\u017F]/g, '').length >= 2);
    const hasValidWords =
      words.some((w) => w.replace(/[^A-Za-z\u00C0-\u017F]/g, '').length >= 3) ||
      (words.length >= 2 && lettersCount >= 5);

    const hasVat = vatRateCandidate !== null;
    const hasPrice = monetaryResult.evidence === 'CERTAIN' || monetaryResult.evidence === 'PLAUSIBLE';
    const isModifier = type !== 'ARTICLE';

    // Riconoscimento continuazioni pure:
    // a. Moltiplicatore o prezzo isolato senza descrizione testuale
    // b. Riga di solo peso / unità di misura (es. "0,500 KG", "2 PZ")
    // c. Riga di sola tariffa moltiplicatore (es. "X 12,00 €/KG", "X 3,50", "X 24,00 6,00")
    // d. Riga di solo prezzo totale isolato (es. "6,00")
    const isWeightOnly = !hasVat && !hasPrice && !isModifier && /^\s*\d+(?:[.,]\d+)?\s*(?:KG|G|GR|L|ML|PZ|CT|CF)\s*$/i.test(normText);
    const isUnitPriceOnly = !hasVat && !isModifier && /^\s*[xX*]\s*\d+[.,]\d{2}/i.test(normText);
    const isPriceOnly = !hasLetters && hasPrice;

    const isPureContinuationOrMultiplier =
      !hasLetters && (multiplierCandidate !== null || hasPrice || isWeightOnly || isUnitPriceOnly || isPriceOnly);

    const isStructuralTerm =
      !hasVat &&
      /\b(?:DOCUMENTO|DOCIMENTO|COMMERCIALE|SCONTRINO|RICEVUTA|FATTURA|PRESTAZIONE|VENDITA|DI\s+VENDITA|DESCRIZIONE\s+IVA|DESTZINE|DESCRZINE|PREZZO|PRAGZOL|IMPORTO|PAGAMENTO|ELETTRONICO|CONTANTE|RESTO|TOTALE|SUBTOTALE|ARRIVEDERCI|GRAZIE|MATRICOLA|CASSIERE|OPERATORE|TERMINALE|P\.?\s*IVA|PARTITA\s*IVA|CODICE\s*FISCALE|C\.?\s*F\.?)\b/i.test(
        cleanDesc
      );

    const isUnpricedLegitimateProduct =
      hasLetters &&
      alphaRatio >= ITEM_MIN_ALPHA_RATIO &&
      noiseRatio <= ITEM_MAX_NOISE_RATIO &&
      hasValidWords &&
      !isStructuralTerm;

    const isNoise =
      !isPureContinuationOrMultiplier &&
      !isPriceOnly &&
      !isWeightOnly &&
      !isUnitPriceOnly &&
      (!hasLetters || !isUnpricedLegitimateProduct) &&
      (monetaryResult.evidence === 'MISSING' || (!hasLetters && multiplierCandidate === null));

    return {
      line,
      type,
      descriptionCandidate,
      vatRateCandidate,
      quantityCandidate,
      unitOfMeasureCandidate,
      multiplierCandidate,
      unitPriceCandidate: unitPriceCandidate ?? (multiplierCandidate ? multiplierCandidate.unitPrice : monetaryResult.value),
      lineTotalCandidate: monetaryResult.value,
      monetaryEvidence: {
        unitPriceEvidence: multiplierCandidate || unitPriceCandidate !== null ? 'CERTAIN' : monetaryResult.evidence,
        lineTotalEvidence: monetaryResult.evidence,
        detectedRawToken: monetaryResult.rawToken,
        candidateValue: monetaryResult.value,
      },
      isNegative,
      isWeightOnly,
      isUnitPriceOnly,
      isPureContinuationOrMultiplier: isPureContinuationOrMultiplier || isWeightOnly || isUnitPriceOnly || isPriceOnly,
      isNoise,
      reasons,
      warnings,
    };
  }

  // =========================================================================
  // CLASSIFICAZIONE CONSERVATIVA DEI TOKEN MONETARI
  // =========================================================================
  private static detectMonetaryEvidence(
    upperText: string,
    isNegativeContext: boolean,
    multiplier?: { quantity: number; unitPrice: number } | null
  ): {
    evidence: MonetaryTokenEvidence;
    value: number | null;
    rawToken: string | null;
    warning?: string;
  } {
    // Rimuoviamo prima di tutto le aliquote IVA (es. "22,00%", "4,00%", "10,00%", "22%", "4%")
    // per evitare che vengano scambiate per importi monetari di riga.
    const textWithoutVat = upperText.replace(/\b\d{1,2}(?:[.,]\d{1,2})?\s*%/g, ' ');

    // A. Pattern Decimale Certo (es. "1,99", "6.99", "2,50", "-0,02", "21,90")
    const decimalTokens = Array.from(textWithoutVat.matchAll(/[-−]?\s*\b\d{1,4}[.,]\d{2}\b/g));

    // Rileva colonna IVA priva del simbolo % (es. "22,00 002 A" o "4,00 01 A")
    const vatColWithDeptMatch = textWithoutVat.match(/\b(?:22|10|4|5|0)(?:[.,]00)?\s+\d{2,4}\s+[A-Z]\b/);
    if (vatColWithDeptMatch && decimalTokens.length === 1) {
      return {
        evidence: 'MISSING',
        value: null,
        rawToken: null,
        warning: 'VAT_PRICE_AMBIGUOUS',
      };
    }

    if (decimalTokens.length > 0) {
      // Se abbiamo un moltiplicatore e più decimali, prendiamo l'ultimo decimale come totale riga
      let selectedMatch = decimalTokens[decimalTokens.length - 1];
      if (multiplier && decimalTokens.length > 1) {
        // Il primo o intermedio corrispondeva al prezzo unitario del moltiplicatore
        selectedMatch = decimalTokens[decimalTokens.length - 1];
      }
      const rawToken = selectedMatch[0].replace(/\s+/g, '');
      const parsed = parseFloat(rawToken.replace('−', '-').replace(',', '.'));

      if (!isNaN(parsed)) {
        const finalValue = isNegativeContext && parsed > 0 ? -parsed : parsed;
        return {
          evidence: 'CERTAIN',
          value: finalValue,
          rawToken,
        };
      }
    }

    // B. Pattern Decimale con OCR Apostrofe/Plausibile (es. "1’89", "1'89")
    const apostropheMatch = textWithoutVat.match(/\b\d{1,4}[’']\d{2}\b/);
    if (apostropheMatch) {
      const rawToken = apostropheMatch[0];
      const parsed = parseFloat(rawToken.replace(/[’']/, '.'));
      if (!isNaN(parsed)) {
        const finalValue = isNegativeContext && parsed > 0 ? -parsed : parsed;
        return {
          evidence: 'PLAUSIBLE',
          value: finalValue,
          rawToken,
          warning: 'PRICE_ESTIMATED_FROM_APOSTROPHE_TOKEN',
        };
      }
    }

    // C. Pattern Decimale Ambiguo (es. token numerici a 3 o 4 cifre senza punto: "189", "156", "002" prima di codici reparto PRA/BC)
    // Regola Ceccotti: NON promuovere automaticamente a prezzo certo! Dichiarare AMBIGUOUS.
    const ambiguousIntegerMatch = textWithoutVat.match(/\b(\d{3,4})\s+(?:PRA|BC|IBRIDO|PERA|PA|PZ|GLI|RO|TO|UN)\b/i);
    if (ambiguousIntegerMatch) {
      const rawToken = ambiguousIntegerMatch[1];
      const plausibleCents = parseFloat(rawToken) / 100;
      return {
        evidence: 'AMBIGUOUS',
        value: null, // Manteniamo il valore null/unknown per preservare la verità OCR
        rawToken,
        warning: `AMBIGUOUS_PRICE_FORMAT (candidate: ${plausibleCents.toFixed(2)})`,
      };
    }

    // D. Prezzo Mancante / Non Rilevato
    return {
      evidence: 'MISSING',
      value: null,
      rawToken: null,
      warning: 'PRICE_NOT_DETECTED',
    };
  }

  // =========================================================================
  // PULIZIA E NORMALIZZAZIONE DELLA DESCRIZIONE PRODOTTO
  // =========================================================================
  private static cleanItemDescription(
    text: string,
    vatRate: number | null,
    monetaryToken: string | null,
    multiplier?: { quantity: number; unitPrice: number; unitOfMeasure?: string } | null,
    weightEvidence?: { quantity: number; uom: string } | null
  ): string {
    let desc = text;

    // Rimuovi blocco moltiplicatore commerciale completo (es. "2 X 3,00", "2 X 1,10", "0,500 KG X 12,00")
    if (multiplier) {
      desc = desc.replace(/\b\d+(?:[.,]\d+)?\s*(?:KG|G|GR|L|ML|PZ|CT|CF)?\s*[xX*]\s*\d+[.,]\d{2}\b/gi, ' ');
      desc = desc.replace(/\b[xX*]\s*\d+[.,]\d{2}\b/gi, ' ');
    }

    // Rimuovi evidenza di peso/unità riconosciuta (es. "0,500 KG", "500 GR")
    if (weightEvidence) {
      desc = desc.replace(/\b\d+(?:[.,]\d+)?\s*(?:KG|G|GR|L|ML|PZ|CT|CF)\b/gi, ' ');
    }

    // Rimuovi IVA (es. "22,00%", "4,00%", "10,00%")
    desc = desc.replace(/\b\d{1,2}(?:[.,]\d{1,2})?\s*%/g, ' ');
    if (vatRate !== null) {
      // Rimuovi eventuali frammenti residui formattati con l'aliquota nota
      desc = desc.replace(new RegExp(`\\b${vatRate}(?:[.,]0{1,2})?\\s*%?`, 'gi'), ' ');
    }

    // Rimuovi token monetario riconosciuto
    if (monetaryToken) {
      desc = desc.replace(monetaryToken, ' ');
    }

    // Rimuovi decimali residui isolati
    desc = desc.replace(/[-−]?\s*\b\d{1,4}[.,]\d{2}\b/g, ' ');
    desc = desc.replace(/\b\d{1,4}[’']\d{2}\b/g, ' ');

    // Rimuovi token ambigui a 3 cifre seguiti da codici reparto (es. "189 PRA", "156 BC", "002 PERA")
    desc = desc.replace(/\b\d{3,4}\s+(?:PRA|BC|IBRIDO|PERA|PA|PZ|GLI|RO|TO|UN)\b/gi, ' ');

    // Rimuovi indicatori commerciali e di reparto tipici di fine riga
    desc = desc.replace(/\b(?:PRA\s*O|PRA|PA\s*A\s*i|PA|IBRIDO|PERA|BC|GLI|GL|RO|TO|UN|II\s*UN|Na)\b/gi, ' ');

    // Rimuovi rumore OCR isolato a fine riga (es. "oo", "i 3", "‘e", "i", virgolette singole/apici)
    desc = desc.replace(/\b(?:oo|i\s+\d+|[‘'’]e)\b/gi, ' ');
    desc = desc.replace(/\s+[iI!òóeè‘'’°\d]\s*$/g, '');
    desc = desc.replace(/\s+[A-Z]\s*$/g, '');
    desc = desc.replace(/\s+[‘'’]\s*$/g, '');

    // Pulizia spazi multipli e punteggiatura pendente
    desc = desc.replace(/\s+/g, ' ').trim();
    desc = desc.replace(/^[-–—.:,‘'’]+\s*/, '').replace(/\s*[-–—.:,‘'’]+$/, '');

    return desc;
  }

  // =========================================================================
  // PASSATA 2: COSTRUZIONE DELL'ITEM E MERGE
  // =========================================================================
  private static buildLineItem(candidate: RawLineCandidate): ParsedLineItemV2 {
    const rawLine = candidate.line;

    // Calcolo delle confidenze per campo
    const descConf = candidate.descriptionCandidate.length >= 3 ? 0.95 : 0.6;
    const qtyConf = candidate.quantityCandidate !== null ? 0.95 : 0.5;
    const unitPriceConf =
      candidate.monetaryEvidence.unitPriceEvidence === 'CERTAIN'
        ? 0.95
        : candidate.monetaryEvidence.unitPriceEvidence === 'PLAUSIBLE'
        ? 0.75
        : candidate.monetaryEvidence.unitPriceEvidence === 'AMBIGUOUS'
        ? 0.3
        : 0.0;
    const lineTotalConf =
      candidate.monetaryEvidence.lineTotalEvidence === 'CERTAIN'
        ? 0.95
        : candidate.monetaryEvidence.lineTotalEvidence === 'PLAUSIBLE'
        ? 0.75
        : candidate.monetaryEvidence.lineTotalEvidence === 'AMBIGUOUS'
        ? 0.3
        : 0.0;
    const vatConf = candidate.vatRateCandidate !== null ? 0.95 : 0.0;

    const overallConf =
      Math.round(
        ((descConf * 0.35 + lineTotalConf * 0.35 + qtyConf * 0.15 + vatConf * 0.15)) * 100
      ) / 100;

    return {
      id: `item-v2-${rawLine.rawIndex}-${Date.now().toString(36)}`,
      type: candidate.type,
      rawIndices: [rawLine.rawIndex],
      rawText: rawLine.rawText,
      normalizedText: rawLine.text,
      description: candidate.descriptionCandidate,
      quantity: candidate.quantityCandidate ?? (candidate.isWeightOnly ? null : 1),
      unitOfMeasure: candidate.unitOfMeasureCandidate,
      unitPrice: candidate.unitPriceCandidate,
      lineTotal: candidate.lineTotalCandidate,
      vatRate: candidate.vatRateCandidate,
      discount: candidate.type === 'DISCOUNT' || candidate.type === 'ROUNDING' ? candidate.lineTotalCandidate : null,
      isNegative: candidate.isNegative,
      confidence: {
        description: descConf,
        quantity: qtyConf,
        unitPrice: unitPriceConf,
        lineTotal: lineTotalConf,
        vat: vatConf,
        overall: overallConf,
      },
      monetaryEvidence: candidate.monetaryEvidence,
      warnings: candidate.warnings,
      reasons: candidate.reasons,
      rawLines: [
        {
          rawIndex: rawLine.rawIndex,
          rawText: rawLine.rawText,
          normalizedText: rawLine.text,
        },
      ],
    };
  }

  private static mergeContinuationLine(
    parent: ParsedLineItemV2,
    continuation: RawLineCandidate
  ): ParsedLineItemV2 {
    const rawIndices = [...parent.rawIndices, continuation.line.rawIndex];
    const rawText = `${parent.rawText}\n${continuation.line.rawText}`;
    const normalizedText = `${parent.normalizedText} ${continuation.line.text}`;
    const rawLines = [
      ...parent.rawLines,
      {
        rawIndex: continuation.line.rawIndex,
        rawText: continuation.line.rawText,
        normalizedText: continuation.line.text,
      },
    ];

    // Se la continuazione contiene descrizione testuale aggiuntiva (es. multilinea pura), uniamo le descrizioni
    // Escludiamo continuazioni che sono solo peso/uom (es. "0,250 KG") o solo tariffa moltiplicatore (es. "X 24,00")
    let description = parent.description;
    const isStructuralContinuation = continuation.isWeightOnly || continuation.isUnitPriceOnly || /^[xX*]/.test(continuation.descriptionCandidate);
    if (
      !isStructuralContinuation &&
      continuation.descriptionCandidate &&
      continuation.descriptionCandidate.length > 0 &&
      !parent.description.includes(continuation.descriptionCandidate)
    ) {
      description = `${parent.description} ${continuation.descriptionCandidate}`.trim();
    }

    // Se la continuazione contiene moltiplicatore o prezzo valido, arricchiamo l'elemento genitore
    const quantity = continuation.quantityCandidate ?? parent.quantity;
    const unitOfMeasure = continuation.unitOfMeasureCandidate ?? parent.unitOfMeasure;
    const unitPrice = continuation.unitPriceCandidate ?? parent.unitPrice;
    const lineTotal = continuation.lineTotalCandidate ?? parent.lineTotal;
    const vatRate = continuation.vatRateCandidate ?? parent.vatRate;

    const monetaryEvidence =
      continuation.monetaryEvidence.lineTotalEvidence !== 'MISSING'
        ? continuation.monetaryEvidence
        : parent.monetaryEvidence;

    let warnings = Array.from(new Set([...parent.warnings, ...continuation.warnings]));
    if (monetaryEvidence.lineTotalEvidence === 'CERTAIN' || monetaryEvidence.lineTotalEvidence === 'PLAUSIBLE') {
      warnings = warnings.filter((w) => w !== 'PRICE_NOT_DETECTED' && w !== 'LOW_CONFIDENCE');
    }
    const reasons = [...parent.reasons, `merged_continuation_line_${continuation.line.rawIndex}`];

    // Ricalcolo confidenze
    const lineTotalConf =
      monetaryEvidence.lineTotalEvidence === 'CERTAIN'
        ? 0.95
        : monetaryEvidence.lineTotalEvidence === 'PLAUSIBLE'
        ? 0.75
        : 0.0;
    const overallConf =
      Math.round(
        ((parent.confidence.description * 0.35 + lineTotalConf * 0.35 + parent.confidence.quantity * 0.15 + (vatRate ? 0.95 : 0.0) * 0.15)) * 100
      ) / 100;

    return {
      ...parent,
      description,
      rawIndices,
      rawText,
      normalizedText,
      quantity,
      unitOfMeasure,
      unitPrice,
      lineTotal,
      vatRate,
      monetaryEvidence,
      warnings,
      reasons,
      rawLines,
      confidence: {
        ...parent.confidence,
        lineTotal: lineTotalConf,
        overall: overallConf,
      },
    };
  }

  // =========================================================================
  // ADATTATORE VISTA LEGACY COMPATIBILE (SENZA FORZARE ZERI CERTI)
  // =========================================================================
  public static toLegacyParsedReceiptLine(item: ParsedLineItemV2, index: number): ParsedReceiptLine {
    const lineTotal = item.lineTotal ?? 0;
    const unitPrice = item.unitPrice ?? lineTotal;
    const reviewStatus: OCRLineReviewStatus = 'pending';
    const warnings = [...item.warnings];

    if (item.lineTotal === null && !warnings.includes('PRICE_NOT_DETECTED')) {
      warnings.push('PRICE_NOT_DETECTED');
    }

    return {
      id: item.id,
      originalText: item.rawText,
      normalizedDescription: item.description,
      quantity: item.quantity ?? 1,
      unitOfMeasure: item.unitOfMeasure,
      unitPrice,
      lineTotal,
      discount: item.discount,
      isNegative: item.isNegative,
      pageIndex: 0,
      lineIndex: item.rawIndices[0] ?? index,
      confidence: item.confidence.overall,
      reviewStatus,
      warnings,
    };
  }

  public static toLegacyLines(items: readonly ParsedLineItemV2[]): ParsedReceiptLine[] {
    return items.map((it, idx) => this.toLegacyParsedReceiptLine(it, idx));
  }
}
