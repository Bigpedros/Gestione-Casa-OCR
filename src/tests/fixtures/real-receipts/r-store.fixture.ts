import { RealReceiptFixture } from '../../harness/types';

export const R_STORE_FIXTURE: RealReceiptFixture = {
  id: 'R_STORE_001',
  label: 'R-Store Apple Premium Reseller',
  rawText: undefined,
  groundTruth: {
    id: 'R_STORE_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'R-STORE',
    notes: 'Campione elettronica/informatica ad importi medio-alti e matricole seriali.',
  },
  layoutNotes: 'Documento commerciale con codici seriali e accessori Apple.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
