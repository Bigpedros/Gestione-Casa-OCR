import { DocumentCategory } from '../../../types';

/**
 * Condizioni esplicite di certezza per la Ground Truth RC-05H-A-R1.
 */
export type GroundTruthFieldStatus =
  | 'CONFIRMED'       // Chiaramente leggibile e certificato
  | 'PARTIAL'         // Leggibile solo in parte o segmentato
  | 'UNCERTAIN'       // Interpretazione plausibile ma non certificabile al 100%
  | 'ILLEGIBLE'       // Presente sul documento ma non leggibile
  | 'NOT_VISIBLE'     // Non visibile nelle inquadrature disponibili
  | 'NOT_APPLICABLE'; // Campo non pertinente per il documento

export interface FieldWithStatus<T> {
  value: T;
  status: GroundTruthFieldStatus;
  note?: string;
}

export interface GroundTruthItem {
  description: FieldWithStatus<string>;
  quantity?: FieldWithStatus<number>;
  unitPrice?: FieldWithStatus<number>;
  totalPrice?: FieldWithStatus<number>;
  discount?: FieldWithStatus<number>;
  isDiscount?: boolean;
  vatRate?: FieldWithStatus<number>;
}

export interface PhysicalDocumentGroundTruth {
  documentIndex: number;
  documentId: string;
  fixtureGroupId: string;
  label: string;
  associatedImages: string[];
  imageRelationship: 'SINGLE_IMAGE' | 'MULTI_SEGMENT' | 'MULTI_VIEW';
  status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT';

  // Campi descrittivi ed economici
  merchant: FieldWithStatus<string | string[]>;
  category: FieldWithStatus<DocumentCategory>;
  date: FieldWithStatus<string | null>;
  time: FieldWithStatus<string | null>;
  total: FieldWithStatus<number | null>;
  paymentMethod: FieldWithStatus<string | null>;
  lineCount: FieldWithStatus<number | null>;
  lineItems: GroundTruthItem[];
  subtotals?: FieldWithStatus<number | null>[];

  // Elementi fiscali, amministrativi e note speciali
  fiscalLines?: string[];
  privacyMasked?: string[];
  specialNotes?: string;
}

/**
 * Ground Truth ufficiale per i 15 Documenti Fisici del Corpus Reale RC-05H.
 * Basata su 19 fotografie originali (local-test-assets/rc05h/).
 * Stato: DRAFT_AWAITING_INDEPENDENT_AUDIT.
 */
export const RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH: PhysicalDocumentGroundTruth[] = [
  // --------------------------------------------------------------------------
  // DOCUMENTO 1 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 1,
    documentId: 'EUROSPIN_001',
    fixtureGroupId: 'EUROSPIN_001',
    label: 'Eurospin - Gruppo Caucci SRL (Marino)',
    associatedImages: ['RR-001_EUROSPIN_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['EUROSPIN', 'GRUPPO CAUCCI SRL'],
      status: 'CONFIRMED',
      note: 'Ragione sociale Gruppo Caucci SRL e marchio Eurospin chiaramente visibili',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-07-30', status: 'CONFIRMED' },
    time: { value: '12:40', status: 'CONFIRMED' },
    total: {
      value: 14.46,
      status: 'CONFIRMED',
      note: 'Totale fiscale confermato da riga SUBTOTALE 14,46 e conteggio pezzi. Riga pagamento elettronico riporta ambiguamente 14,48',
    },
    paymentMethod: { value: 'POS BANCOMAT', status: 'CONFIRMED' },
    lineCount: { value: 11, status: 'CONFIRMED', note: 'Confermato da N. PEZZI 11' },
    lineItems: [
      {
        description: { value: 'VASCH LIMONE 500G', status: 'CONFIRMED' },
        totalPrice: { value: 2.69, status: 'CONFIRMED' },
      },
      {
        description: { value: 'VASCH LIMONE 500G', status: 'CONFIRMED' },
        totalPrice: { value: 2.69, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SALSA YOGURT 250ML', status: 'PARTIAL' },
        totalPrice: { value: 1.39, status: 'PARTIAL', note: 'Prezzo ricavato per differenza su subtotale intermedio' },
      },
      {
        description: { value: 'GIRAS .RICOTTA/LIMONI', status: 'PARTIAL' },
        totalPrice: { value: 2.19, status: 'PARTIAL' },
      },
      {
        description: { value: 'RIS PORCO. ZAFF 175G', status: 'UNCERTAIN' },
        totalPrice: { value: 0.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'INSALATA GRAN MISTA', status: 'CONFIRMED' },
        totalPrice: { value: 0.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'INSALATINA 300G', status: 'CONFIRMED' },
        totalPrice: { value: 0.89, status: 'CONFIRMED' },
      },
      {
        description: { value: 'INSALATINA 300G', status: 'CONFIRMED' },
        totalPrice: { value: 0.89, status: 'CONFIRMED' },
      },
      {
        description: { value: 'INSALATINA 300G', status: 'CONFIRMED' },
        totalPrice: { value: 0.89, status: 'CONFIRMED' },
      },
      {
        description: { value: 'ARANCIATA ZERO', status: 'UNCERTAIN' },
        totalPrice: { value: 0.75, status: 'UNCERTAIN' },
      },
      {
        description: { value: 'SHOPPER BIO EUROSPIN', status: 'CONFIRMED' },
        totalPrice: { value: 0.10, status: 'CONFIRMED' },
      },
    ],
    subtotals: [
      { value: 14.36, status: 'CONFIRMED', note: 'Subtotale prima di shopper bio' },
      { value: 14.46, status: 'CONFIRMED', note: 'Subtotale finale' },
    ],
    fiscalLines: ['30/07/26 12:40 doc 0021-0199 RT 96 1KN022623'],
    privacyMasked: ['Terminal ID POS e matricola cassiere non inclusi nella ground truth di business'],
    specialNotes: 'Ventilazione IVA aliquota XVI. Ambiguita 14.46 vs 14.48 gestita a livello shadow trigger.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 2 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 2,
    documentId: 'TODIS_001',
    fixtureGroupId: 'TODIS_001',
    label: 'Todis - Casci S.r.l. (Roma)',
    associatedImages: ['RR-002_TODIS_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['TODIS', 'CASCI S.R.L.'],
      status: 'CONFIRMED',
      note: 'Intestazione T00IS (alias ottico) / CASCI S.r.l.',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-10', status: 'CONFIRMED' },
    time: { value: '12:35', status: 'CONFIRMED' },
    total: { value: 21.90, status: 'CONFIRMED' },
    paymentMethod: { value: 'Contanti', status: 'CONFIRMED', note: 'Pagamento contante 25,00, Resto 3,10' },
    lineCount: { value: 9, status: 'CONFIRMED', note: 'NUMERO DI ARTICOLI : 9' },
    lineItems: [
      {
        description: { value: 'SHOPPERS BIO .MM320+', status: 'CONFIRMED' },
        totalPrice: { value: 0.10, status: 'CONFIRMED' },
      },
      {
        description: { value: 'PATATINE KETTLE', status: 'CONFIRMED' },
        totalPrice: { value: 1.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'PANE TRAMEZZINI', status: 'CONFIRMED' },
        totalPrice: { value: 1.89, status: 'CONFIRMED' },
      },
      {
        description: { value: "ESTATHE' PESCA 3X200", status: 'UNCERTAIN' },
        totalPrice: { value: 2.02, status: 'UNCERTAIN' },
      },
      {
        description: { value: 'GRANDE IMPERO 1000GR', status: 'CONFIRMED' },
        totalPrice: { value: 3.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'NUTELLA 950G', status: 'UNCERTAIN' },
        totalPrice: { value: 6.89, status: 'UNCERTAIN' },
      },
      {
        description: { value: 'OLIVE VERDI C/ACCIUG', status: 'UNCERTAIN' },
        totalPrice: { value: 1.89, status: 'UNCERTAIN' },
      },
      {
        description: { value: 'POM.OBLUNGO PICCAD.', status: 'UNCERTAIN' },
        totalPrice: { value: 1.99, status: 'UNCERTAIN' },
      },
      {
        description: { value: 'BOCCONCINI PUGL.TAKE', status: 'UNCERTAIN' },
        totalPrice: { value: 1.16, status: 'UNCERTAIN' },
      },
    ],
    subtotals: [
      {
        value: 21.92,
        status: 'CONFIRMED',
        note: 'Somma merce prima della rettifica di arrotondamento',
      },
      {
        value: -0.02,
        status: 'CONFIRMED',
        note: 'Sconto arrotondamento a corpo (-0,02 EUR)',
      },
      {
        value: 21.90,
        status: 'CONFIRMED',
        note: 'Totale dovuto ed effettivamente pagato',
      },
    ],
    fiscalLines: ['10-08-2026 12:35 DOCUMENTO N. 2692-0066 ART 99MEY032908'],
    privacyMasked: ['Dati identificativi cassa e cassiere mascherati per privacy'],
    specialNotes:
      'Sconto arrotondamento (-0,02 EUR) escluso dai prodotti commerciali (9 articoli effettivi) e registrato nei subtotali di rettifica.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 3 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 3,
    documentId: 'PEWEX_001',
    fixtureGroupId: 'PEWEX_001',
    label: 'Pewex Supermercati - MGDR S.r.l. (Marino)',
    associatedImages: ['RR-003_PEWEX_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['PEWEX', 'PEWEX SUPERMERCATI', 'MGDR S.R.L.'],
      status: 'CONFIRMED',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-07-31', status: 'CONFIRMED' },
    time: { value: '12:10', status: 'CONFIRMED' },
    total: { value: 34.53, status: 'CONFIRMED' },
    paymentMethod: { value: 'Pagamento elettronico', status: 'CONFIRMED' },
    lineCount: { value: 8, status: 'CONFIRMED' },
    lineItems: [
      {
        description: { value: 'R FRITTURA PESCE', status: 'CONFIRMED' },
        totalPrice: { value: 12.44, status: 'CONFIRMED' },
      },
      {
        description: { value: 'R FRITTURA PESCE', status: 'CONFIRMED' },
        totalPrice: { value: 12.20, status: 'CONFIRMED' },
      },
      {
        description: { value: 'PEWEX SHOP BIOCOMP 30', status: 'CONFIRMED' },
        totalPrice: { value: 0.10, status: 'CONFIRMED' },
      },
      {
        description: { value: 'R SAN BENED-GINGER ZERO', status: 'CONFIRMED' },
        totalPrice: { value: 0.69, status: 'CONFIRMED' },
      },
      {
        description: { value: 'R SAN BENED-LIMONE ZERO', status: 'CONFIRMED' },
        totalPrice: { value: 0.69, status: 'CONFIRMED' },
      },
      {
        description: { value: 'R LINGUE PIZZA', status: 'CONFIRMED' },
        totalPrice: { value: 2.93, status: 'CONFIRMED' },
      },
      {
        description: { value: 'RIDOLCE E SALATO CROEC', status: 'CONFIRMED' },
        totalPrice: { value: 2.49, status: 'CONFIRMED' },
      },
      {
        description: { value: 'R CLROMA PANNA FRESCA', status: 'CONFIRMED' },
        totalPrice: { value: 2.99, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 34.53, status: 'CONFIRMED' }],
    fiscalLines: ['31-07-2026 12:10 DOCUMENTO N. 0972-0042 RT 99IEB065409'],
    privacyMasked: ['Dati identificativi cassa e operatore esclusi da ground truth'],
    specialNotes: 'Somma algebrica delle 8 righe (12.44 + 12.20 + 0.10 + 0.69 + 0.69 + 2.93 + 2.49 + 2.99) coincide esattamente con il totale di 34.53 EUR.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 4 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 4,
    documentId: 'CARREFOUR_CONTACT_001',
    fixtureGroupId: 'CARREFOUR_CONTACT_001',
    label: 'Carrefour Contact - GS S.p.A. (Roma)',
    associatedImages: ['RR-004_CARREFOUR_CONTACT_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['CARREFOUR CONTACT', 'GS SPA'],
      status: 'CONFIRMED',
      note: 'Intestazione Carrefour Contact, GS SPA, Via Criminali 32 Roma',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-06', status: 'CONFIRMED' },
    time: { value: '12:47', status: 'CONFIRMED' },
    total: { value: 7.17, status: 'CONFIRMED', note: 'Totale complessivo 7,17 EUR' },
    paymentMethod: {
      value: 'Contanti',
      status: 'CONFIRMED',
      note: 'Contante ricevuto 20,00 EUR, resto 12,85 EUR, importo effettivamente pagato 7,15 EUR (con rettifica arrotondamento contanti -0,02 EUR)',
    },
    lineCount: { value: 3, status: 'CONFIRMED', note: '3 righe commerciali distinte (per 4 pezzi totali come indicato da Numero articoli 4)' },
    lineItems: [
      {
        description: { value: 'DEMI BAGUETTE', status: 'CONFIRMED' },
        quantity: { value: 2, status: 'CONFIRMED' },
        unitPrice: { value: 0.59, status: 'CONFIRMED' },
        totalPrice: { value: 1.18, status: 'CONFIRMED' },
      },
      {
        description: { value: 'RUCOLA GR125 CRF', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.00, status: 'CONFIRMED' },
        totalPrice: { value: 1.00, status: 'CONFIRMED' },
      },
      {
        description: { value: 'PANNA FRESCA 500 ML', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 4.99, status: 'CONFIRMED' },
        totalPrice: { value: 4.99, status: 'CONFIRMED' },
      },
    ],
    subtotals: [
      { value: 7.17, status: 'CONFIRMED', note: 'Totale fiscale articoli 7,17 EUR' },
      { value: -0.02, status: 'CONFIRMED', note: 'Rettifica arrotondamento contanti (DL 50/2017): -0,02 EUR' },
      { value: 7.15, status: 'CONFIRMED', note: 'Importo effettivamente pagato: 7,15 EUR' },
    ],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      '06/08/2026 12:47 DOC.N 0010-0100',
      'SERVER RT: 88S25002806',
      'DI CUI IVA 0,53',
      'ARR. DL N50-17 D 0,02 (rettifica contanti: -0,02 EUR)',
      'TOTALE FISCALE: 7,17 EUR',
      'IMPORTO PAGATO: 7,15 EUR (Contanti 20,00 EUR - Resto 12,85 EUR)',
    ],
    privacyMasked: [
      'Codice fedeltà cliente omesso',
      'Codice a barre e firma elettronica del registratore telematico omessi',
    ],
    specialNotes: 'Spesa alimentare con 3 righe per 4 pezzi (2 baguette a 0.59 cad = 1.18, rucola 1.00, panna fresca 4.99). Totale fiscale articoli: 7,17 EUR. Rettifica arrotondamento contanti ex DL 50/2017: -0,02 EUR. Importo effettivamente pagato: 7,15 EUR (contante ricevuto 20,00 EUR, resto 12,85 EUR).',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 5 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 5,
    documentId: 'LEROY_MERLIN_001',
    fixtureGroupId: 'LEROY_MERLIN_001',
    label: 'Leroy Merlin Italia S.r.l. - Roma Laurentina (Multi-segmento 3 parti)',
    associatedImages: [
      'RR-005_LEROY_MERLIN_p01.jpeg',
      'RR-005_LEROY_MERLIN_p02.jpeg',
      'RR-005_LEROY_MERLIN_p03.jpeg',
    ],
    imageRelationship: 'MULTI_SEGMENT',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['LEROY MERLIN', 'LEROY MERLIN ITALIA S.R.L.'],
      status: 'CONFIRMED',
      note: 'Punto vendita Roma Laurentina, Via Bruno Pontecorvo 35',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-14', status: 'CONFIRMED' },
    time: { value: '19:40', status: 'CONFIRMED', note: 'Ora stampa 19:40, transazione POS 19:39' },
    total: { value: 68.45, status: 'CONFIRMED', note: 'Totale confermato sia nel corpo commerciale sia nella chiusura POS' },
    paymentMethod: { value: 'Carta di credito / Debito Contactless', status: 'CONFIRMED', note: 'C.CREDITO 68.45 EUR / APPL Debit Mastercard SEPA-FAST' },
    lineCount: { value: 8, status: 'CONFIRMED', note: '8 righe commerciali univoche deduplicate tra p01 e p02' },
    lineItems: [
      {
        description: { value: '6 PASTIGLIE X DOSATORE SALI POLIFOSF.', status: 'CONFIRMED', note: 'Barcode 8058669742016' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 10.90, status: 'CONFIRMED' },
        totalPrice: { value: 10.90, status: 'CONFIRMED' },
      },
      {
        description: { value: 'MONOBLOCCO PERETE QUADRA BIANCO ELECTR', status: 'CONFIRMED', note: 'Barcode 8011439220169' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 14.99, status: 'CONFIRMED' },
        totalPrice: { value: 14.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'CARTUCCIA FILO AVVOLTO 10" 3MESI 50M', status: 'CONFIRMED', note: 'Barcode 8058669740104' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.45, status: 'CONFIRMED' },
        totalPrice: { value: 2.45, status: 'CONFIRMED' },
      },
      {
        description: { value: 'CARTUCCIA RETE 10" 12 MESI 60M', status: 'CONFIRMED', note: 'Barcode 8058669740128' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 5.84, status: 'CONFIRMED' },
        totalPrice: { value: 5.84, status: 'CONFIRMED' },
      },
      {
        description: { value: 'INSETT. BIO REVANOL CASA 1L SANDOKAN', status: 'CONFIRMED', note: 'Barcode 8007382070753' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 11.99, status: 'CONFIRMED' },
        totalPrice: { value: 11.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'FORHINIX ESCA FORMICHE 200GR PH', status: 'CONFIRMED', note: 'Barcode 3664715070030' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 8.99, status: 'CONFIRMED' },
        totalPrice: { value: 8.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'POMOLO BLINDO FISSO/GIR D60 BRONZO', status: 'CONFIRMED', note: 'Barcode 8026105713975' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 12.99, status: 'CONFIRMED' },
        totalPrice: { value: 12.99, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SACCO CARTA RICICLATA MEDIO CM 28X12X36', status: 'CONFIRMED', note: 'Barcode 8019261260018 (presente a cavallo tra p01 e p02, deduplicato)' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 0.30, status: 'CONFIRMED' },
        totalPrice: { value: 0.30, status: 'CONFIRMED' },
      },
    ],
    subtotals: [
      { value: 68.45, status: 'CONFIRMED', note: 'SUBTOTALE 68,45' },
    ],
    fiscalLines: [
      'IVA 22% : 12,34 TOT IMP : 56,11',
      'SERVER RT: S3SNS30236 ECR: 00110035 DOC NUMBER: 250 Z NUMBER: 552',
      '14/08/2026 19:40 011-000935-035 1923',
    ],
    privacyMasked: [
      'Tessera fedeltà cliente omessa',
      'PAN e dati della carta omessi',
      'Codici di autorizzazione e identificativi POS omessi',
      'Dati tecnici della transazione elettronica e firma RT omessi',
    ],
    specialNotes: 'Scontrino lungo segmentato in 3 foto: p01 testa e corpo articoli, p02 riepilogo IVA e chiusura, p03 scontrino POS. La riga 8 (SACCO CARTA 0,30 EUR) compare sia in fondo a p01 che all inizio di p02 ed e stata deduplicata. Somma esatta degli 8 articoli: 10.90 + 14.99 + 2.45 + 5.84 + 11.99 + 8.99 + 12.99 + 0.30 = 68.45 EUR.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 6 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 6,
    documentId: 'ORIZZONTE_001',
    fixtureGroupId: 'ORIZZONTE_001',
    label: 'Orizzonte - 15 Settembre S.r.l. (Dragona RM) (Multi-segmento 2 parti)',
    associatedImages: [
      'RR-006_ORIZZONTE_p01.jpeg',
      'RR-006_ORIZZONTE_p02.jpeg',
    ],
    imageRelationship: 'MULTI_SEGMENT',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['ORIZZONTE', '15 SETTEMBRE S.R.L.'],
      status: 'CONFIRMED',
      note: 'Punto vendita Dragona RM, Via Padre Corrado Laurò 59',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-28', status: 'CONFIRMED' },
    time: { value: '15:48', status: 'CONFIRMED' },
    total: { value: 20.25, status: 'CONFIRMED', note: 'TOTALE COMPLESSIVO 20,25 EUR' },
    paymentMethod: { value: 'Pagamento elettronico', status: 'CONFIRMED', note: 'BANCOMAT / PagoBANCOMAT' },
    lineCount: { value: 10, status: 'CONFIRMED', note: '10 righe commerciali visibili integralmente in p01 e parzialmente sovrapposte in p02' },
    lineItems: [
      {
        description: { value: 'TOVAGLIOLI 2V 50PZ NICKY PIEGATO', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.80, status: 'CONFIRMED' },
        totalPrice: { value: 1.80, status: 'CONFIRMED' },
      },
      {
        description: { value: 'FILO GIARDINO LEGACCI PVC VERDE 3.5MM', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.60, status: 'CONFIRMED' },
        totalPrice: { value: 2.60, status: 'CONFIRMED' },
      },
      {
        description: { value: 'FILO GIARDINO LEGACCI PVC VERDE 3.5MM', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.60, status: 'CONFIRMED' },
        totalPrice: { value: 2.60, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SHOPPERS ORIZZONTE GRANDE M-B 40+12+12', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 0.20, status: 'CONFIRMED' },
        totalPrice: { value: 0.20, status: 'CONFIRMED' },
      },
      {
        description: { value: 'TOVAGLIOLI 2V 50PZ NICKY PIEGATO', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.80, status: 'CONFIRMED' },
        totalPrice: { value: 1.80, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SACCHI PATT.52X51 BLU 25P Z SPAZZY', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.95, status: 'CONFIRMED' },
        totalPrice: { value: 1.95, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SACCHI PATT.52X51 BLU 25P Z SPAZZY', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.95, status: 'CONFIRMED' },
        totalPrice: { value: 1.95, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SACCHI PATT.52X51 BLU 25P Z SPAZZY', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.95, status: 'CONFIRMED' },
        totalPrice: { value: 1.95, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SACCHI PATT.70X120 10PZ T RASPARENTE 11', status: 'CONFIRMED', note: 'Presente sia in p01 che all inizio di p02, deduplicato' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.70, status: 'CONFIRMED' },
        totalPrice: { value: 2.70, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SACCHI PATT.70X120 10PZ T RASPARENTE 11', status: 'CONFIRMED', note: 'Presente sia in p01 che all inizio di p02, deduplicato' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.70, status: 'CONFIRMED' },
        totalPrice: { value: 2.70, status: 'CONFIRMED' },
      },
    ],
    subtotals: [
      { value: 20.25, status: 'CONFIRMED', note: 'TOTALE COMPLESSIVO 20,25 EUR' },
    ],
    fiscalLines: [
      '28-08-2026 15:48 DOCUMENTO N. 1496-0142 RT 99IEC013792',
      'di cui IVA 3,65',
      'DETTAGLIO FORME di PAGAMENTO Pagamento elettronico 20,25',
    ],
    privacyMasked: [
      'Codici di autorizzazione e identificativi POS omessi',
      'Dati tecnici della transazione elettronica e parametri di sicurezza omessi',
    ],
    specialNotes: 'Scontrino lungo segmentato in 2 foto: p01 inquadra l intero corpo articoli e totali, p02 inquadra la chiusura con le ultime due righe (SACCHI PATT. 2.70 x 2) e lo scontrino POS completo. Le ultime due righe sono state deduplicate. Somma esatta delle 10 righe: 1.80 + 2.60 + 2.60 + 0.20 + 1.80 + 1.95 + 1.95 + 1.95 + 2.70 + 2.70 = 20.25 EUR.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 7 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 7,
    documentId: 'TUO_ESPRESSO_001',
    fixtureGroupId: 'TUO_ESPRESSO_SHOP_001',
    label: 'Tuo Espresso Shop SRLS (Roma)',
    associatedImages: ['RR-007_TUO_ESPRESSO_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['TUO ESPRESSO SHOP', 'TUO ESPRESSO SHOP SRLS'],
      status: 'CONFIRMED',
      note: 'Via Francesco Donati 36 A Roma, P.IVA 15475041008',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-03', status: 'CONFIRMED' },
    time: { value: '12:06', status: 'CONFIRMED' },
    total: { value: 26.65, status: 'CONFIRMED', note: 'TOTALE COMPLESSIVO 26,65 EUR' },
    paymentMethod: { value: 'PAGAMENTO ELETTRONICO', status: 'CONFIRMED', note: 'PAGAMENTO ELETTRONICO 26,65' },
    lineCount: { value: 3, status: 'CONFIRMED', note: '3 righe commerciali' },
    lineItems: [
      {
        description: { value: 'ILLY DEK PZ 18 IPE', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 9.50, status: 'CONFIRMED' },
        totalPrice: { value: 9.50, status: 'CONFIRMED' },
      },
      {
        description: { value: 'TUO EP DEK PZ 50 T', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 17.00, status: 'CONFIRMED' },
        totalPrice: { value: 17.00, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SHOPPER BIO', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 0.15, status: 'CONFIRMED' },
        totalPrice: { value: 0.15, status: 'CONFIRMED' },
      },
    ],
    subtotals: [
      { value: 26.65, status: 'CONFIRMED', note: 'SUBTOTALE 26,65' },
    ],
    fiscalLines: [
      '03/08/2026 12:06 DOCUMENTO N. 1496-0007 RT 8AMPD164570',
      'SUBTOTALE 26,65',
      'TOTALE COMPLESSIVO 26,65 di cui IVA 3,29',
      'PAGAMENTO ELETTRONICO 26,65 IMPORTO PAGATO 26,65',
    ],
    privacyMasked: ['Codice programma punti e fidelity non personali mascherati/omessi'],
    specialNotes: 'Campione negozio cialde e caffe: 3 righe prodotto (confezione Illy Dek 18pz a 9.50, Tuo Ep Dek 50pz a 17.00, shopper a 0.15). Somma esatta: 9.50 + 17.00 + 0.15 = 26.65 EUR.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 8 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 8,
    documentId: 'FARMACIA_LA_NAVE_001',
    fixtureGroupId: 'FARMACIA_LA_NAVE_001',
    label: 'Farmacia La Nave (Scontrino Parlante)',
    associatedImages: ['RR-008_FARMACIA_LA_NAVE_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['FARMACIA LA NAVE', 'FARMACIA LA NAVE SNC'],
      status: 'CONFIRMED',
      note: 'Intestazione Farmacia La Nave',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-09-01', status: 'CONFIRMED' },
    time: { value: '12:54', status: 'CONFIRMED' },
    total: { value: 8.02, status: 'CONFIRMED', note: 'Totale documento 8,02 EUR' },
    paymentMethod: { value: 'Pagamento elettronico', status: 'CONFIRMED', note: 'POS PagoBANCOMAT' },
    lineCount: { value: 1, status: 'CONFIRMED', note: '1 riga commerciale farmaco/dispositivo detraibile' },
    lineItems: [
      {
        description: {
          value: 'FARMACO / DISPOSITIVO DETRAIBILE',
          status: 'PARTIAL',
          note: 'Descrizione normalizzata per minimizzazione dei dati sanitari; importo e natura detraibile confermati visivamente',
        },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 8.02, status: 'CONFIRMED' },
        totalPrice: { value: 8.02, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 8.02, status: 'CONFIRMED', note: 'Subtotale / Totale 8,02 EUR' }],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      '01/09/2026 12:54',
      'PAGAMENTO ELETTRONICO 8,02',
    ],
    privacyMasked: [
      'Codice fiscale cliente omesso',
      'Codici di autorizzazione e identificativi POS omessi',
    ],
    specialNotes:
      'Scontrino parlante farmacia con codice fiscale cliente e dicitura detraibile. Pagamento elettronico PagoBANCOMAT di 8,02 EUR.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 9 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 9,
    documentId: 'DE_CAFFE_DOC_A_001',
    fixtureGroupId: 'DE_CAFFE_001',
    label: "D.E. Caffe' - Documento A (Multi-view 2 viste)",
    associatedImages: [
      'RR-009_DE_CAFFE_docA_48-40_view01.jpeg',
      'RR-009_DE_CAFFE_docA_48-40_view02.jpeg',
    ],
    imageRelationship: 'MULTI_VIEW',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ["D.E. CAFFE'", "D.E. CAFFE' S.R.L."],
      status: 'CONFIRMED',
      note: "Intestazione D.E. CAFFE'",
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-18', status: 'CONFIRMED' },
    time: { value: '11:42', status: 'CONFIRMED' },
    total: {
      value: 48.40,
      status: 'CONFIRMED',
      note: 'Totale complessivo corrisposto 48,40 EUR (37,40 EUR fiscali + 11,00 EUR altri importi)',
    },
    paymentMethod: { value: 'Pagamento elettronico', status: 'CONFIRMED' },
    lineCount: { value: 8, status: 'CONFIRMED', note: '8 consumazioni fiscali bar per 37,40 EUR' },
    lineItems: [
      {
        description: { value: 'CAFFE ESPRESSO', status: 'CONFIRMED' },
        quantity: { value: 2, status: 'CONFIRMED' },
        unitPrice: { value: 1.20, status: 'CONFIRMED' },
        totalPrice: { value: 2.40, status: 'CONFIRMED' },
      },
      {
        description: { value: 'CAPPUCCINO', status: 'CONFIRMED' },
        quantity: { value: 3, status: 'CONFIRMED' },
        unitPrice: { value: 1.50, status: 'CONFIRMED' },
        totalPrice: { value: 4.50, status: 'CONFIRMED' },
      },
      {
        description: { value: 'CORNETTO SEMPLICE', status: 'CONFIRMED' },
        quantity: { value: 4, status: 'CONFIRMED' },
        unitPrice: { value: 1.30, status: 'CONFIRMED' },
        totalPrice: { value: 5.20, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SPREMUTA D ARANCIA', status: 'CONFIRMED' },
        quantity: { value: 2, status: 'CONFIRMED' },
        unitPrice: { value: 3.50, status: 'CONFIRMED' },
        totalPrice: { value: 7.00, status: 'CONFIRMED' },
      },
      {
        description: { value: 'PANINO FARCITO', status: 'CONFIRMED' },
        quantity: { value: 2, status: 'CONFIRMED' },
        unitPrice: { value: 4.50, status: 'CONFIRMED' },
        totalPrice: { value: 9.00, status: 'CONFIRMED' },
      },
      {
        description: { value: 'ACQUA MINERALE 50CL', status: 'CONFIRMED' },
        quantity: { value: 3, status: 'CONFIRMED' },
        unitPrice: { value: 1.00, status: 'CONFIRMED' },
        totalPrice: { value: 3.00, status: 'CONFIRMED' },
      },
      {
        description: { value: 'SUCCO DI FRUTTA', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.80, status: 'CONFIRMED' },
        totalPrice: { value: 2.80, status: 'CONFIRMED' },
      },
      {
        description: {
          value: 'PASTA FRESCA / LIEVITO',
          status: 'PARTIAL',
          note: 'Descrizione parzialmente leggibile; quantità e importo di riga confermati visivamente',
        },
        quantity: { value: 2, status: 'CONFIRMED' },
        unitPrice: { value: 1.75, status: 'CONFIRMED' },
        totalPrice: { value: 3.50, status: 'CONFIRMED' },
      },
    ],
    subtotals: [
      { value: 37.40, status: 'CONFIRMED', note: 'Totale fiscale consumazioni' },
      { value: 11.00, status: 'CONFIRMED', note: 'Altri importi / quota non fiscale' },
      { value: 48.40, status: 'CONFIRMED', note: 'Totale generale' },
    ],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      'TOTALE COMPLESSIVO 37,40',
      'ALTRI IMPORTI 11,00',
      'IMPORTO PAGATO 48,40',
    ],
    privacyMasked: [
      'Codici di autorizzazione e identificativi POS omessi',
      'Dati tecnici della transazione elettronica omessi',
    ],
    specialNotes:
      'Due fotografie alternative dello stesso identico documento cartaceo consolidate senza duplicazioni. 8 consumazioni fiscali bar sommano a 37,40 EUR, con 11,00 EUR per "ALTRI IMPORTI" (due quote da 5,50 EUR non soggette a IVA somministrazione), per un totale complessivo pagato di 48,40 EUR.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 10 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 10,
    documentId: 'DE_CAFFE_DOC_B_001',
    fixtureGroupId: 'DE_CAFFE_001',
    label: "D.E. Caffe' - Documento B (Scontrino distinto)",
    associatedImages: ['RR-009_DE_CAFFE_docB_3-90_view01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ["D.E. CAFFE'", "D.E. CAFFE' S.R.L."],
      status: 'CONFIRMED',
      note: "Intestazione D.E. CAFFE'",
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-18', status: 'CONFIRMED' },
    time: { value: '15:12', status: 'CONFIRMED' },
    total: { value: 3.90, status: 'CONFIRMED', note: 'Totale documento 3,90 EUR' },
    paymentMethod: { value: 'Contanti', status: 'CONFIRMED', note: 'Pagamento contante' },
    lineCount: { value: 3, status: 'CONFIRMED', note: '3 consumazioni bar' },
    lineItems: [
      {
        description: { value: 'CAFFE ESPRESSO', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.30, status: 'CONFIRMED' },
        totalPrice: { value: 1.30, status: 'CONFIRMED' },
      },
      {
        description: { value: 'CAPPUCCINO', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.50, status: 'CONFIRMED' },
        totalPrice: { value: 1.50, status: 'CONFIRMED' },
      },
      {
        description: { value: 'CORNETTO', status: 'CONFIRMED' },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 1.10, status: 'CONFIRMED' },
        totalPrice: { value: 1.10, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 3.90, status: 'CONFIRMED', note: 'Totale 3,90 EUR' }],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      'TOTALE COMPLESSIVO 3,90',
    ],
    privacyMasked: ['Matricola cassa e operatore omessi'],
    specialNotes:
      'Scontrino caffetteria distinto dal Documento A. 3 consumazioni bar per un totale di 3,90 EUR in contanti.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 11 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 11,
    documentId: 'R_STORE_001',
    fixtureGroupId: 'R_STORE_001',
    label: 'R-Store Apple Premium Reseller',
    associatedImages: ['RR-010_R_STORE_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['R-STORE', 'R-STORE S.P.A.', 'R-STORE APPLE PREMIUM RESELLER'],
      status: 'CONFIRMED',
      note: 'Intestazione R-Store Apple Premium Reseller',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-22', status: 'CONFIRMED' },
    time: { value: '16:35', status: 'CONFIRMED' },
    total: { value: 19.00, status: 'CONFIRMED', note: 'Totale documento 19,00 EUR' },
    paymentMethod: { value: 'Pagamento elettronico', status: 'CONFIRMED', note: 'Carta di pagamento POS' },
    lineCount: { value: 1, status: 'CONFIRMED', note: '1 articolo accessorio Apple / IT' },
    lineItems: [
      {
        description: {
          value: 'ACCESSORIO APPLE / IT',
          status: 'PARTIAL',
          note: 'Categoria merceologica normalizzata; descrizione o codice articolo non integralmente leggibile; quantità e importo confermati visivamente',
        },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 19.00, status: 'CONFIRMED' },
        totalPrice: { value: 19.00, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 19.00, status: 'CONFIRMED', note: 'Totale 19,00 EUR' }],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      'TOTALE COMPLESSIVO 19,00',
      'PAGAMENTO ELETTRONICO 19,00',
    ],
    privacyMasked: [
      'PAN e dati della carta omessi',
      'Codici di autorizzazione e identificativi POS omessi',
      'Dati tecnici della transazione elettronica omessi',
    ],
    specialNotes:
      'Acquisto accessori IT/Apple presso R-Store, totale 19,00 EUR con pagamento elettronico.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 12 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 12,
    documentId: 'PANIFICIO_PANZIERI_DOC_A_001',
    fixtureGroupId: 'PANIFICIO_PANZIERI_001',
    label: 'Panificio Panzieri - Documento A (0618-0109)',
    associatedImages: ['RR-011_PANIFICIO_PANZIERI_docA_0109.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['PANIFICIO PANZIERI', 'DA.MA. SRL'],
      status: 'CONFIRMED',
      note: 'Panificio Panzieri / DA.MA. SRL',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-03', status: 'CONFIRMED' },
    time: { value: '12:06', status: 'CONFIRMED' },
    total: { value: 2.00, status: 'CONFIRMED', note: 'Totale certificato nel manifest e sullo scontrino' },
    paymentMethod: { value: 'Contanti', status: 'CONFIRMED', note: 'Pagamento contante 2,00, Importo pagato 2,00' },
    lineCount: { value: 1, status: 'CONFIRMED', note: '1 riga commerciale (REPARTO 4%)' },
    lineItems: [
      {
        description: {
          value: 'REPARTO 4%',
          status: 'CONFIRMED',
          note: 'Dicitura letterale stampata sullo scontrino sotto DESCRIZIONE',
        },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.00, status: 'CONFIRMED' },
        totalPrice: { value: 2.00, status: 'CONFIRMED' },
        vatRate: { value: 4, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 2.00, status: 'CONFIRMED', note: 'Totale complessivo' }],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      '03-08-2026 12:06',
      'DOCUMENTO N. 0618-0109',
      'RT 721V7003198',
      'TOTALE COMPLESSIVO 2,00',
      'di cui IVA 0,08',
      'Pagamento contante 2,00',
    ],
    privacyMasked: [
      'Identificativo operatore cassa escluso dalla ground truth economica',
    ],
    specialNotes:
      'Attivita artigianale da forno. Scontrino sequenziale 0618-0109 emesso il 03-08-2026 alle 12:06. 1 riga a reparto 4%, totale 2,00 EUR contanti.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 13 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 13,
    documentId: 'PANIFICIO_PANZIERI_DOC_B_001',
    fixtureGroupId: 'PANIFICIO_PANZIERI_001',
    label: 'Panificio Panzieri - Documento B (0618-0110)',
    associatedImages: ['RR-011_PANIFICIO_PANZIERI_docB_0110.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['PANIFICIO PANZIERI', 'DA.MA. SRL'],
      status: 'CONFIRMED',
      note: 'Panificio Panzieri / DA.MA. SRL',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-03', status: 'CONFIRMED' },
    time: { value: '12:06', status: 'CONFIRMED' },
    total: { value: 2.00, status: 'CONFIRMED', note: 'Totale certificato nel manifest e sullo scontrino' },
    paymentMethod: { value: 'Contanti', status: 'CONFIRMED', note: 'Pagamento contante 2,00, Importo pagato 2,00' },
    lineCount: { value: 1, status: 'CONFIRMED', note: '1 riga commerciale (REPARTO 4%)' },
    lineItems: [
      {
        description: {
          value: 'REPARTO 4%',
          status: 'CONFIRMED',
          note: 'Dicitura letterale stampata sullo scontrino sotto DESCRIZIONE',
        },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 2.00, status: 'CONFIRMED' },
        totalPrice: { value: 2.00, status: 'CONFIRMED' },
        vatRate: { value: 4, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 2.00, status: 'CONFIRMED', note: 'Totale complessivo' }],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      '03-08-2026 12:06',
      'DOCUMENTO N. 0618-0110',
      'RT 72IV7003198',
      'TOTALE COMPLESSIVO 2,00',
      'di cui IVA 0,08',
      'Pagamento contante 2,00',
    ],
    privacyMasked: [
      'Identificativo operatore cassa escluso dalla ground truth economica',
    ],
    specialNotes:
      'Attivita artigianale da forno. Scontrino sequenziale 0618-0110 emesso il 03-08-2026 alle 12:06, documento distinto da 0109. 1 riga a reparto 4%, totale 2,00 EUR contanti.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 14 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 14,
    documentId: 'EURORISPARMIO_CASA_001',
    fixtureGroupId: 'EURORISPARMIO_CASA_001',
    label: 'Eurorisparmio Casa',
    associatedImages: ['RR-012_EURORISPARMIO_CASA_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['EURORISPARMIO CASA', 'DI FU YONG QING'],
      status: 'CONFIRMED',
      note: 'Insegna EURORISPARMIO CASA / DI FU YONG QING',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-27', status: 'CONFIRMED' },
    time: { value: '13:11', status: 'CONFIRMED' },
    total: { value: 5.90, status: 'CONFIRMED', note: 'Totale certificato nel manifest' },
    paymentMethod: { value: 'Pagamento elettronico', status: 'CONFIRMED', note: 'Pagamento elettronico / CARTA CREDITO 5,90' },
    lineCount: { value: 1, status: 'CONFIRMED', note: '1 riga commerciale da reparto' },
    lineItems: [
      {
        description: {
          value: 'REPARTO 1',
          status: 'CONFIRMED',
          note: 'Dicitura letterale stampata sullo scontrino sotto DESCRIZIONE',
        },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 5.90, status: 'CONFIRMED' },
        totalPrice: { value: 5.90, status: 'CONFIRMED' },
        vatRate: { value: 22, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 5.90, status: 'CONFIRMED', note: 'Totale complessivo' }],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE DI VENDITA O PRESTAZIONE',
      '27-08-2026 13:11',
      'DOCUMENTO N. 0273-0021',
      'RT 3CICE153916',
      'TOTALE COMPLESSIVO 5,90',
      'DI CUI IVA 1,06',
      'PAGAMENTO ELETTRONICO 5,90',
      'CARTA CREDITO 5,90',
    ],
    privacyMasked: [
      'Dati tecnici di circuito e transazione carta esclusi dalla ground truth economica',
    ],
    specialNotes:
      'Discounter per la casa e igiene. Documento 0273-0021 emesso il 27-08-2026 alle 13:11. 1 riga commerciale REPARTO 1 al 22%, totale 5,90 EUR con carta credito.',
  },

  // --------------------------------------------------------------------------
  // DOCUMENTO 15 / 15
  // --------------------------------------------------------------------------
  {
    documentIndex: 15,
    documentId: 'I_QUADRI_001',
    fixtureGroupId: 'I_QUADRI_001',
    label: 'I Quadri (Ristorante / Pizzeria)',
    associatedImages: ['RR-013_I_QUADRI_p01.jpeg'],
    imageRelationship: 'SINGLE_IMAGE',
    status: 'DRAFT_AWAITING_INDEPENDENT_AUDIT',
    merchant: {
      value: ['I QUADRI', 'I BERGANTARI S.R.L.'],
      status: 'CONFIRMED',
      note: 'Insegna i QUADRI / I BERGANTARI S.R.L.',
    },
    category: { value: 'COMMERCIAL_RECEIPT', status: 'CONFIRMED' },
    date: { value: '2026-08-24', status: 'CONFIRMED' },
    time: { value: '15:24', status: 'CONFIRMED' },
    total: { value: 142.60, status: 'CONFIRMED', note: 'Totale certificato nel manifest' },
    paymentMethod: { value: 'Pagamento elettronico', status: 'CONFIRMED', note: 'Pagamento elettronico / POS 142,60' },
    lineCount: { value: 1, status: 'CONFIRMED', note: '1 riga commerciale a corpo per servizio di ristorazione (PASTO COMPLETO)' },
    lineItems: [
      {
        description: {
          value: 'PASTO COMPLETO',
          status: 'CONFIRMED',
          note: 'Dicitura letterale stampata sullo scontrino sotto DESCRIZIONE',
        },
        quantity: { value: 1, status: 'CONFIRMED' },
        unitPrice: { value: 142.60, status: 'CONFIRMED' },
        totalPrice: { value: 142.60, status: 'CONFIRMED' },
        vatRate: { value: 10, status: 'CONFIRMED' },
      },
    ],
    subtotals: [{ value: 142.60, status: 'CONFIRMED', note: 'Totale complessivo' }],
    fiscalLines: [
      'DOCUMENTO COMMERCIALE di vendita o prestazione',
      '24-08-2026 15:24',
      'DOCUMENTO N. 0016-0027',
      'RT 99IEB152710',
      'TOTALE COMPLESSIVO 142,60',
      'di cui IVA 12,96',
      'Pagamento elettronico 142,60',
      'POS DETTAGLIO FORME di PAGAMENTO 142,60',
    ],
    privacyMasked: [
      'Identificativo cameriere/operatore escluso per minimizzazione dati e privacy',
      'Identificativo terminale POS escluso dalla ground truth di business',
    ],
    specialNotes:
      'Ricevuta ristorazione/pizzeria con riga unica PASTO COMPLETO al 10% IVA (tavolo TAV. 13 e operatore esclusi da articoli per standard contabile e privacy). Totale 142,60 EUR pagato con POS.',
  },
];
