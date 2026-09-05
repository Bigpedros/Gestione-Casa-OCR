import { receiptParserService } from '../../services/ocrParser/receiptParserService';
import {
  RealReceiptFixture,
  HarnessDocumentReport,
  HarnessBatchSummary,
  HarnessExecutionMode,
} from './types';
import { evaluateReceiptDraftAgainstGroundTruth } from './evaluator';

export interface RunBatchOptions {
  mode?: HarnessExecutionMode;
  onDocumentComplete?: (report: HarnessDocumentReport) => void;
}

/**
 * Esegue la MODE B: RAW FIXTURE
 * Invia il rawText congelato direttamente al parser ufficiale di Gestione Casa.
 */
export async function executeRawFixture(
  fixture: RealReceiptFixture
): Promise<HarnessDocumentReport> {
  const startTime = Date.now();

  if (!fixture.rawText) {
    return {
      documentId: fixture.id,
      label: fixture.label,
      mode: 'RAW_FIXTURE',
      status: 'SKIPPED',
      durationMs: 0,
      category: 'NONE',
      categoryConfidence: 0,
      expectedCategory: fixture.groundTruth.expectedDocumentCategory,
      categoryMatch: false,
      merchantRaw: '',
      merchantCandidate: '',
      merchantConfidence: 0,
      detectedLineCount: 0,
      linesWithPrice: 0,
      linesPriceNotDetected: 0,
      unfoundExpectedProducts: [],
      suspiciousLinesCount: 0,
      detectedTotal: null,
      itemsSumVsTotalDiff: null,
      detectedPaymentMethod: null,
      warnings: ['RAW_TEXT_MISSING: In attesa di acquisizione / congelamento OCR'],
      unparsedNoiseCount: 0,
      notes: fixture.layoutNotes || fixture.groundTruth.notes,
      failureReasons: [],
      partialReasons: ['Campione senza rawText: acquisizione OCR pendente'],
    };
  }

  // Esecuzione del parser ufficiale di Gestione Casa
  const draft = receiptParserService.parseText(fixture.rawText, {
    overallOcrConfidence: 85,
  });

  const durationMs = Date.now() - startTime;
  return evaluateReceiptDraftAgainstGroundTruth(fixture, draft, 'RAW_FIXTURE', durationMs);
}

/**
 * Esegue la MODE A: IMAGE E2E
 * Esegue Tesseract.js locale direttamente sull'immagine, produce il rawText,
 * e poi invoca il parser ufficiale di Gestione Casa.
 */
export async function executeImageE2E(
  fixture: RealReceiptFixture
): Promise<HarnessDocumentReport> {
  return {
    documentId: fixture.id,
    label: fixture.label,
    mode: 'IMAGE_E2E',
    status: 'SKIPPED',
    durationMs: 0,
    category: 'NONE',
    categoryConfidence: 0,
    expectedCategory: fixture.groundTruth.expectedDocumentCategory,
    categoryMatch: false,
    merchantRaw: '',
    merchantCandidate: '',
    merchantConfidence: 0,
    detectedLineCount: 0,
    linesWithPrice: 0,
    linesPriceNotDetected: 0,
    unfoundExpectedProducts: [],
    suspiciousLinesCount: 0,
    detectedTotal: null,
    itemsSumVsTotalDiff: null,
    detectedPaymentMethod: null,
    warnings: [
      'MODE_A_BLOCKED_UNSHARED_OCR_PIPELINE: Modalità IMAGE_E2E bloccata in R1 per prevenire duplicazione OCR non conforme alla pipeline ufficiale di ocrService.ts. Utilizzare MODE RAW_FIXTURE.',
    ],
    unparsedNoiseCount: 0,
    notes: fixture.layoutNotes || fixture.groundTruth.notes,
    failureReasons: [],
    partialReasons: ['MODE A bloccata: pipeline ottica non condivisa con ocrService.ts'],
  };
}

/**
 * Verifica se una fixture contiene almeno una sorgente immagine valida (singola o multipla).
 * Array vuoti o stringhe vuote NON vengono considerati sorgenti valide.
 */
export function hasImageSources(fixture: RealReceiptFixture): boolean {
  if (typeof fixture.imagePath === 'string' && fixture.imagePath.trim() !== '') {
    return true;
  }
  if (typeof fixture.imageDataUrl === 'string' && fixture.imageDataUrl.trim() !== '') {
    return true;
  }
  if (
    Array.isArray(fixture.imagePaths) &&
    fixture.imagePaths.length > 0 &&
    fixture.imagePaths.some((p) => typeof p === 'string' && p.trim() !== '')
  ) {
    return true;
  }
  if (
    Array.isArray(fixture.imageDataUrls) &&
    fixture.imageDataUrls.length > 0 &&
    fixture.imageDataUrls.some((u) => typeof u === 'string' && u.trim() !== '')
  ) {
    return true;
  }
  return false;
}

/**
 * Esegue un singolo fixture selezionando la modalità adeguata o preferita.
 * Riconosce come IMAGE_E2E una fixture se:
 * - La modalità richiesta è 'IMAGE_E2E' e la fixture contiene almeno una sorgente immagine (singola o multipla); OPPURE
 * - La fixture ha esclusivamente sorgenti immagini e nessun rawText presente.
 */
export async function executeFixture(
  fixture: RealReceiptFixture,
  preferredMode: HarnessExecutionMode = 'RAW_FIXTURE'
): Promise<HarnessDocumentReport> {
  const hasImages = hasImageSources(fixture);
  const hasRaw = typeof fixture.rawText === 'string' && fixture.rawText.trim() !== '';

  if (hasImages && (preferredMode === 'IMAGE_E2E' || !hasRaw)) {
    return executeImageE2E(fixture);
  }
  return executeRawFixture(fixture);
}

/**
 * Esegue un batch completo di fixture ed elabora il sommario statistico.
 */
export async function runBatch(
  fixtures: RealReceiptFixture[],
  options: RunBatchOptions = {}
): Promise<{ reports: HarnessDocumentReport[]; summary: HarnessBatchSummary }> {
  const preferredMode = options.mode || 'RAW_FIXTURE';
  const reports: HarnessDocumentReport[] = [];
  const batchStart = Date.now();

  for (const fixture of fixtures) {
    const report = await executeFixture(fixture, preferredMode);
    reports.push(report);
    if (options.onDocumentComplete) {
      options.onDocumentComplete(report);
    }
  }

  const totalDurationMs = Date.now() - batchStart;

  // Calcolo statistiche
  const totalDocuments = reports.length;
  const passCount = reports.filter((r) => r.status === 'PASS').length;
  const partialCount = reports.filter((r) => r.status === 'PARTIAL').length;
  const failCount = reports.filter((r) => r.status === 'FAIL').length;
  const skippedCount = reports.filter((r) => r.status === 'SKIPPED').length;

  const executedReports = reports.filter((r) => r.status !== 'SKIPPED');

  // Accuratezze (solo sui documenti con valore atteso specificato)
  const categoryEvaluated = executedReports.filter((r) => r.expectedCategory !== undefined);
  const categoryCorrect = categoryEvaluated.filter((r) => r.categoryMatch).length;
  const categoryAccuracyPct =
    categoryEvaluated.length > 0 ? Math.round((categoryCorrect / categoryEvaluated.length) * 100) : 100;

  const merchantEvaluated = executedReports.filter((r) => r.expectedMerchant !== undefined);
  const merchantCorrect = merchantEvaluated.filter((r) => r.merchantMatch).length;
  const merchantAccuracyPct =
    merchantEvaluated.length > 0 ? Math.round((merchantCorrect / merchantEvaluated.length) * 100) : 100;

  const totalEvaluated = executedReports.filter((r) => r.expectedTotal !== undefined);
  const totalCorrect = totalEvaluated.filter((r) => r.totalMatch).length;
  const totalAccuracyPct =
    totalEvaluated.length > 0 ? Math.round((totalCorrect / totalEvaluated.length) * 100) : 100;

  const lineCountEvaluated = executedReports.filter((r) => r.expectedLineCount !== undefined);
  const lineCountCorrect = lineCountEvaluated.filter((r) => r.lineCountMatch).length;
  const lineCountAccuracyPct =
    lineCountEvaluated.length > 0 ? Math.round((lineCountCorrect / lineCountEvaluated.length) * 100) : 100;

  const paymentEvaluated = executedReports.filter((r) => r.expectedPaymentMethod !== undefined);
  const paymentCorrect = paymentEvaluated.filter((r) => r.paymentMethodMatch).length;
  const paymentMethodAccuracyPct =
    paymentEvaluated.length > 0 ? Math.round((paymentCorrect / paymentEvaluated.length) * 100) : 100;

  const summary: HarnessBatchSummary = {
    totalDocuments,
    passCount,
    partialCount,
    failCount,
    skippedCount,

    categoryAccuracyPct,
    merchantAccuracyPct,
    totalAccuracyPct,
    lineCountAccuracyPct,
    paymentMethodAccuracyPct,

    totalDurationMs,
  };

  return { reports, summary };
}
