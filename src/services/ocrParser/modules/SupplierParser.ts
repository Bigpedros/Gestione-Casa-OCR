import { ReceiptParserContext, ParsedField, ReceiptParserModule } from '../types';
import {
  OCR_CONFIDENCE_MIN_RELIABLE,
  OCR_QUALITY_SCORE_MIN_RELIABLE,
  OCR_QUALITY_SCORE_CRITICAL_LOW,
  SUPPLIER_MIN_ALPHA_RATIO,
  SUPPLIER_MAX_NOISE_RATIO,
  SUPPLIER_MIN_LETTERS,
} from '../constants';
import { receiptKnowledgeBase } from '../knowledgeBase';

export class SupplierParser implements ReceiptParserModule<string> {
  public name = 'SupplierParser';

  private genericExclusions = [
    'DOCUMENTO COMMERCIALE',
    'DOCUMENTO',
    'COMMERCIALE',
    'DOCIMENTO',
    'SCONTRINO FISCALE',
    'SCONTRINO',
    'RICEVUTA FISCALE',
    'RICEVUTA',
    'FATTURA ELETTRONICA',
    'FATTURA N',
    'FATTURA NO',
    'FATTURA',
    'PRESTAZIONE',
    'VENDITA',
    'DI VENDITA',
    'DI VENDITA O PRESTAZIONE',
    'VENDITA O PRESTAZIONE',
    'DESCRIZIONE',
    'DESTZINE',
    'PREZZO',
    'IMPORTO',
    'PAGAMENTO ELETTRONICO',
    'PAGAMENTO',
    'ELETTRONICO',
    'CONTANTE',
    'RESTO',
    'TOTALE',
    'SUBTOTALE',
    'BENVENUTO',
    'BENVENUTI',
    'ARRIVEDERCI',
    'GRAZIE E ARRIVEDERCI',
    'GRAZIE E BUONA GIORNATA',
    'GRAZIE',
    'P.IVA',
    'PARTITA IVA',
    'CODICE FISCALE',
    'C.F.',
    'TEL.',
    'TELEFONO',
    'CASSA',
    'CASSIR',
    'OPERATORE',
    'TERMINALE',
    'AUTORIZZAZIONE',
    'TRANSAZIONE',
    'REGISTRATORE',
    'SPETT.LE',
    'CLIENTE',
    'MEMORIA CLIENTE',
    'COPIA CLIENTE',
    'COPIA ESERCENTE',
    'SCONTRINO ESERCENTE',
    'RICEVUTA CLIENTE',
    'RICEVUTA POS',
    'NEXI',
    'SEPA-FAST',
    'SEPA FAST',
    'SEPA',
    'PAGOBANCOMAT',
    'BANCOMAT',
    'DEBIT MASTERCARD',
    'CREDIT MASTERCARD',
    'MASTERCARD',
    'VISA DEBIT',
    'VISA ELECTRON',
    'VISA',
    'V-PAY',
    'MAESTRO',
    'AMERICAN EXPRESS',
    'AMEX',
    'SUMUP',
    'AXERVE',
    'INGENICO',
    'WORLDLINE',
    'PIN VERIFICATO',
    'PAGAMENTO APPROVATO',
    'TRANSAZIONE ESEGUITA',
    'C-LESS',
    'CONTACTLESS',
  ];

  /**
   * Normalizzazione generica OCR di caratteri confusi frequenti (0/O, 1/I, 5/S)
   */
  private normalizeOcrLetters(text: string): string {
    return text
      .toUpperCase()
      .replace(/\b0([A-Z]+)\b/g, 'O$1')
      .replace(/\b([A-Z]+)0\b/g, '$1O')
      .replace(/\b1([A-Z]+)\b/g, 'I$1')
      .replace(/\b([A-Z]+)1\b/g, '$1I');
  }

  public parse(context: ReceiptParserContext): ParsedField<string> {
    const lines = context.normalizedLines;
    if (!lines || lines.length === 0) {
      return {
        value: null,
        confidence: 0,
        warnings: ['nessun_testo_disponibile'],
      };
    }

    const qualityScore = context.ocrQualityScore ?? 50;
    const ocrConfidence = context.overallOcrConfidence ?? 80;
    const docCategory = context.metadata?.classification?.category || context.documentType;

    // Quality Gate: se il documento è UNKNOWN e la qualità OCR è critica, blocca l'estrazione fornitore
    if (docCategory === 'UNKNOWN' && qualityScore < OCR_QUALITY_SCORE_CRITICAL_LOW) {
      return {
        value: null,
        confidence: 0,
        warnings: ['qualita_ocr_insufficiente', 'fornitore_non_identificato'],
      };
    }

    const maxLines = Math.min(8, lines.length);
    const candidates: Array<{
      name: string;
      score: number;
      lineIndex: number;
      sourceText: string;
      isLowConfidence?: boolean;
    }> = [];

    for (let i = 0; i < maxLines; i++) {
      const line = lines[i];
      const upperLine = line.toUpperCase().trim();

      // Controlla se è una riga da escludere (Knowledge Base + genericExclusions)
      const isExcluded =
        receiptKnowledgeBase.isCommercialDocumentHeader(upperLine) ||
        receiptKnowledgeBase.isPaymentMarker(upperLine) ||
        receiptKnowledgeBase.isPaymentProofEvidence(upperLine) ||
        receiptKnowledgeBase.isTrailingMetadata(upperLine) ||
        this.genericExclusions.some((exc) => {
          if (exc.length <= 4) {
            const regex = new RegExp(`\\b${exc}\\b`, 'i');
            return regex.test(upperLine);
          }
          return upperLine.includes(exc);
        });
      if (isExcluded) continue;

      // Pulizia preliminare simboli rumorosi a inizio/fine
      let cleanName = line
        .replace(/^[*\-_\s‘'"`«“()[\]#~|\\<>:;=,!+%$?]+/, '')
        .replace(/[*\-_\s‘'"`«“()[\]#~|\\<>:;=!+%$?]+$/, '')
        .trim();

      if (cleanName.endsWith('.') && !/\b(?:S\.?R\.?L|S\.?P\.?A|S\.?N\.?C|S\.?A\.?S|COOP)\.$/i.test(cleanName)) {
        cleanName = cleanName.replace(/\.+$/, '').trim();
      }

      const lettersCount = (cleanName.match(/[A-Za-zÀ-ÿ]/g) || []).length;
      if (lettersCount < SUPPLIER_MIN_LETTERS) continue;

      const alphaRatio = lettersCount / cleanName.length;
      if (alphaRatio < SUPPLIER_MIN_ALPHA_RATIO) continue;

      const noiseCount = (cleanName.match(/[~|\\{}_^<>*+=$"“'‘`()[\]@!%]/g) || []).length;
      const noiseRatio = noiseCount / cleanName.length;
      if (noiseRatio > SUPPLIER_MAX_NOISE_RATIO) continue;

      const words = cleanName
        .split(/\s+/)
        .filter((w) => w.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2);
      if (words.length === 0) continue;

      let score = 50 - i * 5; // Base decrescente prudenziale

      // Punti per forme societarie
      const isCorporateForm = /\b(S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|SOC\.?\s*COOP\.?)\b/i.test(
        cleanName
      );
      if (isCorporateForm) {
        score += 30;
      }

      // Prossimità a P.IVA o indirizzo nelle righe adiacenti
      let hasAddressOrVatNearby = false;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/\b(?:P\.?\s*IVA|PARTITA\s*IVA|VIA|CORSO|PIAZZA|VIALE|TEL|DNA)\b/i.test(lines[j])) {
          score += 15;
          hasAddressOrVatNearby = true;
          break;
        }
      }

      // Bonus per parole complete e leggibili (>= 2 parole composte)
      if (words.length >= 2) {
        score += 10;
      }

      // Bonus insegna/brand primario in prima riga
      if (i === 0 && (lettersCount >= 3 || cleanName.length >= 4)) {
        score += 15;
      }

      // Normalizzazione OCR lettere conservativa del parser (preserva il valore estratto)
      const contextualName = this.normalizeOcrLetters(cleanName);

      // Supporto semantico / fuzzy Merchant Directory (NON sostituisce il parser, calibra la confidenza)
      const normalizedAliasesName = receiptKnowledgeBase.normalizeOcrAliases(cleanName);
      const merchantMatch = receiptKnowledgeBase.lookupMerchant(normalizedAliasesName);
      if (merchantMatch.matched && !merchantMatch.isAmbiguous && merchantMatch.similarity >= 0.85) {
        score += merchantMatch.confidenceAdjustment;
      }

      // Penalità se la qualità OCR o confidenza complessiva è degradata
      if (qualityScore < OCR_QUALITY_SCORE_MIN_RELIABLE) {
        score -= Math.min(20, Math.round((OCR_QUALITY_SCORE_MIN_RELIABLE - qualityScore) * 0.8));
      }
      if (ocrConfidence < OCR_CONFIDENCE_MIN_RELIABLE) {
        score -= Math.min(15, Math.round((OCR_CONFIDENCE_MIN_RELIABLE - ocrConfidence) * 0.4));
      }
      if (noiseRatio > 0.08) {
        score -= 10;
      }

      const isLowConf = (!isCorporateForm && !hasAddressOrVatNearby) || score < 45;

      candidates.push({
        name: contextualName,
        score,
        lineIndex: i,
        sourceText: line,
        isLowConfidence: isLowConf,
      });
    }

    if (candidates.length === 0) {
      return {
        value: null,
        confidence: 0,
        warnings: ['fornitore_non_identificato'],
      };
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Se il miglior candidato ha uno score insufficiente, non inventare il fornitore
    if (best.score < 25) {
      return {
        value: null,
        confidence: 0,
        warnings: ['fornitore_non_identificato'],
      };
    }

    const confidence = Math.min(85, Math.max(20, best.score));
    const alternatives = candidates.slice(1, 4).map((c) => c.name);

    const warnings: string[] = [];
    if (confidence < 60 || best.isLowConfidence) {
      warnings.push('fornitore_da_verificare');
    }

    return {
      value: best.name,
      confidence,
      lineIndex: best.lineIndex,
      sourceText: best.sourceText,
      alternatives,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
