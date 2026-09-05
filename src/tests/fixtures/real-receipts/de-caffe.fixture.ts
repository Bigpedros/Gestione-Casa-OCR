import { RealReceiptFixture } from '../../harness/types';

export const DE_CAFFE_FIXTURE: RealReceiptFixture = {
  id: 'DE_CAFFE_001',
  label: "D.E. Caffe'",
  rawText: undefined,
  groundTruth: {
    id: 'DE_CAFFE_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: "D.E. CAFFE'",
    notes: 'Campione bar/caffetteria con pochi articoli ad importo unitario basso.',
  },
  layoutNotes: 'Scontrino bar/somministrazione alimenti e bevande.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
