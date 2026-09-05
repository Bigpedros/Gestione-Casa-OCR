import { RealReceiptFixture } from '../../harness/types';

export const FARMACIA_LA_NAVE_FIXTURE: RealReceiptFixture = {
  id: 'FARMACIA_LA_NAVE_001',
  label: 'Farmacia La Nave',
  rawText: undefined,
  groundTruth: {
    id: 'FARMACIA_LA_NAVE_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'FARMACIA LA NAVE',
    notes: 'Campione scontrino parlante farmacia con codici fiscali e ticket.',
  },
  layoutNotes: 'Scontrino parlante farmacia con diciture SOP/OTC/Dispositivo Medico.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
