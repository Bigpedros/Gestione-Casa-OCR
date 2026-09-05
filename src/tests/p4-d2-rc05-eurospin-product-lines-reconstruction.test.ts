import { describe, it, expect } from 'vitest';
import { receiptParserService } from '../services/ocrParser/receiptParserService';

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

describe('FASE P4-D2-RC-05 — Ricostruzione righe prodotto Eurospin e divieto fusione prodotti senza prezzo', () => {
  it('separa correttamente i prodotti senza prezzo evitando fusioni indiscriminate tra articoli consecutivi', () => {
    const draft = receiptParserService.parseText(EUROSPIN_REAL_RAW_TEXT);

    expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');

    // A. Due descrizioni consecutive appartenenti a prodotti diversi NON devono essere concatenate in un unico prodotto
    const mergedSalsaGiras = draft.lines.find(
      (l) =>
        l.normalizedDescription.toUpperCase().includes('SALSA YOGURT') &&
        (l.normalizedDescription.toUpperCase().includes('GIRAS') ||
          l.normalizedDescription.toUpperCase().includes('RICOTTA'))
    );
    expect(
      mergedSalsaGiras,
      'SALSA YOGURT e GIRAS .RICOTTA non devono essere fusi in una singola riga prodotto'
    ).toBeUndefined();

    const mergedZareAranciata = draft.lines.find(
      (l) =>
        l.normalizedDescription.toUpperCase().includes('ZARE') &&
        l.normalizedDescription.toUpperCase().includes('ARANCIATA')
    );
    expect(
      mergedZareAranciata,
      'ZARE e ARANCIATA ZERO non devono essere fusi in una singola riga prodotto'
    ).toBeUndefined();

    // B. Righe prodotto senza prezzo leggibile devono rimanere autonome con warning PRICE_NOT_DETECTED
    const salsaLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('SALSA YOGURT')
    );
    expect(salsaLine, 'SALSA YOGURT deve essere estratto come riga autonoma').toBeDefined();
    expect(salsaLine?.warnings).toContain('PRICE_NOT_DETECTED');

    const girasLine = draft.lines.find(
      (l) =>
        l.normalizedDescription.toUpperCase().includes('GIRAS') ||
        l.normalizedDescription.toUpperCase().includes('RICOTTA')
    );
    expect(girasLine, 'GIRAS .RICOTTA deve essere estratto come riga autonoma').toBeDefined();
    expect(girasLine?.warnings).toContain('PRICE_NOT_DETECTED');

    const zareLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('ZARE')
    );
    expect(zareLine, 'ZARE non deve risultare come articolo autonomo (rumore)').toBeUndefined();

    const shopperLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('SHOPPER')
    );
    expect(shopperLine, 'SHOPPER BIO EUROSPIN deve essere estratto come riga autonoma').toBeDefined();
    expect(shopperLine?.warnings).toContain('PRICE_NOT_DETECTED');

    const aranciataLine = draft.lines.find((l) =>
      l.normalizedDescription.toUpperCase().includes('ARANCIATA')
    );
    expect(aranciataLine, 'ARANCIATA ZERO deve essere estratto come riga autonoma').toBeDefined();
    expect(aranciataLine?.warnings).toContain('PRICE_NOT_DETECTED');

    // C. Le righe commerciali con prezzo certo devono rimanere intatte
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

    // D. Totale articoli coerente: 11 articoli distinti (7 con prezzo + 4 senza prezzo)
    expect(draft.lines.length, 'Devono essere presenti 11 righe articolo distinte').toBe(11);

    // E. Il footer deve continuare a essere escluso tassativamente
    const combinedTexts = draft.lines.map((l) => `${l.normalizedDescription} ${l.originalText}`.toUpperCase());
    for (const pattern of ['SUBTOTAL', 'PAGAMENTO ELETTRONICO', 'IMPORTO PAGATO', 'POS BANCOMAT']) {
      const match = combinedTexts.find((text) => text.includes(pattern));
      expect(match, `La riga footer "${pattern}" non deve essere tra le line item`).toBeUndefined();
    }
  });
});
