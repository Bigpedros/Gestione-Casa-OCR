import { describe, it, expect } from 'vitest';
import { DocumentTypeClassifier } from '../services/ocrParser/modules/DocumentTypeClassifier';

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

describe('FASE P4-D2-RC-03 — Regressione classificazione Eurospin reale', () => {
  it('classifica lo scontrino commerciale reale Eurospin del 30/07/2026 come COMMERCIAL_RECEIPT', () => {
    const result = DocumentTypeClassifier.classify(EUROSPIN_REAL_RAW_TEXT);

    expect(result.category).toBe('COMMERCIAL_RECEIPT');
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);

    const signalNames = result.evidences.map((e) => e.signal);
    expect(signalNames).toContain('CORROBORATED_DEGRADED_HEADER_COMMERCIAL_DOCUMENT');
    expect(signalNames).toContain('COMMERCIAL_SUBTITLE_VENDITA_PRESTAZIONE');
    expect(signalNames).toContain('TABLE_HEADER_DESCRIZIONE_PREZZO_IVA');
    expect(signalNames).toContain('ITEM_COUNT_INDICATOR');
    expect(signalNames).toContain('FISCAL_REGISTER_METADATA');
    expect(signalNames).toContain('SUBTOTAL_KEYWORD');
    expect(result.categoryScores.commercialReceipt).toBeGreaterThanOrEqual(70);
  });

  it('GUARD TEST NEGATIVO: una ricevuta POS pura con POS/BANCOMAT/PAGAMENTO ELETTRONICO non diventa COMMERCIAL_RECEIPT', () => {
    const purePosText = `BAR GELATERIA DEL CORSO
Via Dante 15, Milano
PAGAMENTO ELETTRONICO
POS BANCOMAT
TID: 98127361
STAN: 182736
DATA: 30/07/2026 14:15
IMPORTO: EUR 14,48
TRANSAZIONE ESEGUITA
ESITO: OK - APPROVED
MEMORIA CLIENTE`;

    const result = DocumentTypeClassifier.classify(purePosText);

    expect(result.category).not.toBe('COMMERCIAL_RECEIPT');
    expect(result.category).toBe('PAYMENT_PROOF');
    expect(result.categoryScores.commercialReceipt).toBe(0);
  });
});

