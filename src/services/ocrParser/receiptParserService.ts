import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
} from '../../repositories';
import {
  ParsedReceiptDraft,
  ReceiptParserContext,
  ParserWarning,
  ParsedField,
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
import { OCRReceiptLine } from '../../types';
import { productClassificationService } from '../productClassification/ProductClassificationService';

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
    });

    // 3. Idempotenza: cancella le sole righe non confermate (reviewStatus === 'pending' | 'rejected')
    await ocrReceiptLineRepository.deleteUnconfirmedByOcrProcessId(ocrProcessId);

    // 4. Salva le nuove righe estratte in ocrReceiptLines
    if (draft.lines.length > 0) {
      const newLinesData: Array<Omit<OCRReceiptLine, 'id' | 'metadata'>> = draft.lines.map((l) => ({
        ocrProcessId,
        originalText: l.originalText,
        description: l.normalizedDescription,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        confidence: l.confidence,
        reviewStatus: l.reviewStatus,
        productId: null,
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

    const context: ReceiptParserContext = {
      rawText: normResult.originalText,
      normalizedText: normResult.normalizedText,
      lines: normResult.lines,
      normalizedLines: normResult.normalizedLines,
      overallOcrConfidence: options?.overallOcrConfidence ?? 85,
      documentType: options?.documentType,
      sourceMode: options?.sourceMode,
      processingMode: options?.processingMode,
      ocrProcessId: options?.ocrProcessId,
    };

    if (!normResult.normalizedText) {
      return this.createEmptyDraft(context.overallOcrConfidence, [
        {
          code: 'EMPTY_TEXT',
          message: 'Il testo fornito è vuoto',
          severity: 'high',
        },
      ]);
    }

    // 1. Esecuzione dei moduli di estrazione
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
      lines,
      warnings: [],
      overallConfidence: preliminaryConfidence,
    };

    // 3. Esecuzione del modulo di validazione coerenza
    const validation = ReceiptConsistencyValidator.validate(initialDraft);
    initialDraft.warnings = validation.warnings;
    initialDraft.overallConfidence = validation.adjustedConfidence;

    return initialDraft;
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
