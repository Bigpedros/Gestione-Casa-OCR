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

describe('FASE P4-D2-RC-04 — Confine corpo articoli e footer fiscale/pagamenti Eurospin', () => {
  it('esclude tassativamente le righe del footer fiscale e dei pagamenti dalle line item del corpo articoli', () => {
    // Percorso produttivo ufficiale per COMMERCIAL_RECEIPT
    const draft = receiptParserService.parseText(EUROSPIN_REAL_RAW_TEXT);

    expect(draft.documentCategory).toBe('COMMERCIAL_RECEIPT');

    const combinedTexts = draft.lines.map((l) => `${l.normalizedDescription} ${l.originalText}`.toUpperCase());

    const FORBIDDEN_FOOTER_PATTERNS = [
      'SUBTOTAL',
      'PAGAMENTO ELETTRONICO',
      'IMPORTO PAGATO',
      'DI CUI IVA',
      'DETTAGLIO PAGAMENTI',
      'POS BANCOMAT',
      'RT  96 1KN022623',
      'N. PEZZI 11',
    ];

    // C. Verifica che NON siano presenti tra le line item finali elementi contenenti le parole del footer
    for (const pattern of FORBIDDEN_FOOTER_PATTERNS) {
      const match = combinedTexts.find((text) => text.includes(pattern));
      expect(
        match,
        `La riga footer "${pattern}" non deve essere inclusa tra le line item commerciali! Trovata in: "${match}"`
      ).toBeUndefined();
    }

    // D. Verifica che rimangano nel corpo prodotti almeno le righe commerciali chiaramente riconosciute
    const vasch5008 = draft.lines.find(
      (l) => l.normalizedDescription.includes('VASCH LIMONE 5008') && l.lineTotal === 2.69
    );
    expect(vasch5008, 'Deve estrarre VASCH LIMONE 5008 a 2.69').toBeDefined();

    const vasch009 = draft.lines.find(
      (l) => l.normalizedDescription.includes('VASCH LIMONE 009') && l.lineTotal === 2.69
    );
    expect(vasch009, 'Deve estrarre VASCH LIMONE 009 a 2.69').toBeDefined();

    const risPorco = draft.lines.find(
      (l) => l.normalizedDescription.includes('RIS PORCO. ZAFF 1795') && l.lineTotal === 0.99
    );
    expect(risPorco, 'Deve estrarre RIS PORCO. ZAFF 1795 a 0.99').toBeDefined();

    const insalataMista = draft.lines.find(
      (l) => l.normalizedDescription.includes('INSALATA GRAN MISTA') && l.lineTotal === 0.99
    );
    expect(insalataMista, 'Deve estrarre INSALATA GRAN MISTA a 0.99').toBeDefined();

    const insalatina3008 = draft.lines.find(
      (l) => l.normalizedDescription.includes('INSALATINA 3008') && l.lineTotal === 0.89
    );
    expect(insalatina3008, 'Deve estrarre INSALATINA 3008 a 0.89').toBeDefined();
  });
});
