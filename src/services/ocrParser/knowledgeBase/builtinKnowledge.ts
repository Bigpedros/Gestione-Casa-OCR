/**
 * =========================================================================
 * RECEIPT KNOWLEDGE BASE v1 — BUILT-IN KNOWLEDGE (LIVELLO 1)
 * =========================================================================
 *
 * Base di conoscenza deterministica, versionata, read-only distribuita con l'applicazione.
 * Derivata dall'analisi del corpus reale di scontrini italiani:
 * EUROSPIN, TODIS, PEWEX, LEROY MERLIN, ORIZZONTE, CARREFOUR CONTACT,
 * D.E. CAFFE', R-STORE, PANIFICIO PANZIERI, EURORISPARMIO CASA,
 * FARMACIA LA NAVE, TUO ESPRESSO SHOP, I QUADRI.
 *
 * NON contiene prezzi, totali o dati economici personali.
 * NON costituisce una whitelist o un'autorità di classificazione esclusiva:
 * fornisce segnali semantici strutturati a supporto del parser.
 */

import { ReceiptKnowledgeEntry, OcrAliasRule } from './types';

export const KNOWLEDGE_BASE_VERSION = '1.0.0';

export const BUILTIN_KNOWLEDGE_ENTRIES: ReceiptKnowledgeEntry[] = [
  // =========================================================================
  // 1. DOCUMENT MARKERS (COMMERCIAL_DOCUMENT_HEADER)
  // =========================================================================
  {
    id: 'doc-comm-header',
    canonical: 'DOCUMENTO COMMERCIALE',
    aliases: [
      'DOCUMENTO COMMERCIALE',
      'DOCUMENTO COMMERCI...',
      'DOCUMENTO COMMERCIA.E',
      'DOCIMENTO COMMERCIALE',
      'DI VENDITA O PRESTAZIONE',
      'di vendita o prestazione',
      'VENDITA O PRESTAZIONE',
      'DI VENDITA',
    ],
    patterns: [
      /\bDOCUMENTO\s+COMMERCI(?:ALE|\.\.\.|A\.E)\b/i,
      /\b(?:DI\s+)?VENDITA\s+O\s+PRESTAZIONE\b/i,
    ],
    semanticRole: 'COMMERCIAL_DOCUMENT_HEADER',
    confidenceWeight: 1.0,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Intestazione standard documento commerciale ex D.Lgs 127/2015',
  },

  // =========================================================================
  // 2. TABLE / ITEM AREA HEADERS (ITEM_TABLE_HEADER)
  // =========================================================================
  {
    id: 'item-table-header-desc',
    canonical: 'DESCRIZIONE',
    aliases: ['DESCRIZIONE', 'DESCRIZ.', 'DESCRZINE', 'DESTZINE', 'DESCRIZIONE IVA', 'DESCRIZIONE / IVA'],
    patterns: [/\bDESCRIZ(?:IONE|INE)?\b/i],
    semanticRole: 'ITEM_TABLE_HEADER',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'item-table-header-price',
    canonical: 'PREZZO',
    aliases: ['PREZZO', 'PREZZO(E)', 'PREZZO (€)', 'PREZZO EUR', 'PREZZO UNITARIO', 'PRAGZOL'],
    patterns: [/\bPREZZO(?:\s*\([€E]\)|\s*EUR)?\b/i],
    semanticRole: 'ITEM_TABLE_HEADER',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'item-table-header-iva',
    canonical: 'IVA',
    aliases: ['IVA', 'ALIQ. IVA', 'ALIQUOTA IVA', 'EURO', 'EUR'],
    patterns: [/^(?:IVA|ALIQ\.?\s*IVA|EURO|EUR)$/i],
    semanticRole: 'ITEM_TABLE_HEADER',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },

  // =========================================================================
  // 3. SUBTOTAL MARKERS (SUBTOTAL)
  // =========================================================================
  {
    id: 'subtotal-marker',
    canonical: 'SUBTOTALE',
    aliases: ['SUBTOTAL', 'SUBTOTALE', 'SUB TOTAL', 'SUB-TOTAL', 'SUB-TOTALE', 'SUB.TOT'],
    patterns: [/\b(?:SUBTOTAL(?:E)?|SUB-TOTAL(?:E)?|SUB\s+TOTAL(?:E)?)\b/i],
    semanticRole: 'SUBTOTAL',
    confidenceWeight: 1.0,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Marker di subtotale. Può essere intermedio se seguito da articoli',
  },

  // =========================================================================
  // 4. FINAL TOTAL MARKERS (FINAL_TOTAL_CANDIDATE)
  // =========================================================================
  {
    id: 'final-total-complessivo',
    canonical: 'TOTALE COMPLESSIVO',
    aliases: [
      'TOTALE COMPLESSIVO',
      'TOTALE(EUR)',
      'TOTALE (EUR)',
      'TOTALE EUR',
      'TOTALE EURO',
      'TOT. GENERALE',
      'TOT GENERALE',
      'TOTALE GENERALE',
      'TOTALE DOCUMENTO',
      'TOTALE DOC.',
    ],
    patterns: [
      /\bTOTALE\s+COMPLESSIVO\b/i,
      /\bTOTALE\s*\((?:EUR|EURO)\)/i,
      /\bTOTALE\s+(?:EUR|EURO)\b/i,
      /\bTOT\.?\s*GENERALE\b/i,
      /^TOTALE(?:\s+(?:COMPLESSIVO|DOCUMENTO|DOC\.?|EURO|EUR))?(?:\s*[:=]?\s*[-−]?\s*\d+[.,]\d{2})?$/i,
    ],
    semanticRole: 'FINAL_TOTAL_CANDIDATE',
    confidenceWeight: 1.0,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },

  // =========================================================================
  // 5. VAT / TAX MARKERS (VAT_TOTAL, VAT_RATE, VAT_METADATA)
  // =========================================================================
  {
    id: 'vat-di-cui',
    canonical: 'DI CUI IVA',
    aliases: ['DI CUI IVA', 'di cui IVA', 'Di cui IVA', 'TOTALE IVA', 'IVA EUR'],
    patterns: [/\bDI\s+CUI\s+IVA\b/i, /\bTOTALE\s+IVA\b/i],
    semanticRole: 'VAT_TOTAL',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'vat-ventilazione',
    canonical: 'VENTILAZIONE',
    aliases: ['VENTILAZIONE', 'VENTILAZIONE IVA', 'VI', 'VI*', '*VI = Ventilazione', '*VI'],
    patterns: [/\bVENTILAZIONE(?:\s+IVA)?\b/i, /^\*?VI(?:\s*=\s*VENTILAZIONE|\*)?$/i],
    semanticRole: 'VAT_METADATA',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },

  // =========================================================================
  // 6. PAYMENT MARKERS (PAYMENT, CASH, CARD, DEBIT, CREDIT, CHANGE, UNPAID)
  // =========================================================================
  {
    id: 'pay-electronic',
    canonical: 'PAGAMENTO ELETTRONICO',
    aliases: ['PAGAMENTO ELETTRONICO', 'Pagamento elettronico', 'PAG. ELETTRONICO', 'PAG ELETTRONICO'],
    patterns: [/\bPAG(?:AMENTO)?\.?\s+ELETTRONICO\b/i],
    semanticRole: 'PAYMENT',
    confidenceWeight: 1.0,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'pay-cash',
    canonical: 'CONTANTE',
    aliases: ['PAGAMENTO CONTANTE', 'Pagamento contante', 'CONTANTE', 'CONTANTI', 'CONTANTE EURO', 'CONTANTI EUR'],
    patterns: [/\b(?:PAGAMENTO\s+)?CONTANT[EI](?:\s+EUR(?:O)?)?\b/i],
    semanticRole: 'CASH_PAYMENT',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'pay-importo-pagato',
    canonical: 'IMPORTO PAGATO',
    aliases: ['IMPORTO PAGATO', 'Importo pagato', 'importo pagato', 'importo nagato', 'IMPORTO PAG.'],
    patterns: [/\bIMPORTO\s+(?:PAGATO|NAGATO|PAG\.)\b/i],
    semanticRole: 'PAYMENT',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'pay-card',
    canonical: 'CARTA DI CREDITO',
    aliases: ['CARTA CREDITO', 'CARTA DI CREDITO', 'Pag. Carta di Credito', 'C.CREDITO', 'CARTA'],
    patterns: [/\b(?:PAG\.?\s+)?CARTA(?:\s+DI)?\s+CREDITO\b/i, /\bC\.CREDITO\b/i],
    semanticRole: 'CARD_PAYMENT',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'pay-pos-bancomat',
    canonical: 'BANCOMAT',
    aliases: ['BANCOMAT', 'PAGOBANCOMAT', 'POS', 'POS BANCOMAT', 'POS/BANCOMAT'],
    patterns: [/\b(?:POS\s+)?(?:PAGO)?BANCOMAT\b/i, /^POS\b/i],
    semanticRole: 'DEBIT_CARD_PAYMENT',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'pay-unpaid-credit',
    canonical: 'NON RISCOSSO',
    aliases: ['CREDITO', 'NON RISCOSSO', 'A CREDITO'],
    patterns: [/\bNON\s+RISCOSSO\b/i, /^CREDITO$/i],
    semanticRole: 'UNPAID_OR_CREDIT_STATUS',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'pay-change-resto',
    canonical: 'RESTO',
    aliases: ['RESTO', 'Resto', 'RESTO EURO', 'RESTO EUR'],
    patterns: [/^RESTO(?:\s+EUR(?:O)?)?\b/i],
    semanticRole: 'CHANGE',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },

  // =========================================================================
  // 7. PAYMENT PROOF / POS MARKERS (PAYMENT_PROOF_EVIDENCE)
  // =========================================================================
  {
    id: 'proof-sepa-fast',
    canonical: 'SEPA-FAST',
    aliases: ['SEPA-FAST', 'SEPA FAST', 'SEPA'],
    patterns: [/\bSEPA[\s-]FAST\b/i],
    semanticRole: 'PAYMENT_PROOF_EVIDENCE',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'proof-contactless',
    canonical: 'CONTACTLESS',
    aliases: ['CONTACTLESS', 'C-LESS', 'CLSS'],
    patterns: [/\b(?:CONTACTLESS|C-LESS)\b/i],
    semanticRole: 'PAYMENT_PROOF_EVIDENCE',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'proof-terminal-fields',
    canonical: 'TERMINAL_IDENTIFIERS',
    aliases: ['MID', 'TML', 'A.ID', 'A ID', 'APPL', 'PAN', 'STAN', 'COD. AUT.', 'COD AUT', 'AUT'],
    patterns: [
      /\b(?:MID|TML|STAN|APPL)\s*[:#]?\s*[A-Z0-9]+/i,
      /\bA\.?ID\s*[:#]?\s*[A-Z0-9]+/i,
      /\bPAN\s*[:#]?\s*[*X\d]+/i,
      /\bCOD\.?\s*AUT\.?\s*[:#]?\s*[A-Z0-9]+/i,
    ],
    semanticRole: 'PAYMENT_PROOF_EVIDENCE',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'proof-cards-networks',
    canonical: 'CARD_NETWORKS',
    aliases: ['DEBIT MASTERCARD', 'MASTERCARD', 'VISA DEBIT', 'VISA ELECTRON', 'VISA', 'V-PAY', 'MAESTRO', 'AMEX', 'AMERICAN EXPRESS'],
    patterns: [/\b(?:DEBIT\s+)?MASTERCARD\b/i, /\bVISA(?:\s+DEBIT|\s+ELECTRON)?\b/i, /\bMAESTRO\b/i],
    semanticRole: 'PAYMENT_PROOF_EVIDENCE',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'proof-transaction-status',
    canonical: 'TRANSACTION_STATUS',
    aliases: [
      'PIN VERIFICATO',
      'PAGAMENTO APPROVATO',
      'RICEVUTA CLIENTE',
      'TRANSAZIONE ESEGUITA',
      'TRANSAZIONE OK',
      'COPIA CLIENTE',
      'COPIA ESERCENTE',
      'MEMORIA CLIENTE',
    ],
    patterns: [
      /\bPIN\s+VERIFICATO\b/i,
      /\bPAGAMENTO\s+APPROVATO\b/i,
      /\bRICEVUTA\s+CLIENTE\b/i,
      /\bTRANSAZIONE\s+ESEGUITA\b/i,
    ],
    semanticRole: 'PAYMENT_PROOF_EVIDENCE',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },

  // =========================================================================
  // 8. TRAILING FISCAL / REGISTER METADATA (TRAILING_METADATA)
  // =========================================================================
  {
    id: 'trailing-doc-num',
    canonical: 'DOCUMENTO N.',
    aliases: ['DOCUMENTO N.', 'DOCUMENTO N', 'DOC. N.', 'DOC N.', 'DOC.', 'DOC.N.'],
    patterns: [/\b(?:DOCUMENTO|DOC)\.?\s*N\.?\s*\d+/i],
    semanticRole: 'TRAILING_METADATA',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'trailing-rt-server',
    canonical: 'RT / SERVER RT',
    aliases: ['RT', 'SERVER RT', 'SERVER', 'ECR', 'MATRICOLA RT', 'MATRICOLA'],
    patterns: [/\b(?:SERVER\s+)?RT\b/i, /\bECR\b/i, /\bMATRICOLA(?:\s+RT)?\b/i],
    semanticRole: 'TRAILING_METADATA',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'trailing-cassa-operatore',
    canonical: 'CASSA / OPERATORE',
    aliases: [
      'NUMERO CASSA',
      'CASSA',
      'OPERATORE',
      'OPERATORE:',
      'VENDITORE',
      'Op:',
      'OP:',
      'Neg-Term-Cassiere-Num.',
      'TAV.',
      'TAV',
    ],
    patterns: [
      /\b(?:NUMERO\s+)?CASSA\s*[:#]?\s*\d+/i,
      /\b(?:OPERATORE|VENDITORE|OP)\s*[:#]?/i,
      /\bTAV\.?\s*\d+/i,
    ],
    semanticRole: 'TRAILING_METADATA',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'trailing-items-count',
    canonical: 'NUMERO ARTICOLI',
    aliases: [
      'NUMERO DI ARTICOLI',
      'NUMERO ARTICOLI',
      'NUM. ARTICOLI',
      'N. PEZZI',
      'NUMERO PEZZI',
      'ART',
      'RIEPILOGO ACQUISTI',
    ],
    patterns: [
      /\b(?:NUMERO\s+(?:DI\s+)?ARTICOLI|NUM\.?\s*ARTICOLI|N\.?\s*PEZZI|NUMERO\s+PEZZI)\b/i,
      /\bRIEPILOGO\s+ACQUISTI\b/i,
    ],
    semanticRole: 'TRAILING_METADATA',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Segnale di controllo o riepilogo conteggio pezzi; non è un articolo',
  },

  // =========================================================================
  // 9. PAYMENT DETAIL HEADERS (PAYMENT_DETAILS_HEADER)
  // =========================================================================
  {
    id: 'header-payment-details',
    canonical: 'DETTAGLIO PAGAMENTI',
    aliases: [
      'DETTAGLIO PAGAMENTI',
      'DETTAGLIO PAGAMENTI:',
      'DETTAGLIO FORME DI PAGAMENTO',
      'DETTAGLIO FORME di PAGAMENTO',
      'FORME DI PAGAMENTO',
    ],
    patterns: [/\bDETTAGLIO\s+(?:FORME\s+DI\s+)?PAGAMENT[OI]\b/i],
    semanticRole: 'PAYMENT_DETAILS_HEADER',
    confidenceWeight: 1.0,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Intestazione della sezione dettagli pagamenti, mai un articolo',
  },

  // =========================================================================
  // 10. DISCOUNT / ADJUSTMENT MARKERS (ITEM_DISCOUNT, ROUNDING_ADJUSTMENT)
  // =========================================================================
  {
    id: 'adj-discount',
    canonical: 'SCONTO',
    aliases: ['SCONTO', 'Sconto', 'BUONO SCONTO', 'BUONO', 'PROMO', 'OFFERTA', 'STORNO', 'RESO'],
    patterns: [/\b(?:BUONO\s+)?SCONTO\b/i, /\bSTORNO\b/i, /\bRESO\b/i],
    semanticRole: 'ITEM_DISCOUNT',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },
  {
    id: 'adj-rounding',
    canonical: 'ARROTONDAMENTO',
    aliases: ['ARROTONDAMENTO', 'Sconto ARROTONDAMENTO', 'ABBUONO'],
    patterns: [/\bARROTONDAMENTO\b/i, /\bABBUONO\b/i],
    semanticRole: 'ROUNDING_ADJUSTMENT',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },

  // =========================================================================
  // 11. COMMERCIAL CARRIER / BAG HINTS (COMMERCIAL_CARRIER_HINT)
  // =========================================================================
  {
    id: 'carrier-shopper-bio',
    canonical: 'SHOPPER',
    aliases: [
      // Termini realmente osservati nel corpus
      'SHOPPER',
      'SHOPPERS',
      'SHOPPER BIO',
      'SHOPPERS BIO',
      'SHOPPER BIO EUROSPIN',
      'SHOPPERS ORIZZONTE GRANDE',
      'PEWEX SHOP BIOCOMP',
      'SHOP BIOCOMP',
      'SACCO CARTA RICICLATA',
      // Varianti linguistiche ammesse come normalizzazione generale
      'BUSTA',
      'BUSTE',
      'SACCHETTO',
      'SACCHETTI',
      'BORSA',
      'BORSE',
      'SACCO',
      'SACCHI',
    ],
    patterns: [
      /\bSHOPPERS?\b/i,
      /\bBIOCOMP\b/i,
      /\b(?:SACCO|SACCHETTO|BUSTA|BORSA)\b/i,
    ],
    semanticRole: 'COMMERCIAL_CARRIER_HINT',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes:
      'Indica compatibilità descrittiva con busta/shopper commerciale. Non forza da solo la classificazione ad articolo, ma fornisce forte indizio semantico.',
  },

  // =========================================================================
  // 12. LOYALTY / FIDELITY MARKERS (LOYALTY_METADATA)
  // =========================================================================
  {
    id: 'loyalty-points',
    canonical: 'PUNTI FEDELTA',
    aliases: [
      'PUNTI',
      'SALDO PUNTI',
      'SALDO PUNTI HOMY PRECEDENTI',
      'PUNTI HOMY SULLA SPESA',
      'NUOVO SALDO PUNTI HOMY',
      'N. HOMY',
      'PUNTI DA ACCUMULARE',
      'PUNTI MOVIMENTATI',
      'PUNTI UTILIZZATI',
      'PAYBACK',
      'CARTA PAYBACK',
      'PROGRAMMA FEDELTA',
      'PROGRAMMA FEDELTÀ',
      'CARTA FEDELTA',
    ],
    patterns: [
      /\b(?:SALDO\s+)?PUNTI(?:\s+HOMY)?\b/i,
      /\bPAYBACK\b/i,
      /\bPROGRAMMA\s+FEDELT[AÀ]\b/i,
    ],
    semanticRole: 'LOYALTY_METADATA',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Dati di loyalty card / punti fidelity, mai un articolo',
  },

  // =========================================================================
  // 13. MARKETING / CLOSING TEXT (MARKETING_OR_CLOSING_FOOTER)
  // =========================================================================
  {
    id: 'footer-marketing',
    canonical: 'ARRIVEDERCI E GRAZIE',
    aliases: [
      'ARRIVEDERCI E GRAZIE',
      'ARRIVEDERCI',
      'GRAZIE',
      'GRAZIE PER AVERCI SCELTO',
      'GRAZIE E ARRIVEDERCI',
      'GRAZIE E BUONA GIORNATA',
      'IL CAMBIO',
      'IL CAMBIO E\' POSSIBILE',
      'IL CAMBIO È POSSIBILE',
      'WWW.',
      'http',
      'https',
    ],
    patterns: [
      /\bARRIVEDERCI(?:\s+E\s+GRAZIE)?\b/i,
      /\bGRAZIE\s+PER\s+AVERCI\s+SCELTO\b/i,
      /\bIL\s+CAMBIO\s+[EÈ]'\s*POSSIBILE\b/i,
      /\b(?:WWW\.|HTTPS?:\/\/)[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    ],
    semanticRole: 'MARKETING_OR_CLOSING_FOOTER',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
  },

  // =========================================================================
  // 14. PHARMACY / FISCAL SPECIAL METADATA (FISCAL_HEALTH_METADATA)
  // =========================================================================
  {
    id: 'fiscal-health',
    canonical: 'CODICE FISCALE / DETRAIBILE 730',
    aliases: [
      'CODICE FISCALE',
      'C.F.',
      'TIPI SPESA 730 ONLINE',
      'TIPI SPESA 730',
      'TOTALE DETRAIBILE',
      'ID 730 ONLINE',
    ],
    patterns: [
      /\bCODICE\s+FISCALE\b/i,
      /\b(?:TIPI\s+SPESA|ID)\s+730\b/i,
      /\bTOTALE\s+DETRAIBILE\b/i,
    ],
    semanticRole: 'FISCAL_HEALTH_METADATA',
    confidenceWeight: 0.95,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Campi fiscali sanitari / detrazioni 730 (Farmacie)',
  },

  // =========================================================================
  // 15. SECTION / DEPARTMENT HEADERS (DEPARTMENT_HEADER)
  // =========================================================================
  {
    id: 'dept-leroy-merlin',
    canonical: 'REPARTO COMMERCIALE',
    aliases: [
      'ELETTRICITA E DOMOTICA',
      'ELETTRICITÀ E DOMOTICA',
      'GIARDINO E TERRAZZO',
      'FERRAMENTA',
      'IDRAULICA',
      'VERNICI E COLORI',
      'FALEGNAMERIA',
      'EDILIZIA',
    ],
    patterns: [
      /\bELETTRICIT[AÀ]\s+E\s+DOMOTICA\b/i,
      /\bGIARDINO\s+E\s+TERRAZZO\b/i,
      /\b(?:FERRAMENTA|IDRAULICA|FALEGNAMERIA)\b/i,
    ],
    semanticRole: 'DEPARTMENT_HEADER',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Intestazione di reparto (es. Leroy Merlin), mai un articolo venduto',
  },

  // =========================================================================
  // 16. PRODUCT SECONDARY IDENTIFIERS (PRODUCT_IDENTIFIER)
  // =========================================================================
  {
    id: 'prod-secondary-ident',
    canonical: 'CODICE_ARTICOLO_O_EAN',
    aliases: ['EAN', 'BARCODE', 'CODICE ARTICOLO'],
    patterns: [
      /^\d{8,14}$/, // Barcode numerico standard EAN-8 / EAN-13 / GTIN-14
      /^J\d{6,12}$/i, // Prefisso J comune in etichette ferramenta/brico
    ],
    semanticRole: 'PRODUCT_IDENTIFIER',
    confidenceWeight: 0.9,
    source: 'builtin',
    version: KNOWLEDGE_BASE_VERSION,
    notes: 'Codice articolo o barcode su riga secondaria adiacente alla descrizione',
  },
];

// =========================================================================
// 17. COMMON OCR NORMALIZATION ALIASES
// =========================================================================
export const BUILTIN_OCR_ALIASES: OcrAliasRule[] = [
  {
    pattern: /\bT00IS\b/gi,
    replacement: 'TODIS',
    description: 'Sostituzione OCR 00 -> OD per marchio TODIS',
    conservativeOnly: true,
  },
  {
    pattern: /\bimporto\s+nagato\b/gi,
    replacement: 'importo pagato',
    description: 'Refuso ottico frequente nagato -> pagato',
    conservativeOnly: true,
  },
  {
    pattern: /\bDOCUMENTO\s+COMMERCIA\.E\b/gi,
    replacement: 'DOCUMENTO COMMERCIALE',
    description: 'Refuso ottico punto anziché L in COMMERCIALE',
    conservativeOnly: true,
  },
];
