import {
  DocumentCategory,
} from '../../../types';
import {
  NormalizedOcrText,
  DocumentTypeEvidence,
  DocumentTypeClassificationResult,
} from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

/**
 * =========================================================================
 * ESTENSIONE PAGAMENTI - BLOCCO P2: DOCUMENT TYPE CLASSIFIER
 * =========================================================================
 *
 * Modulo puro e isolato per la classificazione semantica del tipo di documento
 * analizzando evidenze multiple e contestuali a livello globale del documento.
 *
 * Categorie supportate:
 * - COMMERCIAL_RECEIPT: Scontrino commerciale / fiscale / vendita al dettaglio con body articoli e IVA
 * - PAYMENT_PROOF: Ricevuta di pagamento, scontrino POS, PagoPA, ricevuta bonifico SEPA, quietanza
 * - INVOICE_OR_BILL: Fattura, bolletta utenze (luce/gas/acqua/telefonia) con periodo e consumi
 * - UNKNOWN: Documenti poveri di contesto, ambigui, conflittuali o trading finanziario/crypto
 */
export class DocumentTypeClassifier {
  public static readonly MODULE_NAME = 'DocumentTypeClassifier';

  /**
   * Classifica il documento OCR basandosi sulla struttura globale e su evidenze multiple.
   */
  public static classify(input: NormalizedOcrText | string): DocumentTypeClassificationResult {
    const ocrText: NormalizedOcrText =
      typeof input === 'string'
        ? TextNormalizationModule.normalizeToStructuredOcrText(input)
        : input;

    const rawText = ocrText.rawText || '';
    const normalizedText = ocrText.normalizedText || '';
    const lines = ocrText.lines || [];

    // Se il testo è completamente vuoto o privo di righe valide
    if (!normalizedText.trim() || lines.length === 0) {
      return {
        category: 'UNKNOWN',
        confidence: 0.0,
        evidences: [],
        warnings: ['Testo OCR vuoto o non sufficiente per la classificazione'],
        categoryScores: {
          commercialReceipt: 0,
          paymentProof: 0,
          invoiceOrBill: 0,
        },
      };
    }

    const evidences: DocumentTypeEvidence[] = [];
    const warnings: string[] = [];

    // 0. CONTROLLO PREVENTIVO: Trading Finanziario / Crypto Exchange Purchase
    // Es. "Acquisto BTC su Exchange Crypto.com", ordini di borsa/trading
    const isFinancialTrade = this.detectFinancialTrading(normalizedText, rawText);
    if (isFinancialTrade) {
      warnings.push(
        'Rilevata operazione di compravendita finanziaria/crypto su exchange: non classificabile come spesa domestica o prova di pagamento'
      );
      evidences.push({
        category: 'UNKNOWN',
        signal: 'EXCHANGE_TRADING_DETECTED',
        weight: 100,
        rawSnippet: 'Trading/Exchange purchase detected',
      });
      return {
        category: 'UNKNOWN',
        confidence: 0.3,
        evidences,
        warnings,
        categoryScores: {
          commercialReceipt: 0,
          paymentProof: 0,
          invoiceOrBill: 0,
        },
      };
    }

    // 1. RILEVAZIONE EVIDENZE PER CIASCUNA CATEGORIA
    this.extractCommercialReceiptEvidences(lines, normalizedText, rawText, evidences);
    this.extractPaymentProofEvidences(lines, normalizedText, rawText, evidences);
    this.extractInvoiceOrBillEvidences(lines, normalizedText, rawText, evidences);

    // 2. CALCOLO PUNTEGGI AGGREGATI
    let commercialScore = 0;
    let paymentProofScore = 0;
    let invoiceScore = 0;

    for (const ev of evidences) {
      if (ev.category === 'COMMERCIAL_RECEIPT') commercialScore += ev.weight;
      if (ev.category === 'PAYMENT_PROOF') paymentProofScore += ev.weight;
      if (ev.category === 'INVOICE_OR_BILL') invoiceScore += ev.weight;
    }

    const categoryScores = {
      commercialReceipt: commercialScore,
      paymentProof: paymentProofScore,
      invoiceOrBill: invoiceScore,
    };

    // 3. REGOLE DI ARBITRAGGIO GLOBALE E RISOLUZIONE AMBIGUITÀ

    // Regola A: Scontrino commerciale con pagamento POS/Carta nel footer
    // Se è presente "DOCUMENTO COMMERCIALE" o righe con aliquote IVA articoli (4%/10%/22%) e subtotale/totale,
    // i segnali di pagamento elettronico (es. CARTA, AUT, STAN) nel footer sono secondari e accessori.
    const hasExplicitCommercialHeader = evidences.some(
      (e) =>
        e.category === 'COMMERCIAL_RECEIPT' &&
        (e.signal.includes('EXPLICIT_HEADER') || e.signal.includes('CORROBORATED_DEGRADED_HEADER'))
    );
    const hasVatRateLines = evidences.some(
      (e) => e.category === 'COMMERCIAL_RECEIPT' && e.signal.includes('VAT_RATE_LINES')
    );
    const hasItemCountSignal = evidences.some(
      (e) => e.category === 'COMMERCIAL_RECEIPT' && e.signal.includes('ITEM_COUNT')
    );

    if (commercialScore >= 40 && (hasExplicitCommercialHeader || hasVatRateLines || hasItemCountSignal)) {
      // Bonus contestuale per scontrino commerciale strutturato
      commercialScore += 25;
    }

    // Regola B: Documento con pochissimo testo (es. solo Data + Importo)
    const isSparseDocument =
      lines.length <= 3 &&
      commercialScore < 30 &&
      paymentProofScore < 30 &&
      invoiceScore < 30;

    if (isSparseDocument) {
      warnings.push('Documento povero di dati: presenti solo frammenti isolati non sufficienti per la classificazione');
      return {
        category: 'UNKNOWN',
        confidence: 0.2,
        evidences,
        warnings,
        categoryScores,
      };
    }

    // 4. DETERMINAZIONE CATEGORIA VINCITRICE
    const scores = [
      { cat: 'COMMERCIAL_RECEIPT' as DocumentCategory, score: commercialScore },
      { cat: 'PAYMENT_PROOF' as DocumentCategory, score: paymentProofScore },
      { cat: 'INVOICE_OR_BILL' as DocumentCategory, score: invoiceScore },
    ].sort((a, b) => b.score - a.score);

    const top = scores[0];
    const second = scores[1];

    // Soglia minima di significatività
    const MIN_SIGNIFICANT_SCORE = 35;

    if (top.score < MIN_SIGNIFICANT_SCORE) {
      warnings.push('Punteggio evidenze insufficiente per determinare con certezza la categoria');
      return {
        category: 'UNKNOWN',
        confidence: Math.max(0.1, Number((top.score / 100).toFixed(2))),
        evidences,
        warnings,
        categoryScores,
      };
    }

    // Controllo conflitto/parità tra due categorie con punteggi alti
    if (second.score >= 35 && top.score < second.score * 1.25) {
      warnings.push(
        `Segnali conflittuali tra ${top.cat} (score: ${top.score}) e ${second.cat} (score: ${second.score})`
      );
      return {
        category: 'UNKNOWN',
        confidence: 0.4,
        evidences,
        warnings,
        categoryScores,
      };
    }

    // 5. CALCOLO DELLA CONFIDENCE CONSERVATIVA
    let confidence = 0.5;
    const evidenceCount = evidences.filter((e) => e.category === top.cat).length;

    if (top.score >= 70 && evidenceCount >= 3) {
      confidence = 0.95;
    } else if (top.score >= 50 && evidenceCount >= 2) {
      confidence = 0.85;
    } else if (top.score >= 35) {
      confidence = 0.70;
    }

    // Se ci sono evidenze discordanti moderate, riduciamo leggermente la confidenza
    if (second.score > 20) {
      confidence = Math.max(0.55, confidence - 0.15);
      warnings.push(`Rilevate evidenze secondarie per ${second.cat} (score: ${second.score})`);
    }

    return {
      category: top.cat,
      confidence: Number(confidence.toFixed(2)),
      evidences,
      warnings,
      categoryScores,
    };
  }

  /**
   * Rileva se il documento è un'operazione finanziaria / trading / acquisto crypto su exchange
   * Distingue nettamente tra:
   * - Acquisto/trading/conversione di criptovaluta/asset su exchange o wallet -> UNKNOWN (non è spesa domestica)
   * - Pagamento di beni/servizi eseguito in criptovaluta a favore di un beneficiario/esercente -> PAYMENT_PROOF
   */
  private static detectFinancialTrading(normalizedText: string, rawText: string): boolean {
    const combined = `${normalizedText}\n${rawText}`.toUpperCase();

    // Se è presente un esplicito beneficiario / esercente / destinatario di pagamento verso terzi,
    // allora NON è un trading/acquisto proprio di asset, ma un pagamento reale
    const hasThirdPartyBeneficiary =
      /\b(?:BENEFICIARIO|DESTINATARIO|ESERCENTE|PAGATO\s+A|PAGAMENTO\s+A|MERCHANT)\s*:/i.test(combined);
    const isExplicitPayment =
      /\bPAGAMENTO\s+ESEGUITO\b|\bPAGAMENTO\s+CONFERMATO\b|\bPAGAMENTO\s+EFFETTUATO\b|\bTRANSAZIONE\s+DI\s+PAGAMENTO\b/i.test(
        combined
      );

    if (hasThirdPartyBeneficiary && isExplicitPayment) {
      return false;
    }

    // 1. Indicatori strutturali di compravendita asset (brand-independent)
    // Es. "ACQUISTO ZRX", "BUY BTC", "ACQUISTO BITCOIN", "TRADE ETH", "MARKET BUY", "ORDER FILLED"
    const genericTradeActionRegex =
      /\b(?:ACQUISTO|VENDITA|BUY|SELL|TRADE|SWAP|EXCHANGE|ORDER\s+FILLED|MARKET\s+BUY|LIMIT\s+BUY|CONVERT)\s+(?:DI\s+)?[A-Z0-9]{2,10}\b/i;

    // 2. Prezzo unitario / Prezzo dell'asset
    const unitPriceRegex =
      /\b(?:PREZZO|PRICE|PREZZO\s+UNITARIO|PREZZO\s+DI\s+ACQUISTO|TASSO\s+DI\s+CAMBIO)\s*[:\s]*[€$£]?\s*\d+(?:[.,]\d+)?/i;

    // 3. Portafoglio di origine / Wallet fiat / Saldo
    const portfolioSourceRegex =
      /\b(?:PORTAFOGLIO|WALLET)\s+(?:EUR|USD|GBP|FIAT|SPOT|CRYPTO|PRINCIPALE)\b/i;

    // 4. Coppie di trading (es. BTC/EUR, SOL/USD, XYZ/USDT)
    const tradingPairRegex =
      /\b(?:PAIR|COPPIA)\s*:\s*[A-Z0-9]{2,10}\s*\/\s*(?:EUR|USD|USDT|USDC|GBP|BTC|ETH)\b/i;

    // 5. Metadati di ordine su exchange (Trade ID, Order ID, Codice di riferimento)
    const orderMetadataRegex =
      /\b(?:TRADE\s+ID|ORDER\s+ID|CODICE\s+(?:DI\s+)?RIFERIMENTO|FILLED|COMPLETATO|ESECUTO)\b/i;

    // 6. Marchi exchange noti (segnali accessori, NON strettamente necessari)
    const exchangeMarkers = [
      /\bBINANCE\b/,
      /\bKRAKEN\b/,
      /\bCOINBASE\b/,
      /\bCRYPTO\.COM\b/,
      /\bBYBIT\b/,
      /\bBITPANDA\b/,
      /\bBITGET\b/,
      /\bKUCOIN\b/,
    ];
    const hasExchangeBrand = exchangeMarkers.some((r) => r.test(combined));

    const hasGenericTradeAction = genericTradeActionRegex.test(combined);
    const hasUnitPrice = unitPriceRegex.test(combined);
    const hasPortfolio = portfolioSourceRegex.test(combined);
    const hasTradingPair = tradingPairRegex.test(combined);
    const hasOrderMetadata = orderMetadataRegex.test(combined);

    // Valutazione strutturale brand-independent:
    // A) Azione di acquisto/trade + Prezzo unitario o Portafoglio o Metadata ordine
    if (hasGenericTradeAction && (hasUnitPrice || hasPortfolio || hasTradingPair || hasOrderMetadata)) {
      return true;
    }

    // B) Trading pair esplicita (es. Pair: BTC/EUR)
    if (hasTradingPair) {
      return true;
    }

    // C) Struttura tipica: "Acquisto <Asset>", "Prezzo €X", "Commissione €Y" o "Portafoglio EUR"
    if (
      /ACQUISTO\s+[A-Z0-9]{2,10}/i.test(combined) &&
      (hasUnitPrice || /PREZZO\b/i.test(combined)) &&
      (/COMMISSIONE/i.test(combined) || hasPortfolio || hasOrderMetadata)
    ) {
      return true;
    }

    // D) Presenza di brand exchange + segnali di asset/crypto o acquisto
    if (
      hasExchangeBrand &&
      (hasGenericTradeAction || hasUnitPrice || /\b(?:CRYPTO|ASSET|VALUTA\s+DIGITALE|PORTAFOGLIO)\b/.test(combined))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Estrae evidenze per COMMERCIAL_RECEIPT (Scontrino commerciale / fiscale al dettaglio)
   */
  private static extractCommercialReceiptEvidences(
    lines: readonly { rawIndex: number; rawText: string; normalizedText: string }[],
    normalizedText: string,
    rawText: string,
    evidences: DocumentTypeEvidence[]
  ): void {
    const upperFull = `${normalizedText}\n${rawText}`.toUpperCase();

    // 1. Intestazione Esplicita Scontrino / Documento Commerciale
    const explicitHeaderRegex =
      /DOCUMENTO\s+COMMERCIALE|SCONTRINO\s+FISCALE|DOCUMENTO\s+DI\s+VENDITA(?:\s+O\s+PRESTAZIONE)?|RICEVUTA\s+FISCALE|VENDITA\s+AL\s+DETTAGLIO/i;
    let hasExplicitHeader = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (explicitHeaderRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'COMMERCIAL_RECEIPT',
          signal: 'EXPLICIT_HEADER_COMMERCIAL_DOCUMENT',
          weight: 45,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        hasExplicitHeader = true;
        break;
      }
    }

    // 1b. Sottotitolo tipico scontrino telematico (es. "di vendita o prestazione", "di vendita © prestazione")
    const subtitleRegex = /\b(?:DI\s+VENDITA\s*[^a-zA-Z0-9\s]?\s*PRESTAZIONE|VENDITA\s*[\w©&/.-]*\s*PRESTAZIONE)\b/i;
    let hasCommercialSubtitle = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (subtitleRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'COMMERCIAL_RECEIPT',
          signal: 'COMMERCIAL_SUBTITLE_VENDITA_PRESTAZIONE',
          weight: 20,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        hasCommercialSubtitle = true;
        break;
      }
    }

    // 1c. Intestazione tabella articoli retail (es. "DESCRIZIONE PREZZO IVA", "DESCRIZIONE pREZZOLE) IVA")
    const tableHeaderRegex = /\bDESCRIZIONE\b.*?(?:PREZZO|PREZZOLE\)?|IMPORTO|VALORE|EUR(?:O)?).*?\bIVA\b/i;
    let hasTableHeader = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (tableHeaderRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'COMMERCIAL_RECEIPT',
          signal: 'TABLE_HEADER_DESCRIZIONE_PREZZO_IVA',
          weight: 20,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        hasTableHeader = true;
        break;
      }
    }

    // 2. Metadati Registratore Telematico / Misuratore Fiscale / RT
    // Supporta anche matricole RT con spazi intermedi generati dall'OCR (es. "RT  96 1KN022623")
    const rtRegex =
      /\b(?:REGISTRATORE\s+TELEMATICO|MISURATORE\s+FISCALE|MATRICOLA\s+FISCALE)\b|\bRT\s+[0-9A-Z]{2,}(?:\s*[0-9A-Z]{4,})+|\bDOCUMENTO\s+N\.?\s*\d+[-/]\d+/i;
    let hasFiscalRegister = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (rtRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'COMMERCIAL_RECEIPT',
          signal: 'FISCAL_REGISTER_METADATA',
          weight: 20,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        hasFiscalRegister = true;
        break;
      }
    }

    // 3. Conteggio articoli retail (es. "NUMERO ARTICOLI : 9", "TOTALE PEZZI : 3", "N. PEZZI 11")
    const itemCountRegex = /\b(?:NUMERO\s+(?:DI\s+)?ARTICOLI|TOTALE\s+PEZZI|N\.?\s*(?:PEZZI|ARTICOLI))\s*[:\s]+\d+/i;
    let hasItemCount = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (itemCountRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'COMMERCIAL_RECEIPT',
          signal: 'ITEM_COUNT_INDICATOR',
          weight: 25,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        hasItemCount = true;
        break;
      }
    }

    // 3b. Righe con prezzi retail di articoli multipli su righe distinte
    const retailSummaryExclusionRegex =
      /\b(?:TOTALE|IMPONIBILE|IVA|CANONE|SCADENZA|BOLLETTA|SPESE|COMMISSION|IMPORTO|PAGATO)\b/i;
    const priceLineRegex = /\b\d+[.,]\d{2}\s*(?:€|EUR|[A-Z])?\b/;
    let retailItemLinesCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i].normalizedText;
      if (priceLineRegex.test(lineText) && !retailSummaryExclusionRegex.test(lineText)) {
        retailItemLinesCount++;
      }
    }
    const hasMultiLinePrices = retailItemLinesCount >= 3;
    if (hasMultiLinePrices) {
      evidences.push({
        category: 'COMMERCIAL_RECEIPT',
        signal: 'RETAIL_MULTI_LINE_PRICES',
        weight: 15,
        rawSnippet: `${retailItemLinesCount} righe articoli con importi decimali`,
      });
    }

    // 4. Righe con aliquote IVA tipiche al dettaglio (4,00%, 10,00%, 22,00%, 5,00%)
    const vatRateLineRegex = /(?:4|5|10|22)(?:[.,]00)?\s*%/;
    let vatLinesCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (vatRateLineRegex.test(line.normalizedText)) {
        vatLinesCount++;
      }
    }
    if (vatLinesCount >= 2) {
      evidences.push({
        category: 'COMMERCIAL_RECEIPT',
        signal: 'MULTIPLE_VAT_RATE_LINES',
        weight: 30,
        rawSnippet: `${vatLinesCount} righe con aliquota IVA esplicita (4%/10%/22%)`,
      });
    } else if (vatLinesCount === 1) {
      evidences.push({
        category: 'COMMERCIAL_RECEIPT',
        signal: 'SINGLE_VAT_RATE_LINE',
        weight: 15,
        rawSnippet: '1 riga con aliquota IVA',
      });
    }

    // 5. Struttura Cassa / Subtotale / Resto / Forme di Pagamento Commerciali
    let hasSubtotal = false;
    if (/\bSUBTOTAL(?:E)?\b/i.test(upperFull)) {
      evidences.push({
        category: 'COMMERCIAL_RECEIPT',
        signal: 'SUBTOTAL_KEYWORD',
        weight: 15,
        rawSnippet: 'SUBTOTAL',
      });
      hasSubtotal = true;
    }

    if (/RESTO\s*[:\s]+\d+[.,]\d{2}/i.test(upperFull)) {
      evidences.push({
        category: 'COMMERCIAL_RECEIPT',
        signal: 'CHANGE_RESTO_KEYWORD',
        weight: 20,
        rawSnippet: 'RESTO',
      });
    }

    if (/DETTAGLIO\s+(?:FORME\s+(?:DI\s+)?)?PAGAMENT[OI]/i.test(upperFull)) {
      evidences.push({
        category: 'COMMERCIAL_RECEIPT',
        signal: 'PAYMENT_FORMS_DETAIL_HEADER',
        weight: 15,
        rawSnippet: 'DETTAGLIO PAGAMENTI',
      });
    }

    // 1d. Intestazione commerciale degradata CORROBORATA da struttura retail
    // Riconosce "DOCUMENTO COMMERCI..." solo se corroborata da almeno un segnale strutturale
    // (sottotitolo vendita/prestazione, intestazione colonne, conteggio pezzi, RT o subtotale)
    if (!hasExplicitHeader) {
      const degradedHeaderRegex = /\bDOCUMENTO\s+COMMERCI(?:[A-Z0-9\s/._…£$*~-]{0,10})\b/i;
      let degradedHeaderLine: { rawIndex: number; rawText: string } | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (degradedHeaderRegex.test(line.normalizedText)) {
          degradedHeaderLine = line;
          break;
        }
      }

      if (degradedHeaderLine) {
        const corroborationCount =
          (hasCommercialSubtitle ? 1 : 0) +
          (hasTableHeader ? 1 : 0) +
          (hasItemCount ? 1 : 0) +
          (hasMultiLinePrices ? 1 : 0) +
          (hasFiscalRegister ? 1 : 0) +
          (hasSubtotal ? 1 : 0);

        if (corroborationCount >= 1) {
          evidences.push({
            category: 'COMMERCIAL_RECEIPT',
            signal: 'CORROBORATED_DEGRADED_HEADER_COMMERCIAL_DOCUMENT',
            weight: 45,
            rawSnippet: degradedHeaderLine.rawText,
            lineIndex: degradedHeaderLine.rawIndex,
          });
        }
      }
    }

    // 6. Indicatori Cassiere / Cassa retail
    if (/\b(?:CASSIERE|CASSA\s*(?:\d+|[:|=])|NEG-TERM-CASSIERE)\b/i.test(upperFull)) {
      evidences.push({
        category: 'COMMERCIAL_RECEIPT',
        signal: 'RETAIL_CASHIER_METADATA',
        weight: 10,
        rawSnippet: 'Cassiere/Cassa metadata',
      });
    }
  }

  /**
   * Estrae evidenze per PAYMENT_PROOF (POS, PagoPA, Bonifico SEPA, Quietanza di pagamento)
   */
  private static extractPaymentProofEvidences(
    lines: readonly { rawIndex: number; rawText: string; normalizedText: string }[],
    normalizedText: string,
    rawText: string,
    evidences: DocumentTypeEvidence[]
  ): void {
    const upperFull = `${normalizedText}\n${rawText}`.toUpperCase();

    // A. PagoPA
    if (/\bPAGOPA\b/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'PAGOPA_KEYWORD',
        weight: 40,
        rawSnippet: 'PagoPA',
      });
    }

    const iuvRegex = /\bIUV\b|\bI\.U\.V\b|IDENTIFICATIVO\s+UNICO\s+DI\s+VERSAMENTO/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (iuvRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'PAGOPA_IUV_IDENTIFIER',
          weight: 45,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    if (/ENTE\s+CREDITORE/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'CREDITOR_ENTITY_KEYWORD',
        weight: 20,
        rawSnippet: 'Ente Creditore',
      });
    }

    if (/COMMISSION(?:I|E)\s+APPLICAT[AE]|COMMISSIONE\s*[:\s]+\d+[.,]\d{2}/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'PAYMENT_FEE_KEYWORD',
        weight: 25,
        rawSnippet: 'Commissione applicata',
      });
    }

    // B. Ricevuta Bonifico Bancario / SEPA
    const bonificoHeaderRegex =
      /RICEVUTA\s+BONIFICO|DISPOSIZIONE\s+BONIFICO|BONIFICO\s+SEPA|SEPA\s+CREDIT\s+TRANSFER|CONFERMA\s+OPERAZIONE\s+BONIFICO/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (bonificoHeaderRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'BANK_TRANSFER_RECEIPT_HEADER',
          weight: 45,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    const trnRegex = /\bTRN\b|\bC\.?R\.?O\.?\b|CODICE\s+RIFERIMENTO\s+OPERAZIONE/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (trnRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'BANK_TRANSFER_TRN_CRO',
          weight: 40,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    const ibanRegex = /\bIBAN\s*(?:BENEFICIARIO|ORDINANTE)?\s*[:\s]*[A-Z]{2}\d{2}[A-Z0-9]{10,}/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (ibanRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'IBAN_IDENTIFIER',
          weight: 25,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    if (/BENEFICIARIO\s*:/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'BENEFICIARY_FIELD',
        weight: 15,
        rawSnippet: 'Beneficiario',
      });
    }

    if (/DATA\s+(?:ESECUZIONE|VALUTA)\s*:/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'EXECUTION_OR_VALUE_DATE',
        weight: 15,
        rawSnippet: 'Data esecuzione/valuta',
      });
    }

    // C. Scontrino / Ricevuta POS
    const posHeaderRegex =
      /RICEVUTA\s+POS|SCONTRINO\s+POS|PAGAMENTO\s+POS|TRANSAZIONE\s+BANCARIA|RICEVUTA\s+BANCOMAT/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (posHeaderRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'POS_RECEIPT_HEADER',
          weight: 40,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    if (/\b(?:MEMORIA\s+CLIENTE|COPIA\s+CLIENTE|COPIA\s+ESERCENTE)\b/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'POS_CLIENT_COPY_KEYWORD',
        weight: 25,
        rawSnippet: 'Memoria/Copia cliente',
      });
    }

    // STAN, TID, TML, AUTH CODE
    const stanTidRegex = /\b(?:STAN|S\.T\.A\.N|TID|TERMINAL\s+ID|TML)\s*[:\s]*\d+/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (stanTidRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'POS_STAN_OR_TID',
          weight: 30,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    const authRegex =
      /\b(?:AUTORIZZAZIONE|CODICE\s+AUTORIZZAZIONE|AUTH\s+CODE|AUT(?:\.|\b)(?:\s*CODE)?)\s*[:\s]*[0-9A-Z]+/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (authRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'POS_AUTH_CODE',
          weight: 20,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    // Masked PAN (es. **** **** **** 1234, ************1234, 5353 **** **** 4123)
    const maskedPanRegex = /(?:\*{4}[-\s]?){2,3}\d{4}|\d{4}[-\s]?\*{4}[-\s]?\*{4}[-\s]?\d{4}|\*{6,}\d{4}/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (maskedPanRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'MASKED_PAN_CARD_NUMBER',
          weight: 25,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    // Esito / Transazione eseguita / PIN Verificato
    const outcomeRegex =
      /TRANSAZIONE\s+ESEGUITA|OPERAZIONE\s+ESEGUITA|PAGAMENTO\s+APPROVATO|TRANSAZIONE\s+ACCETTATA|PAGAMENTO\s+ESEGUITO|PIN\s+VERIFICATO|ESITO\s*:\s*OK|ESITO\s+POSITIVO|APPROVED/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (outcomeRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'PAYMENT_TRANSACTION_OUTCOME_OK',
          weight: 30,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    // Protocolli e circuiti di pagamento elettronico / POS (es. SEPA-FAST, PAGOBANCOMAT, C-LESS)
    if (/\b(?:SEPA-FAST|SEPA\s+FAST|PAGOBANCOMAT|BANCOMAT\s+C-LESS|DEBIT\s+MASTERCARD|VISA\s+DEBIT)\b/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'POS_CIRCUIT_OR_PROTOCOL',
        weight: 25,
        rawSnippet: 'Circuito / Protocollo POS rilevato',
      });
    }

    // Quietanza di pagamento / Attestazione
    if (/QUIETANZA\s+DI\s+PAGAMENTO|ATTESTAZIONE\s+DI\s+PAGAMENTO|BOLLETTINO\s+POSTALE/i.test(upperFull)) {
      evidences.push({
        category: 'PAYMENT_PROOF',
        signal: 'PAYMENT_RECEIPT_QUIETANZA',
        weight: 35,
        rawSnippet: 'Quietanza/Attestazione pagamento',
      });
    }

    // D. Transazioni e Ricevute di Pagamento Crypto / Blockchain a favore di esercente/beneficiario
    const cryptoTxIdRegex =
      /\b(?:TRANSACTION\s+ID|TXID|TX\s+ID|TX\s*HASH|HASH\s+TRANSAZIONE|BLOCKCHAIN\s+TX)\s*[:\s]*[0-9A-Za-z_-]{6,}/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (cryptoTxIdRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'CRYPTO_TRANSACTION_HASH_OR_ID',
          weight: 35,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    const cryptoNetworkFeeRegex =
      /\b(?:COMMISSIONE\s+RETE|NETWORK\s+FEE|GAS\s+FEE|COMMISSIONI\s+BLOCKCHAIN)\s*[:\s]*/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (cryptoNetworkFeeRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'CRYPTO_NETWORK_FEE',
          weight: 25,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    const cryptoCountervalueRegex =
      /\b(?:CONTROVALORE(?:\s+EUR)?|EQUIVALENTE(?:\s+EUR)?|IMPORTO\s+EUR)\s*[:\s]*[€]?\s*\d+(?:[.,]\d{2})?/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (cryptoCountervalueRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'PAYMENT_PROOF',
          signal: 'CRYPTO_COUNTERVALUE_EUR',
          weight: 25,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }
  }

  /**
   * Estrae evidenze per INVOICE_OR_BILL (Fattura, bolletta utenze energetiche/idriche/telefonia)
   */
  private static extractInvoiceOrBillEvidences(
    lines: readonly { rawIndex: number; rawText: string; normalizedText: string }[],
    normalizedText: string,
    rawText: string,
    evidences: DocumentTypeEvidence[]
  ): void {
    const upperFull = `${normalizedText}\n${rawText}`.toUpperCase();

    // 1. Intestazione Fattura / Bolletta / Parcella
    const invoiceHeaderRegex =
      /\bFATTURA\s+ELETTRONICA\b|\bFATTURA\s+N\.?\b|\bNUMERO\s+FATTURA\b|\bBOLLETTA\b|\bESTRATTO\s+CONTO\s+ENERGETICO\b|\bPARCELLA\b|\bNOTA\s+DI\s+CREDITO\b/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (invoiceHeaderRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'INVOICE_OR_BILL',
          signal: 'EXPLICIT_INVOICE_OR_BILL_HEADER',
          weight: 45,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    // Se c'è solo la parola "FATTURA" isolata non preceduta da "NON FISCALE"
    if (!evidences.some((e) => e.category === 'INVOICE_OR_BILL' && e.signal.includes('INVOICE_OR_BILL_HEADER'))) {
      if (/\bFATTURA\b/i.test(upperFull) && !/\bNON\s+FATTURA\b/i.test(upperFull)) {
        evidences.push({
          category: 'INVOICE_OR_BILL',
          signal: 'INVOICE_KEYWORD',
          weight: 25,
          rawSnippet: 'Fattura',
        });
      }
    }

    // 2. Periodo di fatturazione / Periodo di consumo
    const periodRegex = /PERIODO\s+(?:DI\s+)?FATTURAZIONE|PERIODO\s+FATTURATO|PERIODO\s+(?:DI\s+)?CONSUMO/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (periodRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'INVOICE_OR_BILL',
          signal: 'BILLING_PERIOD_KEYWORD',
          weight: 25,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    // 3. Data Scadenza / Scadenza fattura
    const dueDateRegex = /DATA\s+SCADENZA|SCADENZA\s+FATTURA|SCADENZA\s+PAGAMENTO|SCADENZA\s*[:\s]+\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (dueDateRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'INVOICE_OR_BILL',
          signal: 'DUE_DATE_KEYWORD',
          weight: 25,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    // 4. Fornitura / Consumi Utenze (POD, PDR, kWh, Smc, potenza impegnata)
    const utilitySupplyRegex =
      /\bPOD\s*[:\s]*[A-Z0-9]{10,}|\bPDR\s*[:\s]*\d{10,}|\bPOTENZA\s+IMPEGNATA\b|FORNITURA\s+(?:ENERGIA|GAS|LUCE|ACQUA|TELEFONIA|FIBRA|INTERNET)/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (utilitySupplyRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'INVOICE_OR_BILL',
          signal: 'UTILITY_SUPPLY_SPECIFICS',
          weight: 35,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    const consumptionUnitsRegex = /\b\d+(?:[.,]\d+)?\s*(?:KWH|SMC|M3|METRI\s+CUBI)\b/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (consumptionUnitsRegex.test(line.normalizedText)) {
        evidences.push({
          category: 'INVOICE_OR_BILL',
          signal: 'CONSUMPTION_ENERGY_METRICS',
          weight: 20,
          rawSnippet: line.rawText,
          lineIndex: line.rawIndex,
        });
        break;
      }
    }

    // 5. Imponibile / Scissione Pagamenti / Riepilogo Servizi
    if (/TOTALE\s+IMPONIBILE|SCISSIONE\s+DEI\s+PAGAMENTI|SPLIT\s+PAYMENT/i.test(upperFull)) {
      evidences.push({
        category: 'INVOICE_OR_BILL',
        signal: 'INVOICE_ACCOUNTING_BREAKDOWN',
        weight: 20,
        rawSnippet: 'Totale imponibile / Split payment',
      });
    }

    if (/TOTALE\s+(?:DA\s+PAGARE|FATTURA|BOLLETTA)/i.test(upperFull)) {
      evidences.push({
        category: 'INVOICE_OR_BILL',
        signal: 'INVOICE_TOTAL_KEYWORD',
        weight: 15,
        rawSnippet: 'Totale fattura/bolletta',
      });
    }
  }
}
