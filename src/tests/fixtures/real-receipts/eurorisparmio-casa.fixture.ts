import { RealReceiptFixture } from '../../harness/types';

export const EURORISPARMIO_CASA_FIXTURE: RealReceiptFixture = {
  id: 'EURORISPARMIO_CASA_001',
  label: 'Eurorisparmio Casa',
  rawText: undefined,
  groundTruth: {
    id: 'EURORISPARMIO_CASA_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'EURORISPARMIO CASA',
    notes: 'Campione prodotti per la casa, igiene e pulizia.',
  },
  layoutNotes: 'Discounter per la casa con intestazione ditta individuale o SRL.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
