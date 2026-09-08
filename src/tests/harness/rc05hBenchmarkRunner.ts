import fs from 'fs';
import path from 'path';
import { createWorker, Worker } from 'tesseract.js';
import {
  RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH,
  PhysicalDocumentGroundTruth,
} from '../fixtures/real-receipts/rc05h-corpus-ground-truth';
import { receiptParserService } from '../../services/ocrParser/receiptParserService';
import { receiptKnowledgeBase } from '../../services/ocrParser/knowledgeBase';
import { ParsedReceiptDraft } from '../../services/ocrParser/types';

/**
 * Funzione di mascheramento per garantire che nessun dato personale o bancario
 * (Codice Fiscale, PAN/frammenti di carta, codici di autorizzazione, identificativi POS/terminale,
 * parametri tecnici di transazione e nominativi operatori) appaia nei log o nei report.
 */
export function maskSensitiveData(text: string): string {
  if (!text) return '';
  return text
    // Codice Fiscale italiano (16 caratteri alfanumerici)
    .replace(/\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPR-T][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi, '[CODICE_FISCALE_MASCHERATO]')
    // PAN carta (16 cifre o cifre mascherate con asterischi/X)
    .replace(/(?:\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b\d{4,6}[*X\s]{4,10}\d{2,4}\b|\*{4,}\s*\d{4})/gi, '[CARTA_PAN_MASCHERATO]')
    // Codici di autorizzazione / Auth code
    .replace(/\b(?:AUT(?:ORIZZAZIONE)?|AUTH|APP\.?CODE|COD\.?\s*AUT\.?)\s*[:#]?\s*([A-Z0-9]{4,12})\b/gi, 'AUT: [AUTH_MASCHERATO]')
    // Terminal ID / TID / POS ID / TPV
    .replace(/\b(?:TID|TERMINALE|TPV|ID\s*TERM(?:INALE)?|POS\s*ID)\s*[:#]?\s*([A-Z0-9]{4,16})\b/gi, 'TID: [TID_MASCHERATO]')
    // STAN / Traccia / Transazione tecnica
    .replace(/\b(?:STAN|TRACCIA|TRANS\.?\s*N\.?)\s*[:#]?\s*(\d{4,10})\b/gi, 'STAN: [TRANS_ID_MASCHERATO]')
    // Operatore / Cassiere
    .replace(/\b(?:OPERATORE|CASSIERE|OP\.?)\s*[:#]?\s*([A-Z\s]{3,25})(?=\n|$)/gi, 'OPERATORE: [OPERATORE_MASCHERATO]');
}

export function normalizeForComparison(str?: string | null): string {
  if (!str) return '';
  return str
    .toUpperCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDescriptionTokens(desc?: string | null): string[] {
  if (!desc) return [];
  return normalizeForComparison(desc)
    .split(' ')
    .filter((token) => token.length > 1 && !/^\d+$/.test(token));
}

export interface MatchedLineDetail {
  gtDescription: string;
  detectedDescription: string;
  gtPrice: number | null;
  detectedPrice: number | null;
  priceStatus: 'CORRECT' | 'WRONG' | 'ABSENT';
  gtQuantity: number | null;
  detectedQuantity: number | null;
  quantityStatus: 'CORRECT' | 'WRONG' | 'ABSENT';
}

export interface MissingLineDetail {
  gtDescription: string;
  expectedPrice: number | null;
  expectedQuantity: number | null;
  gtStatus: string;
}

export interface FalsePositiveLineDetail {
  description: string;
  price: number | null;
  quantity: number | null;
  isFiscalOrPos: boolean;
  rawText: string;
}

export interface DuplicateLineDetail {
  description: string;
  price: number | null;
  occurrences: number;
}

export interface Rc05hDocumentBenchmarkResult {
  documentIndex: number;
  documentId: string;
  label: string;
  relationship: 'SINGLE_IMAGE' | 'MULTI_SEGMENT' | 'MULTI_VIEW';
  associatedImages: string[];
  status: 'SUCCESS' | 'TECHNICAL_FAILURE';
  errorMessage?: string;
  durationMs: number;
  ocrConfidence: number;
  rawTextMasked: string;

  // Categoria
  categoryMatch: boolean;
  detectedCategory: string;
  expectedCategory: string;
  categoryStatus: string;

  // Esercente
  merchantMatch: boolean;
  detectedMerchant: string;
  rawMerchant: string;
  expectedMerchant: string | string[];
  merchantStatus: string;

  // Data & Ora
  dateMatch: boolean;
  detectedDate: string | null;
  expectedDate: string | null;
  dateStatus: string;
  timeMatch: boolean;
  detectedTime: string | null;
  expectedTime: string | null;
  timeStatus: string;

  // Totale
  totalMatch: boolean;
  detectedTotal: number | null;
  expectedTotal: number | null;
  totalDiff: number | null;
  totalStatus: string;

  // Metodo di pagamento
  paymentMethodMatch: boolean;
  detectedPaymentMethod: string | null;
  expectedPaymentMethod: string | null;
  paymentMethodStatus: string;

  // Conteggio righe
  lineCountMatch: boolean;
  detectedLineCount: number;
  expectedLineCount: number | null;
  lineCountStatus: string;

  // Analisi di dettaglio righe commerciali
  matchedLinesCount: number;
  missingLinesCount: number;
  falsePositiveLinesCount: number;
  correctPricesCount: number;
  wrongPricesCount: number;
  absentPricesCount: number;
  correctQuantitiesCount: number;
  wrongQuantitiesCount: number;
  absentQuantitiesCount: number;
  duplicateLinesCount: number;
  fiscalOrPosAsProductCount: number;

  matchedItemsDetail: MatchedLineDetail[];
  missingItemsDetail: MissingLineDetail[];
  falsePositiveLinesDetail: FalsePositiveLineDetail[];
  duplicateLinesDetail: DuplicateLineDetail[];

  // Subtotali, sconti, arrotondamenti
  detectedSubtotal: number | null;
  expectedSubtotals: (number | null)[];
  detectedDiscounts: number | null;
  warnings: string[];
  specialNotes?: string;
}

export interface Rc05hBenchmarkSummary {
  totalDocuments: number;
  totalImages: number;
  successfullyProcessed: number;
  technicalFailures: number;

  categoryMatches: number;
  merchantMatches: number;
  totalMatches: number;
  dateMatches: number;
  timeMatches: number;
  paymentMethodMatches: number;
  lineCountMatches: number;

  totalExpectedLines: number;
  totalDetectedLines: number;
  totalMatchedLines: number;
  totalMissingLines: number;
  totalFalsePositiveLines: number;

  totalCorrectPrices: number;
  totalWrongPrices: number;
  totalAbsentPrices: number;

  totalCorrectQuantities: number;
  totalWrongQuantities: number;
  totalAbsentQuantities: number;

  totalMultiViewOrSegmentDuplicates: number;
  totalFiscalOrPosAsProduct: number;

  totalDurationMs: number;
  averageDurationPerDocMs: number;
}

/**
 * Confronta il commerciante rilevato con le forme attese nella Ground Truth.
 */
export function matchMerchantName(
  detectedCandidate: string,
  rawCandidate: string,
  expected: string | string[]
): boolean {
  const expList = Array.isArray(expected) ? expected : [expected];
  const normDet = normalizeForComparison(detectedCandidate);
  const normRaw = normalizeForComparison(rawCandidate);

  for (const exp of expList) {
    const normExp = normalizeForComparison(exp);
    if (!normExp) continue;

    // Sottostringa bidirezionale
    if (normDet.includes(normExp) || normExp.includes(normDet)) return true;
    if (normRaw.includes(normExp) || normExp.includes(normRaw)) return true;

    // Risoluzione semantica tramite directory merchant
    const lookup = receiptKnowledgeBase.lookupMerchant(detectedCandidate);
    if (lookup.matched && lookup.matchedEntry) {
      const normCanonical = normalizeForComparison(lookup.matchedEntry.canonicalName);
      if (normCanonical.includes(normExp) || normExp.includes(normCanonical)) return true;
    }
  }
  return false;
}

/**
 * Confronta il metodo di pagamento rilevato con quello atteso.
 */
export function matchPaymentMethod(
  detected: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!expected) return true;
  if (!detected) return false;

  const normExp = normalizeForComparison(expected);
  const normDet = normalizeForComparison(detected);

  if (normDet.includes(normExp) || normExp.includes(normDet)) return true;

  // Sinonimi comuni (POS / Carta / Bancomat / Elettronico)
  const isExpElectronic = /POS|CARTA|BANCOMAT|ELETTRONIC|MASTERCARD|VISA|DEBIT/i.test(normExp);
  const isDetElectronic = /POS|CARTA|BANCOMAT|ELETTRONIC|MASTERCARD|VISA|DEBIT/i.test(normDet);
  if (isExpElectronic && isDetElectronic) return true;

  // Contanti / Cash
  const isExpCash = /CONTANT|CASH/i.test(normExp);
  const isDetCash = /CONTANT|CASH/i.test(normDet);
  if (isExpCash && isDetCash) return true;

  return false;
}

/**
 * Riconosce se una riga corrisponde a diciture fiscali o POS scambiate per articolo.
 */
export function isFiscalOrPosNoiseLine(text: string): boolean {
  const norm = normalizeForComparison(text);
  return (
    /\b(?:SUBTOTALE|TOTALE|IMPORTO|PAGAMENTO|PAGOBANCOMAT|BANCOMAT|CARTA|RESTO|CONTANTI|TRANSAZIONE|TERMINALE|TID|STAN|AUTORIZZAZIONE|AUTH|OPERATORE|CASSIERE|RT|DOCUMENTO|COMMERCIALE|VENDITA|ARRIVEDERCI|GRAZIE|CF|PIVA|IVA|ESENTE|VENTILAZIONE|EURO|EUR)\b/.test(
      norm
    ) ||
    /^\d+$/.test(norm.replace(/\s+/g, ''))
  );
}

/**
 * Valutatore dettagliato di confronto tra ParsedReceiptDraft e PhysicalDocumentGroundTruth.
 */
export function evaluateDraftAgainstPhysicalGroundTruth(
  gtDoc: PhysicalDocumentGroundTruth,
  draft: ParsedReceiptDraft,
  rawText: string,
  ocrConfidence: number,
  durationMs: number
): Rc05hDocumentBenchmarkResult {
  // 1. Categoria
  const detectedCategory = draft.documentCategory || 'UNKNOWN';
  const expectedCategory = gtDoc.category.value;
  const categoryMatch = detectedCategory === expectedCategory;

  // 2. Esercente
  const detectedMerchant = draft.supplier?.value || '';
  const rawMerchant = draft.supplier?.sourceText || '';
  const expectedMerchant = gtDoc.merchant.value;
  const merchantMatch = matchMerchantName(detectedMerchant, rawMerchant, expectedMerchant);

  // 3. Data & Ora
  const detectedDate = draft.date?.value || null;
  const expectedDate = gtDoc.date.value;
  const dateMatch =
    gtDoc.date.status === 'NOT_VISIBLE' || gtDoc.date.status === 'NOT_APPLICABLE'
      ? detectedDate === null || detectedDate === expectedDate
      : detectedDate === expectedDate;

  const detectedTime = draft.time?.value || null;
  const expectedTime = gtDoc.time.value;
  const timeMatch =
    gtDoc.time.status === 'NOT_VISIBLE' || gtDoc.time.status === 'NOT_APPLICABLE'
      ? detectedTime === null || detectedTime === expectedTime
      : detectedTime === expectedTime;

  // 4. Totale
  const detectedTotal = typeof draft.total?.value === 'number' ? draft.total.value : null;
  const expectedTotal = gtDoc.total.value;
  let totalMatch = false;
  let totalDiff: number | null = null;
  if (expectedTotal !== null) {
    if (detectedTotal !== null) {
      totalDiff = Math.round(Math.abs(detectedTotal - expectedTotal) * 100) / 100;
      totalMatch = totalDiff < 0.01;
    }
  } else {
    totalMatch = detectedTotal === null;
  }

  // 5. Metodo di pagamento
  const detectedPaymentMethod = draft.paymentMethod?.value || null;
  const expectedPaymentMethod = gtDoc.paymentMethod.value;
  const paymentMethodMatch = matchPaymentMethod(detectedPaymentMethod, expectedPaymentMethod);

  // 6. Line Count
  const detectedLines = draft.lines || [];
  const detectedLineCount = detectedLines.length;
  const expectedLineCount = gtDoc.lineCount.value;
  const lineCountMatch = expectedLineCount !== null && detectedLineCount === expectedLineCount;

  // 7. Dettaglio righe commerciali
  const matchedItemsDetail: MatchedLineDetail[] = [];
  const missingItemsDetail: MissingLineDetail[] = [];
  const falsePositiveLinesDetail: FalsePositiveLineDetail[] = [];
  const duplicateLinesDetail: DuplicateLineDetail[] = [];

  const usedDetectedIndices = new Set<number>();
  const gtItems = gtDoc.lineItems;

  let correctPricesCount = 0;
  let wrongPricesCount = 0;
  let absentPricesCount = 0;

  let correctQuantitiesCount = 0;
  let wrongQuantitiesCount = 0;
  let absentQuantitiesCount = 0;

  let fiscalOrPosAsProductCount = 0;

  for (const gtItem of gtItems) {
    const expDesc = gtItem.description.value;
    const expPrice = gtItem.totalPrice?.value ?? null;
    const expQty = gtItem.quantity?.value ?? 1;
    const expTokens = normalizeDescriptionTokens(expDesc);

    let bestMatchIdx = -1;
    let bestMatchScore = -1;

    for (let i = 0; i < detectedLines.length; i++) {
      if (usedDetectedIndices.has(i)) continue;

      const dLine = detectedLines[i];
      const detDesc = dLine.normalizedDescription || dLine.originalText || '';
      const detTokens = normalizeDescriptionTokens(detDesc);
      const detPrice = dLine.lineTotal ?? null;

      // Calcola sovrapposizione token
      let tokenOverlap = 0;
      for (const t of expTokens) {
        if (detTokens.some((dt) => dt.includes(t) || t.includes(dt))) {
          tokenOverlap++;
        }
      }

      const normExpDesc = normalizeForComparison(expDesc);
      const normDetDesc = normalizeForComparison(detDesc);
      const exactSub = normExpDesc.includes(normDetDesc) || normDetDesc.includes(normExpDesc);

      let score = tokenOverlap * 10 + (exactSub ? 15 : 0);

      // Bonus/Controllo prezzo
      if (expPrice !== null && detPrice !== null) {
        if (Math.abs(detPrice - expPrice) < 0.02) {
          score += 20;
        } else if (Math.abs(detPrice - expPrice) < 0.20) {
          score += 5;
        }
      }

      // Soglia minima per considerare match
      if (score >= 10 && score > bestMatchScore) {
        bestMatchScore = score;
        bestMatchIdx = i;
      }
    }

    if (bestMatchIdx >= 0) {
      usedDetectedIndices.add(bestMatchIdx);
      const matchedLine = detectedLines[bestMatchIdx];
      const detPrice = matchedLine.lineTotal ?? null;
      const detQty = matchedLine.quantity ?? null;

      let priceStatus: 'CORRECT' | 'WRONG' | 'ABSENT' = 'ABSENT';
      if (expPrice !== null) {
        if (detPrice === null || detPrice === 0) {
          priceStatus = 'ABSENT';
          absentPricesCount++;
        } else if (Math.abs(detPrice - expPrice) < 0.02) {
          priceStatus = 'CORRECT';
          correctPricesCount++;
        } else {
          priceStatus = 'WRONG';
          wrongPricesCount++;
        }
      } else {
        priceStatus = detPrice === null ? 'CORRECT' : 'WRONG';
      }

      let quantityStatus: 'CORRECT' | 'WRONG' | 'ABSENT' = 'ABSENT';
      if (detQty === null || detQty === undefined) {
        quantityStatus = expQty === 1 ? 'CORRECT' : 'ABSENT';
        if (expQty === 1) correctQuantitiesCount++;
        else absentQuantitiesCount++;
      } else if (Math.abs(detQty - expQty) < 0.01) {
        quantityStatus = 'CORRECT';
        correctQuantitiesCount++;
      } else {
        quantityStatus = 'WRONG';
        wrongQuantitiesCount++;
      }

      matchedItemsDetail.push({
        gtDescription: expDesc,
        detectedDescription: matchedLine.normalizedDescription || matchedLine.originalText,
        gtPrice: expPrice,
        detectedPrice: detPrice,
        priceStatus,
        gtQuantity: expQty,
        detectedQuantity: detQty,
        quantityStatus,
      });
    } else {
      missingItemsDetail.push({
        gtDescription: expDesc,
        expectedPrice: expPrice,
        expectedQuantity: expQty,
        gtStatus: gtItem.description.status,
      });
    }
  }

  // Righe detected non associate a nessun elemento della Ground Truth -> False Positives
  for (let i = 0; i < detectedLines.length; i++) {
    if (!usedDetectedIndices.has(i)) {
      const line = detectedLines[i];
      const isFiscalOrPos = isFiscalOrPosNoiseLine(line.normalizedDescription || line.originalText);
      if (isFiscalOrPos) {
        fiscalOrPosAsProductCount++;
      }
      falsePositiveLinesDetail.push({
        description: line.normalizedDescription || line.originalText,
        price: line.lineTotal ?? null,
        quantity: line.quantity ?? null,
        isFiscalOrPos,
        rawText: line.originalText,
      });
    }
  }

  // Ricerca duplicazioni tra le righe rilevate (es. multi-view o segmenti sovrapposti)
  const lineCountMap = new Map<string, { count: number; price: number | null }>();
  for (const line of detectedLines) {
    const key = `${normalizeForComparison(line.normalizedDescription || line.originalText)}|${line.lineTotal ?? 0}`;
    const curr = lineCountMap.get(key) || { count: 0, price: line.lineTotal ?? null };
    curr.count++;
    lineCountMap.set(key, curr);
  }
  for (const [key, val] of lineCountMap.entries()) {
    if (val.count > 1) {
      const desc = key.split('|')[0];
      // Verifica se la Ground Truth prevedeva effettivamente più righe identiche (es. 2 x Vaschetta Limone)
      const expectedDuplicates = gtItems.filter(
        (g) =>
          normalizeForComparison(g.description.value).includes(desc) ||
          desc.includes(normalizeForComparison(g.description.value))
      ).length;
      if (val.count > expectedDuplicates) {
        duplicateLinesDetail.push({
          description: desc,
          price: val.price,
          occurrences: val.count - Math.max(1, expectedDuplicates),
        });
      }
    }
  }
  const duplicateLinesCount = duplicateLinesDetail.reduce((acc, d) => acc + d.occurrences, 0);

  const warnings = (draft.warnings || []).map((w) => `${w.code}: ${w.message}`);

  return {
    documentIndex: gtDoc.documentIndex,
    documentId: gtDoc.documentId,
    label: gtDoc.label,
    relationship: gtDoc.imageRelationship,
    associatedImages: gtDoc.associatedImages,
    status: 'SUCCESS',
    durationMs,
    ocrConfidence,
    rawTextMasked: maskSensitiveData(rawText),

    categoryMatch,
    detectedCategory,
    expectedCategory,
    categoryStatus: gtDoc.category.status,

    merchantMatch,
    detectedMerchant,
    rawMerchant,
    expectedMerchant,
    merchantStatus: gtDoc.merchant.status,

    dateMatch,
    detectedDate,
    expectedDate,
    dateStatus: gtDoc.date.status,

    timeMatch,
    detectedTime,
    expectedTime,
    timeStatus: gtDoc.time.status,

    totalMatch,
    detectedTotal,
    expectedTotal,
    totalDiff,
    totalStatus: gtDoc.total.status,

    paymentMethodMatch,
    detectedPaymentMethod,
    expectedPaymentMethod,
    paymentMethodStatus: gtDoc.paymentMethod.status,

    lineCountMatch,
    detectedLineCount,
    expectedLineCount,
    lineCountStatus: gtDoc.lineCount.status,

    matchedLinesCount: matchedItemsDetail.length,
    missingLinesCount: missingItemsDetail.length,
    falsePositiveLinesCount: falsePositiveLinesDetail.length,
    correctPricesCount,
    wrongPricesCount,
    absentPricesCount,
    correctQuantitiesCount,
    wrongQuantitiesCount,
    absentQuantitiesCount,
    duplicateLinesCount,
    fiscalOrPosAsProductCount,

    matchedItemsDetail,
    missingItemsDetail,
    falsePositiveLinesDetail,
    duplicateLinesDetail,

    detectedSubtotal: draft.subtotal?.value ?? null,
    expectedSubtotals: (gtDoc.subtotals || []).map((s) => s.value),
    detectedDiscounts: draft.discounts?.value ?? null,
    warnings,
    specialNotes: gtDoc.specialNotes,
  };
}

export interface RunRc05hBenchmarkOptions {
  assetsDir?: string;
  onProgress?: (index: number, total: number, docId: string) => void;
}

/**
 * Esecuzione del Benchmark OCR reale su tutto il corpus RC-05H (15 documenti, 19 immagini).
 */
export async function runRc05hRealBenchmark(
  options: RunRc05hBenchmarkOptions = {}
): Promise<{
  results: Rc05hDocumentBenchmarkResult[];
  summary: Rc05hBenchmarkSummary;
}> {
  const assetsDir = options.assetsDir || path.resolve('local-test-assets/rc05h');
  const documents = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH;
  const results: Rc05hDocumentBenchmarkResult[] = [];
  const benchmarkStart = Date.now();

  // Inizializza un singolo worker riutilizzato sequenzialmente
  const worker: Worker = await createWorker('ita', 1, {
    logger: () => {},
  });

  await worker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    tessedit_pageseg_mode: '4' as any,
  });

  try {
    for (let docIdx = 0; docIdx < documents.length; docIdx++) {
      const doc = documents[docIdx];
      const docStartTime = Date.now();

      if (options.onProgress) {
        options.onProgress(docIdx + 1, documents.length, doc.documentId);
      }

      try {
        const pageTexts: string[] = [];
        const pageConfidences: number[] = [];

        for (const imgName of doc.associatedImages) {
          const imgPath = path.join(assetsDir, imgName);
          if (!fs.existsSync(imgPath)) {
            throw new Error(`File immagine non trovato: ${imgPath}`);
          }

          const res = await worker.recognize(imgPath);
          pageTexts.push(res.data.text || '');
          pageConfidences.push(Math.round(res.data.confidence || 0));
        }

        // Concatenazione testo nel rispetto della sequenza segmenti/viste
        const combinedRawText = pageTexts
          .map((t) => t.trim())
          .filter(Boolean)
          .join('\n\n');

        const avgConfidence =
          pageConfidences.length > 0
            ? Math.round(pageConfidences.reduce((a, b) => a + b, 0) / pageConfidences.length)
            : 0;

        // Invocazione del parser ufficiale di produzione
        const draft = receiptParserService.parseText(combinedRawText, {
          overallOcrConfidence: avgConfidence,
        });

        const docDurationMs = Date.now() - docStartTime;

        // Valutazione approfondita contro Ground Truth
        const evalResult = evaluateDraftAgainstPhysicalGroundTruth(
          doc,
          draft,
          combinedRawText,
          avgConfidence,
          docDurationMs
        );

        results.push(evalResult);
      } catch (docErr: any) {
        console.error(`[RC-05H-B Benchmark] Errore elaborazione documento ${doc.documentId}:`, docErr);
        const docDurationMs = Date.now() - docStartTime;

        results.push({
          documentIndex: doc.documentIndex,
          documentId: doc.documentId,
          label: doc.label,
          relationship: doc.imageRelationship,
          associatedImages: doc.associatedImages,
          status: 'TECHNICAL_FAILURE',
          errorMessage: docErr?.message || String(docErr),
          durationMs: docDurationMs,
          ocrConfidence: 0,
          rawTextMasked: '',
          categoryMatch: false,
          detectedCategory: 'ERROR',
          expectedCategory: doc.category.value,
          categoryStatus: doc.category.status,
          merchantMatch: false,
          detectedMerchant: '',
          rawMerchant: '',
          expectedMerchant: doc.merchant.value,
          merchantStatus: doc.merchant.status,
          dateMatch: false,
          detectedDate: null,
          expectedDate: doc.date.value,
          dateStatus: doc.date.status,
          timeMatch: false,
          detectedTime: null,
          expectedTime: doc.time.value,
          timeStatus: doc.time.status,
          totalMatch: false,
          detectedTotal: null,
          expectedTotal: doc.total.value,
          totalDiff: null,
          totalStatus: doc.total.status,
          paymentMethodMatch: false,
          detectedPaymentMethod: null,
          expectedPaymentMethod: doc.paymentMethod.value,
          paymentMethodStatus: doc.paymentMethod.status,
          lineCountMatch: false,
          detectedLineCount: 0,
          expectedLineCount: doc.lineCount.value,
          lineCountStatus: doc.lineCount.status,
          matchedLinesCount: 0,
          missingLinesCount: doc.lineItems.length,
          falsePositiveLinesCount: 0,
          correctPricesCount: 0,
          wrongPricesCount: 0,
          absentPricesCount: 0,
          correctQuantitiesCount: 0,
          wrongQuantitiesCount: 0,
          absentQuantitiesCount: 0,
          duplicateLinesCount: 0,
          fiscalOrPosAsProductCount: 0,
          matchedItemsDetail: [],
          missingItemsDetail: doc.lineItems.map((l) => ({
            gtDescription: l.description.value,
            expectedPrice: l.totalPrice?.value ?? null,
            expectedQuantity: l.quantity?.value ?? null,
            gtStatus: l.description.status,
          })),
          falsePositiveLinesDetail: [],
          duplicateLinesDetail: [],
          detectedSubtotal: null,
          expectedSubtotals: (doc.subtotals || []).map((s) => s.value),
          detectedDiscounts: null,
          warnings: [`TECHNICAL_FAILURE: ${docErr?.message || String(docErr)}`],
          specialNotes: doc.specialNotes,
        });
      }
    }
  } finally {
    await worker.terminate();
  }

  const totalDurationMs = Date.now() - benchmarkStart;

  // Calcolo statistiche complessive
  const totalDocuments = results.length;
  const totalImages = results.reduce((acc, r) => acc + r.associatedImages.length, 0);
  const successfullyProcessed = results.filter((r) => r.status === 'SUCCESS').length;
  const technicalFailures = results.filter((r) => r.status === 'TECHNICAL_FAILURE').length;

  const categoryMatches = results.filter((r) => r.categoryMatch).length;
  const merchantMatches = results.filter((r) => r.merchantMatch).length;
  const totalMatches = results.filter((r) => r.totalMatch).length;
  const dateMatches = results.filter((r) => r.dateMatch).length;
  const timeMatches = results.filter((r) => r.timeMatch).length;
  const paymentMethodMatches = results.filter((r) => r.paymentMethodMatch).length;
  const lineCountMatches = results.filter((r) => r.lineCountMatch).length;

  const totalExpectedLines = results.reduce(
    (acc, r) => acc + (r.expectedLineCount ?? r.matchedLinesCount + r.missingLinesCount),
    0
  );
  const totalDetectedLines = results.reduce((acc, r) => acc + r.detectedLineCount, 0);
  const totalMatchedLines = results.reduce((acc, r) => acc + r.matchedLinesCount, 0);
  const totalMissingLines = results.reduce((acc, r) => acc + r.missingLinesCount, 0);
  const totalFalsePositiveLines = results.reduce((acc, r) => acc + r.falsePositiveLinesCount, 0);

  const totalCorrectPrices = results.reduce((acc, r) => acc + r.correctPricesCount, 0);
  const totalWrongPrices = results.reduce((acc, r) => acc + r.wrongPricesCount, 0);
  const totalAbsentPrices = results.reduce((acc, r) => acc + r.absentPricesCount, 0);

  const totalCorrectQuantities = results.reduce((acc, r) => acc + r.correctQuantitiesCount, 0);
  const totalWrongQuantities = results.reduce((acc, r) => acc + r.wrongQuantitiesCount, 0);
  const totalAbsentQuantities = results.reduce((acc, r) => acc + r.absentQuantitiesCount, 0);

  const totalMultiViewOrSegmentDuplicates = results.reduce((acc, r) => acc + r.duplicateLinesCount, 0);
  const totalFiscalOrPosAsProduct = results.reduce((acc, r) => acc + r.fiscalOrPosAsProductCount, 0);

  const averageDurationPerDocMs = totalDocuments > 0 ? Math.round(totalDurationMs / totalDocuments) : 0;

  const summary: Rc05hBenchmarkSummary = {
    totalDocuments,
    totalImages,
    successfullyProcessed,
    technicalFailures,
    categoryMatches,
    merchantMatches,
    totalMatches,
    dateMatches,
    timeMatches,
    paymentMethodMatches,
    lineCountMatches,
    totalExpectedLines,
    totalDetectedLines,
    totalMatchedLines,
    totalMissingLines,
    totalFalsePositiveLines,
    totalCorrectPrices,
    totalWrongPrices,
    totalAbsentPrices,
    totalCorrectQuantities,
    totalWrongQuantities,
    totalAbsentQuantities,
    totalMultiViewOrSegmentDuplicates,
    totalFiscalOrPosAsProduct,
    totalDurationMs,
    averageDurationPerDocMs,
  };

  return { results, summary };
}
