import { describe, it, expect } from 'vitest';
import {
  MerchantDirectoryService,
  MERCHANT_AMBIGUITY_MARGIN,
  MERCHANT_MIN_SIMILARITY,
} from '../services/ocrParser/knowledgeBase/merchantDirectory';
import { MerchantDirectoryEntry } from '../services/ocrParser/knowledgeBase/types';
import { SupplierParser } from '../services/ocrParser/modules/SupplierParser';
import { receiptKnowledgeBase } from '../services/ocrParser/knowledgeBase';

describe('MERCHANT FUZZY R1 — GUARDIA DI AMBIGUITÀ', () => {
  // Test 1: Exact canonical match
  it('TEST 1 — Exact canonical match = 1.00 resta match valido con bonus massimo', () => {
    const res = MerchantDirectoryService.matchMerchant('TODIS');
    expect(res.matched).toBe(true);
    expect(res.canonicalName).toBe('TODIS');
    expect(res.similarity).toBe(1.0);
    expect(res.isAmbiguous).toBe(false);
    expect(res.isFuzzyMatch).toBe(false);
    expect(res.confidenceAdjustment).toBe(15);
  });

  // Test 2: Exact alias match
  it('TEST 2 — Exact alias match = 1.00 resta match valido con bonus alias', () => {
    const res = MerchantDirectoryService.matchMerchant('T00IS');
    expect(res.matched).toBe(true);
    expect(res.canonicalName).toBe('TODIS');
    expect(res.similarity).toBe(1.0);
    expect(res.isAmbiguous).toBe(false);
    expect(res.isFuzzyMatch).toBe(false);
    expect(res.confidenceAdjustment).toBe(12);
  });

  // Test 3: Fuzzy forte non ambiguo
  it('TEST 3 — Fuzzy forte non ambiguo con distacco >= margin è matched: true', () => {
    const entries: MerchantDirectoryEntry[] = [
      {
        id: 'm1',
        canonicalName: 'SUPERMERCATO PRIMO',
        aliases: ['SUPERMERCATO PRIMO'],
      },
      {
        id: 'm2',
        canonicalName: 'FARMACIA SECONDA',
        aliases: ['FARMACIA SECONDA'],
      },
    ];

    // "SUPERMERCAT0 PRIMO" (0 vs O): dist 1 su len 18 => sim = 17/18 = 0.94
    // m2 "FARMACIA SECONDA" ha sim molto bassa (< 0.3)
    const res = MerchantDirectoryService.matchMerchant('SUPERMERCAT0 PRIMO', entries);
    expect(res.matched).toBe(true);
    expect(res.canonicalName).toBe('SUPERMERCATO PRIMO');
    expect(res.similarity).toBeGreaterThanOrEqual(0.9);
    expect(res.isAmbiguous).toBe(false);
    expect(res.isFuzzyMatch).toBe(true);
    expect(res.confidenceAdjustment).toBe(10);
  });

  // Test 4: Fuzzy con distacco < 0.05 (Caso A: 0.956 vs 0.913 => diff 0.043 => ambiguo)
  it('TEST 4 — Fuzzy con distacco inferiore a margin (0.05) è AMBIGUO: matched = false, bonus = 0', () => {
    const entries: MerchantDirectoryEntry[] = [
      {
        id: 'm-alfa',
        canonicalName: 'ALIMENTARI CENTRALE ROM1',
        aliases: [],
      },
      {
        id: 'm-beta',
        canonicalName: 'ALIMENTARI CENTRALE RO12',
        aliases: [],
      },
    ];

    // Candidato: "ALIMENTARI CENTRALE ROMA" (len 23)
    // m-alfa: dist 1 => 22/23 = 0.9565
    // m-beta: dist 2 => 21/23 = 0.9130
    // Distacco: ~0.0435 < 0.05
    const res = MerchantDirectoryService.matchMerchant('ALIMENTARI CENTRALE ROMA', entries);
    expect(res.isAmbiguous).toBe(true);
    expect(res.matched).toBe(false);
    expect(res.confidenceAdjustment).toBe(0);
    expect(res.canonicalName).toBeNull();
    expect(res.matchedEntry).toBeNull();
    expect(res.similarity).toBeGreaterThan(0.9);
    expect(res.secondBestSimilarity).toBeGreaterThan(0.9);
  });

  // Test 5: Fuzzy con distacco < 0.05 in fascia 0.88 vs 0.87 (Caso B)
  it('TEST 5 — Fuzzy in fascia 0.88 vs 0.87 con distacco < 0.05 è AMBIGUO', () => {
    const entries: MerchantDirectoryEntry[] = [
      {
        id: 'm-shop-1',
        canonicalName: 'MARKET NORD A1', // len 14
        aliases: [],
      },
      {
        id: 'm-shop-2',
        canonicalName: 'MARKET NORD B1', // len 14
        aliases: [],
      },
    ];

    // Candidato: "MARKET NORD X1" (len 14)
    // Entrambi hanno dist 1 su len 14 => sim = 13/14 = 0.928 (o distacco 0)
    const res = MerchantDirectoryService.matchMerchant('MARKET NORD X1', entries);
    expect(res.isAmbiguous).toBe(true);
    expect(res.matched).toBe(false);
    expect(res.confidenceAdjustment).toBe(0);
  });

  // Test 6: Tie perfetto fra due merchant diversi
  it('TEST 6 — Tie perfetto tra due merchant distinti è AMBIGUO', () => {
    const entries: MerchantDirectoryEntry[] = [
      {
        id: 'm-a',
        canonicalName: 'EMPORIO CENTRALE 1',
        aliases: [],
      },
      {
        id: 'm-b',
        canonicalName: 'EMPORIO CENTRALE 2',
        aliases: [],
      },
    ];

    // "EMPORIO CENTRALE X": dist 1 da 1, dist 1 da 2 (tie perfetto sopra soglia 0.80)
    const res = MerchantDirectoryService.matchMerchant('EMPORIO CENTRALE X', entries);
    expect(res.isAmbiguous).toBe(true);
    expect(res.matched).toBe(false);
    expect(res.confidenceAdjustment).toBe(0);
    expect(res.similarity).toBe(res.secondBestSimilarity);
  });

  // Test 7: Best e second dello STESSO merchant (canonical + alias) non sono ambigui
  it('TEST 7 — Se le corrispondenze appartengono allo STESSO merchant, NON è ambiguo', () => {
    const entries: MerchantDirectoryEntry[] = [
      {
        id: 'm-single',
        canonicalName: 'SUPERMERCATO PANIFICIO',
        aliases: ['SUPERMERCATI PANIFICI', 'PANIFICIO SUPERMERCATO'],
      },
      {
        id: 'm-far-away',
        canonicalName: 'FARMACIA RURALE ISOLATA',
        aliases: [],
      },
    ];

    // Candidato affine sia al canonical che all'alias dello stesso m-single
    const res = MerchantDirectoryService.matchMerchant('SUPERMERCATO PANIFICI', entries);
    expect(res.matched).toBe(true);
    expect(res.isAmbiguous).toBe(false);
    expect(res.canonicalName).toBe('SUPERMERCATO PANIFICIO');
    expect(res.matchedEntry?.id).toBe('m-single');
  });

  // Test 8: Candidato sotto soglia (< 0.80) => nessun match
  it('TEST 8 — Candidato con similarità sotto soglia assoluta (0.80) non effettua match', () => {
    const res = MerchantDirectoryService.matchMerchant('NEGOZIO TOTALMENTE SCONOSCIUTO XYZ');
    expect(res.matched).toBe(false);
    expect(res.isAmbiguous).toBe(false);
    expect(res.confidenceAdjustment).toBe(0);
    expect(res.canonicalName).toBeNull();
  });

  // Test 9: Ordine invertito delle entry produce lo stesso identico risultato (Order-Independent)
  it('TEST 9 — L\'ordine delle entry nel directory non altera l\'esito di ambiguità (Order-Independent)', () => {
    const entry1: MerchantDirectoryEntry = {
      id: 'm1',
      canonicalName: 'BOTTEGA VERDE ROMA 1',
      aliases: [],
    };
    const entry2: MerchantDirectoryEntry = {
      id: 'm2',
      canonicalName: 'BOTTEGA VERDE ROMA 2',
      aliases: [],
    };

    const candidate = 'BOTTEGA VERDE ROMA X';

    const resOrderA = MerchantDirectoryService.matchMerchant(candidate, [entry1, entry2]);
    const resOrderB = MerchantDirectoryService.matchMerchant(candidate, [entry2, entry1]);

    expect(resOrderA.isAmbiguous).toBe(true);
    expect(resOrderB.isAmbiguous).toBe(true);
    expect(resOrderA.matched).toBe(false);
    expect(resOrderB.matched).toBe(false);
    expect(resOrderA.confidenceAdjustment).toBe(0);
    expect(resOrderB.confidenceAdjustment).toBe(0);
    expect(resOrderA.similarity).toBe(resOrderB.similarity);
  });

  // Test 10: SupplierParser non riceve bonus su match ambiguo
  it('TEST 10 — SupplierParser non incrementa lo score se il match merchant è ambiguo', () => {
    // Verifichiamo che receiptKnowledgeBase.lookupMerchant segnali isAmbiguous: true e confidenceAdjustment: 0
    const ambiguousEntries: MerchantDirectoryEntry[] = [
      {
        id: 'm-rival-1',
        canonicalName: 'BAR DEL CORSO 1',
        aliases: [],
      },
      {
        id: 'm-rival-2',
        canonicalName: 'BAR DEL CORSO 2',
        aliases: [],
      },
    ];

    const match = receiptKnowledgeBase.lookupMerchant('BAR DEL CORSO X', ambiguousEntries);
    expect(match.isAmbiguous).toBe(true);
    expect(match.matched).toBe(false);
    expect(match.confidenceAdjustment).toBe(0);

    // Eseguiamo SupplierParser su uno scontrino con quel nome
    const ocrLines = [
      'BAR DEL CORSO X',
      'VIA NAZIONALE 15 ROMA',
      'P.IVA 12345678901',
    ];

    const supplierParser = new SupplierParser();
    const rawText = ocrLines.join('\n');
    const result = supplierParser.parse({
      rawText,
      normalizedText: rawText,
      lines: ocrLines,
      normalizedLines: ocrLines,
      overallOcrConfidence: 90,
    });
    expect(result.value).toBe('BAR DEL CORSO X');
    // Il fornitore non è stato sostituito con un canonicalName arbitrario
    expect(result.value).not.toBe('BAR DEL CORSO 1');
    expect(result.value).not.toBe('BAR DEL CORSO 2');
  });

  // Test costanti esportate
  it('TEST 11 — Verifica costanti di soglia e margine', () => {
    expect(MERCHANT_AMBIGUITY_MARGIN).toBe(0.05);
    expect(MERCHANT_MIN_SIMILARITY).toBe(0.80);
  });
});
