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
} from './types';
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
import { productClassificationService } from '../productClassification/ProductClassificationService';
import { DocumentCategory } from '../../types';

class ReceiptParserService {
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

    const context: ReceiptParserContext = {
      rawText: normResult.originalText,
      normalizedText: normResult.normalizedText,
      lines: normResult.lines,
      normalizedLines: normResult.normalizedLines,
      overallOcrConfidence: options?.overallOcrConfidence ?? 85,
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

      return this.createEmptyDraft(context.overallOcrConfidence, [
        {
          code: 'EMPTY_TEXT',
          message: 'Il testo fornito è vuoto',
          severity: 'high',
        },
      ]);
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

    context.metadata = {
      ...context.metadata,
      shadowV2: shadowV2Result,
      shadowComparison,
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
    };

    // 3. Esecuzione del modulo di validazione coerenza
    const validation = ReceiptConsistencyValidator.validate(initialDraft);
    initialDraft.warnings = validation.warnings;
    initialDraft.overallConfidence = validation.adjustedConfidence;

    return initialDraft;
  }

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

      // Cerchiamo una corrispondenza in V2 (prima per similarità su descrizione, poi per indice/prezzo)
      let bestV2Idx = -1;
      let bestScore = 0;

      for (let j = 0; j < v2Lines.length; j++) {
        if (matchedV2Indices.has(j)) continue;
        const v2 = v2Lines[j];
        const normV2Desc = v2.normalizedDescription.toUpperCase().replace(/\s+/g, ' ').trim();

        // Matching esatto o inclusione
        if (normV1Desc === normV2Desc) {
          bestV2Idx = j;
          bestScore = 1.0;
          break;
        }

        // Calcolo overlap token
        const v1Words = normV1Desc.split(' ').filter((w) => w.length > 2);
        const v2Words = normV2Desc.split(' ').filter((w) => w.length > 2);
        const commonWords = v1Words.filter((w) => v2Words.includes(w));
        const overlapScore = v1Words.length > 0 ? commonWords.length / Math.max(v1Words.length, v2Words.length) : 0;

        if (overlapScore > 0.4 && overlapScore > bestScore) {
          bestScore = overlapScore;
          bestV2Idx = j;
        }
      }

      // Fallback matching posizionale se prezzi identici
      if (bestV2Idx === -1 && i < v2Lines.length && !matchedV2Indices.has(i)) {
        const v2Candidate = v2Lines[i];
        if (Math.abs(v1.lineTotal - v2Candidate.lineTotal) < 0.01) {
          bestV2Idx = i;
          bestScore = 0.5;
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

  private createEmptyDraft(confidence: number, warnings: ParserWarning[]): ParsedReceiptDraft {
    const emptyField = <T>(): ParsedField<T> => ({ value: null, confidence: 0 });
    return {
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
