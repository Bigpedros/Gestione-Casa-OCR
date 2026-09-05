import { RealReceiptFixture } from '../../harness/types';

export const ORIZZONTE_FIXTURE: RealReceiptFixture = {
  id: 'ORIZZONTE_001',
  label: 'Orizzonte',
  rawText: undefined,
  groundTruth: {
    id: 'ORIZZONTE_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'ORIZZONTE',
    notes: 'Campione Orizzonte casalinghi e cura della casa.',
  },
  layoutNotes: 'Layout scontrino standard non-alimentare/casalinghi.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
