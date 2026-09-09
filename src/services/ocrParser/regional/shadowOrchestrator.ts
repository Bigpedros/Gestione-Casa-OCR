/**
 * RC-05F: SECOND-PASS REGIONAL OCR — SHADOW ORCHESTRATOR
 *
 * Orchestratore puro in-memory per coordinare il secondo passaggio
 * regionale in modalità shadow non-invasiva.
 *
 * - Zero modifiche ai dati ufficiali
 * - Zero mutazioni a database / Dexie
 * - Isolamento totale degli errori (failure-safe)
 * - Riutilizzo sequenziale del Worker Tesseract esistente
 */

import type { Worker } from 'tesseract.js';
import {
  RegionalOcrEvidence,
  RegionalTriggerReason,
  RegionalBodyEvidence,
  RegionalFooterEvidence,
  RegionalAlignmentProposal,
  RegionalMonetaryToken,
} from './types';
import { resolveRelativeCropBox, SHADOW_REFERENCE_POLICY } from './geometry';
import { extractRegionalMonetaryTokens } from './monetaryTokenParser';
import { generateShadowAlignmentProposals } from './shadowAlignment';
import { shouldRunRegionalSecondPass } from './triggerPolicy';
import { regionalEvidenceStore } from './regionalEvidenceStore';
import {
  executeRegionalCropRecognition,
  WorkerParameterConfig,
  PRODUCTION_TESSERACT_PARAMETERS,
} from './regionalWorkerHelper';
import { receiptParserService } from '../receiptParserService';
import { TextNormalizationModule } from '../modules/TextNormalizationModule';
import { ReceiptZoneSegmenter } from '../modules/ReceiptZoneSegmenter';
import { LineItemParserV2 } from '../modules/LineItemParserV2';

export type RegionalSkipReason =
  | 'shadow_mode_disabled'
  | 'multi_source_document_skipped'
  | 'ineligible_document_category'
  | 'trigger_not_activated'
  | 'image_source_unavailable';

export interface RegionalDiagnosticLog {
  shadowEnabled: boolean;
  documentCategory: string;
  triggerActivated: boolean;
  triggerReason: RegionalTriggerReason;
  skipReason?: RegionalSkipReason;
  regionsAttempted: readonly ('body' | 'footer')[];
  pricesExtractedCount: number;
  mergeSuccessCount: number;
  totalRecovered: number | null;
  durationMs: number;
  failureReason?: string;
}

export interface RunRegionalShadowOptions {
  worker: Pick<Worker, 'setParameters' | 'recognize'> | null;
  imageSource: string | null;
  combinedRawText: string;
  overallConfidence: number;
  shadowEnabled?: boolean;
  imageDimensions?: { width: number; height: number };
  variantUsed?: string;
  sourceCount?: number;
  restoreParameters?: WorkerParameterConfig;
}

export interface RunRegionalShadowResult {
  evidence: RegionalOcrEvidence | null;
  diagnostic: RegionalDiagnosticLog;
}

/**
 * Risolve il triggerReason formale RC-05E a partire dalle regioni e dalla policy.
 */
export function resolveRegionalTriggerReason(
  targetRegions: readonly ('body' | 'footer')[],
  policyReason?: string
): RegionalTriggerReason {
  if (policyReason === 'math_discrepancy') {
    return 'math_discrepancy';
  }
  if (targetRegions.includes('footer') && !targetRegions.includes('body')) {
    return 'missing_total';
  }
  if (targetRegions.includes('body') && !targetRegions.includes('footer')) {
    return 'low_price_density';
  }
  if (targetRegions.includes('body') && targetRegions.includes('footer')) {
    return 'missing_total';
  }
  return null;
}

/**
 * Ottiene le dimensioni dell'immagine in pixel in modo resiliente e safe.
 */
export async function getImageDimensions(
  imageSource: string
): Promise<{ width: number; height: number }> {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof Image === 'undefined'
  ) {
    return { width: 1000, height: 2000 };
  }

  return new Promise<{ width: number; height: number }>((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ width: 1000, height: 2000 });
        }
      }, 500);

      img.onload = () => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve({
            width: img.naturalWidth || img.width || 1000,
            height: img.naturalHeight || img.height || 2000,
          });
        }
      };

      img.onerror = () => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve({ width: 1000, height: 2000 });
        }
      };

      img.src = imageSource;
    } catch {
      resolve({ width: 1000, height: 2000 });
    }
  });
}

/**
 * Formatta il log diagnostico deterministico con prefisso [OCRService:SecondPass]
 */
export function formatRegionalDiagnosticLog(diag: RegionalDiagnosticLog): string {
  const parts = [
    `[OCRService:SecondPass]`,
    `shadowEnabled=${diag.shadowEnabled}`,
    `documentCategory=${diag.documentCategory}`,
    `triggerActivated=${diag.triggerActivated}`,
    `triggerReason=${diag.triggerReason !== null ? diag.triggerReason : 'null'}`,
  ];
  if (diag.skipReason) {
    parts.push(`skipReason=${diag.skipReason}`);
  }
  parts.push(
    `regionsAttempted=${JSON.stringify(diag.regionsAttempted)}`,
    `pricesExtractedCount=${diag.pricesExtractedCount}`,
    `mergeSuccessCount=${diag.mergeSuccessCount}`,
    `totalRecovered=${diag.totalRecovered !== null ? diag.totalRecovered : 'null'}`,
    `durationMs=${diag.durationMs}`
  );
  if (diag.failureReason) {
    parts.push(`failureReason=${diag.failureReason}`);
  }
  return parts.join(' ');
}

/**
 * Esegue il flusso shadow del Second-Pass Regional OCR con isolamento totale.
 */
export async function runRegionalSecondPassShadow(
  options: RunRegionalShadowOptions
): Promise<RunRegionalShadowResult> {
  const {
    worker,
    imageSource,
    combinedRawText,
    overallConfidence,
    shadowEnabled = true,
    imageDimensions,
    variantUsed = 'default',
    sourceCount,
    restoreParameters,
  } = options;

  const startTime = Date.now();

  // 1. Verifica Kill Switch
  if (!shadowEnabled) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: false,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'shadow_mode_disabled',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: 0,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 1.5. Verifica coerenza mono-sorgente (Multi-Source Safety RC-05F-R1)
  if ((sourceCount ?? 1) > 1) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'multi_source_document_skipped',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 1.6. Verifica presenza sorgente immagine (prerequisito nominale)
  if (!imageSource) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'image_source_unavailable',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 2. Esecuzione First-Pass Parsing (in-memory puro)
  let firstParseDraft;
  try {
    firstParseDraft = receiptParserService.parseText(combinedRawText, {
      overallOcrConfidence: overallConfidence,
    });
  } catch (parseErr) {
    const failureReason = parseErr instanceof Error ? parseErr.message : String(parseErr);
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory: 'UNKNOWN',
      triggerActivated: false,
      triggerReason: null,
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
      failureReason,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  const documentCategory = firstParseDraft.documentCategory;

  // 3. Verifica eleggibilità documento (solo COMMERCIAL_RECEIPT)
  if (documentCategory !== 'COMMERCIAL_RECEIPT') {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'ineligible_document_category',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 4. Valutazione trigger decision deterministica
  const trigger = shouldRunRegionalSecondPass(firstParseDraft);
  if (!trigger.shouldRun) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: false,
      triggerReason: null,
      skipReason: 'trigger_not_activated',
      regionsAttempted: [],
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  const resolvedTriggerReason = resolveRegionalTriggerReason(trigger.targetRegions, trigger.reason);

  // 5. Verifica disponibilità worker
  if (!worker) {
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: true,
      triggerReason: resolvedTriggerReason,
      regionsAttempted: trigger.targetRegions,
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
      failureReason: 'worker_not_available',
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }

  // 6. Esecuzione mirata dei crop regionali con isolamento errori
  try {
    const dims = imageDimensions || (await getImageDimensions(imageSource));
    const imageWidth = dims.width;
    const imageHeight = dims.height;

    let bodyEvidence: RegionalBodyEvidence | undefined;
    let footerEvidence: RegionalFooterEvidence | undefined;
    let proposals: readonly RegionalAlignmentProposal[] | undefined;
    let pricesExtractedCount = 0;
    let mergeSuccessCount = 0;
    let totalRecovered: number | null = null;

    // A. FOOTER CROP (se richiesto dal trigger)
    if (trigger.targetRegions.includes('footer')) {
      const footerPixelBox = resolveRelativeCropBox(
        imageWidth,
        imageHeight,
        SHADOW_REFERENCE_POLICY.footerBox
      );

      const footerOcrRes = await executeRegionalCropRecognition(
        worker,
        imageSource,
        footerPixelBox,
        restoreParameters ?? PRODUCTION_TESSERACT_PARAMETERS
      );

      const footerTokens = extractRegionalMonetaryTokens(footerOcrRes.text);
      const exactFooterTokens = footerTokens.filter((t) => t.classification === 'exact_monetary');
      pricesExtractedCount += exactFooterTokens.length;

      const footerCandidate = findHighConfidenceFooterTotalCandidate(
        footerOcrRes.text,
        footerTokens
      );

      if (footerCandidate !== null) {
        totalRecovered = footerCandidate.parsedValue;
      }

      // Riconoscimento payment method nel footer se presente
      let paymentCandidate: { rawText: string; method: string; confidence: number } | null = null;
      const paymentMatch = footerOcrRes.text.match(
        /\b(CARTA|BANCOMAT|CONTANTI|MASTERCARD|VISA|PAGOBANCOMAT)\b/i
      );
      if (paymentMatch) {
        paymentCandidate = {
          rawText: paymentMatch[0],
          method: paymentMatch[0].toLowerCase(),
          confidence: Math.round(footerOcrRes.confidence || 75),
        };
      }

      footerEvidence = {
        executed: true,
        variantUsed,
        totalCandidate:
          footerCandidate !== null
            ? {
                rawText: footerCandidate.rawText,
                parsedValue: footerCandidate.parsedValue,
                confidence: footerCandidate.confidence,
              }
            : null,
        paymentMethodCandidate: paymentCandidate,
        cropBox: SHADOW_REFERENCE_POLICY.footerBox,
        rawText: footerOcrRes.text,
      };
    }

    // B. BODY CROP (se richiesto dal trigger o se il footer non ha recuperato un totale mancante)
    const shouldAttemptBodyCrop =
      trigger.targetRegions.includes('body') ||
      (totalRecovered === null &&
        (firstParseDraft.total.value === null || firstParseDraft.total.value <= 0));

    if (shouldAttemptBodyCrop) {
      const bodyPixelBox = resolveRelativeCropBox(
        imageWidth,
        imageHeight,
        SHADOW_REFERENCE_POLICY.bodyBox
      );

      const bodyOcrRes = await executeRegionalCropRecognition(
        worker,
        imageSource,
        bodyPixelBox,
        restoreParameters ?? PRODUCTION_TESSERACT_PARAMETERS
      );

      const bodyTokens = extractRegionalMonetaryTokens(bodyOcrRes.text, {
        knownTotalValue: totalRecovered ?? firstParseDraft.total.value ?? undefined,
      });

      const exactBodyTokens = bodyTokens.filter(
        (t) => t.classification === 'exact_monetary' && t.reason !== 'matches_known_total'
      );
      pricesExtractedCount += exactBodyTokens.length;

      // Se il totale non è stato recuperato dal footer, cerchiamo un candidato ad alta confidenza nei token regionali
      if (totalRecovered === null && bodyTokens.length > 0) {
        const bodyCandidate = findHighConfidenceBodyTotalCandidate(bodyTokens, firstParseDraft);
        if (bodyCandidate !== null) {
          totalRecovered = bodyCandidate.parsedValue;
          pricesExtractedCount += 1;
        }
      }

      // Segmentazione body V2 per generare le proposte shadow di allineamento
      const structuredNorm = TextNormalizationModule.normalizeToStructuredOcrText(combinedRawText);
      const zones = ReceiptZoneSegmenter.segment(structuredNorm);
      const v2Result = LineItemParserV2.parseBody(zones.body);

      const alignmentProposals = generateShadowAlignmentProposals(v2Result.items, bodyTokens);
      proposals = alignmentProposals;
      mergeSuccessCount = alignmentProposals.filter((p) => p.status === 'PROPOSED').length;

      bodyEvidence = {
        executed: true,
        variantUsed,
        tokens: bodyTokens,
        confidence: bodyOcrRes.confidence,
        cropBox: SHADOW_REFERENCE_POLICY.bodyBox,
        rawText: bodyOcrRes.text,
      };
    }

    const evidence: RegionalOcrEvidence = {
      executed: true,
      triggerReason: resolvedTriggerReason,
      bodyEvidence,
      footerEvidence,
      proposals,
      totalRecovered,
      durationMs: Date.now() - startTime,
    };

    // Registra l'evidenza nello store transitorio per la riconciliazione controllata
    regionalEvidenceStore.set(evidence);

    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: true,
      triggerReason: resolvedTriggerReason,
      regionsAttempted: trigger.targetRegions,
      pricesExtractedCount,
      mergeSuccessCount,
      totalRecovered,
      durationMs: Date.now() - startTime,
    };

    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence, diagnostic };
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    const diagnostic: RegionalDiagnosticLog = {
      shadowEnabled: true,
      documentCategory,
      triggerActivated: true,
      triggerReason: resolvedTriggerReason,
      regionsAttempted: trigger.targetRegions,
      pricesExtractedCount: 0,
      mergeSuccessCount: 0,
      totalRecovered: null,
      durationMs: Date.now() - startTime,
      failureReason,
    };
    console.warn(formatRegionalDiagnosticLog(diagnostic));
    return { evidence: null, diagnostic };
  }
}

/**
 * RC-05H-B-R1: High-confidence extraction of total candidate from regional footer OCR.
 *
 * Safety Principles:
 * 1. Explicit fiscal provenance: candidate must appear on a line with total keywords
 *    (TOTALE, COMPLESSIVO, IMPORTO DOVUTO, TOTAL).
 * 2. Tender / change exclusion: lines with only RESTO, CONTANTI, CARTA, BANCOMAT, PAGAMENTO
 *    are payment amounts, not fiscal total.
 * 3. Identifiers & counts exclusion: lines with NUMERO ARTICOLI, PEZZI, PZ, RT, DOC N., etc.
 *    are strictly excluded.
 */
export function findHighConfidenceFooterTotalCandidate(
  footerRawText: string,
  footerTokens: readonly RegionalMonetaryToken[]
): { rawText: string; parsedValue: number; confidence: number } | null {
  const exactTokens = footerTokens.filter(
    (t) => t.classification === 'exact_monetary' && t.parsedValue !== null && t.parsedValue > 0
  );
  if (exactTokens.length === 0) return null;

  const lines = footerRawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (let i = exactTokens.length - 1; i >= 0; i--) {
    const token = exactTokens[i];
    const val = token.parsedValue!;

    // Trova la riga corrispondente al token
    const matchingLine = lines.find((l) => {
      const normalized = l.replace(/\s+/g, ' ');
      return normalized.includes(token.rawToken) || l.includes(val.toFixed(2).replace('.', ','));
    });

    if (matchingLine) {
      const upperLine = matchingLine.toUpperCase();

      // Esclusione 1: Righe di conteggio articoli (es. NUMERO ARTICOLI: 9)
      if (
        /\b(?:NUMERO|ARTICOLI|PEZZI|PZ|N\.\s*ARTICOLI)\b/i.test(upperLine) &&
        !/\b(?:TOTALE|COMPLESSIVO)\b/i.test(upperLine)
      ) {
        continue;
      }

      // Esclusione 2: Righe di matricola, RT, documento, data/ora, terminale POS
      if (
        /\b(?:RT|MATRICOLA|DOC(?:UMENTO)?\s*N|CASSIER|OPERATORE|STAN|TID|AUTH|TRANSAZIONE)\b/i.test(
          upperLine
        )
      ) {
        continue;
      }

      // Esclusione 3: Righe di solo tender / resto / pagamento non-totale
      if (
        /\b(?:RESTO|CHANGE)\b/i.test(upperLine) &&
        !/\b(?:TOTALE|COMPLESSIVO)\b/i.test(upperLine)
      ) {
        continue;
      }

      // Inclusione: Riga con parola chiave di totale
      const hasTotalKeyword = /\b(?:TOTALE|COMPLESSIVO|TOT\.?|IMPORTO\s+DOVUTO|TOTAL)\b/i.test(
        upperLine
      );
      if (hasTotalKeyword) {
        return {
          rawText: token.rawToken,
          parsedValue: val,
          confidence: 90,
        };
      }
    }
  }

  return null;
}

/**
 * RC-05H-B: High-confidence extraction of total candidate from regional body tokens.
 *
 * Employs strictly general mathematical and fiscal structure principles:
 * 1. Line Sum Identity: Regional token matches the sum of parsed receipt line items (min 2 items).
 * 2. Fiscal Duplication: Totale and Importo Pagato are printed as identical amounts
 *    at the end of the price list.
 *
 * NO merchant-specific hardcoding, NO Ground Truth awareness.
 */
export function findHighConfidenceBodyTotalCandidate(
  bodyTokens: readonly RegionalMonetaryToken[],
  firstParseDraft: any
): { rawText: string; parsedValue: number; confidence: number } | null {
  const exactTokens = bodyTokens.filter(
    (t) => t.classification === 'exact_monetary' && t.parsedValue !== null && t.parsedValue > 0
  );
  if (exactTokens.length === 0) return null;

  // 1. Math identity: match against line item sum from firstParseDraft (requires at least 2 valid lines)
  if (firstParseDraft.lines && Array.isArray(firstParseDraft.lines)) {
    const validLines = firstParseDraft.lines.filter(
      (l: any) => typeof l.lineTotal === 'number' && l.lineTotal > 0
    );
    if (validLines.length >= 2) {
      const sumLines =
        Math.round(validLines.reduce((s: number, l: any) => s + l.lineTotal, 0) * 100) / 100;
      if (sumLines > 0) {
        const match = exactTokens.find((t) => Math.abs(t.parsedValue! - sumLines) <= 0.05);
        if (match && match.parsedValue !== null) {
          return {
            rawText: match.rawToken,
            parsedValue: match.parsedValue,
            confidence: 95,
          };
        }
      }
    }
  }

  // 2. Fiscal Duplication: Totale & Importo Pagato are consecutive identical amounts
  // at the end of the price list (within the last 4 tokens)
  if (exactTokens.length >= 2) {
    for (let i = exactTokens.length - 1; i >= Math.max(1, exactTokens.length - 4); i--) {
      const current = exactTokens[i];
      const prev = exactTokens[i - 1];
      if (
        current.parsedValue !== null &&
        prev.parsedValue !== null &&
        current.parsedValue >= 0.5 &&
        Math.abs(current.parsedValue - prev.parsedValue) < 0.001
      ) {
        return {
          rawText: current.rawToken,
          parsedValue: current.parsedValue,
          confidence: 90,
        };
      }
    }
  }

  return null;
}

