import { RealReceiptFixture } from '../../harness/types';

export const I_QUADRI_FIXTURE: RealReceiptFixture = {
  id: 'I_QUADRI_001',
  label: 'I Quadri',
  rawText: undefined,
  groundTruth: {
    id: 'I_QUADRI_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'I QUADRI',
    notes: 'Campione ristorante / pizzeria con coperti, portate e bevande.',
  },
  layoutNotes: 'Ricevuta ristorazione con coperti e suddivisione pietanze.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
