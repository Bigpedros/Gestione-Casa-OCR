import { RealReceiptFixture } from '../../harness/types';

export const PANIFICIO_PANZIERI_FIXTURE: RealReceiptFixture = {
  id: 'PANIFICIO_PANZIERI_001',
  label: 'Panificio Panzieri',
  rawText: undefined,
  groundTruth: {
    id: 'PANIFICIO_PANZIERI_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'PANIFICIO PANZIERI',
    notes: 'Campione panetteria/artigianale con prezzi a peso e descrizioni abbreviate.',
  },
  layoutNotes: 'Attività artigianale alimentare con righe sintetiche e IVA 4%.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
