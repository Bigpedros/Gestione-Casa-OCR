import { ParsedLineItemV2 } from '../types';

const MONEY_TOLERANCE = 0.05;

export interface ReceiptItemStructuralSignature {
  readonly hasDescription: boolean;
  readonly hasVat: boolean;
  readonly hasQuantity: boolean;
  readonly hasUnitPrice: boolean;
  readonly hasLineTotal: boolean;
  readonly hasCoreCommercialEvidence: boolean;
}

/**
 * ReceiptStructuralGrammar
 *
 * Assembla una unita commerciale senza dipendere dal layout grafico
 * dell'esercente. Le ancore sono semantiche:
 * descrizione/articolo, IVA, prezzo unitario e totale riga.
 * Quantita/peso e sconto sono estensioni opzionali.
 *
 * La fusione e fail-closed: due righe vengono unite solo se sono adiacenti,
 * appartengono entrambe ad ARTICLE, non hanno valori in conflitto e una delle
 * due ha la forma inequivocabile di "riga portatrice" strutturale
 * (quantita/moltiplicatore/IVA/prezzo), non di un secondo articolo autonomo.
 */
export class ReceiptStructuralGrammar {
  public static signature(item: ParsedLineItemV2): ReceiptItemStructuralSignature {
    const hasDescription = this.hasMeaningfulDescription(item.description);
    const hasVat = item.vatRate !== null;
    const hasQuantity =
      item.quantity !== null &&
      (item.quantity !== 1 || item.unitOfMeasure !== null);
    const hasUnitPrice = item.unitPrice !== null && item.unitPrice > 0;
    const hasLineTotal = item.lineTotal !== null && Math.abs(item.lineTotal) > 0;

    return {
      hasDescription,
      hasVat,
      hasQuantity,
      hasUnitPrice,
      hasLineTotal,
      hasCoreCommercialEvidence:
        hasDescription && hasVat && hasUnitPrice && hasLineTotal,
    };
  }

  public static assemble(items: readonly ParsedLineItemV2[]): ParsedLineItemV2[] {
    const assembled: ParsedLineItemV2[] = [];

    for (const current of items) {
      const previous = assembled[assembled.length - 1];

      if (previous && this.canMerge(previous, current)) {
        assembled[assembled.length - 1] = this.merge(previous, current);
      } else {
        assembled.push(current);
      }
    }

    return assembled;
  }

  private static canMerge(
    previous: ParsedLineItemV2,
    current: ParsedLineItemV2
  ): boolean {
    if (previous.type !== 'ARTICLE' || current.type !== 'ARTICLE') return false;
    if (previous.isNegative || current.isNegative) return false;
    if (!this.areAdjacent(previous, current)) return false;
    if (this.hasFieldConflict(previous, current)) return false;

    const prevSig = this.signature(previous);
    const currSig = this.signature(current);

    // Due articoli gia completi non si fondono mai.
    if (
      prevSig.hasDescription &&
      prevSig.hasLineTotal &&
      currSig.hasDescription &&
      currSig.hasLineTotal
    ) {
      return false;
    }

    const previousNeedsEvidence =
      !prevSig.hasLineTotal || !prevSig.hasUnitPrice || !prevSig.hasVat;
    const currentAddsEvidence =
      (!prevSig.hasLineTotal && currSig.hasLineTotal) ||
      (!prevSig.hasUnitPrice && currSig.hasUnitPrice) ||
      (!prevSig.hasVat && currSig.hasVat) ||
      (!prevSig.hasQuantity && currSig.hasQuantity);

    const currentIsCarrier = this.isStructuralCarrier(current);

    return previousNeedsEvidence && currentAddsEvidence && currentIsCarrier;
  }

  private static areAdjacent(
    previous: ParsedLineItemV2,
    current: ParsedLineItemV2
  ): boolean {
    const prevMax = Math.max(...previous.rawIndices);
    const currMin = Math.min(...current.rawIndices);
    return currMin === prevMax + 1;
  }

  private static hasFieldConflict(
    a: ParsedLineItemV2,
    b: ParsedLineItemV2
  ): boolean {
    if (
      a.vatRate !== null &&
      b.vatRate !== null &&
      Math.abs(a.vatRate - b.vatRate) > 0.01
    ) {
      return true;
    }

    if (
      a.lineTotal !== null &&
      b.lineTotal !== null &&
      Math.abs(Math.abs(a.lineTotal) - Math.abs(b.lineTotal)) > MONEY_TOLERANCE
    ) {
      return true;
    }

    // Prezzi unitari diversi possono essere legittimi solo quando una delle
    // righe porta esplicitamente una quantita/moltiplicatore. Senza tale
    // evidenza la fusione resta vietata.
    if (
      a.unitPrice !== null &&
      b.unitPrice !== null &&
      Math.abs(a.unitPrice - b.unitPrice) > MONEY_TOLERANCE &&
      !this.hasExplicitQuantityEvidence(a) &&
      !this.hasExplicitQuantityEvidence(b)
    ) {
      return true;
    }

    return false;
  }

  private static isStructuralCarrier(item: ParsedLineItemV2): boolean {
    const raw = item.rawText.trim().toUpperCase();
    const desc = item.description.trim();

    const beginsWithStructuralToken =
      /^(?:[X*]|\d+(?:[.,]\d+)?\s*(?:KG|G|GR|L|LT|ML|PZ|CT|CF)?\s*(?:[X*]|$)|\d{1,2}(?:[.,]00)?\s*%)/i.test(raw);

    const hasMultiplier =
      /\b\d+(?:[.,]\d+)?\s*(?:KG|G|GR|L|LT|ML|PZ|CT|CF)?\s*[X*]\s*\d+[.,]\d{2}\b/i.test(raw);

    const hasVatToken =
      /\b(?:0|4|5|10|22)(?:[.,]00)?\s*%\b/i.test(raw);

    const descriptionIsWeak =
      !this.hasMeaningfulDescription(desc) ||
      desc.split(/\s+/).filter(Boolean).length <= 1;

    return (
      (beginsWithStructuralToken && (item.lineTotal !== null || item.unitPrice !== null || item.vatRate !== null)) ||
      hasMultiplier ||
      (hasVatToken && descriptionIsWeak)
    );
  }

  private static hasExplicitQuantityEvidence(item: ParsedLineItemV2): boolean {
    return (
      (item.quantity !== null && item.quantity !== 1) ||
      item.unitOfMeasure !== null ||
      /\b\d+(?:[.,]\d+)?\s*(?:KG|G|GR|L|LT|ML|PZ|CT|CF)?\s*[X*]\s*\d+[.,]\d{2}\b/i.test(
        item.rawText
      )
    );
  }

  private static hasMeaningfulDescription(description: string): boolean {
    const letters = description.match(/[A-ZÀ-ÖØ-öø-ÿ]/gi) || [];
    return letters.length >= 3;
  }

  private static merge(
    previous: ParsedLineItemV2,
    current: ParsedLineItemV2
  ): ParsedLineItemV2 {
    const currentSig = this.signature(current);

    const description =
      this.hasMeaningfulDescription(previous.description)
        ? previous.description
        : current.description;

    const quantity =
      currentSig.hasQuantity ? current.quantity : previous.quantity;
    const unitOfMeasure =
      currentSig.hasQuantity ? current.unitOfMeasure : previous.unitOfMeasure;
    const unitPrice =
      current.unitPrice ?? previous.unitPrice;
    const lineTotal =
      current.lineTotal ?? previous.lineTotal;
    const vatRate =
      current.vatRate ?? previous.vatRate;

    const chosenMonetaryEvidence =
      current.monetaryEvidence.lineTotalEvidence !== 'MISSING'
        ? current.monetaryEvidence
        : previous.monetaryEvidence;

    const warnings = Array.from(
      new Set([...previous.warnings, ...current.warnings])
    );
    if (lineTotal !== null) {
      const idx = warnings.indexOf('PRICE_NOT_DETECTED');
      if (idx >= 0) warnings.splice(idx, 1);
    }

    const rawIndices = [...previous.rawIndices, ...current.rawIndices];

    return {
      ...previous,
      rawIndices,
      rawText: `${previous.rawText}\n${current.rawText}`,
      normalizedText: `${previous.normalizedText} ${current.normalizedText}`.trim(),
      description,
      quantity,
      unitOfMeasure,
      unitPrice,
      lineTotal,
      vatRate,
      monetaryEvidence: chosenMonetaryEvidence,
      warnings,
      reasons: [
        ...previous.reasons,
        ...current.reasons,
        'merged_by_receipt_structural_grammar',
      ],
      rawLines: [...previous.rawLines, ...current.rawLines],
      confidence: {
        description: Math.max(
          previous.confidence.description,
          current.confidence.description
        ),
        quantity: Math.max(
          previous.confidence.quantity,
          current.confidence.quantity
        ),
        unitPrice: Math.max(
          previous.confidence.unitPrice,
          current.confidence.unitPrice
        ),
        lineTotal: Math.max(
          previous.confidence.lineTotal,
          current.confidence.lineTotal
        ),
        vat: Math.max(previous.confidence.vat, current.confidence.vat),
        overall:
          Math.round(
            Math.max(
              previous.confidence.overall,
              current.confidence.overall
            ) * 100
          ) / 100,
      },
    };
  }
}
