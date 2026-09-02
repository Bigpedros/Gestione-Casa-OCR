import { describe, it, expect } from 'vitest';
import { TextNormalizationModule } from '../services/ocrParser/modules/TextNormalizationModule';
import { ReceiptZoneSegmenter } from '../services/ocrParser/modules/ReceiptZoneSegmenter';
import { LineItemParser } from '../services/ocrParser/modules/LineItemParser';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';
import { ReceiptParserContext } from '../services/ocrParser/types';

describe('SOTTO-BLOCCO 2C: Confronto Deterministico Legacy vs LineItemParserV2', () => {
  const structuredNorm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
  const zones = ReceiptZoneSegmenter.segment(structuredNorm);
  const bodyLines = zones.body;

  it('runs both parsers on identical BODY input derived from canonical TODIS raw fixture', () => {
    // 1. V2 riceve direttamente SegmentedReceiptLine[] da zones.body
    const v2Result = LineItemParserV2.parseBody(bodyLines);

    // 2. Legacy adapter: riceve ReceiptParserContext con le sole righe di BODY (sia normalizzate che raw)
    const legacyParser = new LineItemParser();
    const legacyContextWithBodyOnly: ReceiptParserContext = {
      rawText: bodyLines.map(l => l.rawText).join('\n'),
      normalizedText: bodyLines.map(l => l.text).join('\n'),
      lines: bodyLines.map(l => l.rawText),
      normalizedLines: bodyLines.map(l => l.text),
      overallOcrConfidence: 0.85,
    };
    const legacyResultFromParsedBody = legacyParser.parse(legacyContextWithBodyOnly);

    // 3. Legacy con intero documento (per verificare la dipendenza del legacy dai propri filtri header/footer)
    const legacyContextFullDoc: ReceiptParserContext = {
      rawText: structuredNorm.rawText,
      normalizedText: structuredNorm.normalizedText,
      lines: [...structuredNorm.rawLines],
      normalizedLines: structuredNorm.lines.map(l => l.normalizedText),
      overallOcrConfidence: 0.85,
    };
    const legacyResultFromFullDoc = legacyParser.parse(legacyContextFullDoc);

    // Invarianti di confronto tra i due parser
    // legacyResultFromParsedBody estrae 9 righe (articoli con e senza prezzo preservati sotto Regola Ceccotti P4-D1-R1)
    expect(legacyResultFromParsedBody.length).toBe(9);
    expect(legacyResultFromFullDoc.length).toBe(7);

    // Invarianti V2 sul BODY TODIS
    expect(v2Result.items.length).toBe(10);
    const articleCount = v2Result.items.filter(it => it.type === 'ARTICLE').length;
    const discountCount = v2Result.items.filter(it => it.type === 'DISCOUNT' || it.type === 'ROUNDING').length;
    expect(articleCount).toBe(9);
    expect(discountCount).toBe(1);

    // Ordine preservato
    expect(v2Result.items[0].description).toContain('SHOPPERS BIO .MM320+');
    expect(v2Result.items[1].description).toContain('PATATINE KETTLE');
    expect(v2Result.items[2].description).toContain('PANE TRAMEZZINI');
    expect(v2Result.items[3].description).toContain("ESTATHE' PESCA 3X20");
    expect(v2Result.items[4].description).toContain('ARROTONDAMENTO');
    expect(v2Result.items[5].description).toContain('GRANDE IMPERO 1000GR');
    expect(v2Result.items[6].description).toContain('NUTELLA');
    expect(v2Result.items[7].description).toContain('OLIVE VERDI C/ACCIUG');
    expect(v2Result.items[8].description).toContain('POM.OBLUNGO PICCAD');
    expect(v2Result.items[9].description).toContain('BOCCONCINI PUGL.TAKE');

    // Verifica conservativa: nessun prezzo assente trasformato in €0 certo
    expect(v2Result.items[0].lineTotal).toBeNull();
    expect(v2Result.items[0].monetaryEvidence.lineTotalEvidence).toBe('MISSING');

    // Token ambigui
    expect(v2Result.items[2].lineTotal).toBeNull();
    expect(v2Result.items[2].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');
    expect(v2Result.items[3].lineTotal).toBeNull();
    expect(v2Result.items[3].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');
    expect(v2Result.items[4].lineTotal).toBeNull();
    expect(v2Result.items[4].monetaryEvidence.lineTotalEvidence).toBe('AMBIGUOUS');

    // Prezzi certi
    expect(v2Result.items[1].lineTotal).toBe(1.99);
    expect(v2Result.items[1].monetaryEvidence.lineTotalEvidence).toBe('CERTAIN');
    expect(v2Result.items[5].lineTotal).toBe(6.99);
    expect(v2Result.items[5].monetaryEvidence.lineTotalEvidence).toBe('CERTAIN');

    // Provenance immutabile
    expect(v2Result.items.every(it => it.rawIndices.length > 0 && it.rawLines.length > 0)).toBe(true);
  });
});
