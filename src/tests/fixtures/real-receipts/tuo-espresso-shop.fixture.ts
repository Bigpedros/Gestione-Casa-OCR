import { RealReceiptFixture } from '../../harness/types';

export const TUO_ESPRESSO_SHOP_FIXTURE: RealReceiptFixture = {
  id: 'TUO_ESPRESSO_001',
  label: 'Tuo Espresso Shop',
  rawText: undefined,
  groundTruth: {
    id: 'TUO_ESPRESSO_001',
    expectedDocumentCategory: 'COMMERCIAL_RECEIPT',
    expectedMerchant: 'TUO ESPRESSO SHOP',
    notes: 'Campione negozio cialde e caffè con righe con quantità multiple.',
  },
  layoutNotes: 'Negozio specializzato cialde/caffè.',
  metadata: {
    acquisitionDate: '2026-09-04',
  },
};
