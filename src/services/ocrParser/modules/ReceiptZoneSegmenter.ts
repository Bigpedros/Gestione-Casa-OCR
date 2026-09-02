import { NormalizedOcrText, ReceiptZones, SegmentedReceiptLine, ReceiptZoneType } from '../types';
import { TextNormalizationModule } from './TextNormalizationModule';

/**
 * RECEIPT ZONE SEGMENTER (Architettura Regola Ceccotti - Blocco 1)
 *
 * Responsabilità UNICA:
 * Classificare e segmentare sequenzialmente le righe normalizzate di uno scontrino
 * nelle sue 4 macro-zone strutturali:
 * 1. HEADER (Intestazione negozio, dati fiscali, forma societaria, indirizzo)
 * 2. BODY (Articoli, descrizioni, quantità, prezzi, sconti di riga, modificatori)
 * 3. TOTALS_FOOTER (Subtotale, sconti/arrotondamenti di chiusura, Totale complessivo, Pagamento, Resto)
 * 4. TRAILING_METADATA (Data/ora fiscali, Doc. N., RT, numero articoli, matricola cassa, saluti)
 * 5. AMBIGUOUS (Righe con evidenze contrastanti o rumore isolato non classificabile con certezza)
 *
 * NON DEVE:
 * - Estrarre o istanziare prodotti o prezzi
 * - Riconoscere fornitori
 * - Calcolare il totale del documento o quadrare i conti
 * - Modificare il testo o i caratteri delle righe
 */
export class ReceiptZoneSegmenter {
  public static readonly name = 'ReceiptZoneSegmenter';

  /**
   * Esegue la segmentazione a zone a partire da una stringa rawText o da un NormalizedOcrText strutturato.
   */
  public static segment(input: string | NormalizedOcrText): ReceiptZones {
    const normText: NormalizedOcrText = typeof input === 'string'
      ? this.buildNormalizedOcrText(input)
      : input;

    const lines = normText.lines;
    if (!lines || lines.length === 0) {
      return {
        header: [],
        body: [],
        totalsFooter: [],
        trailingMetadata: [],
        ambiguous: [],
        allLines: [],
      };
    }

    const n = lines.length;

    // FASE 1: Identificazione dei confini (Anchors)

    // A. Ricerca dell'intestazione tabella esplicita (es. "DESCRIZIONE IVA EURO", "ARTICOLO PREZZO", ecc.)
    let tableHeaderIndex = -1;
    for (let i = 0; i < n; i++) {
      if (this.isExplicitTableHeader(lines[i].normalizedText)) {
        tableHeaderIndex = i;
        break;
      }
    }

    // B. Ricerca della prima riga articolo certa (Anchor Body Start)
    let firstItemIndex = -1;
    for (let i = 0; i < n; i++) {
      // Se abbiamo superato o trovato l'intestazione tabella, consideriamo solo dopo
      if (tableHeaderIndex !== -1 && i <= tableHeaderIndex) {
        continue;
      }

      // Valutazione evidenze articolo vs header
      if (this.hasStrongItemCharacteristics(lines[i].normalizedText) && !this.hasStrongHeaderCharacteristics(lines[i].normalizedText)) {
        firstItemIndex = i;
        break;
      }
    }

    // Confine di inizio del Body:
    // Se c'è intestazione tabella ("DESCRIZIONE IVA...", ecc.), cerchiamo dopo l'intestazione se ci sono righe di rumore pre-tabellari note (es. "245 + Lao È", "O AZZ a")
    // e impostiamo il bodyStartIndex subito dopo di esse, oppure a tableHeaderIndex + 1.
    let bodyStartIndex = n; // default: nessun body
    if (tableHeaderIndex !== -1) {
      let candidateStart = tableHeaderIndex + 1;
      while (candidateStart < n && this.isHeaderNoiseOrDepartment(lines[candidateStart].normalizedText)) {
        candidateStart++;
      }
      bodyStartIndex = candidateStart;
    } else if (firstItemIndex !== -1) {
      bodyStartIndex = firstItemIndex;
    }

    // C. Ricerca della chiusura del Body e inizio della Totals/Footer Zone (Anchor Totals Start)
    // Cerchiamo le parole chiave di totalizzazione: SUBTOTALE, TOTALE, TOTALE COMPLESSIVO, IMPORTO PAGATO, CONTANTE, RESTO
    let totalsStartIndex = -1;
    for (let i = Math.max(0, bodyStartIndex); i < n; i++) {
      const text = lines[i].normalizedText;
      if (this.isTotalsStartAnchor(text)) {
        totalsStartIndex = i;
        break;
      }
    }

    // Se non troviamo una riga di totale esplicita, cerchiamo righe di pagamento / resto
    if (totalsStartIndex === -1) {
      for (let i = Math.max(0, bodyStartIndex); i < n; i++) {
        const text = lines[i].normalizedText;
        if (this.isPaymentOrRestoAnchor(text)) {
          totalsStartIndex = i;
          break;
        }
      }
    }

    // Se ancora non troviamo totali, il body si estende fino alla fine o alle trailing metadata
    if (totalsStartIndex === -1) {
      totalsStartIndex = n;
    }

    // D. Ricerca della fine della Totals/Footer Zone e inizio di Trailing Metadata (Anchor Metadata Start)
    // Trailing metadata comprende: DOCUMENTO N., RT, ART, DETTAGLIO FORME DI PAGAMENTO, NUMERO DI ARTICOLI, matricola, ARRIVEDERCI
    // NOTA: Se queste righe si trovano DOPO il totale complessivo o dopo pagamento/resto, appartengono a TRAILING_METADATA.
    let trailingStartIndex = n;
    let foundFinalTotalOrPayment = false;

    for (let i = totalsStartIndex; i < n; i++) {
      const text = lines[i].normalizedText;

      // Se incontriamo TOTALE COMPLESSIVO, PAGAMENTO o RESTO o IMPORTO PAGATO, segnamo che siamo nella fase conclusiva dei totali
      if (this.isFinalTotalOrPayment(text)) {
        foundFinalTotalOrPayment = true;
        continue;
      }

      // Se abbiamo già visto il totale/pagamento e ora troviamo metadati fiscali/chiusura
      if (foundFinalTotalOrPayment && this.isTrailingMetadataLine(text)) {
        trailingStartIndex = i;
        break;
      }
    }

    // FASE 2: Classificazione e assegnazione con motivazioni tracciate
    const segmentedLines: SegmentedReceiptLine[] = [];

    for (let i = 0; i < n; i++) {
      const line = lines[i];
      const text = line.normalizedText;
      let zone: ReceiptZoneType;
      const reasons: string[] = [];
      let confidence = 0.9;

      if (i < bodyStartIndex) {
        // ZONA HEADER
        if (i === tableHeaderIndex) {
          zone = 'HEADER';
          reasons.push('explicit_table_header_delimiter');
          confidence = 0.98;
        } else if (this.hasStrongHeaderCharacteristics(text)) {
          zone = 'HEADER';
          reasons.push('strong_header_features (legal_entity/address/vat/tax)');
          confidence = 0.95;
        } else if (this.isHeaderNoiseOrDepartment(text)) {
          zone = 'HEADER';
          reasons.push('pre_table_noise_or_store_data');
          confidence = 0.85;
        } else {
          zone = 'HEADER';
          reasons.push('position_before_body_start');
          confidence = 0.8;
        }
      } else if (i >= bodyStartIndex && i < totalsStartIndex) {
        // ZONA BODY (Articoli / Modificatori)
        if (this.hasStrongItemCharacteristics(text)) {
          zone = 'BODY';
          reasons.push('strong_item_characteristics (description_and_price)');
          confidence = 0.95;
        } else if (this.isItemSpecificationOrModifier(text)) {
          zone = 'BODY';
          reasons.push('item_specification_or_modifier (multiplier/weight/vat_subline)');
          confidence = 0.9;
        } else if (this.isItemDiscountLine(text)) {
          zone = 'BODY';
          reasons.push('in_body_item_discount_or_rounding');
          confidence = 0.92;
        } else if (this.isAmbiguousNoise(text)) {
          // Riga isolata priva di significato nel mezzo degli articoli
          zone = 'AMBIGUOUS';
          reasons.push('unrecognized_mid_body_token');
          confidence = 0.5;
        } else {
          zone = 'BODY';
          reasons.push('contained_in_body_zone');
          confidence = 0.75;
        }
      } else if (i >= totalsStartIndex && i < trailingStartIndex) {
        // ZONA TOTALS_FOOTER
        if (this.isTotalsStartAnchor(text)) {
          zone = 'TOTALS_FOOTER';
          reasons.push('totals_anchor (subtotal/total)');
          confidence = 0.98;
        } else if (this.isPostSubtotalModifier(text)) {
          zone = 'TOTALS_FOOTER';
          reasons.push('post_subtotal_discount_or_rounding');
          confidence = 0.95;
        } else if (this.isPaymentOrRestoAnchor(text)) {
          zone = 'TOTALS_FOOTER';
          reasons.push('payment_or_resto_line');
          confidence = 0.95;
        } else {
          zone = 'TOTALS_FOOTER';
          reasons.push('within_totals_footer_boundary');
          confidence = 0.85;
        }
      } else {
        // ZONA TRAILING_METADATA
        zone = 'TRAILING_METADATA';
        if (this.isTrailingMetadataLine(text)) {
          reasons.push('trailing_fiscal_or_register_metadata');
          confidence = 0.95;
        } else {
          reasons.push('position_after_totals_completion');
          confidence = 0.85;
        }
      }

      segmentedLines.push({
        index: i,
        rawIndex: line.rawIndex,
        text: line.normalizedText,
        rawText: line.rawText,
        zone,
        confidence,
        reasons,
      });
    }

    const header = segmentedLines.filter(l => l.zone === 'HEADER');
    const body = segmentedLines.filter(l => l.zone === 'BODY');
    const totalsFooter = segmentedLines.filter(l => l.zone === 'TOTALS_FOOTER');
    const trailingMetadata = segmentedLines.filter(l => l.zone === 'TRAILING_METADATA');
    const ambiguous = segmentedLines.filter(l => l.zone === 'AMBIGUOUS');

    return {
      header,
      body,
      totalsFooter,
      trailingMetadata,
      ambiguous,
      allLines: segmentedLines,
    };
  }

  /**
   * Costruisce un NormalizedOcrText mantenendo rigorosamente il mapping indice per indice con il rawText,
   * delegando a TextNormalizationModule.
   */
  public static buildNormalizedOcrText(rawText: string): NormalizedOcrText {
    return TextNormalizationModule.normalizeToStructuredOcrText(rawText);
  }

  // =========================================================================
  // PREDICATI E REGOLE DI EVIDENZA MULTIPLA
  // =========================================================================

  private static isExplicitTableHeader(text: string): boolean {
    const u = text.toUpperCase();
    return (
      (u.includes('DESCRIZIONE') && (u.includes('EURO') || u.includes('PREZZO') || u.includes('IVA') || u.includes('IMPORTO'))) ||
      (u.includes('DESTZINE') && (u.includes('PREZZO') || u.includes('PRAGZOL') || u.includes('EURO'))) ||
      (u.includes('DESCR') && (u.includes('IVA') || u.includes('IMA') || u.includes('PREZZO'))) ||
      (u.includes('ARTICOLO') && (u.includes('PREZZO') || u.includes('EURO') || u.includes('TOTALE'))) ||
      (u.includes('Q.TA') && (u.includes('PREZZO') || u.includes('DESCRIZIONE'))) ||
      /^DESCRIZIONE\s+IVA\s+EURO$/i.test(u) ||
      /^PESCRZIONE\s+IMA\s+PREZZO/i.test(u)
    );
  }

  private static hasStrongHeaderCharacteristics(text: string): boolean {
    const u = text.toUpperCase();
    return (
      /\b(?:S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|S\.?R\.?\])\b/i.test(u) ||
      /\b(?:P\.?\s*IVA|P\.?\s*I\.?\s*V\.?\s*A\.?|PP\s*IVA|PARTITA\s*IVA|COD\.?\s*FISC|C\.?\s*F\.?)\b/i.test(u) ||
      /\b(?:VIA|CORSO|PIAZZA|VIALE|LARGO|STRADA|LOC\.?|FRAZ\.?)\b.*\b\d+/i.test(u) ||
      /\b(?:DOCUMENTO\s+COMMERCIALE|DOCIMENTO\s+COMMERCIALE|DOCIMENTO|SCONTRINO\s+FISCALE|RICEVUTA\s+FISCALE)\b/i.test(u) ||
      /\b(?:DI\s+VENDITA\s+[O0]\s+PRESTAZIONE|VENDITA\s+[O0]\s+PRESTAZIONE)\b/i.test(u) ||
      /\b(?:CASSA|CASSIERE|OPERATORE|TERMINALE|REGISTRATORE)\b/i.test(u) ||
      /\b(?:TEL|FAX|EMAIL|PEC|CAP)\b/i.test(u)
    );
  }

  private static isHeaderNoiseOrDepartment(text: string): boolean {
    const u = text.toUpperCase();
    return (
      /^\d+\s*[-+]\s*[\p{L}\p{N}\s]+$/u.test(u) || // es. "245 + Lao È"
      /^[O0]\s+[\p{L}\s]+$/u.test(u) ||           // es. "O AZZ a"
      /^\d{2,5}\b/.test(u) && u.length < 10
    );
  }

  private static hasStrongItemCharacteristics(text: string): boolean {
    const u = text.toUpperCase();

    // Se contiene parole esclusive di totale o header fiscale, non è un articolo certo
    if (this.isTotalsStartAnchor(text) || this.isExplicitTableHeader(text) || this.hasStrongHeaderCharacteristics(text)) {
      return false;
    }

    // Pattern 1: Aliquota IVA esplicita (es. "22,00%", "4,00%", "10,00%", "22%", "4%")
    const hasVatRate = /\b(?:\d{1,2}(?:[.,]\d{2})?\s*%)|(?:%\s*\d{1,2})/.test(u);

    // Pattern 2: Testo descrizione + Prezzo decimale standard o valuta
    // es. "PATATINE KETTLE oo 1,99 PA A i", "PASTA BARILLA 500G 1,15", "CAFFE 1,20"
    const hasDecimalPrice = /[-−]?\s*\d{1,4}[.,]\d{2}\b/.test(u);

    // Pattern 3: Almeno una parola o token alfabetico significativo
    const hasLetters = /[A-Z]{3,}/i.test(u);

    if (hasLetters && (hasVatRate || hasDecimalPrice)) {
      return true;
    }

    // Pattern 4: Codici prodotto o descrizioni commerciali con token prezzi/reparto (es. "189 PRA", "6.99 PRA", "002 PERA")
    const hasCommercialTokens = /\b\d{2,4}\s+(?:PRA|BC|IBRIDO|PERA|PA|PZ|P\.P\.)\b/i.test(u);
    if (hasLetters && hasCommercialTokens) {
      return true;
    }

    return false;
  }

  private static isItemSpecificationOrModifier(text: string): boolean {
    const u = text.toUpperCase();
    return (
      /\d+\s*[xX*]\s*[-−]?\s*\d+[.,]\d{2}/.test(u) || // es. "2 X 1,89"
      /\d+\s*(?:KG|G|GR|L|ML|PZ|CT|CF)\b/i.test(u) ||   // es. "500G 2,50 A"
      /\b(?:PESO|TARA|LORDO|NETTO)\b/i.test(u)
    );
  }

  private static isItemDiscountLine(text: string): boolean {
    const u = text.toUpperCase();
    return (
      /\b(?:SCONTO|BUONO|PROMO|OFFERTA|STORNO|RESO|ARROTONDAMENTO)\b/i.test(u) &&
      /[-−]?\s*\d{1,4}[.,]\d{2}/.test(u)
    );
  }

  private static isTotalsStartAnchor(text: string): boolean {
    const u = text.toUpperCase().replace(/^[‘'"`«“\s*_\-|]+/, '').trim();
    return (
      /\b(?:SUBTOTALE|SUB-TOTALE|SUB\s*TOTALE)\b/i.test(u) ||
      /\b(?:NUMERO\s+(?:DI\s+)?ARTICOLI|NUM\.?\s*ARTICOLI|N\.?\s*ARTICOLI|ARTICOLI\s+\d+|N\.?\s*PEZZI)\b/i.test(u) ||
      /\b(?:TOTALE\s+COMPLESSIVO|TOTALE\s+EURO|TOTALE\s+DOCUMENTO|TOTALE\s+DOC\.?)\b/i.test(u) ||
      /^TOTALE\b/i.test(u)
    );
  }

  private static isPostSubtotalModifier(text: string): boolean {
    const u = text.toUpperCase().replace(/^[‘'"`«“\s*_\-|]+/, '').trim();
    return (
      /\b(?:SCONTO|BUONO|ARROTONDAMENTO|ABBUONO)\b/i.test(u)
    );
  }

  private static isPaymentOrRestoAnchor(text: string): boolean {
    const u = text.toUpperCase().replace(/^[‘'"`«“\s*_\-|]+/, '').trim();
    return (
      /\b(?:PAGAMENTO\s+ELETTRONICO|PAG\.?\s*ELETTRONICO|PAGAMENTO|PAGATO|CONTANTE|CONTANTI|CARTA|BANCOMAT|CREDITO|RESTO|IMPORTO\s+PAGATO|IMPORTO\s+NAGATO)\b/i.test(u)
    );
  }

  private static isFinalTotalOrPayment(text: string): boolean {
    const u = text.toUpperCase().replace(/^[‘'"`«“\s*_\-|]+/, '').trim();
    return (
      /\b(?:TOTALE\s+COMPLESSIVO|TOTALE|PAGAMENTO\s+ELETTRONICO|PAG\.?\s*ELETTRONICO|PAGAMENTO|RESTO|IMPORTO\s+PAGATO|IMPORTO\s+NAGATO)\b/i.test(u)
    );
  }

  private static isTrailingMetadataLine(text: string): boolean {
    const u = text.toUpperCase();
    return (
      /\b(?:DOCUMENTO\s+N\.?|DOC\.?\s*N\.?|RT\b|MATRICOLA|CASSIERE|TERMINALE|TERM\.?)\b/i.test(u) ||
      /\b(?:DETTAGLIO\s+FORME|NUMERO\s+(?:DI\s+)?ARTICOLI|NUM\.?\s*ARTICOLI|ART\s*\d+)\b/i.test(u) ||
      /\b(?:ARRIVEDERCI|GRAZIE|ARRIVEDERCI\s+E\s+GRAZIE)\b/i.test(u) ||
      /\b(?:SERVIZIO\s+CLIENTI|PUNTI\s+FEDELT[AÀ]|SALDO\s+PUNTI)\b/i.test(u) ||
      /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s+\d{1,2}:\d{2}/.test(u) // es. "10/08/2026 12:35"
    );
  }

  private static isAmbiguousNoise(text: string): boolean {
    const u = text.toUpperCase().trim();
    // Stringhe prive di lettere o con solo 1-2 simboli sparsi
    return u.length <= 3 || !/[A-Z0-9]/i.test(u);
  }
}
