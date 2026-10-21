import { describe, expect, it } from 'vitest';
import { ReceiptParserService } from '../services/ocrParser/receiptParserService';

describe('production TODIS footer-total regression', () => {
  it('preserves the last article price and removes leaked footer rows', () => {
    const rawText = [
      '97%',
      'I i E',
      '= en Ho i',
      'DIS',
      'CASCI 2 me',
      'Via lario Albizzati 279, 00125 Roma',
      'P. iva 1155331004',
      'te}. 06-5210505',
      'DOCUMENTO COMMERCIALE',
      'di vendita o prestaz ione',
      'TONE 1vVA prezzo( €)',
      'DELITY 0237**#K#t4444*#*',
      'MARI CALDI 10,00% 5.98',
      'ATI 1KG 4,00% 2,79',
      'BIO.MM320+ 22,00% 0,13',
      'ROMANESCHE 4,00% 3.86',
      'BOVINO ADUL 10,00% 5,13',
      '17,89',
      'LESSIVO 17,83',
      '1,8',
      'ttronico 17,89',
      '17,89',
      '09-09-2026 12:19',
      'MENTO N. 2709-0158',
      '7 99ME 1032903',
      '? AC',
      'RI',
    ].join('\n');

    const parser = new ReceiptParserService();
    const draft = parser.parseText(rawText, {
      overallOcrConfidence: 55,
      documentType: 'COMMERCIAL_RECEIPT',
    });

    expect(draft.total.value).toBe(17.89);
    expect(draft.lines.map((line) => line.lineTotal)).toEqual([
      5.98,
      2.79,
      0.13,
      3.86,
      5.13,
    ]);
    expect(draft.lines[4].normalizedDescription).toContain('BOVINO');
    expect(draft.lines[4].lineTotal).toBe(5.13);
    expect(
      Math.round(draft.lines.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100
    ).toBe(17.89);
  });
});
