import { describe, it, expect } from 'vitest';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { LineItemParserV2 } from '../services/ocrParser/modules/LineItemParserV2';
import { SegmentedReceiptLine } from '../services/ocrParser/types';

export const EUROSPIN_REAL_RAW_TEXT = `GRUPPO CAUCCI SRL
pv. Largo Manzoni, 14
010040 - $ Maria delle Mole - Marino (RM

P.i. 136031 11003
C.F. 19360317 1003

www.eurospin.it

Tel: 0803548050 = Cassa |

DOCUMENTO COMMERCI /...£

di vendita © prestazione

DESCRIZIONE                    pREZZOLE) IVA
VASCH LIMONE 5008                  2,69 L
VASCH LIMONE 009                  2,69 L
SALSA YOGURT 250n                 {SOR
GIRAS .RICOTTA/I IMONI               AO I
RIS PORCO. ZAFF 1795                0.99 L
INSALATA GRAN MISTA                0,99 L
INSALATINA 3008                   0,89 L
INSALATINA 3009                  0,89 L
INSALATINA 3009                   0.89 L N
ZARE  |

ARANCIATA ZERO 45)
SUBTOTAL              14,36
OE

|
|

SHOPPER BIO EUROSPIN
SUBTOTAL              14,46

“O
0,00

DI CUI IVA
PAGAMENTO ELETTRONICO                  14,46
14,48

IMPORTO PAGATO

L: XVI Ventilazione IVA
30/07/26 12:40                 noc 0021-0199
RT  96 1KN022623

DETTAGLIO PAGAMENTI :
POS BANCOMAT                          14,48

N. PEZZI 11
ERE tori LA`;

describe('FASE P4-D2-RC-06A — Correzione Identità Articoli Eurospin (Falso Articolo + Shopper Post-Subtotale Intermedio)', () => {
  it('identifica esattamente gli 11 articoli reali, esclude il frammento ZARE | e include SHOPPER BIO EUROSPIN', () => {
    const draft = receiptParserService.parseText(EUROSPIN_REAL_RAW_TEXT);

    expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');

    // 1. Il numero complessivo di articoli deve essere esattamente 11 (corrispondente a N. PEZZI 11)
    expect(draft.lines.length, 'Devono essere presenti esattamente 11 righe articolo distinte').toBe(11);

    // 2. La riga isolata di frammento / rumore "ZARE |" non deve essere promossa ad articolo autonomo
    const zareLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('ZARE') ||
      l.originalText.toUpperCase().includes('ZARE')
    );
    expect(zareLine, 'La riga ZARE | non deve essere presente tra gli articoli').toBeUndefined();

    const raw25Line = draft.lines.find((l) => l.lineIndex === 25);
    expect(raw25Line, 'Nessun articolo deve corrispondere al rawIndex 25 (ZARE |)').toBeUndefined();

    // 3. Verifica presenza ed esattezza di SHOPPER BIO EUROSPIN (articolo commerciale post-subtotale intermedio)
    const shopperLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('SHOPPER') ||
      l.originalText.toUpperCase().includes('SHOPPER')
    );
    expect(shopperLine, 'SHOPPER BIO EUROSPIN deve essere estratto come riga articolo').toBeDefined();
    expect(shopperLine?.lineIndex).toBe(34);
    // Non deduciamo né inventiamo 0.10: il token monetario è assente nel raw OCR
    expect(shopperLine?.lineTotal, 'Il prezzo totale di SHOPPER BIO non deve essere inventato').toBe(0);
    expect(shopperLine?.warnings).toContain('PRICE_NOT_DETECTED');

    // 4. Verifica dei 7 articoli commerciali con prezzo certo
    const vasch5008 = draft.lines.find(
      (l) => l.normalizedDescription.includes('VASCH LIMONE 5008') && l.lineTotal === 2.69
    );
    expect(vasch5008, 'VASCH LIMONE 5008 a 2.69 deve essere presente').toBeDefined();

    const vasch009 = draft.lines.find(
      (l) => l.normalizedDescription.includes('VASCH LIMONE 009') && l.lineTotal === 2.69
    );
    expect(vasch009, 'VASCH LIMONE 009 a 2.69 deve essere presente').toBeDefined();

    const risPorco = draft.lines.find(
      (l) => l.normalizedDescription.includes('RIS PORCO. ZAFF 1795') && l.lineTotal === 0.99
    );
    expect(risPorco, 'RIS PORCO. ZAFF 1795 a 0.99 deve essere presente').toBeDefined();

    const insalataMista = draft.lines.find(
      (l) => l.normalizedDescription.includes('INSALATA GRAN MISTA') && l.lineTotal === 0.99
    );
    expect(insalataMista, 'INSALATA GRAN MISTA a 0.99 deve essere presente').toBeDefined();

    const insalatina3008 = draft.lines.find(
      (l) => l.normalizedDescription.includes('INSALATINA 3008') && l.lineTotal === 0.89
    );
    expect(insalatina3008, 'INSALATINA 3008 a 0.89 deve essere presente').toBeDefined();

    const insalatina3009First = draft.lines.find(
      (l) => l.lineIndex === 23 && l.lineTotal === 0.89
    );
    expect(insalatina3009First, 'Prima INSALATINA 3009 a 0.89 deve essere presente').toBeDefined();

    const insalatina3009Second = draft.lines.find(
      (l) => l.lineIndex === 24 && l.lineTotal === 0.89
    );
    expect(insalatina3009Second, 'Seconda INSALATINA 3009 a 0.89 deve essere presente').toBeDefined();

    // 5. Verifica dei 4 articoli privi di prezzo OCR leggibile (tutti con warning PRICE_NOT_DETECTED)
    const salsaLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('SALSA YOGURT')
    );
    expect(salsaLine, 'SALSA YOGURT deve essere estratto come articolo autonomo').toBeDefined();
    expect(salsaLine?.warnings).toContain('PRICE_NOT_DETECTED');

    const girasLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('GIRAS') ||
      l.normalizedDescription.toUpperCase().includes('RICOTTA')
    );
    expect(girasLine, 'GIRAS .RICOTTA deve essere estratto come articolo autonomo').toBeDefined();
    expect(girasLine?.warnings).toContain('PRICE_NOT_DETECTED');

    const aranciataLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('ARANCIATA')
    );
    expect(aranciataLine, 'ARANCIATA ZERO deve essere estratto come articolo autonomo').toBeDefined();
    expect(aranciataLine?.warnings).toContain('PRICE_NOT_DETECTED');

    // 6. Esclusione tassativa di subtotali, totali, pagamenti e metadati dalle righe articolo
    const combinedTexts = draft.lines.map((l) => `${l.normalizedDescription} ${l.originalText}`.toUpperCase());
    for (const pattern of [
      'SUBTOTAL',
      'PAGAMENTO ELETTRONICO',
      'IMPORTO PAGATO',
      'POS BANCOMAT',
      'DI CUI IVA',
      'VENTILAZIONE',
      'DETTAGLIO PAGAMENTI',
      'N. PEZZI',
      'RT 96'
    ]) {
      const match = combinedTexts.find((text) => text.includes(pattern));
      expect(match, `La voce "${pattern}" non deve comparire tra le line item`).toBeUndefined();
    }
  });

  it('preserva gli invarianti multilinea legittimi (Scenari M, G, O)', () => {
    // Scenario M: Descrizione multilinea unita con evidenza fiscale positiva
    const linesM: SegmentedReceiptLine[] = [
      {
        index: 0,
        rawIndex: 10,
        text: 'DETERGENTE LAVATRICE',
        rawText: 'DETERGENTE LAVATRICE',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test']
      },
      {
        index: 1,
        rawIndex: 11,
        text: 'LIQUIDO CLASSICO 40LAV 5,99 22%',
        rawText: 'LIQUIDO CLASSICO 40LAV 5,99 22%',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test']
      }
    ];
    const resultM = LineItemParserV2.parseBody(linesM);
    expect(resultM.items.length).toBe(1);
    expect(resultM.items[0].description).toBe('DETERGENTE LAVATRICE LIQUIDO CLASSICO 40LAV');
    expect(resultM.items[0].lineTotal).toBe(5.99);
    expect(resultM.items[0].vatRate).toBe(22);
    expect(resultM.items[0].rawIndices).toEqual([10, 11]);

    // Scenario G: Descrizione con prezzo e IVA su riga successiva
    const linesG: SegmentedReceiptLine[] = [
      {
        index: 0,
        rawIndex: 20,
        text: 'PRODOTTO SPECIALITA',
        rawText: 'PRODOTTO SPECIALITA',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test']
      },
      {
        index: 1,
        rawIndex: 21,
        text: '2,99 10%',
        rawText: '2,99 10%',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test']
      }
    ];
    const resultG = LineItemParserV2.parseBody(linesG);
    expect(resultG.items.length).toBe(1);
    expect(resultG.items[0].description).toBe('PRODOTTO SPECIALITA');
    expect(resultG.items[0].lineTotal).toBe(2.99);
    expect(resultG.items[0].vatRate).toBe(10);
    expect(resultG.items[0].rawIndices).toEqual([20, 21]);

    // Scenario O: Prodotto senza prezzo seguito da riga di peso / moltiplicatore
    const linesO: SegmentedReceiptLine[] = [
      {
        index: 0,
        rawIndex: 30,
        text: 'MELE GOLDEN',
        rawText: 'MELE GOLDEN',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test']
      },
      {
        index: 1,
        rawIndex: 31,
        text: '1,250 KG X 1,60 2,00 4%',
        rawText: '1,250 KG X 1,60 2,00 4%',
        zone: 'BODY',
        confidence: 1.0,
        reasons: ['test']
      }
    ];
    const resultO = LineItemParserV2.parseBody(linesO);
    expect(resultO.items.length).toBe(1);
    expect(resultO.items[0].description).toBe('MELE GOLDEN');
    expect(resultO.items[0].lineTotal).toBe(2.00);
    expect(resultO.items[0].quantity).toBe(1.25);
    expect(resultO.items[0].unitOfMeasure).toBe('KG');
    expect(resultO.items[0].vatRate).toBe(4);
    expect(resultO.items[0].rawIndices).toEqual([30, 31]);
  });

  it('non scarta articoli legittimi brevi puliti privi di prezzo come "PANE"', () => {
    const paneLine: SegmentedReceiptLine = {
      index: 1,
      rawIndex: 5,
      text: 'PANE FRESCO',
      rawText: 'PANE FRESCO',
      zone: 'BODY',
      confidence: 0.75,
      reasons: ['contained_in_body_zone']
    };

    const parsed = LineItemParserV2.parseBody([paneLine]);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].description).toBe('PANE FRESCO');
    expect(parsed.items[0].lineTotal).toBeNull();
    expect(parsed.items[0].warnings).toContain('PRICE_NOT_DETECTED');
  });
});
