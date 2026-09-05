import { RealReceiptFixture } from '../../harness/types';

export const CARREFOUR_CONTACT_FIXTURE: RealReceiptFixture = {
  id: 'CARREFOUR_CONTACT_001',
  label: 'Carrefour Contact',
  rawText: undefined,
  groundTruth: {
    id: 'CARREFOUR_CONTACT_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'CARREFOUR',
    notes: 'Campione Carrefour Contact per verifica insegna e linee spesa.',
  },
  layoutNotes: 'Grande distribuzione con intestazione Carrefour Contact.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
