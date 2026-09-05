import { describe, it, expect } from 'vitest';
import {
  receiptKnowledgeBase,
  ReceiptKnowledgeBaseService,
  MerchantDirectoryService,
  KNOWLEDGE_BASE_VERSION,
  BUILTIN_KNOWLEDGE_ENTRIES,
} from '../services/ocrParser/knowledgeBase';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { SegmentedReceiptLine } from '../services/ocrParser/types';

describe('RECEIPT KNOWLEDGE BASE v1 — SUITE DI TEST E CONVALIDA', () => {
  // TEST A: Normalizzazione SUBTOTAL / SUBTOTALE
  it('TEST A — Riconosce e normalizza SUBTOTAL, SUBTOTALE e SUB TOTAL come ruolo SUBTOTAL', () => {
    expect(receiptKnowledgeBase.isSubtotalMarker('SUBTOTAL')).toBe(true);
    expect(receiptKnowledgeBase.isSubtotalMarker('SUBTOTALE')).toBe(true);
    expect(receiptKnowledgeBase.isSubtotalMarker('SUB TOTAL')).toBe(true);
    expect(receiptKnowledgeBase.isSubtotalMarker('SUB-TOTAL')).toBe(true);

    const lookup = receiptKnowledgeBase.lookupRole('SUBTOTALE');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('SUBTOTAL');
  });

  // TEST B: TOTALE COMPLESSIVO come FINAL_TOTAL_CANDIDATE
  it('TEST B — Riconosce TOTALE COMPLESSIVO e varianti come FINAL_TOTAL_CANDIDATE', () => {
    expect(receiptKnowledgeBase.isFinalTotalCandidate('TOTALE COMPLESSIVO')).toBe(true);
    expect(receiptKnowledgeBase.isFinalTotalCandidate('TOTALE(EUR)')).toBe(true);
    expect(receiptKnowledgeBase.isFinalTotalCandidate('TOTALE (EUR)')).toBe(true);
    expect(receiptKnowledgeBase.isFinalTotalCandidate('TOT. GENERALE')).toBe(true);

    const lookup = receiptKnowledgeBase.lookupRole('TOTALE COMPLESSIVO');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('FINAL_TOTAL_CANDIDATE');
  });

  // TEST C: PAGAMENTO ELETTRONICO come PAYMENT
  it('TEST C — Riconosce PAGAMENTO ELETTRONICO come PAYMENT', () => {
    expect(receiptKnowledgeBase.isPaymentMarker('PAGAMENTO ELETTRONICO')).toBe(true);
    expect(receiptKnowledgeBase.isPaymentMarker('PAG. ELETTRONICO')).toBe(true);

    const lookup = receiptKnowledgeBase.lookupRole('PAGAMENTO ELETTRONICO');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('PAYMENT');
  });

  // TEST D: POS BANCOMAT come payment evidence
  it('TEST D — Riconosce POS BANCOMAT come payment marker / debit card payment', () => {
    expect(receiptKnowledgeBase.isPaymentMarker('POS BANCOMAT')).toBe(true);
    expect(receiptKnowledgeBase.isPaymentMarker('BANCOMAT')).toBe(true);

    const lookup = receiptKnowledgeBase.lookupRole('POS BANCOMAT');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('DEBIT_CARD_PAYMENT');
  });

  // TEST E: DETTAGLIO FORME DI PAGAMENTO classificato come metadata/header
  it('TEST E — Riconosce DETTAGLIO FORME DI PAGAMENTO come PAYMENT_DETAILS_HEADER / TRAILING_METADATA', () => {
    expect(receiptKnowledgeBase.isTrailingMetadata('DETTAGLIO FORME DI PAGAMENTO')).toBe(true);
    expect(receiptKnowledgeBase.isTrailingMetadata('DETTAGLIO PAGAMENTI')).toBe(true);

    const lookup = receiptKnowledgeBase.lookupRole('DETTAGLIO FORME DI PAGAMENTO');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('PAYMENT_DETAILS_HEADER');
  });

  // TEST F, G, H, I: SHOPPER / BIO / CARRIER HINTS
  it('TEST F — SHOPPER BIO EUROSPIN classificato come COMMERCIAL_CARRIER_HINT', () => {
    expect(receiptKnowledgeBase.isCommercialCarrierHint('SHOPPER BIO EUROSPIN')).toBe(true);
    const lookup = receiptKnowledgeBase.lookupRole('SHOPPER BIO EUROSPIN');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('COMMERCIAL_CARRIER_HINT');
  });

  it('TEST G — SHOPPERS BIO TODIS classificato come COMMERCIAL_CARRIER_HINT', () => {
    expect(receiptKnowledgeBase.isCommercialCarrierHint('SHOPPERS BIO TODIS')).toBe(true);
    const lookup = receiptKnowledgeBase.lookupRole('SHOPPERS BIO');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('COMMERCIAL_CARRIER_HINT');
  });

  it('TEST H — PEWEX SHOP BIOCOMP classificato come COMMERCIAL_CARRIER_HINT', () => {
    expect(receiptKnowledgeBase.isCommercialCarrierHint('PEWEX SHOP BIOCOMP')).toBe(true);
    expect(receiptKnowledgeBase.isCommercialCarrierHint('SHOP BIOCOMP')).toBe(true);
  });

  it('TEST I — SHOPPERS ORIZZONTE GRANDE classificato come COMMERCIAL_CARRIER_HINT', () => {
    expect(receiptKnowledgeBase.isCommercialCarrierHint('SHOPPERS ORIZZONTE GRANDE')).toBe(true);
    expect(receiptKnowledgeBase.isCommercialCarrierHint('SACCO CARTA RICICLATA')).toBe(true);
    expect(receiptKnowledgeBase.isCommercialCarrierHint('BUSTA SPESA')).toBe(true);
  });

  // TEST J: ZARE | NON classificato come articolo dalla Knowledge Base
  it('TEST J — "ZARE |" non è presente nella Knowledge Base come articolo né ha un ruolo di prodotto', () => {
    const lookup = receiptKnowledgeBase.lookupRole('ZARE |');
    expect(lookup.matched).toBe(false);
  });

  // TEST K & L: PANE e LATTE non sono rumore nel parser
  it('TEST K — PANE non viene scartato come rumore ma trattato come articolo valido senza prezzo', () => {
    const line: SegmentedReceiptLine = {
      index: 0,
      rawIndex: 1,
      text: 'PANE',
      rawText: 'PANE',
      zone: 'BODY',
      confidence: 0.85,
      reasons: ['body'],
    };
    const parsed = LineItemParserV2.parseBody([line]);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].description).toBe('PANE');
    expect(parsed.items[0].monetaryEvidence.lineTotalEvidence).toBe('MISSING');
  });

  it('TEST L — LATTE non viene scartato come rumore ma trattato come articolo valido senza prezzo', () => {
    const line: SegmentedReceiptLine = {
      index: 0,
      rawIndex: 1,
      text: 'LATTE',
      rawText: 'LATTE',
      zone: 'BODY',
      confidence: 0.85,
      reasons: ['body'],
    };
    const parsed = LineItemParserV2.parseBody([line]);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].description).toBe('LATTE');
    expect(parsed.items[0].monetaryEvidence.lineTotalEvidence).toBe('MISSING');
  });

  // TEST M: PRODOTTO SPECIALE non presente nel dizionario gestito strutturalmente dal parser
  it('TEST M — PRODOTTO SPECIALE (non presente nella KB) viene gestito strutturalmente dal parser', () => {
    const lookup = receiptKnowledgeBase.lookupRole('PRODOTTO SPECIALE');
    expect(lookup.matched, 'La KB non deve fare da whitelist esclusiva per i prodotti').toBe(false);

    const rawReceipt = `SUPERMERCATO MODERNO
DOCUMENTO COMMERCIALE
DESCRIZIONE PREZZO IVA
PRODOTTO SPECIALE 5,50 22%
TOTALE COMPLESSIVO 5,50
PAGAMENTO CONTANTE 5,50`;

    const draft = receiptParserService.parseText(rawReceipt);
    const item = draft.lines.find((l) => l.normalizedDescription.includes('PRODOTTO SPECIALE'));
    expect(item, 'PRODOTTO SPECIALE deve essere estratto anche se assente dal dizionario').toBeDefined();
    expect(item?.lineTotal).toBe(5.5);
  });

  // TEST N, O, P: Footer e Metadata
  it('TEST N — RIEPILOGO ACQUISTI viene identificato come TRAILING_METADATA', () => {
    expect(receiptKnowledgeBase.isTrailingMetadata('RIEPILOGO ACQUISTI')).toBe(true);
    const lookup = receiptKnowledgeBase.lookupRole('RIEPILOGO ACQUISTI');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('TRAILING_METADATA');
  });

  it('TEST O — NUMERO DI ARTICOLI viene identificato come TRAILING_METADATA', () => {
    expect(receiptKnowledgeBase.isTrailingMetadata('NUMERO DI ARTICOLI')).toBe(true);
    expect(receiptKnowledgeBase.isTrailingMetadata('NUMERO ARTICOLI')).toBe(true);
    const lookup = receiptKnowledgeBase.lookupRole('NUMERO DI ARTICOLI');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('TRAILING_METADATA');
  });

  it('TEST P — N. PEZZI viene identificato come TRAILING_METADATA', () => {
    expect(receiptKnowledgeBase.isTrailingMetadata('N. PEZZI')).toBe(true);
    const lookup = receiptKnowledgeBase.lookupRole('N. PEZZI');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('TRAILING_METADATA');
  });

  // TEST Q: Campi fiscali sanitari / detraibili 730
  it('TEST Q — CODICE FISCALE e TOTALE DETRAIBILE sono identificati come FISCAL_HEALTH_METADATA', () => {
    expect(receiptKnowledgeBase.isFiscalHealthMetadata('CODICE FISCALE')).toBe(true);
    expect(receiptKnowledgeBase.isFiscalHealthMetadata('TOTALE DETRAIBILE')).toBe(true);
    expect(receiptKnowledgeBase.isFiscalHealthMetadata('TIPI SPESA 730 ONLINE')).toBe(true);

    const lookup = receiptKnowledgeBase.lookupRole('TOTALE DETRAIBILE');
    expect(lookup.matched).toBe(true);
    expect(lookup.role).toBe('FISCAL_HEALTH_METADATA');
  });

  // TEST R: Segnali POS / transazione bancaria
  it('TEST R — CONTACTLESS, DEBIT MASTERCARD e ricevuta cliente forniscono PAYMENT_PROOF_EVIDENCE', () => {
    expect(receiptKnowledgeBase.isPaymentProofEvidence('CONTACTLESS')).toBe(true);
    expect(receiptKnowledgeBase.isPaymentProofEvidence('DEBIT MASTERCARD')).toBe(true);
    expect(receiptKnowledgeBase.isPaymentProofEvidence('PIN VERIFICATO')).toBe(true);
    expect(receiptKnowledgeBase.isPaymentProofEvidence('TRANSAZIONE ESEGUITA')).toBe(true);
  });

  // TEST S: Merchant alias T00IS -> TODIS e supporto disambiguazione
  it('TEST S — Merchant alias T00IS normalizza verso TODIS senza logiche merchant-specific', () => {
    const rawOcr = 'T00IS SUPERMERCATI';
    const normalized = receiptKnowledgeBase.normalizeOcrAliases(rawOcr);
    expect(normalized).toContain('TODIS');

    const match = MerchantDirectoryService.matchMerchant('T00IS');
    expect(match.matched).toBe(true);
    expect(match.canonicalName).toBe('TODIS');
    expect(match.confidenceAdjustment).toBeGreaterThan(0);
  });

  // TEST T: Versioning e Immutabilità del Livello 1
  it('TEST T — La Knowledge Base built-in è versionata 1.0.0 e non vuota', () => {
    expect(receiptKnowledgeBase.getVersion()).toBe('1.0.0');
    expect(KNOWLEDGE_BASE_VERSION).toBe('1.0.0');
    expect(BUILTIN_KNOWLEDGE_ENTRIES.length).toBeGreaterThan(15);
  });

  // TEST U: Livello 2 Local Learned Dictionary
  it('TEST U — Supporta l\'aggiunta di entry al Livello 2 (Learned) senza mutare il Built-in', () => {
    const kb = ReceiptKnowledgeBaseService.getInstance();
    const initialBuiltinCount = kb.getAllEntries().filter((e) => e.source === 'builtin').length;

    kb.registerLearnedEntry({
      id: 'custom-learned-term',
      canonical: 'TERMINE_CUSTOM_TEST',
      semanticRole: 'DEPARTMENT_HEADER',
      notes: 'Termine appreso localmente durante test',
    });

    const hasCustom = kb.hasRole('TERMINE_CUSTOM_TEST', 'DEPARTMENT_HEADER');
    expect(hasCustom).toBe(true);

    const builtinCountAfter = kb.getAllEntries().filter((e) => e.source === 'builtin').length;
    expect(builtinCountAfter).toBe(initialBuiltinCount);
  });

  // TEST V: Document Category Header
  it('TEST V — Riconosce DOCUMENTO COMMERCIALE e DOCUMENTO COMMERCI... come COMMERCIAL_DOCUMENT_HEADER', () => {
    expect(receiptKnowledgeBase.isCommercialDocumentHeader('DOCUMENTO COMMERCIALE')).toBe(true);
    expect(receiptKnowledgeBase.isCommercialDocumentHeader('DOCUMENTO COMMERCI...')).toBe(true);
    expect(receiptKnowledgeBase.isCommercialDocumentHeader('DI VENDITA O PRESTAZIONE')).toBe(true);
  });
});
