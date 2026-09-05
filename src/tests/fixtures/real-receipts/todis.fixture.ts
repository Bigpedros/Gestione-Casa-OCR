import { RealReceiptFixture } from '../../harness/types';
import { TODIS_REAL_RAW_TEXT } from '../todisRealRawFixture';

export const TODIS_FIXTURE: RealReceiptFixture = {
  id: 'TODIS_001',
  label: 'Todis - Casci S.r.l. (Roma)',
  rawText: TODIS_REAL_RAW_TEXT,
  groundTruth: {
    id: 'TODIS_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: ['TODIS', 'T00IS', 'CASCI'],
    expectedLineCount: 9,
    expectedTotal: 21.90,
    expectedPaymentMethod: 'Contanti',
    notes: 'Scontrino reale Todis con 9 articoli, sconto arrotondamento, OCR noise e contanti.',
  },
  layoutNotes: 'Intestazione T00IS (alias OCR), corpo articoli con sconto arrotondamento, totale 21,90 con contanti 25,00 e resto 3,10.',
  metadata: {
    acquisitionDate: '2026-08-10',
    rawFrozenAt: '2026-09-04T08:29:00.000Z',
    ocrEngineVersion: 'Tesseract.js v7.0.0 (ita)',
    sourceVariant: 'original',
    sha256: '81a37eb295eaec298111e9da3c8cf51ac01f3abc3b2462afd26ff7f0d47d02cb',
  },
};
