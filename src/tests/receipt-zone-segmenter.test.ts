import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { ReceiptZoneSegmenter } from '../services/ocrParser/modules/ReceiptZoneSegmenter';
import { TextNormalizationModule } from '../services/ocrParser/modules/TextNormalizationModule';
import { TODIS_REAL_RAW_TEXT } from './fixtures/todisRealRawFixture';

describe('ReceiptZoneSegmenter (Ceccotti Architecture - Block 1R Tests)', () => {
  // =========================================================================
  // TEST 0: Verità Immutabile e Test di Integrità Permanente della Fixture
  // =========================================================================
  describe('0. Permanent Raw Fixture Integrity (Fonte Canonica di Verità)', () => {
    it('strictly verifies exact line count, character length, UTF-8 byte count, and SHA-256 hash', () => {
      const lines = TODIS_REAL_RAW_TEXT.split('\n');
      const charCount = TODIS_REAL_RAW_TEXT.length;
      const byteCount = new TextEncoder().encode(TODIS_REAL_RAW_TEXT).length;
      const hash = crypto.createHash('sha256').update(TODIS_REAL_RAW_TEXT, 'utf8').digest('hex');

      expect(lines.length).toBe(37);
      expect(charCount).toBe(1462);
      expect(byteCount).toBe(1471);
      expect(hash).toBe('81a37eb295eaec298111e9da3c8cf51ac01f3abc3b2462afd26ff7f0d47d02cb');

      expect(lines[0]).toBe('T00IS');
      expect(lines[36]).toBe('37004-003-0000131-0077');
    });

    it('asserts exact presence of noisy Tesseract lines and prevents idealized strings', () => {
      expect(TODIS_REAL_RAW_TEXT).toContain('PATATINE KETTLE         oo         1,99 PA A i');
      expect(TODIS_REAL_RAW_TEXT).toContain('TOTALE COMPLESSIVO          N');
      expect(TODIS_REAL_RAW_TEXT).toContain('nq    NF NIMAIA');
      expect(TODIS_REAL_RAW_TEXT).toContain('Contanti                               25,00');

      // Assenza assoluta di stringhe inventate o idealizzate
      expect(TODIS_REAL_RAW_TEXT).not.toContain('ARRIVEDERCI E GRAZIE');
      expect(TODIS_REAL_RAW_TEXT).not.toContain('DOCUMENTO N. 0045-0012');
      expect(TODIS_REAL_RAW_TEXT).not.toContain('PATATINE KETTLE 10,00% 2,49 A');
      expect(TODIS_REAL_RAW_TEXT).not.toContain('Sconto ARROTONDAMENTO 22,00% -0,02');
    });
  });

  // =========================================================================
  // TEST A: RAW TODIS Reale della Sesta Prova (Documento_27-08-2026_016)
  // =========================================================================
  describe('A. Real TODIS Raw OCR Segmentation (Documento_27-08-2026_016)', () => {
    it('guarantees that the raw original text is immutable and preserved byte-for-byte across pipeline', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      expect(norm.rawText).toBe(TODIS_REAL_RAW_TEXT);
      expect(norm.rawLines.length).toBe(37);
      expect(norm.lines.length).toBe(37);

      // Esegue la segmentazione e verifica che rawText non sia alterato
      const zones = ReceiptZoneSegmenter.segment(norm);
      expect(norm.rawText).toBe(TODIS_REAL_RAW_TEXT);
      expect(zones.allLines.length).toBe(37);
      expect(zones.allLines.every(l => typeof l.rawIndex === 'number' && l.rawIndex >= 0 && l.rawIndex < 37)).toBe(true);
    });

    it('correctly classifies HEADER zone (lines 0-9) and excludes store header lines from BODY', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.header.length).toBe(10); // Righe 0..9

      const headerTexts = zones.header.map(l => l.text);
      expect(headerTexts.some(t => t.includes('T00IS'))).toBe(true);
      expect(headerTexts.some(t => t.includes('CASCI S.r.]'))).toBe(true);
      expect(headerTexts.some(t => t.includes('PP Iva 11515331004'))).toBe(true);
      expect(headerTexts.some(t => t.includes('DOCUMENTO COMMERCIALE'))).toBe(true);
      expect(headerTexts.some(t => t.includes('di vendita 0 prestazione'))).toBe(true);
      expect(headerTexts.some(t => t.includes('DESCRIZIONE') && (t.includes('prezzo') || t.includes('€') || t.includes('IVA')))).toBe(true);
      expect(headerTexts.some(t => t.includes('245 + Lao È'))).toBe(true);
      expect(headerTexts.some(t => t.includes('O AZZ a'))).toBe(true);

      // Nessuna riga di testata deve finire nel BODY
      const bodyTexts = zones.body.map(l => l.text);
      expect(bodyTexts.some(t => t.includes('T00IS'))).toBe(false);
      expect(bodyTexts.some(t => t.includes('CASCI S.r.]'))).toBe(false);
      expect(bodyTexts.some(t => t.includes('PP Iva'))).toBe(false);
      expect(bodyTexts.some(t => t.includes('DOCUMENTO COMMERCIALE'))).toBe(false);
    });

    it('correctly isolates all 10 items/discounts inside BODY zone in real sequence without mutation', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.body.length).toBe(10); // Righe 10..19 (9 articoli + 1 riga di sconto/arrotondamento)

      const bodyTexts = zones.body.map(l => l.text);

      expect(bodyTexts[0]).toContain('SHOPPERS BIO .MM320+');
      expect(bodyTexts[1]).toContain('PATATINE KETTLE');
      expect(bodyTexts[2]).toContain('PANE TRAMEZZINI');
      expect(bodyTexts[3]).toContain("ESTATHE' PESCA 3X20");
      expect(bodyTexts[4]).toContain('Sconto ARROTONDAMENTO');
      expect(bodyTexts[5]).toContain('GRANDE IMPERO 1000GR');
      expect(bodyTexts[6]).toContain('NUTELLA 9506');
      expect(bodyTexts[7]).toContain('OLIVE VERDI C/ACCIUG');
      expect(bodyTexts[8]).toContain('POM.OBLUNGO PICCAD');
      expect(bodyTexts[9]).toContain('BOCCONCINI PUGL.TAKE');

      // Verifica indici raw corrispondenti
      expect(zones.body.map(l => l.rawIndex)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    });

    it('correctly isolates TOTALS_FOOTER zone (SUBTOTALE, noise interposto, TOTALE COMPLESSIVO N, IVA, Pagamento, Resto, importo nagato)', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);

      // Righe 20..28 (SUBTOTALE, 2 righe rumore, TOTALE COMPLESSIVO N, Sa SESSI, di cui IVA, Pagamento contante, Resto, importo nagato)
      expect(zones.totalsFooter.length).toBe(9);
      const totalsTexts = zones.totalsFooter.map(l => l.text);

      expect(totalsTexts.some(t => t.includes('SUBTOTALE 21,90'))).toBe(true);
      expect(totalsTexts.some(t => t.includes('TOTALE COMPLESSIVO N'))).toBe(true);
      expect(totalsTexts.some(t => t.includes('Pagamento contante 25,00'))).toBe(true);
      expect(totalsTexts.some(t => t.includes('Resto 3,10'))).toBe(true);
      expect(totalsTexts.some(t => t.includes('importo nagato 21,90'))).toBe(true);

      // Nessuna riga dei totali deve essere confusa con BODY
      const bodyTexts = zones.body.map(l => l.text);
      expect(bodyTexts.some(t => t.includes('SUBTOTALE'))).toBe(false);
      expect(bodyTexts.some(t => t.includes('TOTALE COMPLESSIVO'))).toBe(false);
      expect(bodyTexts.some(t => t.includes('Pagamento contante'))).toBe(false);
    });

    it('correctly isolates TRAILING_METADATA zone (Data, DOC. N 2692-0066, ART, FORME PAGAMENTO, Contanti, NUMERO ARTICOLI, Terminale)', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.trailingMetadata.length).toBe(8); // Righe 29..36
      const trailingTexts = zones.trailingMetadata.map(l => l.text);

      expect(trailingTexts[0]).toContain('10-08-2026 12:35');
      expect(trailingTexts[1]).toContain('DOCUMENTO N. 2692-0066');
      expect(trailingTexts[2]).toContain('ART _ 99MEY032908');
      expect(trailingTexts[3]).toContain('DETTAGLIO FORME di PAGAMENTO');
      expect(trailingTexts[4]).toContain('Contanti 25,00');
      expect(trailingTexts[5]).toContain('NUMERO DI ARTICOLI :9');
      expect(trailingTexts[6]).toContain('Neg-Term-Cassiere-Num.');
      expect(trailingTexts[7]).toContain('37004-003-0000131-0077');
    });
  });

  // =========================================================================
  // TEST B: Invarianti Strutturali di Zonizzazione (Ceccotti Invariants)
  // =========================================================================
  describe('B. Mandatory Structural Invariants', () => {
    it('Invariants A-F: accounts for all 37 lines with disjoint zones and strict index preservation', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);

      // A. Tutte le 37 righe originali sono contabilizzate
      expect(zones.allLines.length).toBe(37);
      const totalPartitionSum = zones.header.length + zones.body.length + zones.totalsFooter.length + zones.trailingMetadata.length + zones.ambiguous.length;
      expect(totalPartitionSum).toBe(37);

      // B. Ogni riga appartiene a UNA SOLA zona (indici disgiunti)
      const allAssignedIndices = [
        ...zones.header.map(l => l.index),
        ...zones.body.map(l => l.index),
        ...zones.totalsFooter.map(l => l.index),
        ...zones.trailingMetadata.map(l => l.index),
        ...zones.ambiguous.map(l => l.index),
      ].sort((a, b) => a - b);

      expect(allAssignedIndices).toEqual(Array.from({ length: 37 }, (_, i) => i));

      // C & D. Nessuna riga inventata o eliminata
      for (let i = 0; i < 37; i++) {
        expect(zones.allLines[i].rawIndex).toBe(i);
        expect(zones.allLines[i].rawText).toBe(norm.rawLines[i]);
      }

      // E & F. rawIndex e rawText consentono sempre di risalire e l'ordine è rigorosamente conservato
      expect(zones.body.every((l, idx, arr) => idx === 0 || l.rawIndex > arr[idx - 1].rawIndex)).toBe(true);
      expect(zones.header.every((l, idx, arr) => idx === 0 || l.rawIndex > arr[idx - 1].rawIndex)).toBe(true);
      expect(zones.totalsFooter.every((l, idx, arr) => idx === 0 || l.rawIndex > arr[idx - 1].rawIndex)).toBe(true);
      expect(zones.trailingMetadata.every((l, idx, arr) => idx === 0 || l.rawIndex > arr[idx - 1].rawIndex)).toBe(true);
    });

    it('Invariants G-J: structural context preserves body and footer zones even with corrupt prices and noisy lines', () => {
      const norm = TextNormalizationModule.normalizeToStructuredOcrText(TODIS_REAL_RAW_TEXT);
      const zones = ReceiptZoneSegmenter.segment(norm);

      // G. Segmenter produce solo zone strutturali, non altera prezzi
      expect(zones.body.every(l => typeof l.zone === 'string' && typeof l.confidence === 'number')).toBe(true);

      // H. Righe con prezzi sporcati/illeggibili (es. "PATATINE KETTLE oo 1,99 PA A i", "156 BC", "Na II UN") rimangono in BODY
      const bodyRawIndices = zones.body.map(l => l.rawIndex);
      expect(bodyRawIndices).toContain(11); // PATATINE KETTLE
      expect(bodyRawIndices).toContain(14); // Sconto ARROTONDAMENTO 156 BC
      expect(bodyRawIndices).toContain(17); // OLIVE VERDI Na II UN
      expect(bodyRawIndices).toContain(18); // POM.OBLUNGO i TO
      expect(bodyRawIndices).toContain(19); // BOCCONCINI ‘e RO

      // I. TOTALE COMPLESSIVO N (raw #23) senza importo leggibile è classificato come TOTALS_FOOTER
      const totalsRawIndices = zones.totalsFooter.map(l => l.rawIndex);
      expect(totalsRawIndices).toContain(23);

      // J. Rumore OCR post-subtotale (raw #21, #22, #24, #25) non retrocede il boundary a BODY
      expect(zones.body.some(l => l.rawIndex >= 20)).toBe(false);
    });
  });

  // =========================================================================
  // TEST C: Scontrino senza intestazione tabellare esplicita
  // =========================================================================
  describe('C. Receipt without explicit table header', () => {
    it('identifies body start using strong item characteristics and excludes header', () => {
      const raw = `ALIMENTARI DA MARIO
VIA ROMA 10, MILANO
P.IVA 12345678901
RICEVUTA FISCALE

PASTA BARILLA 500G 1,15
SUGO PRONTO BASILICO 1,85
LATTE FRESCO 1L 1,60
TOTALE COMPLESSIVO 4,60
PAGAMENTO CONTANTE 5,00
RESTO 0,40
ARRIVEDERCI`;

      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.header.length).toBe(4);
      expect(zones.header.map(l => l.text)).toContain('P.IVA 12345678901');

      expect(zones.body.length).toBe(3);
      expect(zones.body.map(l => l.text)).toContain('PASTA BARILLA 500G 1,15');
      expect(zones.body.map(l => l.text)).toContain('SUGO PRONTO BASILICO 1,85');
      expect(zones.body.map(l => l.text)).toContain('LATTE FRESCO 1L 1,60');

      expect(zones.totalsFooter.length).toBe(3);
      expect(zones.trailingMetadata.length).toBe(1);
    });
  });

  // =========================================================================
  // TEST D: Scontrino monoriga / Bar
  // =========================================================================
  describe('D. Single-line / Bar Receipt', () => {
    it('correctly segments a 1-item bar receipt', () => {
      const raw = `BAR CENTRALE SNC
PIAZZA GARIBALDI 1 - NAPOLI
PARTITA IVA 09876543210
SCONTRINO FISCALE

CAFFE ESPRESSO 1,20
TOTALE EURO 1,20
CONTANTI 2,00
RESTO 0,80
GRAZIE E ARRIVEDERCI`;

      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.header.length).toBe(4);
      expect(zones.body.length).toBe(1);
      expect(zones.body[0].text).toBe('CAFFE ESPRESSO 1,20');
      expect(zones.totalsFooter.length).toBe(3);
      expect(zones.trailingMetadata.length).toBe(1);
    });
  });

  // =========================================================================
  // TEST E: Scontrino con righe descrizione/prezzo spezzate
  // =========================================================================
  describe('E. Receipt with split multiline items and multipliers', () => {
    it('keeps multiline item descriptions and multipliers inside BODY zone', () => {
      const raw = `SUPERSTORE ITALIA SPA
VIA NAZIONALE 50 - FIRENZE
P.IVA 05555555555
DESCRIZIONE PREZZO

PANE PUGLIESE BIOLOGICO
500G 2,50 A
CAFFE MACINATO ARABICA
2 X 3,00 6,00 A
TOTALE COMPLESSIVO 8,50
CARTA DI CREDITO 8,50
NUMERO ARTICOLI 2`;

      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.header.length).toBe(4);
      expect(zones.body.length).toBe(4);
      const bodyTexts = zones.body.map(l => l.text);
      expect(bodyTexts).toContain('PANE PUGLIESE BIOLOGICO');
      expect(bodyTexts).toContain('500G 2,50 A');
      expect(bodyTexts).toContain('CAFFE MACINATO ARABICA');
      expect(bodyTexts).toContain('2 X 3,00 6,00 A');

      expect(zones.totalsFooter.length).toBe(2);
      expect(zones.trailingMetadata.length).toBe(1);
      expect(zones.trailingMetadata[0].text).toBe('NUMERO ARTICOLI 2');
    });
  });

  // =========================================================================
  // TEST F: Scontrino con sconto e arrotondamento dopo SUBTOTALE
  // =========================================================================
  describe('F. Receipt with discount and rounding after SUBTOTALE', () => {
    it('classifies subtotal, post-subtotal discount, and final total in TOTALS_FOOTER', () => {
      const raw = `MARKET PRO
P.IVA 11223344556
DESCRIZIONE EURO
PRODOTTO ALFA 10,00
PRODOTTO BETA 15,00
SUBTOTALE 25,00
BUONO SCONTO PROMO -5,00
ARROTONDAMENTO -0,05
TOTALE COMPLESSIVO 19,95
PAGAMENTO CONTANTI 20,00
RESTO 0,05
ARRIVEDERCI`;

      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.body.length).toBe(2);
      expect(zones.totalsFooter.length).toBe(6);
      const totalsTexts = zones.totalsFooter.map(l => l.text);
      expect(totalsTexts).toContain('SUBTOTALE 25,00');
      expect(totalsTexts).toContain('BUONO SCONTO PROMO -5,00');
      expect(totalsTexts).toContain('ARROTONDAMENTO -0,05');
      expect(totalsTexts).toContain('TOTALE COMPLESSIVO 19,95');
    });
  });

  // =========================================================================
  // TEST G: Input rumoroso con token non classificabili (AMBIGUOUS handling)
  // =========================================================================
  describe('G. Noisy input and ambiguous token handling', () => {
    it('classifies unclassifiable mid-body garbage tokens as AMBIGUOUS without inventing items', () => {
      const raw = `SUPERMERCATO TEST
P.IVA 99887766554
DESCRIZIONE EURO
BISCOTTI FROLLINI 2,30
$$$
SUCCO DI FRUTTA 1,50
TOTALE 3,80`;

      const norm = TextNormalizationModule.normalizeToStructuredOcrText(raw);
      const zones = ReceiptZoneSegmenter.segment(norm);

      expect(zones.body.length).toBe(2);
      expect(zones.body.map(l => l.text)).toContain('BISCOTTI FROLLINI 2,30');
      expect(zones.body.map(l => l.text)).toContain('SUCCO DI FRUTTA 1,50');

      expect(zones.ambiguous.length).toBe(1);
      expect(zones.ambiguous[0].text).toBe('$$$');
    });
  });
});
