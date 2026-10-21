import type { OcrPage, OcrToken } from '../vendor/motore-ocr-ai/contracts.js';
import { TesseractLocalProvider } from '../vendor/motore-ocr-ai/core/ocr/tesseractLocalProvider.js';
import { DualRecognizerOcrProvider, OcrsWasmRecognizerB } from '../vendor/motore-ocr-ai/core/ocr/recognizerB.js';
import { OcrPageOrchestrator } from '../vendor/motore-ocr-ai/core/ocr/orchestrator.js';
import { DECISION_ENGINE_VERSION } from '../vendor/motore-ocr-ai/core/pipeline/decisionEngine.js';
import { collectReceiptEvidence } from '../vendor/motore-ocr-ai/core/ocr/receiptFinalizer.js';
import type { OcrWordGeometry } from './ocrParser/types';

export const MOTORE_OCR_AI_SOURCE_COMMIT = '7e6738262d326099b7c73955207a371c09ee042f';

export interface MotoreOcrAiPageResult {
  text: string;
  confidence: number;
  words: OcrWordGeometry[];
  warnings: string[];
  diagnostics: string[];
  recognizer: string;
  quality: OcrPage['quality'] | null;
  geometryCorrection: OcrPage['geometryCorrection'] | null;
  photoScan: OcrPage['photoScan'] | null;
  variantEvidenceCount: number;
  decisionCount: number;
  changedDecisionCount: number;
  recognizerBUsed: boolean;
  recognizerBTokens: number;
  engineSourceCommit: string;
  decisionEngineVersion: string;
  decisionSummary?: any;
  primaryReader?: any;
  secondaryReader?: any;
  variantReader?: any;
  matchingDiagnostics?: any[];
  decisions?: any[];
  receiptItemBlocks?: any[];
}

let provider: DualRecognizerOcrProvider | null = null;

function getProvider(): DualRecognizerOcrProvider {
  if (provider) return provider;
  const primary = new TesseractLocalProvider({
    language: 'ita',
    segmentation: 'auto',
    dpi: 300,
    maxVariantDimension: 2400,
    performanceProfile: 'med',
  });
  const secondary = new OcrsWasmRecognizerB({
    moduleUrl: '/recognizer-b/ocrs_wasm.js',
    detectionModelUrl: '/models/text-detection.rten',
    recognitionModelUrl: '/models/text-recognition.rten',
    regionLimit: 8,
  });
  provider = new DualRecognizerOcrProvider(primary, secondary);
  return provider;
}

export async function recognizeReceiptPageWithMotoreOcrAi(
  source: string,
  pageNumber: number,
  rotationDegrees = 0,
  signal?: AbortSignal
): Promise<MotoreOcrAiPageResult> {
  const canvas = await dataUrlToCanvas(source, rotationDegrees);
  const engine = getProvider();
  const orchestrator = new OcrPageOrchestrator(engine);
  const session = await orchestrator.start(
    { pageNumber, width: canvas.width, height: canvas.height, image: canvas },
    signal
  );
  const rawPage = session.raw.page;
  const rawSnapshot = session.raw;

  const receiptEvidence = collectReceiptEvidence(session.stabilized.page, session.evidence.candidates);
  if (receiptEvidence.tokens.length) {
    orchestrator.addEvidence(
      session,
      'receipt-finalizer',
      receiptEvidence.tokens,
      'Gestione Casa receipt evidence collector'
    );
  }
  const stabilized = receiptEvidence.tokens.length
    ? orchestrator.stabilize(session)
    : session.stabilized;
  const page = stabilized.page;
  const tokenConfidence = averageConfidence(page.tokens);
  const confidence = Math.round(Math.max(0, Math.min(
    100,
    tokenConfidence || ((page.quality?.score ?? 0) * 100)
  )));
  const recognizerB = (rawPage.variantEvidence ?? []).filter((entry) =>
    entry.source.startsWith('recognizer-b:')
  );
  const recognizerBTokens = recognizerB.reduce((sum, entry) => sum + entry.tokens.length, 0);
  const changedDecisionCount = stabilized.decisions.filter((decision) => decision.changed).length;

  return {
    text: page.text,
    confidence,
    words: mapMotoreOcrTokensToWords(page.tokens),
    warnings: [...page.warnings],
    diagnostics: [
      `provider:${engine.id}`,
      `decisionEngineVersion:${DECISION_ENGINE_VERSION}`,
      `rawTokens:${rawSnapshot.tokens.length}`,
      `evidence:${stabilized.evidenceCount}`,
      `decisions:${stabilized.decisions.length}`,
      `changed:${changedDecisionCount}`,
      `recognizerB:${recognizerB.length ? 'used' : 'not-used'}`,
      `recognizerBTokens:${recognizerBTokens}`,
      `orchestratorInitialMs:${Math.round(session.diagnostics.initialMs)}`,
      `orchestratorStabilizationMs:${Math.round(session.diagnostics.stabilizationMs)}`,
      `receiptEvidenceTokens:${receiptEvidence.tokens.length}`,
      `receiptEvidenceObservations:${receiptEvidence.observations.length}`,
      `receiptItemBlocks:${receiptEvidence.itemBlocks.length}`,
    ],
    recognizer: engine.id,
    quality: page.quality ?? null,
    geometryCorrection: page.geometryCorrection ?? null,
    photoScan: page.photoScan ?? null,
    variantEvidenceCount: rawPage.variantEvidence?.length ?? 0,
    decisionCount: stabilized.decisions.length,
    changedDecisionCount,
    recognizerBUsed: recognizerB.length > 0,
    recognizerBTokens,
    engineSourceCommit: MOTORE_OCR_AI_SOURCE_COMMIT,
    decisionEngineVersion: DECISION_ENGINE_VERSION,
    decisionSummary: stabilized.decisionSummary,
    primaryReader: stabilized.primaryReaderInfo,
    secondaryReader: stabilized.secondaryReaderInfo,
    variantReader: stabilized.variantReaderInfo,
    matchingDiagnostics: stabilized.matchingDiagnostics,
    decisions: stabilized.decisions,
    receiptItemBlocks: receiptEvidence.itemBlocks,
  };
}

export function mapMotoreOcrTokensToWords(tokens: readonly OcrToken[]): OcrWordGeometry[] {
  return tokens.filter((token) => token.text.trim()).map((token) => ({
    text: token.text,
    confidence: Math.round(token.confidence ?? 0),
    bbox: {
      x0: token.box.x,
      y0: token.box.y,
      x1: token.box.x + token.box.width,
      y1: token.box.y + token.box.height,
    },
  }));
}

function averageConfidence(tokens: readonly OcrToken[]): number {
  const values = tokens.map((token) => token.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function dataUrlToCanvas(source: string, rotationDegrees: number): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('MOTORE_OCR_AI_BROWSER_CANVAS_UNAVAILABLE');
  }
  const image = await loadImage(source);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const rotation = ((Math.round(rotationDegrees / 90) * 90) % 360 + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('MOTORE_OCR_AI_CANVAS_CONTEXT_UNAVAILABLE');
  context.save();
  if (rotation === 90) {
    context.translate(canvas.width, 0); context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height); context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height); context.rotate(-Math.PI / 2);
  }
  context.drawImage(image, 0, 0);
  context.restore();
  return canvas;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('MOTORE_OCR_AI_IMAGE_DECODE_FAILED'));
    image.src = source;
  });
}
