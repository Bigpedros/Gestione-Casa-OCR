import { RealReceiptFixture } from '../../harness/types';

export const PEWEX_REAL_RAW_TEXT = `PEWEX SUPERMERCATI
MGDR S.R.L.

P.le Sandro Pertini - C.C
00040 - Marino (RM)
Tel.0620192151
P.IVA 13024251004

DOCUMENTO COMMERCIALE
di vendita o prestazione

DES SCRIZIONE                          Prezzo(€)

PANE - 12, a
R OR AES:

PANE i 12,205
Ò FRITTURA PESCE

PEWEX SHOP BIOCOMP 30     22,00%
R SAN BENED-GINGER ZERO 22,00%
R SAN BENED-LIMONE ZERO 22,00%

PANE 3. 2593
R LINGUE PIZZA    SA FR 10,00%

RIDOLCE E SALATO CROEC      +00
R CLROMA PANNA FRESCA     10,00%
TOTALE

Til E QONPLESSIO
i

lettro:
.0

31-07-2026 12:10
DOCUMENTO N. 0972-0042

QUTEN

151E7065409`;

/**
 * RAW REGIONALI REALI CERTIFICATI IN RC-05C-R2 (Evidenza empirica congelata)
 * Provenienza: Tesseract.js v7.0.0 (ita) su crop body e footer dell'immagine Pewex.
 * Livello di validazione: L2 Recorded Regional Replay.
 */
export const PEWEX_BODY_RAW_REAL = `
VA     Prezzo(€)             GE
00%          12,44 PRI
GG
00%    12,20 Pa
o n            PARIS
LUIGI Aa
00%                     0,10 VG
00%       0,69 RIA
00%                   0,69 SG
RA
SU
00%           2599    e  MN
Li             MS
00%           2489 O
00%           2,99 ANS
34,53 NSA
i       SEEN
I RS
34,53 e

53
`;

export const PEWEX_FOOTER_RAW_REAL = `
lettronico              34,53
31-07-7076 12:10
DOCUMENTO N. 0972-0042
7 99ÎEB065409
`;

export const PEWEX_FIXTURE: RealReceiptFixture = {
  id: 'PEWEX_001',
  label: 'Pewex Supermercati - MGDR S.r.l. (Marino)',
  rawText: PEWEX_REAL_RAW_TEXT,
  groundTruth: {
    id: 'PEWEX_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: ['PEWEX', 'PEWEX SUPERMERCATI', 'MGDR S.R.L.', 'MGDR SRL'],
    expectedLineCount: 8,
    expectedTotal: 34.53,
    expectedPaymentMethod: 'Pagamento elettronico',
    expectedProducts: [
      { descriptionContains: 'R FRITTURA PESCE', price: 12.44 },
      { descriptionContains: 'R FRITTURA PESCE', price: 12.20 },
      { descriptionContains: 'PEWEX SHOP BIOCOMP', price: 0.10 },
      { descriptionContains: 'SAN BENED-GINGER', price: 0.69 },
      { descriptionContains: 'SAN BENED-LIMONE', price: 0.69 },
      { descriptionContains: 'LINGUE PIZZA', price: 2.93 },
      { descriptionContains: 'DOLCE E SALATO', price: 2.49 },
      { descriptionContains: 'CLROMA PANNA FRESCA', price: 2.99 },
    ],
    expectedDate: '2026-07-31',
    notes: 'Scontrino reale Pewex con 8 articoli commerciali con prezzo (somma 34,53 €), subtotale, intestazione MGDR S.R.L. e pagamento elettronico.',

    // RC-05G Shadow Replay Expectations
    expectedTriggerReason: 'missing_total',
    expectedRegionalTotal: 34.53,
    expectedRegionalMonetaryValues: [12.44, 12.20, 0.10, 0.69, 0.69, 2.99],
    expectedRegionalTokenCount: 10,
    expectedAlignmentOutcome: 'AMBIGUOUS',
    validationLevel: 'L2_RECORDED_REGIONAL',
  },
  recordedRegionalReplay: {
    bodyRaw: PEWEX_BODY_RAW_REAL,
    footerRaw: PEWEX_FOOTER_RAW_REAL,
    provenance: 'Recorded from real Tesseract.js v7.0.0 (ita) regional crop in RC-05C-R2 on Pewex image. L2 Recorded Replay.',
  },
  layoutNotes: 'Supermercato Pewex C.C. La Nave, intestazione MGDR S.R.L. con P.IVA 13024251004, articoli con raggruppamento PANE, totale 34,53 € e pagamento elettronico.',
  metadata: {
    acquisitionDate: '2026-07-31',
    rawFrozenAt: '2026-09-05T12:45:00.000Z',
    ocrEngineVersion: 'Tesseract.js v7.0.0 (ita)',
    sourceVariant: 'gentle_contrast',
    sha256: '3ed7a7685ffd6abf2696dcd62487888a1757b092b6c2dc2125e01242af7e8824',
  },
};

