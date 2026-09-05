import { ParsedReceiptDraft } from '../../services/ocrParser/types';
import { receiptKnowledgeBase } from '../../services/ocrParser/knowledgeBase';
import {
  RealReceiptFixture,
  HarnessDocumentReport,
  HarnessEvaluationStatus,
  HarnessExecutionMode,
} from './types';

/**
 * Normalizza una stringa per confronto robusto (maiuscolo, whitespace normalizzati, senza punteggiatura superflua).
 */
function normalizeForComparison(str?: string | null): string {
  if (!str) return '';
  return str
    .toUpperCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Valuta l'output del parser a fronte della ground truth specificata nella fixture.
 */
export function evaluateReceiptDraftAgainstGroundTruth(
  fixture: RealReceiptFixture,
  draft: ParsedReceiptDraft,
  mode: HarnessExecutionMode,
  durationMs: number
): HarnessDocumentReport {
  const gt = fixture.groundTruth;
  const failureReasons: string[] = [];
  const partialReasons: string[] = [];

  // 1. Categoria
  const category = draft.documentCategory || 'UNKNOWN';
  const categoryConfidence = draft.overallConfidence || 0;
  const expectedCategory = gt.expectedDocumentCategory;
  const categoryMatch = category === expectedCategory;
  if (!categoryMatch) {
    failureReasons.push(
      `Categoria errata: attesa "${expectedCategory}", rilevata "${category}"`
    );
  }

  // 2. Merchant (Fornitore)
  const merchantRaw = draft.supplier?.sourceText || '';
  const merchantCandidate = draft.supplier?.value || '';
  const merchantConfidence = draft.supplier?.confidence || 0;
  let merchantMatch: boolean | undefined = undefined;

  if (gt.expectedMerchant !== undefined && gt.expectedMerchant !== null) {
    const expectedList = Array.isArray(gt.expectedMerchant)
      ? gt.expectedMerchant
      : [gt.expectedMerchant];

    const normDetected = normalizeForComparison(merchantCandidate);
    const normRaw = normalizeForComparison(merchantRaw);

    // Verifica se una delle forme attese corrisponde al rilevato, al raw, o tramite Merchant Directory
    merchantMatch = expectedList.some((exp) => {
      const normExp = normalizeForComparison(exp);
      if (
        normDetected.includes(normExp) ||
        normExp.includes(normDetected) ||
        normRaw.includes(normExp)
      ) {
        return true;
      }

      // Risoluzione semantica tramite directory dei mercanti (es. T00IS -> TODIS)
      const lookup = receiptKnowledgeBase.lookupMerchant(merchantCandidate);
      if (lookup.matched && lookup.matchedEntry) {
        const normCanonical = normalizeForComparison(lookup.matchedEntry.canonicalName);
        if (normCanonical.includes(normExp) || normExp.includes(normCanonical)) {
          return true;
        }
      }

      return false;
    });

    if (!merchantMatch) {
      const expLabel = expectedList.join(' / ');
      failureReasons.push(
        `Merchant errato: atteso "${expLabel}", rilevato "${merchantCandidate}" (raw: "${merchantRaw}")`
      );
    }
  }

  // 3. Totale
  const detectedTotal = typeof draft.total?.value === 'number' ? draft.total.value : null;
  let totalMatch: boolean | undefined = undefined;

  if (gt.expectedTotal !== undefined && gt.expectedTotal !== null) {
    if (detectedTotal !== null && Math.abs(detectedTotal - gt.expectedTotal) < 0.01) {
      totalMatch = true;
    } else {
      totalMatch = false;
      failureReasons.push(
        `Totale errato: atteso ${gt.expectedTotal.toFixed(2)} €, rilevato ${detectedTotal !== null ? detectedTotal.toFixed(2) + ' €' : 'NULL'}`
      );
    }
  }

  // 4. Line items
  const detectedLines = draft.lines || [];
  const detectedLineCount = detectedLines.length;
  let lineCountMatch: boolean | undefined = undefined;

  let linesWithPrice = 0;
  let linesPriceNotDetected = 0;
  let suspiciousLinesCount = 0;
  let itemsSum = 0;

  for (const line of detectedLines) {
    const hasPrice = (line.lineTotal && line.lineTotal > 0) || (line.unitPrice && line.unitPrice > 0);
    const hasWarningPriceNotDetected = line.warnings?.includes('PRICE_NOT_DETECTED');

    if (hasPrice && !hasWarningPriceNotDetected) {
      linesWithPrice++;
      itemsSum += line.lineTotal || 0;
    } else {
      linesPriceNotDetected++;
    }

    // Identifica righe sospette (troppo brevi, numeri isolati o solo caratteri speciali)
    const desc = line.normalizedDescription || line.originalText || '';
    if (desc.trim().length < 3 || /^[^a-zA-Z0-9]+$/.test(desc.trim())) {
      suspiciousLinesCount++;
    }
  }

  if (gt.expectedLineCount !== undefined && gt.expectedLineCount !== null) {
    if (detectedLineCount === gt.expectedLineCount) {
      lineCountMatch = true;
    } else {
      lineCountMatch = false;
      const diff = Math.abs(detectedLineCount - gt.expectedLineCount);
      // Se la differenza è drastica (es. > 100% dell'atteso o righe azzerate quando attese), è FAIL
      if (
        (gt.expectedLineCount > 0 && detectedLineCount === 0) ||
        (gt.expectedLineCount > 0 && detectedLineCount >= gt.expectedLineCount * 2.5 && diff > 8)
      ) {
        failureReasons.push(
          `Line count gravemente anomalo: attese ${gt.expectedLineCount} righe, rilevate ${detectedLineCount} (possibile esplosione footer/noise in righe)`
        );
      } else {
        partialReasons.push(
          `Line count discordante: attese ${gt.expectedLineCount}, rilevate ${detectedLineCount} (diff: ${diff})`
        );
      }
    }
  }

  // 5. Prodotti attesi specifici
  const unfoundExpectedProducts: string[] = [];
  if (gt.expectedProducts && gt.expectedProducts.length > 0) {
    for (const expProd of gt.expectedProducts) {
      const targetSub = normalizeForComparison(expProd.descriptionContains);
      const found = detectedLines.some((dl) => {
        const lineDesc = normalizeForComparison(dl.normalizedDescription || dl.originalText);
        const descMatches = !targetSub || lineDesc.includes(targetSub);
        const priceMatches =
          expProd.price === undefined ||
          (dl.lineTotal !== undefined && Math.abs(dl.lineTotal - expProd.price) < 0.02);
        return descMatches && priceMatches;
      });

      if (!found) {
        const descLabel = expProd.descriptionContains || 'item';
        const priceLabel = expProd.price !== undefined ? ` (${expProd.price.toFixed(2)} €)` : '';
        unfoundExpectedProducts.push(`${descLabel}${priceLabel}`);
      }
    }

    if (unfoundExpectedProducts.length > 0) {
      partialReasons.push(
        `Prodotti attesi non riscontrati (${unfoundExpectedProducts.length}/${gt.expectedProducts.length}): ${unfoundExpectedProducts.join(', ')}`
      );
    }
  }

  // 6. Metodo di pagamento
  const detectedPaymentMethod = draft.paymentMethod?.value || null;
  let paymentMethodMatch: boolean | undefined = undefined;

  if (gt.expectedPaymentMethod !== undefined && gt.expectedPaymentMethod !== null) {
    const normExpPay = normalizeForComparison(gt.expectedPaymentMethod);
    const normDetPay = normalizeForComparison(detectedPaymentMethod);

    if (normDetPay.includes(normExpPay) || normExpPay.includes(normDetPay)) {
      paymentMethodMatch = true;
    } else {
      paymentMethodMatch = false;
      partialReasons.push(
        `Metodo pagamento discordante: atteso "${gt.expectedPaymentMethod}", rilevato "${detectedPaymentMethod || 'NONE'}"`
      );
    }
  }

  // Differenza somma righe vs totale
  const itemsSumVsTotalDiff =
    detectedTotal !== null && itemsSum > 0
      ? Math.round(Math.abs(itemsSum - detectedTotal) * 100) / 100
      : null;

  // Warning e rumore
  const warnings = (draft.warnings || []).map((w) => `${w.code}: ${w.message}`);
  const unparsedNoiseCount = suspiciousLinesCount;

  // Calcolo dello stato finale: PASS | PARTIAL | FAIL
  let status: HarnessEvaluationStatus;
  if (failureReasons.length > 0) {
    status = 'FAIL';
  } else if (partialReasons.length > 0) {
    status = 'PARTIAL';
  } else {
    status = 'PASS';
  }

  return {
    documentId: fixture.id,
    label: fixture.label,
    mode,
    status,
    durationMs,

    category,
    categoryConfidence,
    expectedCategory,
    categoryMatch,

    merchantRaw,
    merchantCandidate,
    merchantConfidence,
    expectedMerchant: gt.expectedMerchant,
    merchantMatch,

    expectedLineCount: gt.expectedLineCount,
    detectedLineCount,
    linesWithPrice,
    linesPriceNotDetected,
    lineCountMatch,
    unfoundExpectedProducts,
    suspiciousLinesCount,

    detectedTotal,
    expectedTotal: gt.expectedTotal,
    totalMatch,
    itemsSumVsTotalDiff,

    detectedPaymentMethod,
    expectedPaymentMethod: gt.expectedPaymentMethod,
    paymentMethodMatch,

    warnings,
    unparsedNoiseCount,
    notes: gt.notes || fixture.layoutNotes,
    failureReasons,
    partialReasons,
  };
}
