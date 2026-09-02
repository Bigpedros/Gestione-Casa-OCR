import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
} from '../../repositories';
import {
  ParsedReceiptDraft,
  ReceiptParserContext,
  ParserWarning,
  ParsedField,
  ParsedReceiptLine,
  ShadowV2ComparisonResult,
  LineItemComparisonDifference,
  LineItemParseResultV2,
  ReceiptZones,
  ShadowPaymentEvidenceResult,
  PaymentEvidenceParseResult,
} from './types';
import type { OcrQualityEvaluation } from '../../utils/imagePreprocessing';
import { TextNormalizationModule } from './modules/TextNormalizationModule';
import { SupplierParser } from './modules/SupplierParser';
import { AddressParser } from './modules/AddressParser';
import { TaxIdentifierParser } from './modules/TaxIdentifierParser';
import { DateTimeParser } from './modules/DateTimeParser';
import { TotalParser } from './modules/TotalParser';
import { SubtotalParser } from './modules/SubtotalParser';
import { VatParser } from './modules/VatParser';
import { DiscountParser } from './modules/DiscountParser';
import { PaymentMethodParser } from './modules/PaymentMethodParser';
import { LineItemParser } from './modules/LineItemParser';
import { ReceiptConsistencyValidator } from './modules/ReceiptConsistencyValidator';
import { DocumentTypeClassifier } from './modules/DocumentTypeClassifier';
import { ReceiptZoneSegmenter } from './modules/ReceiptZoneSegmenter';
import { LineItemParserV2 } from './modules/LineItemParserV2';
import { PaymentEvidenceParser } from './modules/PaymentEvidenceParser';
import { productClassificationService } from '../productClassification/ProductClassificationService';
import { DocumentCategory } from '../../types';
import { evaluateReceiptOcrQuality } from '../../utils/imagePreprocessing';

export class ReceiptParserService {
  private supplierParser = new SupplierParser();
  private addressParser = new AddressParser();
  private taxIdentifierParser = new TaxIdentifierParser();
  private dateTimeParser = new DateTimeParser();
  private totalParser = new TotalParser();
  private subtotalParser = new SubtotalParser();
  private vatParser = new VatParser();
  private discountParser = new DiscountParser();
  private paymentMethodParser = new PaymentMethodParser();
  private lineItemParser = new LineItemParser();

  private lastShadowComparison: ShadowV2ComparisonResult | null = null;
  private lastShadowResult: LineItemParseResultV2 | null = null;
  private lastPaymentEvidenceShadow: ShadowPaymentEvidenceResult | null = null;
  private lastPaymentEvidenceShadowResult: PaymentEvidenceParseResult | null = null;

  /**
   * Restituisce l'ultimo risultato del confronto shadow V1 vs V2.
   */
  public getLastShadowComparison(): ShadowV2ComparisonResult | null {
    return this.lastShadowComparison;
  }

  /**
   * Restituisce l'ultimo risultato del parsing V2 in shadow mode.
   */
  public getLastShadowResult(): LineItemParseResultV2 | null {
    return this.lastShadowResult;
  }

  /**
   * Restituisce l'ultimo risultato del parsing PaymentEvidence in shadow mode (Fase P4-C1).
   */
  public getLastPaymentEvidenceShadow(): ShadowPaymentEvidenceResult | null {
    return this.lastPaymentEvidenceShadow;
  }

  /**
   * Restituisce l'ultimo risultato puro PaymentEvidenceParseResult in shadow mode.
   */
  public getLastPaymentEvidenceShadowResult(): PaymentEvidenceParseResult | null {
    return this.lastPaymentEvidenceShadowResult;
  }

  /**
   * Esegue il parsing del rawText associato a un OCRProcess salvato in Dexie.
   * Aggiorna OCRProcess e salva le righe preliminari in ocrReceiptLines in modo idempotente.
   */
  public async parse(ocrProcessId: string): Promise<ParsedReceiptDraft> {
    const ocrProcess = await ocrProcessRepository.getById(ocrProcessId);
    if (!ocrProcess) {
      throw new Error(`Processo OCR ${ocrProcessId} non trovato`);
    }

    const rawText = ocrProcess.rawText;

    if (!rawText || rawText.trim().length === 0) {
      await ocrProcessRepository.update(ocrProcessId, {
        status: 'failed',
        errorMessage: 'rawText assente o vuoto',
      });
      throw new Error('Impossibile eseguire il parsing: rawText assente o vuoto');
    }

    // 1. Esegue il parsing logico del testo
    const normResult = TextNormalizationModule.normalize(rawText);
    const draft = this.parseText(rawText, {
      overallOcrConfidence: ocrProcess.confidence || 85,
      ocrQualityScore: (ocrProcess.metadata as any)?.ocrQualityScore,
      ocrProcessId,
    });

    // 2. Aggiorna OCRProcess con i dati estratti (SENZA impostare confirmedByUser: true)
    await ocrProcessRepository.update(ocrProcessId, {
      detectedSupplier: draft.supplier.value,
      detectedDate: draft.date.value,
      detectedTotal: draft.total.value,
      confidence: draft.overallConfidence,
      status: 'completed',
      confirmedByUser: false,
      metadata: {
        ...ocrProcess.metadata,
        documentCategory: draft.documentCategory,
        detectedPaymentMethod: draft.paymentMethod?.value || null,
        normalizedLines: normResult.normalizedLines,
      } as any,
    });

    // 3. Idempotenza: cancella le sole righe non confermate (reviewStatus === 'pending' | 'rejected')
    await ocrReceiptLineRepository.deleteUnconfirmedByOcrProcessId(ocrProcessId);

    // 4. Salva le nuove righe estratte in ocrReceiptLines
    if (draft.lines.length > 0) {
      const newLinesData = draft.lines.map((l) => ({
        ocrProcessId,
        originalText: l.originalText,
        description: l.normalizedDescription,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        confidence: l.confidence,
        reviewStatus: l.reviewStatus,
        productId: null,
        metadata: {
          warnings: l.warnings || [],
          discountAmount: l.discount || 0,
          priceNotDetected: l.warnings?.includes('PRICE_NOT_DETECTED') || false,
        },
      }));

      await ocrReceiptLineRepository.bulkCreate(newLinesData);
    }

    // 5. Esegue la classificazione automatica e l'associazione dei prodotti
    await productClassificationService.classifyReceiptLines(ocrProcessId);

    return draft;
  }

  /**
   * Esegue il parsing puro a partire dal testo grezzo senza accedere al database.
   * Utile per test unitari e preview.
   */
  public parseText(
    rawText: string,
    options?: {
      overallOcrConfidence?: number;
      ocrQualityScore?: number;
      ocrQualityEvaluation?: OcrQualityEvaluation;
      documentType?: string;
      sourceMode?: string;
      processingMode?: string;
      ocrProcessId?: string;
    }
  ): ParsedReceiptDraft {
    const normResult = TextNormalizationModule.normalize(rawText);

    // 0. Classificazione semantica del tipo di documento (Fase P4-A)
    const classification = DocumentTypeClassifier.classify(normResult.originalText);
    const documentCategory = ((options?.documentType || classification.category) as DocumentCategory);

    const ocrConfidence = options?.overallOcrConfidence ?? 85;
    const ocrQualityEval =
      options?.ocrQualityEvaluation ?? evaluateReceiptOcrQuality(normResult.originalText, ocrConfidence);
    const ocrQualityScore = options?.ocrQualityScore ?? ocrQualityEval.overallScore;

    const context: ReceiptParserContext = {
      rawText: normResult.originalText,
      normalizedText: normResult.normalizedText,
      lines: normResult.lines,
      normalizedLines: normResult.normalizedLines,
      overallOcrConfidence: ocrConfidence,
      ocrQualityScore,
      ocrQualityEvaluation: ocrQualityEval,
      documentType: documentCategory,
      sourceMode: options?.sourceMode,
      processingMode: options?.processingMode,
      ocrProcessId: options?.ocrProcessId,
      metadata: {
        classification,
      },
    };

    if (!normResult.normalizedText) {
      this.lastShadowComparison = {
        executed: false,
        documentCategory,
        v1Count: 0,
        v2Count: 0,
        matchedCount: 0,
        lostInV2Count: 0,
        addedInV2Count: 0,
        v2NoiseCount: 0,
        differences: [],
      };
      this.lastShadowResult = null;
      this.lastPaymentEvidenceShadow = {
        executed: false,
        documentCategory,
        result: null,
      };
      this.lastPaymentEvidenceShadowResult = null;

      return this.createEmptyDraft(
        context.overallOcrConfidence,
        [
          {
            code: 'EMPTY_TEXT',
            message: 'Il testo fornito è vuoto',
            severity: 'high',
          },
        ],
        documentCategory
      );
    }

    // 1. Esecuzione dei moduli di estrazione legacy (V1 ufficiale)
    const supplier = this.supplierParser.parse(context);
    const address = this.addressParser.parse(context);
    const taxIdentifier = this.taxIdentifierParser.parse(context);
    const dateTime = this.dateTimeParser.parse(context);
    const total = this.totalParser.parse(context);
    const subtotal = this.subtotalParser.parse(context);
    const vat = this.vatParser.parse(context);
    const discounts = this.discountParser.parse(context);
    const paymentMethod = this.paymentMethodParser.parse(context);
    const lines = this.lineItemParser.parse(context);

    // =========================================================================
    // FASE P4-B2: SWITCH CONTROLLATO DEL PARSER RIGHE V2 PER COMMERCIAL_RECEIPT
    // - Per COMMERCIAL_RECEIPT: LineItemParserV2 (legacyLines) diventa l'output UFFICIALE.
    // - Per i documenti non commerciali (PAYMENT_PROOF, INVOICE_OR_BILL, UNKNOWN):
    //   LineItemParser V1 resta il motore invariato.
    // - LineItemParser V1 resta attivo per COMMERCIAL_RECEIPT come confronto
    //   diagnostico shadow e come FALLBACK ESCLUSIVAMENTE TECNICO in caso di
    //   eccezione runtime non recuperabile.
    // - Regola Ceccotti: differenze semantiche (0 righe in V2, righe ambigue,
    //   differenze di confidence) NON attivano il fallback a V1.
    // =========================================================================
    let officialLines: ParsedReceiptLine[] = lines;
    let shadowV2Result: LineItemParseResultV2 | null = null;
    let shadowComparison: ShadowV2ComparisonResult | null = null;
    let fallbackUsed = false;
    let fallbackReason: string | undefined = undefined;

    if (documentCategory === 'COMMERCIAL_RECEIPT') {
      try {
        const structuredNorm = TextNormalizationModule.normalizeToStructuredOcrText(normResult.originalText);
        const zones = ReceiptZoneSegmenter.segment(structuredNorm);
        shadowV2Result = LineItemParserV2.parseBody(zones.body);

        // V2 diventa l'output ufficiale per COMMERCIAL_RECEIPT
        officialLines = [...shadowV2Result.legacyLines];

        // Esegue il confronto diagnostico shadow tra V1 e V2
        shadowComparison = this.compareV1VsV2(lines, shadowV2Result, zones, documentCategory);
        shadowComparison.isV2Official = true;
        shadowComparison.fallbackUsed = false;
      } catch (technicalErr) {
        console.warn('[ReceiptParserService] Errore tecnico runtime in LineItemParserV2. Attivazione fallback di sicurezza V1:', technicalErr);
        fallbackUsed = true;
        fallbackReason = String(technicalErr);
        officialLines = lines; // Fallback tecnico di emergenza a V1

        shadowComparison = {
          executed: true,
          documentCategory,
          isV2Official: false,
          fallbackUsed: true,
          fallbackReason,
          v1Count: lines.length,
          v2Count: 0,
          matchedCount: 0,
          lostInV2Count: lines.length,
          addedInV2Count: 0,
          v2NoiseCount: 0,
          differences: [
            {
              type: 'SEMANTIC_DIFFERENCE',
              message: `Fallback tecnico V1 attivato per eccezione runtime in V2: ${fallbackReason}`,
            },
          ],
        };
      }
    } else if (documentCategory === 'PAYMENT_PROOF') {
      // Fase P4-D2-RC-01: Per PAYMENT_PROOF le righe articolo ufficiali sono sempre vuote ([])
      // per evitare che frammenti monetari o totali POS vengano trasformati in falsi articoli.
      officialLines = [];
      shadowComparison = {
        executed: false,
        documentCategory,
        isV2Official: false,
        fallbackUsed: false,
        v1Count: lines.length,
        v2Count: 0,
        matchedCount: 0,
        lostInV2Count: lines.length,
        addedInV2Count: 0,
        v2NoiseCount: 0,
        differences: [],
      };
    } else {
      // Documenti non commerciali: rimangono sul parser legacy V1
      officialLines = lines;
      shadowComparison = {
        executed: false,
        documentCategory,
        isV2Official: false,
        fallbackUsed: false,
        v1Count: lines.length,
        v2Count: 0,
        matchedCount: 0,
        lostInV2Count: lines.length,
        addedInV2Count: 0,
        v2NoiseCount: 0,
        differences: [],
      };
    }

    this.lastShadowComparison = shadowComparison;
    this.lastShadowResult = shadowV2Result;

    // =========================================================================
    // FASE P4-C2: INTEGRAZIONE UFFICIALE DEL PAYMENT EVIDENCE PARSER
    // - Esecuzione per documentCategory === 'PAYMENT_PROOF'.
    // - Per COMMERCIAL_RECEIPT, INVOICE_OR_BILL, UNKNOWN: NON viene eseguito
    //   e paymentEvidence è impostato a null.
    // - paymentEvidence diventa parte del risultato ufficiale ParsedReceiptDraft
    //   per i documenti PAYMENT_PROOF, senza creare righe sintetiche fittizie,
    //   senza persistenza contabile Dexie (demandata a P4-C3) e senza mappare
    //   artificialmente i campi.
    // - Se si verifica un'eccezione tecnica runtime, la pipeline prosegue senza
    //   crashare impostando paymentEvidence a null e registrando l'errore.
    // =========================================================================
    let shadowPaymentEvidence: ShadowPaymentEvidenceResult | null = null;
    let officialPaymentEvidence: PaymentEvidenceParseResult | null = null;

    if (documentCategory === 'PAYMENT_PROOF') {
      try {
        const structuredNorm = TextNormalizationModule.normalizeToStructuredOcrText(normResult.originalText);
        const peResult = PaymentEvidenceParser.parse(structuredNorm, classification);
        officialPaymentEvidence = peResult;
        shadowPaymentEvidence = {
          executed: true,
          documentCategory,
          result: peResult,
        };
      } catch (technicalErr) {
        console.warn('[ReceiptParserService] Errore tecnico runtime in PaymentEvidenceParser:', technicalErr);
        officialPaymentEvidence = null;
        shadowPaymentEvidence = {
          executed: true,
          documentCategory,
          result: null,
          error: String(technicalErr),
        };
      }
    } else {
      officialPaymentEvidence = null;
      shadowPaymentEvidence = {
        executed: false,
        documentCategory,
        result: null,
      };
    }

    this.lastPaymentEvidenceShadow = shadowPaymentEvidence;
    this.lastPaymentEvidenceShadowResult = shadowPaymentEvidence.result;

    // Sincronizzazione campi standard da PaymentEvidence per PAYMENT_PROOF
    if (documentCategory === 'PAYMENT_PROOF' && officialPaymentEvidence) {
      if (officialPaymentEvidence.merchantOrBeneficiary) {
        supplier.value = officialPaymentEvidence.merchantOrBeneficiary;
        supplier.confidence = Math.round((officialPaymentEvidence.fieldConfidence.merchantOrBeneficiary || 0.85) * 100);
        supplier.warnings = [];
      } else {
        supplier.value = null;
        supplier.confidence = 0;
        supplier.warnings = ['fornitore_non_identificato'];
      }
      const effectiveAmount = officialPaymentEvidence.totalCharged ?? officialPaymentEvidence.amount;
      if (effectiveAmount !== null && effectiveAmount > 0) {
        total.value = effectiveAmount;
        total.confidence = Math.round((officialPaymentEvidence.fieldConfidence.amount || 0.90) * 100);
        total.warnings = [];
      }
      if (officialPaymentEvidence.dateTime) {
        const dateStr = officialPaymentEvidence.dateTime.substring(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          dateTime.date.value = dateStr;
          dateTime.date.confidence = Math.round((officialPaymentEvidence.fieldConfidence.dateTime || 0.90) * 100);
          dateTime.date.warnings = [];
        }
        if (officialPaymentEvidence.dateTime.length > 10) {
          dateTime.time.value = officialPaymentEvidence.dateTime.substring(11, 16);
          dateTime.time.confidence = Math.round((officialPaymentEvidence.fieldConfidence.dateTime || 0.90) * 100);
        }
      }
      const officialPaymentMethod = officialPaymentEvidence.paymentMethodHint?.macroCategoryHint;
      if (officialPaymentMethod) {
        paymentMethod.value = officialPaymentMethod;
      }
    }

    context.metadata = {
      ...context.metadata,
      shadowV2: shadowV2Result,
      shadowComparison,
      shadowPaymentEvidence,
      isV2Official: documentCategory === 'COMMERCIAL_RECEIPT' && !fallbackUsed,
      fallbackUsed,
    };

    // 2. Calcolo confidenza preliminare
    const fieldConfidences = [
      supplier.confidence,
      dateTime.date.confidence,
      total.confidence,
      paymentMethod.confidence,
    ].filter((c) => c > 0);

    const avgFieldConfidence =
      fieldConfidences.length > 0
        ? Math.round(fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length)
        : 50;

    const preliminaryConfidence = Math.round((context.overallOcrConfidence + avgFieldConfidence) / 2);

    const initialDraft: ParsedReceiptDraft = {
      documentCategory,
      supplier,
      address,
      taxIdentifier,
      date: dateTime.date,
      time: dateTime.time,
      total,
      subtotal,
      vat,
      discounts,
      paymentMethod,
      lines: officialLines,
      warnings: fallbackUsed && fallbackReason ? [
        {
          code: 'V2_FALLBACK_ACTIVATED',
          message: `LineItemParserV2 ha generato un'eccezione tecnica runtime: ${fallbackReason}. Attivato fallback di emergenza V1.`,
          severity: 'medium',
        }
      ] : [],
      overallConfidence: preliminaryConfidence,
      paymentEvidence: officialPaymentEvidence,
    };

    // 3. Esecuzione del modulo di validazione coerenza e Safety Gate
    const validation = ReceiptConsistencyValidator.validate(initialDraft, context);
    initialDraft.warnings = validation.warnings;
    initialDraft.overallConfidence = validation.adjustedConfidence;
    initialDraft.requiresManualReview = validation.requiresManualReview;

    return initialDraft;
  }

  private static readonly SHADOW_TOKEN_MIN_LENGTH = 3;
  private static readonly SHADOW_DISTINCT_TOKEN_MIN_LENGTH = 5;
  private static readonly SHADOW_TOKEN_OVERLAP_THRESHOLD = 0.4;
  private static readonly SHADOW_GENERIC_STRUCTURAL_WORDS = new Set([
    'ARTICOLO',
    'PRODOTTO',
    'SCONTO',
    'PREZZO',
    'IMPORTO',
    'TOTALE',
    'SUBTOTALE',
    'EURO',
    'PEZZI',
    'PESO',
    'QUANTITA',
    'VALORE',
    'ALIQUOTA',
    'IVA',
    'PZ',
    'GR',
    'KG',
    'LT',
    'ML',
  ]);

  /**
   * Esegue il confronto non modificativo tra le righe estratte da V1 e quelle da V2.
   * Rispetta rigorosamente il Principio Ceccotti: nessuna correzione automatica o supposizione.
   */
  public compareV1VsV2(
    v1Lines: ParsedReceiptLine[],
    v2Result: LineItemParseResultV2,
    zones: ReceiptZones,
    documentCategory: DocumentCategory
  ): ShadowV2ComparisonResult {
    const v2Lines = v2Result.legacyLines;
    const v2Items = v2Result.items;
    const differences: LineItemComparisonDifference[] = [];

    const matchedV2Indices = new Set<number>();
    let matchedCount = 0;

    // 1. Confronto delle righe V1 contro le righe V2
    for (let i = 0; i < v1Lines.length; i++) {
      const v1 = v1Lines[i];
      const normV1Desc = v1.normalizedDescription.toUpperCase().replace(/\s+/g, ' ').trim();

      // Cerchiamo una corrispondenza semantica in V2
      let bestV2Idx = -1;
      let bestScore = 0;

      for (let j = 0; j < v2Lines.length; j++) {
        if (matchedV2Indices.has(j)) continue;
        const v2 = v2Lines[j];
        const normV2Desc = v2.normalizedDescription.toUpperCase().replace(/\s+/g, ' ').trim();

        // 1. Matching esatto tra descrizioni normalizzate
        if (normV1Desc === normV2Desc) {
          bestV2Idx = j;
          bestScore = 1.0;
          break;
        }

        // Tokenizzazione
        const v1Words = normV1Desc.split(' ').filter((w) => w.length >= ReceiptParserService.SHADOW_TOKEN_MIN_LENGTH);
        const v2Words = normV2Desc.split(' ').filter((w) => w.length >= ReceiptParserService.SHADOW_TOKEN_MIN_LENGTH);
        const commonWords = v1Words.filter((w) => v2Words.includes(w));

        // 2. Overlap lessicale significativo
        const maxTokens = Math.max(v1Words.length, v2Words.length);
        const overlapScore = maxTokens > 0 ? commonWords.length / maxTokens : 0;

        if (overlapScore > ReceiptParserService.SHADOW_TOKEN_OVERLAP_THRESHOLD && overlapScore > bestScore) {
          bestScore = overlapScore;
          bestV2Idx = j;
        }

        // 3. Caso distintivo a singolo token (es. "NUTELLA 9506 1’89 IBRIDO" vs "NUTELLA"):
        // Richiede:
        // - almeno una delle due descrizioni è composta da esattamente un solo token significativo
        // - token comune identico di lunghezza sufficiente (>= 5 caratteri)
        // - token non appartenente a dizionario di termini generici/strutturali
        // - entrambi i prezzi rilevati, non null, positivi e coincidenti al centesimo
        if (bestScore < 0.85 && Math.min(v1Words.length, v2Words.length) === 1 && commonWords.length >= 1) {
          const hasDistinctiveToken = commonWords.some(
            (token) =>
              token.length >= ReceiptParserService.SHADOW_DISTINCT_TOKEN_MIN_LENGTH &&
              !ReceiptParserService.SHADOW_GENERIC_STRUCTURAL_WORDS.has(token)
          );

          const hasValidPrices =
            v1.lineTotal !== null &&
            v2.lineTotal !== null &&
            v1.lineTotal > 0 &&
            v2.lineTotal > 0 &&
            Math.abs(v1.lineTotal - v2.lineTotal) < 0.01;

          if (hasDistinctiveToken && hasValidPrices && 0.85 > bestScore) {
            bestScore = 0.85;
            bestV2Idx = j;
          }
        }
      }

      if (bestV2Idx !== -1) {
        matchedV2Indices.add(bestV2Idx);
        matchedCount++;
        const v2 = v2Lines[bestV2Idx];
        const v2Item = v2Items[bestV2Idx];

        // Controllo differenze quantità
        if (Math.abs(v1.quantity - v2.quantity) > 0.001) {
          differences.push({
            v1Index: i,
            v2Index: bestV2Idx,
            type: 'QUANTITY_MISMATCH',
            v1Line: v1,
            v2Line: v2,
            v2Item,
            message: `Discrepanza quantità: V1=${v1.quantity} vs V2=${v2.quantity}`,
          });
        }

        // Controllo differenze prezzi unitari (se definiti)
        if (v1.unitPrice && v2.unitPrice && Math.abs(v1.unitPrice - v2.unitPrice) > 0.01) {
          differences.push({
            v1Index: i,
            v2Index: bestV2Idx,
            type: 'PRICE_MISMATCH',
            v1Line: v1,
            v2Line: v2,
            v2Item,
            message: `Discrepanza prezzo unitario: V1=${v1.unitPrice} vs V2=${v2.unitPrice}`,
          });
        }

        // Controllo differenze totale riga
        if (Math.abs(v1.lineTotal - v2.lineTotal) > 0.01) {
          differences.push({
            v1Index: i,
            v2Index: bestV2Idx,
            type: 'PRICE_MISMATCH',
            v1Line: v1,
            v2Line: v2,
            v2Item,
            message: `Discrepanza totale riga: V1=${v1.lineTotal} vs V2=${v2.lineTotal}`,
          });
        }

        // Controllo differenze descrittive
        if (v1.normalizedDescription.trim() !== v2.normalizedDescription.trim()) {
          differences.push({
            v1Index: i,
            v2Index: bestV2Idx,
            type: 'DESCRIPTION_MISMATCH',
            v1Line: v1,
            v2Line: v2,
            v2Item,
            message: `Differenza descrizione: V1="${v1.normalizedDescription}" vs V2="${v2.normalizedDescription}"`,
          });
        }
      } else {
        // Riga presente in V1 ma non individuata in V2
        differences.push({
          v1Index: i,
          type: 'LOST_IN_V2',
          v1Line: v1,
          message: `Riga V1 non individuata in V2: "${v1.normalizedDescription}" (${v1.lineTotal} €)`,
        });
      }
    }

    // 2. Righe aggiuntive in V2 non presenti in V1
    for (let j = 0; j < v2Lines.length; j++) {
      if (!matchedV2Indices.has(j)) {
        const v2 = v2Lines[j];
        const v2Item = v2Items[j];
        differences.push({
          v2Index: j,
          type: 'ADDED_IN_V2',
          v2Line: v2,
          v2Item,
          message: `Riga aggiuntiva in V2 non presente in V1: "${v2.normalizedDescription}" (${v2.lineTotal} €)`,
        });
      }
    }

    const lostInV2Count = v1Lines.length - matchedCount;
    const addedInV2Count = v2Lines.length - matchedCount;

    return {
      executed: true,
      documentCategory,
      v1Count: v1Lines.length,
      v2Count: v2Lines.length,
      matchedCount,
      lostInV2Count,
      addedInV2Count,
      v2NoiseCount: v2Result.unparsedNoiseLines.length,
      differences,
      v2Summary: v2Result.summary,
      zones: {
        headerCount: zones.header.length,
        bodyCount: zones.body.length,
        totalsFooterCount: zones.totalsFooter.length,
        trailingMetadataCount: zones.trailingMetadata.length,
        ambiguousCount: zones.ambiguous.length,
      },
    };
  }

  private createEmptyDraft(
    confidence: number,
    warnings: ParserWarning[],
    documentCategory: DocumentCategory
  ): ParsedReceiptDraft {
    const emptyField = <T>(): ParsedField<T> => ({ value: null, confidence: 0 });
    return {
      documentCategory,
      supplier: emptyField(),
      address: emptyField(),
      taxIdentifier: emptyField(),
      date: emptyField(),
      time: emptyField(),
      total: emptyField(),
      subtotal: emptyField(),
      vat: emptyField(),
      discounts: emptyField(),
      paymentMethod: emptyField(),
      lines: [],
      warnings,
      overallConfidence: confidence,
    };
  }
}

export const receiptParserService = new ReceiptParserService();
