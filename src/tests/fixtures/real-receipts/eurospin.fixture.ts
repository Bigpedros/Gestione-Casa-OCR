import { RealReceiptFixture } from '../../harness/types';

export const EUROSPIN_REAL_RAW_TEXT = `GRUPPO CAUCCI SRL
pv. Largo Manzoni, 14
010040 - $ Maria delle Mole - Marino (RM

P.i. 136031 11003
C.F. 19360317 1003

www.eurospin.it

Tel: 0803548050 = Cassa |

DOCUMENTO COMMERCI /...£

di vendita © prestazione

DESCRIZIONE                    pREZZOLE) IVA
VASCH LIMONE 5008                  2,69 L
VASCH LIMONE 009                  2,69 L
SALSA YOGURT 250n                 {SOR
GIRAS .RICOTTA/I IMONI               AO I
RIS PORCO. ZAFF 1795                0.99 L
INSALATA GRAN MISTA                0,99 L
INSALATINA 3008                   0,89 L
INSALATINA 3009                  0,89 L
INSALATINA 3009                   0.89 L N
ZARE  |

ARANCIATA ZERO 45)
SUBTOTAL              14,36
OE

|
|

SHOPPER BIO EUROSPIN
SUBTOTAL              14,46

“O
0,00

DI CUI IVA
PAGAMENTO ELETTRONICO                  14,46
14,48

IMPORTO PAGATO

L: XVI Ventilazione IVA
30/07/26 12:40                 noc 0021-0199
RT  96 1KN022623

DETTAGLIO PAGAMENTI :
POS BANCOMAT                          14,48

N. PEZZI 11
ERE tori LA`;

export const EUROSPIN_FIXTURE: RealReceiptFixture = {
  id: 'EUROSPIN_001',
  label: 'Eurospin - Gruppo Caucci SRL (Marino)',
  rawText: EUROSPIN_REAL_RAW_TEXT,
  groundTruth: {
    id: 'EUROSPIN_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: ['EUROSPIN', 'GRUPPO CAUCCI SRL'],
    expectedLineCount: 11,
    expectedTotal: 14.46,
    expectedPaymentMethod: 'POS BANCOMAT',
    expectedProducts: [
      { descriptionContains: 'VASCH LIMONE', price: 2.69 },
      { descriptionContains: 'VASCH LIMONE', price: 2.69 },
      { descriptionContains: 'SALSA YOGURT', price: 1.39 },
      { descriptionContains: 'GIRAS .RICOTTA', price: 2.19 },
      { descriptionContains: 'RIS PORCO. ZAFF', price: 0.99 },
      { descriptionContains: 'INSALATA GRAN MISTA', price: 0.99 },
      { descriptionContains: 'INSALATINA', price: 0.89 },
      { descriptionContains: 'INSALATINA', price: 0.89 },
      { descriptionContains: 'INSALATINA', price: 0.89 },
      { descriptionContains: 'ARANCIATA ZERO', price: 0.75 },
      { descriptionContains: 'SHOPPER BIO', price: 0.10 },
    ],
    notes: 'Scontrino reale Eurospin con 11 articoli, subtotale intermedio, iva ventilazione e pagamento POS.',
  },
  layoutNotes: 'Intestazione con ragione sociale Gruppo Caucci SRL e URL www.eurospin.it, subtotale a metà articoli, pagamento POS.',
  metadata: {
    acquisitionDate: '2026-07-30',
    rawFrozenAt: '2026-09-04T09:00:00.000Z',
    ocrEngineVersion: 'Tesseract.js v7.0.0 (ita)',
    sourceVariant: 'gentle_contrast',
  },
};
