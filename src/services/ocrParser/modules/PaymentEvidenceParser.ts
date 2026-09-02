import {
  PaymentMethod,
  MoneyAmount,
} from '../../../types';
import {
  NormalizedOcrText,
  DocumentTypeClassificationResult,
  PaymentEvidenceParseResult,
  PaymentEvidenceSubtype,
  PaymentEvidenceMethodHint,
  PaymentEvidenceCryptoDetails,
} from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

/**
 * =========================================================================
 * ESTENSIONE PAGAMENTI - BLOCCO P3: PAYMENT EVIDENCE PARSER
 * =========================================================================
 *
 * Modulo puro e isolato per l'estrazione di bozze strutturate di PaymentEvidence
 * a partire da documenti classificati come PAYMENT_PROOF (o testo OCR grezzo).
 *
 * Principi architetturali:
 * 1. Principio Ceccotti: MAI inventare dati. Campi non leggibili = null con warning.
 * 2. Scomposizione Importo: Distingue amount principale, fee (commissioni) e totalCharged.
 * 3. Protezione Dati Carta: PAN completi non vengono mai propagati nell'output (solo maskedPan).
 * 4. Anti-Hardcoding: Pattern matching semantico e strutturale indipendente da singoli brand.
 * 5. Isolamento totale: Nessuna dipendenza da Dexie, Expense o pipeline di produzione.
 */
export class PaymentEvidenceParser {
  public static readonly MODULE_NAME = 'PaymentEvidenceParser';

  /**
   * Esegue il parsing del documento OCR per estrarre la bozza di PaymentEvidence.
   */
  public static parse(
    input: NormalizedOcrText | string,
    classification?: DocumentTypeClassificationResult
  ): PaymentEvidenceParseResult {
    const ocrText: NormalizedOcrText =
      typeof input === 'string'
        ? TextNormalizationModule.normalizeToStructuredOcrText(input)
        : input;

    const normalizedText = ocrText.normalizedText || '';
    const lines = ocrText.lines || [];

    const evidences: string[] = [];
    const warnings: string[] = [];
    const unparsedRelevantLines: string[] = [];
    const fieldConfidence: Record<string, number> = {
      amount: 0,
      fee: 0,
      dateTime: 0,
      merchantOrBeneficiary: 0,
      transactionReference: 0,
    };

    // 0. Verifica input vuoto
    if (!normalizedText.trim() || lines.length === 0) {
      return {
        subtype: 'GENERIC_PAYMENT_PROOF',
        amount: null,
        fee: null,
        totalCharged: null,
        dateTime: null,
        merchantOrBeneficiary: null,
        transactionReference: null,
        paymentMethodHint: {},
        paymentChannelHint: null,
        confidence: 0,
        fieldConfidence,
        evidences: [],
        warnings: ['DOCUMENT_EMPTY_OR_UNREADABLE', 'AMOUNT_NOT_DETECTED', 'DATE_NOT_DETECTED'],
        unparsedRelevantLines: [],
      };
    }

    // 1. Determinazione del Subtype di pagamento
    const subtype = this.detectSubtype(ocrText, classification);
    evidences.push(`SUBTYPE_IDENTIFIED:${subtype}`);

    // 2. Estrazione Importo, Commissione e Totale addebitato
    const amountResult = this.extractAmounts(ocrText, subtype);
    if (amountResult.amount !== null) {
      fieldConfidence.amount = amountResult.amountConfidence;
      evidences.push(`AMOUNT_EXTRACTED:${amountResult.amount}`);
    } else {
      warnings.push(amountResult.amountWarning || 'AMOUNT_NOT_DETECTED');
    }

    if (amountResult.fee !== null) {
      fieldConfidence.fee = amountResult.feeConfidence;
      evidences.push(`FEE_EXTRACTED:${amountResult.fee}`);
    }

    if (amountResult.warnings.length > 0) {
      warnings.push(...amountResult.warnings);
    }

    // 3. Estrazione Data e Ora
    const dateResult = this.extractDateTime(ocrText);
    if (dateResult.dateTime !== null) {
      fieldConfidence.dateTime = dateResult.confidence;
      evidences.push(`DATETIME_EXTRACTED:${dateResult.dateTime}`);
    } else {
      warnings.push('DATE_NOT_DETECTED');
    }

    // 4. Estrazione Esercente / Beneficiario
    const beneficiaryResult = this.extractMerchantOrBeneficiary(ocrText, subtype);
    if (beneficiaryResult.beneficiary !== null) {
      fieldConfidence.merchantOrBeneficiary = beneficiaryResult.confidence;
      evidences.push(`BENEFICIARY_EXTRACTED:${beneficiaryResult.beneficiary}`);
    } else {
      warnings.push('BENEFICIARY_NOT_DETECTED');
    }

    // 5. Estrazione Riferimento Transazione (IUV, TRN, CRO, STAN, TxID, ecc.)
    const referenceResult = this.extractTransactionReference(ocrText, subtype);
    if (referenceResult.reference !== null) {
      fieldConfidence.transactionReference = referenceResult.confidence;
      evidences.push(`REFERENCE_EXTRACTED:${referenceResult.referenceType}:${referenceResult.reference}`);
    } else {
      warnings.push('REFERENCE_NOT_DETECTED');
    }

    // 6. Estrazione Metodo di Pagamento Hint, Circuito e PAN Mascherato
    const methodHintResult = this.extractMethodHint(ocrText, subtype);

    // 7. Canale di pagamento
    const channelHint = this.determineChannelHint(subtype, ocrText);

    // 8. Dettagli specifici Crypto (se applicabile)
    let cryptoDetails: PaymentEvidenceCryptoDetails | undefined;
    if (subtype === 'CRYPTO_PAYMENT') {
      cryptoDetails = this.extractCryptoDetails(ocrText, amountResult.fee);
      if (cryptoDetails.cryptoAmount) {
        evidences.push(`CRYPTO_AMOUNT:${cryptoDetails.cryptoAmount} ${cryptoDetails.cryptoAsset || ''}`);
      }
      if (cryptoDetails.txHash) {
        evidences.push(`CRYPTO_TXHASH:${cryptoDetails.txHash}`);
      }
    }

    // 9. Raccolta righe accessorie rilevanti non mappate direttamente (es. IBAN, causale, ecc.)
    for (const line of lines) {
      const norm = line.normalizedText.toUpperCase();
      if (
        /\b(?:IBAN|CAUSALE|CIRCUITO|AUTORIZZAZIONE|TERMINALE|ESITO)\b/.test(norm) &&
        !evidences.some((e) => e.includes(line.rawText.trim()))
      ) {
        unparsedRelevantLines.push(line.rawText.trim());
      }
    }

    // 10. Calcolo Confidenza Globale
    let totalScore = 0;
    let totalWeight = 0;

    const weights = {
      amount: 0.35,
      dateTime: 0.20,
      merchantOrBeneficiary: 0.20,
      transactionReference: 0.25,
    };

    totalScore += (fieldConfidence.amount || 0) * weights.amount;
    totalScore += (fieldConfidence.dateTime || 0) * weights.dateTime;
    totalScore += (fieldConfidence.merchantOrBeneficiary || 0) * weights.merchantOrBeneficiary;
    totalScore += (fieldConfidence.transactionReference || 0) * weights.transactionReference;
    totalWeight = weights.amount + weights.dateTime + weights.merchantOrBeneficiary + weights.transactionReference;

    let overallConfidence = totalWeight > 0 ? Number((totalScore / totalWeight).toFixed(2)) : 0;
    if (amountResult.amount === null) {
      overallConfidence = Math.min(overallConfidence, 0.45);
    }

    return {
      subtype,
      amount: amountResult.amount,
      fee: amountResult.fee,
      totalCharged: amountResult.totalCharged,
      dateTime: dateResult.dateTime,
      merchantOrBeneficiary: beneficiaryResult.beneficiary,
      transactionReference: referenceResult.reference,
      paymentMethodHint: methodHintResult,
      paymentChannelHint: channelHint,
      cryptoDetails,
      confidence: overallConfidence,
      fieldConfidence,
      evidences,
      warnings,
      unparsedRelevantLines,
    };
  }

  /**
   * Determina il sottotipo di ricevuta di pagamento
   */
  private static detectSubtype(
    ocrText: NormalizedOcrText,
    _classification?: DocumentTypeClassificationResult
  ): PaymentEvidenceSubtype {
    const text = `${ocrText.normalizedText}\n${ocrText.rawText}`.toUpperCase();

    // 1. PagoPA
    if (/\bPAGOPA\b|\bIUV\b|\bENTE\s+CREDITORE\b|\bCODICE\s+AVVISO\b|\bQUIETANZA\s+PAGOPA\b/.test(text)) {
      return 'PAGOPA_RECEIPT';
    }

    // 2. Bonifico Bancario SEPA
    if (/\bBONIFICO\b|\bSEPA\s+CREDIT\s+TRANSFER\b|\bTRN\b|\bCRO\b|\bDATA\s+VALUTA\b|\bORDINANTE\b/.test(text)) {
      return 'BANK_TRANSFER_RECEIPT';
    }

    // 3. Ricevitoria / Punto autorizzato (Sisal, Mooney, Lottomatica, Tabacchi)
    if (
      /\bSISAL\b|\bMOONEY\b|\bLOTTOMATICA\b|\bLIS\b|\bPUNTO\s+AUTORIZZATO\b|\bRICEVITORIA\b|\bSERVIZIO\s+DI\s+PAGAMENTO\b/.test(
        text
      )
    ) {
      return 'SISAL_OR_AUTHORIZED_POINT';
    }

    // 4. Crypto Payment
    if (
      (/\bTRANSACTION\s+ID\b|\bTXID\b|\bTX\s*HASH\b|\bBLOCKCHAIN\b|\bCOMMISSIONE\s+RETE\b|\bGAS\s+FEE\b/.test(text) ||
        /\b(?:BTC|ETH|SOL|SATS|USDT|USDC)\b/.test(text)) &&
      (/\bBENEFICIARIO\b|\bESERCENTE\b|\bDESTINATARIO\b|\bPAGATO\s+A\b|\bPAGAMENTO\s+A\b/.test(text) ||
        /\bPAGAMENTO\s+(?:ESEGUITO|CONFERMATO|EFFETTUATO)\b/.test(text))
    ) {
      return 'CRYPTO_PAYMENT';
    }

    // 5. Ricevuta POS / Carta
    if (
      /\bPOS\b|\bSTAN\b|\bTID\b|\bAUT\.?\s*CODE\b|\bCODICE\s+AUTORIZZAZIONE\b|\bCOPIA\s+CLIENTE\b|\bMEMORIA\s+CLIENTE\b|\bBANCOMAT\b|\bPAGOBANCOMAT\b|\bMASTERCARD\b|\bVISA\b|\bMAESTRO\b|\bAMEX\b|\bCARTA\b|\bTRANSAZIONE\s+ESEGUITA\b/.test(
        text
      )
    ) {
      return 'POS_RECEIPT';
    }

    return 'GENERIC_PAYMENT_PROOF';
  }

  /**
   * Estrae e scompone gli importi:
   * - importo della spesa/prestazione
   * - commissione (fee)
   * - totale addebitato (totalCharged)
   */
  private static extractAmounts(
    ocrText: NormalizedOcrText,
    _subtype: PaymentEvidenceSubtype
  ): {
    amount: MoneyAmount | null;
    fee: MoneyAmount | null;
    totalCharged: MoneyAmount | null;
    amountConfidence: number;
    feeConfidence: number;
    amountWarning?: string;
    warnings: string[];
  } {
    const lines = ocrText.lines;
    const warnings: string[] = [];

    let detectedAmount: MoneyAmount | null = null;
    let detectedFee: MoneyAmount | null = null;
    let detectedTotalCharged: MoneyAmount | null = null;

    let amountLineIndex = -1;
    let feeLineIndex = -1;

    // Pattern regex per estrazione numeri monetari
    // Es. €100,00 | 100.00 | 100,00 EUR | € 1.250,50
    const moneyRegex = /(?:€|EUR)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2}))\s*(?:€|EUR)?/i;

    const parseMoneyValue = (str: string): number | null => {
      // Se la riga è una quantità crypto pura (es. "0,000250 BTC" o "0,185 SOL") senza simbolo € o EUR o CONTROVALORE
      if (
        /\b\d+(?:[.,]\d+)?\s*(?:BTC|ETH|SOL|SATS|USDT|USDC|XRP|ADA|DOT)\b/i.test(str) &&
        !/€|EUR|CONTROVALORE|EQUIVALENTE/i.test(str)
      ) {
        return null;
      }

      const match = str.match(moneyRegex);
      if (!match) return null;
      let rawVal = match[1];
      // Se contiene sia punto che virgola (es. 1.250,50)
      if (rawVal.includes('.') && rawVal.includes(',')) {
        rawVal = rawVal.replace(/\./g, '').replace(',', '.');
      } else if (rawVal.includes(',')) {
        rawVal = rawVal.replace(',', '.');
      }
      const num = parseFloat(rawVal);
      return isNaN(num) ? null : Number(num.toFixed(2));
    };

    // 0. Cerca prima se c'è un CONTROVALORE esplicito (fondamentale per ricevute Crypto)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const norm = line.normalizedText.toUpperCase();
      if (/\b(?:CONTROVALORE(?:\s+EUR)?|EQUIVALENTE(?:\s+EUR)?)\b/.test(norm)) {
        const val = parseMoneyValue(line.normalizedText);
        if (val !== null) {
          detectedAmount = val;
          amountLineIndex = i;
          break;
        } else if (i + 1 < lines.length) {
          const nextVal = parseMoneyValue(lines[i + 1].normalizedText);
          if (nextVal !== null) {
            detectedAmount = nextVal;
            amountLineIndex = i + 1;
            break;
          }
        }
      }
    }

    // 1. Cerca righe di Commissione / Fee
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const norm = line.normalizedText.toUpperCase();
      if (
        /\b(?:COMMISSIONE|COMMISSIONI|FEE|COMMISSIONE\s+RETE|COMMISSIONE\s+PSP|COMMISSIONI\s+BLOCKCHAIN|COSTO\s+OPERAZIONE|DIRITTI|SPESE\s+OPERAZIONE)\b/.test(
          norm
        )
      ) {
        const val = parseMoneyValue(line.normalizedText);
        if (val !== null) {
          detectedFee = val;
          feeLineIndex = i;
          break;
        } else if (i + 1 < lines.length) {
          const nextVal = parseMoneyValue(lines[i + 1].normalizedText);
          if (nextVal !== null) {
            detectedFee = nextVal;
            feeLineIndex = i + 1;
            break;
          }
        }
      }
    }

    // 2. Cerca righe di Totale addebitato / Totale transazione / Totale pagato / Totale
    for (let i = 0; i < lines.length; i++) {
      if (i === feeLineIndex || i === amountLineIndex) continue;
      const line = lines[i];
      const norm = line.normalizedText.toUpperCase();
      if (
        /\b(?:TOTALE\s+ADDEBITATO|TOTALE\s+PAGATO|TOTALE\s+OPERAZIONE|TOTALE\s+TRANSAZIONE|TOTALE\s+COMPLESSIVO|TOTALE\s+DOVUTO)\b/.test(
          norm
        )
      ) {
        const val = parseMoneyValue(line.normalizedText);
        if (val !== null) {
          detectedTotalCharged = val;
          break;
        } else if (i + 1 < lines.length) {
          const nextVal = parseMoneyValue(lines[i + 1].normalizedText);
          if (nextVal !== null) {
            detectedTotalCharged = nextVal;
            break;
          }
        }
      }
    }

    // 3. Cerca righe di Importo / Somma pagata (se non già individuato da Controvalore)
    if (detectedAmount === null) {
      for (let i = 0; i < lines.length; i++) {
        if (i === feeLineIndex) continue;
        const line = lines[i];
        const norm = line.normalizedText.toUpperCase();
        if (
          /\b(?:IMPORTO|IMPORTO\s+OPERAZIONE|IMPORTO\s+PAGAMENTO|SOMMA\s+PAGATA|IMPORTO\s+DOVUTO)\b/.test(
            norm
          ) &&
          !/\bTOTALE\b/.test(norm)
        ) {
          const val = parseMoneyValue(line.normalizedText);
          if (val !== null) {
            detectedAmount = val;
            amountLineIndex = i;
            break;
          } else if (i + 1 < lines.length) {
            const nextVal = parseMoneyValue(lines[i + 1].normalizedText);
            if (nextVal !== null) {
              detectedAmount = nextVal;
              amountLineIndex = i + 1;
              break;
            }
          }
        }
      }
    }

    // 4. Se abbiamo trovato "Totale: €X" generico (senza "addebitato")
    if (detectedAmount === null && detectedTotalCharged === null) {
      for (let i = 0; i < lines.length; i++) {
        if (i === feeLineIndex) continue;
        const line = lines[i];
        const norm = line.normalizedText.toUpperCase();
        if (/\b(?:TOTALE|TOTAL|IMPORTO\s+EUR|IMPORTO)\s*[:\s]*/.test(norm)) {
          const val = parseMoneyValue(line.normalizedText);
          if (val !== null) {
            detectedAmount = val;
            amountLineIndex = i;
            break;
          }
        }
      }
    }

    // 5. Disambiguazione e coerenza matematica:
    // Caso 1: Abbiamo sia `detectedAmount` che `detectedFee` e `detectedTotalCharged`:
    // es. Amount = 100, Fee = 1.50, TotalCharged = 101.50 -> Tutto chiaro
    if (detectedAmount !== null && detectedFee !== null) {
      if (detectedTotalCharged === null) {
        detectedTotalCharged = Number((detectedAmount + detectedFee).toFixed(2));
      }
    } else if (detectedAmount === null && detectedTotalCharged !== null && detectedFee !== null) {
      // Caso 2: TotalCharged = 101.50, Fee = 1.50 -> Amount = 100.00
      detectedAmount = Number((detectedTotalCharged - detectedFee).toFixed(2));
    } else if (detectedAmount === null && detectedTotalCharged !== null && detectedFee === null) {
      // Caso 3: Solo TotalCharged (o Totale) presente -> amount = totalCharged, fee = null
      detectedAmount = detectedTotalCharged;
    } else if (detectedAmount !== null && detectedTotalCharged === null && detectedFee === null) {
      // Caso 4: Solo amount presente -> totalCharged = amount
      detectedTotalCharged = detectedAmount;
    }

    // 6. Fallback conservativo se nessun importo è stato individuato per label:
    // Se c'è solo un singolo importo monetario chiaro nell'intero testo
    if (detectedAmount === null) {
      const allMoneyValues: { val: number; lineIdx: number }[] = [];
      for (let i = 0; i < lines.length; i++) {
        const val = parseMoneyValue(lines[i].normalizedText);
        if (val !== null && val > 0) {
          // Ignoriamo orari o date che potrebbero assomigliare a importi
          if (!lines[i].normalizedText.match(/\b\d{2}[/.-]\d{2}[/.-]\d{2,4}\b/)) {
            allMoneyValues.push({ val, lineIdx: i });
          }
        }
      }

      if (allMoneyValues.length === 1) {
        detectedAmount = allMoneyValues[0].val;
        detectedTotalCharged = detectedAmount;
      } else if (allMoneyValues.length > 1) {
        // Più numeri senza etichette certe -> NON scegliere arbitrariamente quello sbagliato
        warnings.push('AMBIGUOUS_AMOUNT');
      }
    }

    const amountConfidence = detectedAmount !== null ? (amountLineIndex !== -1 ? 0.95 : 0.70) : 0;
    const feeConfidence = detectedFee !== null ? 0.95 : 0;

    return {
      amount: detectedAmount,
      fee: detectedFee,
      totalCharged: detectedTotalCharged,
      amountConfidence,
      feeConfidence,
      amountWarning: detectedAmount === null ? 'AMOUNT_NOT_DETECTED' : undefined,
      warnings,
    };
  }

  /**
   * Estrae Data e Ora
   */
  private static extractDateTime(ocrText: NormalizedOcrText): {
    dateTime: string | null;
    confidence: number;
  } {
    const lines = ocrText.lines;
    const dateRegex = /\b([0-3]?[0-9])[/.-]([0-1]?[0-9])[/.-](20[2-3][0-9]|19[0-9]{2}|[0-9]{2})\b/;
    const timeRegex = /\b([0-2]?[0-9])[:.]([0-5][0-9])(?::([0-5][0-9]))?\b/;

    let foundDate: string | null = null;
    let foundTime: string | null = null;

    for (const line of lines) {
      const norm = line.normalizedText;
      const dateMatch = norm.match(dateRegex);
      if (dateMatch && !foundDate) {
        let day = dateMatch[1].padStart(2, '0');
        let month = dateMatch[2].padStart(2, '0');
        let year = dateMatch[3];
        if (year.length === 2) {
          year = `20${year}`;
        }
        foundDate = `${year}-${month}-${day}`;
      }

      const timeMatch = norm.match(timeRegex);
      if (timeMatch && !foundTime) {
        // Verifica che non sia parte della data
        if (!dateMatch || norm.indexOf(timeMatch[0]) !== norm.indexOf(dateMatch[0])) {
          const hour = timeMatch[1].padStart(2, '0');
          const min = timeMatch[2].padStart(2, '0');
          const sec = timeMatch[3] ? timeMatch[3].padStart(2, '0') : '00';
          foundTime = `${hour}:${min}:${sec}`;
        }
      }

      if (foundDate && foundTime) {
        break;
      }
    }

    if (foundDate) {
      const fullIso = foundTime ? `${foundDate}T${foundTime}` : `${foundDate}T00:00:00`;
      return {
        dateTime: fullIso,
        confidence: foundTime ? 0.95 : 0.80,
      };
    }

    return {
      dateTime: null,
      confidence: 0,
    };
  }

  /**
   * Estrae Esercente o Beneficiario a seconda del sottotipo
   */
  private static extractMerchantOrBeneficiary(
    ocrText: NormalizedOcrText,
    subtype: PaymentEvidenceSubtype
  ): {
    beneficiary: string | null;
    confidence: number;
  } {
    const lines = ocrText.lines;

    // 1. Label esplicite di beneficiario / ente creditore / esercente / destinatario / merchant
    const beneficiaryLabelRegex =
      /\b(?:BENEFICIARIO|ENTE\s+CREDITORE|DESTINATARIO|ESERCENTE|PUNTO\s+VENDITA|P\.?\s*VENDITA|A\s+FAVORE\s+DI|INTESTATARIO|INTESTATO\s+A|SERVIZIO|MERCHANT)\s*[:\s]+(.+)$/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.rawText.match(beneficiaryLabelRegex);
      if (match) {
        let name = match[1].trim();
        // Rimuove eventuali etichette residue
        name = name.replace(/\b(?:IBAN|DATA|IMPORTO|CODICE|CF|PIVA|STAN|TID|AUT)\b.*$/i, '').trim();
        if (name.length >= 2) {
          return {
            beneficiary: name,
            confidence: 0.95,
          };
        }
      }
    }

    // 2. Se è un Bonifico Bancario o PagoPA ma la label era a capo successivo
    if (subtype === 'BANK_TRANSFER_RECEIPT' || subtype === 'PAGOPA_RECEIPT') {
      for (let i = 0; i < lines.length; i++) {
        const norm = lines[i].normalizedText.toUpperCase();
        if (/^(?:BENEFICIARIO|ENTE\s+CREDITORE|DESTINATARIO|ESERCENTE)\s*:?$/i.test(norm)) {
          if (i + 1 < lines.length && lines[i + 1].rawText.trim().length >= 3) {
            return {
              beneficiary: lines[i + 1].rawText.trim(),
              confidence: 0.90,
            };
          }
        }
      }
    }

    // 3. Ricevute POS, Sisal o Prove di Pagamento generiche:
    // Discriminazione semantica tra Provider POS / Gestore / Circuito e Merchant Commerciale reale
    if (subtype === 'POS_RECEIPT' || subtype === 'SISAL_OR_AUTHORIZED_POINT' || subtype === 'GENERIC_PAYMENT_PROOF') {
      // Regex di esclusione per provider POS, circuiti di carte e termini operativi/tecnici
      const paymentProviderRegex =
        /\b(?:NEXI|SEPA-?FAST|SEPA|SUMUP|AXERVE|INGENICO|WORLDLINE|SIA|EQUENS|SETTEFI|MONEYNET|PAYPAL|STRIPE|VERIFONE|PAX|GLOBAL\s+PAYMENTS|BANCOMAT\s+PAY|SATISPAY|MOONEY|LIS|SISALPAY|SISTEMA\s+PAGAMENTI)\b/i;
      const cardSchemeRegex =
        /\b(?:PAGOBANCOMAT|BANCOMAT|MASTERCARD|DEBIT\s+MASTERCARD|CREDIT\s+MASTERCARD|VISA|VISA\s+DEBIT|VISA\s+ELECTRON|V-?PAY|MAESTRO|AMEX|AMERICAN\s+EXPRESS|CIRRUS|DINERS|JCB|UNIONPAY)\b/i;
      const posOperationalRegex =
        /\b(?:POS|TERMINALE|TPV|TID|STAN|AUT\.?\s*CODE|AUTH\s*CODE|AUTORIZZAZIONE|APPLICAZIONE|AID|ATC|ARQC|TC|C-?LESS|CONTACTLESS|CHIP|MAG|FALLBACK|ACQUISTO|VENDITA|STORNO|PREAUTORIZZAZIONE|TRANSAZIONE|OPERAZIONE|ESITO|PAGAMENTO|RICEVUTA|QUIETANZA|MEMORIA\s+CLIENTE|COPIA\s+CLIENTE|COPIA\s+ESERCENTE|SCONTRINO\s+ESERCENTE|RICEVUTA\s+CLIENTE|RICEVUTA\s+POS|SCONTRINO|DOCUMENTO|BIGLIETTO|ARRIVEDERCI|GRAZIE)\b/i;
      const addressIndicatorsRegex =
        /\b(?:VIA|CORSO|PIAZZA|VIALE|LARGO|STRADA|VICOLO|PIAZZALE|LOCALITA|LOC\.?|KM|FRAZIONE|SNC)\b/i;
      const commercialKeywordsRegex =
        /\b(?:FARMACIA|PARAFARMACIA|SUPERMERCATO|IPERMERCATO|MINIMARKET|MARKET|BAR|CAFFE|RISTORANTE|PIZZERIA|TRATTORIA|OSTERIA|GELATERIA|PASTICCERIA|PANIFICIO|FORNO|TABACCHI|TABACCHERIA|EDICOLA|LIBRERIA|LAVANDERIA|STUDIO|POLIAMBULATORIO|AMBULATORIO|OTTICA|BOUTIQUE|NEGOZIO|HOTEL|ALBERGO|AUTOFFICINA|OFFICINA|DISTRIBUTORE|GARAGE|CINEMA|TEATRO|PALESTRA|CENTRO|STORE|SHOP|MERCATO)\b/i;
      const corporateSuffixRegex =
        /\b(?:S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|SOC\.?\s*COOP\.?|S\.?T\.?P\.?|DITTA|S\.?S\.?|ONLUS|E\.?T\.?S\.?)\b/i;

      interface MerchantCandidate {
        text: string;
        score: number;
        lineIndex: number;
      }
      const candidates: MerchantCandidate[] = [];

      const searchLinesCount = Math.min(lines.length, 8);
      for (let i = 0; i < searchLinesCount; i++) {
        const raw = lines[i].rawText.trim();
        const norm = lines[i].normalizedText.toUpperCase().trim();

        if (raw.length < 3) continue;

        // Scarta se la riga è solo una sequenza di numeri o codici tecnici (es. "911-000935-05 i pe PARO", "12/08/2026")
        const digitRatio = (norm.match(/\d/g) || []).length / norm.length;
        if (digitRatio > 0.35) continue;

        // Se la riga contiene provider di pagamento o circuito carta SENZA un suffisso/keyword commerciale
        const hasProvider = paymentProviderRegex.test(norm);
        const hasCardScheme = cardSchemeRegex.test(norm);
        const hasPosOp = posOperationalRegex.test(norm);
        const hasCommercialKeyword = commercialKeywordsRegex.test(norm);
        const hasCorporateSuffix = corporateSuffixRegex.test(norm);

        // Se è una riga puramente tecnica POS / provider / circuito -> scarta
        if ((hasProvider || hasCardScheme || hasPosOp) && !hasCommercialKeyword && !hasCorporateSuffix) {
          continue;
        }

        // Se è puramente un indirizzo stradale isolato
        if (addressIndicatorsRegex.test(norm) && !hasCommercialKeyword && !hasCorporateSuffix) {
          continue;
        }

        let score = 0;

        // Punteggio keyword commerciale (es. "FARMACIA LA NAVE", "BAR IL GABBIANO")
        if (hasCommercialKeyword) {
          score += 35;
        }

        // Punteggio forma societaria (es. "S.R.L.", "S.P.A.")
        if (hasCorporateSuffix) {
          score += 30;
        }

        // Punteggio per struttura nome pluri-parola alfabetica (es. "LA NAVE", "BELLA NAPOLI")
        const words = raw.split(/\s+/).filter((w) => w.length >= 2);
        const alphaOnly = raw.replace(/[^A-Za-z]/g, '');
        if (words.length >= 2 && alphaOnly.length >= 5) {
          score += 15;
        } else if (words.length === 1 && alphaOnly.length >= 4 && !hasProvider && !hasCardScheme && !hasPosOp) {
          score += 5;
        }

        // Bonus se la riga successiva o precedente sembra un indirizzo o località
        const prevNorm = i > 0 ? lines[i - 1].normalizedText.toUpperCase() : '';
        const nextNorm = i + 1 < lines.length ? lines[i + 1].normalizedText.toUpperCase() : '';
        if (addressIndicatorsRegex.test(prevNorm) || addressIndicatorsRegex.test(nextNorm)) {
          score += 10;
        }

        // Bonus posizione (prime 3 righe)
        if (i <= 2) {
          score += 10;
        } else if (i <= 4) {
          score += 5;
        }

        // Penalità se contiene frammenti di parole POS
        if (hasPosOp) {
          score -= 15;
        }

        if (score >= 25) {
          // Pulizia del nome candidato
          let cleanText = raw.replace(/^[*#\-_:;.]+|\s+[*#\-_:;.]+$/g, '').trim();
          candidates.push({
            text: cleanText,
            score,
            lineIndex: i,
          });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        const conf = Math.min(0.95, Math.max(0.70, 0.65 + best.score * 0.005));
        return {
          beneficiary: best.text,
          confidence: conf,
        };
      }
    }

    return {
      beneficiary: null,
      confidence: 0,
    };
  }

  /**
   * Estrae il riferimento univoco della transazione (IUV, TRN, CRO, STAN, TxID, AuthCode)
   */
  private static extractTransactionReference(
    ocrText: NormalizedOcrText,
    subtype: PaymentEvidenceSubtype
  ): {
    reference: string | null;
    referenceType: string | null;
    confidence: number;
  } {
    const lines = ocrText.lines;
    const combined = lines.map((l) => l.normalizedText).join('\n');

    // 1. PagoPA: IUV o Codice Avviso
    if (subtype === 'PAGOPA_RECEIPT') {
      const iuvMatch = combined.match(/\b(?:IUV|CODICE\s+IUV)\s*[:\s]*([0-9A-Z]{15,18})\b/i);
      if (iuvMatch) {
        return { reference: iuvMatch[1], referenceType: 'IUV', confidence: 0.95 };
      }
      const avvisoMatch = combined.match(/\b(?:CODICE\s+AVVISO|NUMERO\s+AVVISO)\s*[:\s]*([0-9]{18})\b/i);
      if (avvisoMatch) {
        return { reference: avvisoMatch[1], referenceType: 'CODICE_AVVISO', confidence: 0.90 };
      }
    }

    // 2. Bonifico: TRN (30-35 chars) o CRO (11 cifre)
    if (subtype === 'BANK_TRANSFER_RECEIPT') {
      const trnMatch = combined.match(/\b(?:TRN|CODICE\s+TRN)\s*[:\s]*([0-9A-Za-z]{30,35})\b/i);
      if (trnMatch) {
        return { reference: trnMatch[1].toUpperCase(), referenceType: 'TRN', confidence: 0.95 };
      }
      const croMatch = combined.match(/\b(?:CRO|CODICE\s+CRO)\s*[:\s]*([0-9]{11})\b/i);
      if (croMatch) {
        return { reference: croMatch[1], referenceType: 'CRO', confidence: 0.90 };
      }
    }

    // 3. Crypto: TxID o Transaction Hash
    if (subtype === 'CRYPTO_PAYMENT') {
      const txMatch = combined.match(
        /\b(?:TRANSACTION\s+ID|TXID|TX\s*HASH|HASH)\s*[:\s]*([0-9a-zA-Z_-]{16,80})\b/i
      );
      if (txMatch) {
        return { reference: txMatch[1], referenceType: 'TXID', confidence: 0.95 };
      }
    }

    // 4. POS: STAN, Auth Code, TID
    if (subtype === 'POS_RECEIPT') {
      // STAN (6 cifre)
      const stanMatch = combined.match(/\b(?:STAN|N\.\s*STAN|STAN\s*N\.?)\s*[:\s]*([0-9]{6})\b/i);
      if (stanMatch) {
        return { reference: stanMatch[1], referenceType: 'STAN', confidence: 0.95 };
      }
      // Codice Autorizzazione (6 caratteri)
      const authMatch = combined.match(
        /\b(?:AUT\.?\s*CODE|CODICE\s+AUTORIZZAZIONE|AUTORIZZAZIONE|AUTH\s+CODE|AUT\.?)\s*[:\s]*([0-9A-Za-z]{6})\b/i
      );
      if (authMatch) {
        return { reference: authMatch[1].toUpperCase(), referenceType: 'AUTH_CODE', confidence: 0.90 };
      }
      // TID (8-10 caratteri)
      const tidMatch = combined.match(/\b(?:TID|TERMINAL\s+ID|ID\s+TERMINALE)\s*[:\s]*([0-9A-Za-z]{8,10})\b/i);
      if (tidMatch) {
        return { reference: tidMatch[1], referenceType: 'TID', confidence: 0.85 };
      }
    }

    // 5. Sisal / Ricevitoria / Generico
    const genericRefMatch = combined.match(
      /\b(?:ID\s+TRANSAZIONE|CODICE\s+TRANSAZIONE|CODICE\s+OPERAZIONE|NUMERO\s+OPERAZIONE|RICEVUTA\s+N\.?|BIGLIETTO\s+N\.?)\s*[:\s]*([0-9A-Za-z_-]{6,30})\b/i
    );
    if (genericRefMatch) {
      return { reference: genericRefMatch[1], referenceType: 'TRANSACTION_ID', confidence: 0.85 };
    }

    return {
      reference: null,
      referenceType: null,
      confidence: 0,
    };
  }

  /**
   * Estrae suggerimenti sul metodo di pagamento (hint), circuito e PAN mascherato
   * Garantisce che nessun PAN completo venga propagato
   */
  private static extractMethodHint(
    ocrText: NormalizedOcrText,
    subtype: PaymentEvidenceSubtype
  ): PaymentEvidenceMethodHint {
    const combined = `${ocrText.normalizedText}\n${ocrText.rawText}`.toUpperCase();

    let macroCategoryHint: PaymentMethod | undefined;
    let methodAliasHint: string | undefined;
    let circuitOrBrand: string | undefined;
    let maskedPan: string | undefined;

    // 1. Circuito della carta
    if (/\bPAGOBANCOMAT\b|\bBANCOMAT\b/.test(combined)) {
      circuitOrBrand = 'PagoBANCOMAT';
      macroCategoryHint = 'debitCard';
      methodAliasHint = 'Bancomat';
    } else if (/\bMASTERCARD\b/.test(combined)) {
      circuitOrBrand = 'Mastercard';
      macroCategoryHint = 'creditCard';
      methodAliasHint = 'Mastercard';
    } else if (/\bVISA\b|\bV-PAY\b/.test(combined)) {
      circuitOrBrand = 'Visa';
      macroCategoryHint = 'creditCard';
      methodAliasHint = 'Visa';
    } else if (/\bMAESTRO\b/.test(combined)) {
      circuitOrBrand = 'Maestro';
      macroCategoryHint = 'debitCard';
      methodAliasHint = 'Maestro';
    } else if (/\bAMEX\b|\bAMERICAN\s+EXPRESS\b/.test(combined)) {
      circuitOrBrand = 'American Express';
      macroCategoryHint = 'creditCard';
      methodAliasHint = 'Amex';
    }

    // 2. Riconoscimento PAN e MASCHERATURA RIGOROSA
    // Cerchiamo pattern PAN già mascherato (es. **** **** **** 1234 o ************1234 o ...1234)
    const alreadyMaskedMatch = combined.match(/(?:\*{4}\s*){1,3}(\d{4})|(?:\*{8,12})(\d{4})/);
    if (alreadyMaskedMatch) {
      const lastDigits = alreadyMaskedMatch[1] || alreadyMaskedMatch[2];
      maskedPan = `**** **** **** ${lastDigits}`;
    } else {
      // Se nel testo OCR grezzo fosse presente un numero di carta intero (13-19 cifre),
      // NON dobbiamo MAI propagarlo in chiaro: estraiamo solo le ultime 4 cifre mascherate
      const fullPanMatch = combined.match(/\b(?:\d{4}[ -]?){3}\d{4}\b|\b\d{13,19}\b/);
      if (fullPanMatch) {
        const cleanDigits = fullPanMatch[0].replace(/[\s-]/g, '');
        if (cleanDigits.length >= 13 && cleanDigits.length <= 19) {
          const last4 = cleanDigits.slice(-4);
          maskedPan = `**** **** **** ${last4}`;
        }
      }
    }

    // 3. Impostazione Macro Categorie in base a sottotipo se non già impostate
    if (!macroCategoryHint) {
      if (subtype === 'POS_RECEIPT') {
        macroCategoryHint = 'debitCard';
        methodAliasHint = 'Carta POS';
      } else if (subtype === 'BANK_TRANSFER_RECEIPT') {
        macroCategoryHint = 'bankTransfer';
        methodAliasHint = 'Bonifico SEPA';
      } else if (subtype === 'PAGOPA_RECEIPT') {
        macroCategoryHint = 'other';
        methodAliasHint = 'PagoPA';
      } else if (subtype === 'CRYPTO_PAYMENT') {
        macroCategoryHint = 'other';
        // Ticker crypto rilevato
        const cryptoTickerMatch = combined.match(/\b(BTC|ETH|SOL|SATS|USDT|USDC|XRP|ADA|DOT)\b/);
        if (cryptoTickerMatch) {
          methodAliasHint = cryptoTickerMatch[1];
        } else {
          methodAliasHint = 'Crypto';
        }
      } else if (subtype === 'SISAL_OR_AUTHORIZED_POINT') {
        macroCategoryHint = 'cash';
        methodAliasHint = 'Punto Autorizzato';
      }
    }

    return {
      macroCategoryHint,
      methodAliasHint,
      circuitOrBrand,
      maskedPan,
    };
  }

  /**
   * Determina l'hint sul canale di pagamento
   */
  private static determineChannelHint(subtype: PaymentEvidenceSubtype, ocrText: NormalizedOcrText): string {
    const combined = ocrText.normalizedText.toUpperCase();

    switch (subtype) {
      case 'POS_RECEIPT':
        return 'POS';
      case 'PAGOPA_RECEIPT':
        return 'PagoPA';
      case 'BANK_TRANSFER_RECEIPT':
        return 'SEPA_TRANSFER';
      case 'SISAL_OR_AUTHORIZED_POINT':
        if (/\b(?:SISAL|SISALPAY)\b/i.test(combined)) return 'SISAL_POINT';
        if (/\bMOONEY\b/i.test(combined)) return 'MOONEY_POINT';
        if (/\b(?:LOTTOMATICA|LIS)\b/i.test(combined)) return 'LOTTOMATICA_POINT';
        return 'AUTHORIZED_POINT';
      case 'CRYPTO_PAYMENT':
        return 'CRYPTO_WALLET';
      default:
        return 'GENERIC_PAYMENT_CHANNEL';
    }
  }

  /**
   * Estrae i dettagli specifici di un pagamento Crypto
   */
  private static extractCryptoDetails(
    ocrText: NormalizedOcrText,
    detectedFee: MoneyAmount | null
  ): PaymentEvidenceCryptoDetails {
    const combined = `${ocrText.normalizedText}\n${ocrText.rawText}`;

    let cryptoAmount: number | null = null;
    let cryptoAsset: string | null = null;
    let txHash: string | null = null;

    // Quantità crypto (es. 0.000250 BTC, 0.185 SOL, 50 USDT)
    const cryptoQtyMatch = combined.match(
      /\b([0-9]+(?:[.,][0-9]{1,8})?)\s*(BTC|ETH|SOL|SATS|USDT|USDC|XRP|ADA|DOT|[A-Z]{3,6})\b/i
    );
    if (cryptoQtyMatch) {
      const rawQty = cryptoQtyMatch[1].replace(',', '.');
      cryptoAmount = parseFloat(rawQty);
      cryptoAsset = cryptoQtyMatch[2].toUpperCase();
    }

    // TxID / Hash
    const txMatch = combined.match(
      /\b(?:TRANSACTION\s+ID|TXID|TX\s*HASH|HASH)\s*[:\s]*([0-9a-zA-Z_-]{16,80})\b/i
    );
    if (txMatch) {
      txHash = txMatch[1];
    }

    return {
      cryptoAmount: isNaN(Number(cryptoAmount)) ? null : cryptoAmount,
      cryptoAsset: cryptoAsset || null,
      networkFee: detectedFee,
      txHash: txHash || null,
    };
  }
}
