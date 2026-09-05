import { RealReceiptFixture } from '../../harness/types';

export const LEROY_MERLIN_FIXTURE: RealReceiptFixture = {
  id: 'LEROY_MERLIN_001',
  label: 'Leroy Merlin',
  rawText: undefined,
  groundTruth: {
    id: 'LEROY_MERLIN_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'LEROY MERLIN',
    notes: 'Campione bricolage/casa con codici articolo lunghi e descrizioni tecniche.',
  },
  layoutNotes: 'Ricevuta bricolage con descrizioni estese e codici a barre.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
