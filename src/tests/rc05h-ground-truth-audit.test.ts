import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH } from './fixtures/real-receipts/rc05h-corpus-ground-truth';

describe('RC-05H-A-R1 — GROUND TRUTH AUDIT (15 DOCUMENTI / 19 IMMAGINI)', () => {
  const assetsDir = path.resolve('local-test-assets/rc05h');

  it('Verifica che la Ground Truth contenga esattamente 15 documenti fisici', () => {
    expect(RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH).toHaveLength(15);
    const indices = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.map((d) => d.documentIndex);
    expect(indices).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('Verifica che siano contabilizzati esattamente 19 JPEG senza duplicati né omissioni', () => {
    const allImages = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.flatMap((d) => d.associatedImages);
    expect(allImages).toHaveLength(19);

    const uniqueImages = new Set(allImages);
    expect(uniqueImages.size).toBe(19);

    // Se la directory locale e presente, verifica che tutti i 19 file esistano su disco
    if (fs.existsSync(assetsDir)) {
      const diskJpegs = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.jpeg'));
      expect(diskJpegs).toHaveLength(19);
      for (const img of allImages) {
        expect(diskJpegs).toContain(img);
        const stat = fs.statSync(path.join(assetsDir, img));
        expect(stat.size).toBeGreaterThan(100000); // Tutti i JPEG sono file validi > 100 KB
      }
    }
  });

  it('Verifica che le associazioni multi-segmento e multi-view siano corrette e preservate', () => {
    // 1. Leroy Merlin: 3 segmenti dello stesso documento
    const leroy = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'LEROY_MERLIN_001');
    expect(leroy).toBeDefined();
    expect(leroy?.imageRelationship).toBe('MULTI_SEGMENT');
    expect(leroy?.associatedImages).toEqual([
      'RR-005_LEROY_MERLIN_p01.jpeg',
      'RR-005_LEROY_MERLIN_p02.jpeg',
      'RR-005_LEROY_MERLIN_p03.jpeg',
    ]);
    expect(leroy?.total.value).toBe(68.45);

    // 2. Orizzonte: 2 segmenti dello stesso documento
    const orizzonte = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'ORIZZONTE_001');
    expect(orizzonte).toBeDefined();
    expect(orizzonte?.imageRelationship).toBe('MULTI_SEGMENT');
    expect(orizzonte?.associatedImages).toEqual([
      'RR-006_ORIZZONTE_p01.jpeg',
      'RR-006_ORIZZONTE_p02.jpeg',
    ]);
    expect(orizzonte?.total.value).toBe(20.25);

    // 3. D.E. Caffe Doc A: 2 viste dello stesso documento
    const deCaffeA = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'DE_CAFFE_DOC_A_001');
    expect(deCaffeA).toBeDefined();
    expect(deCaffeA?.imageRelationship).toBe('MULTI_VIEW');
    expect(deCaffeA?.associatedImages).toEqual([
      'RR-009_DE_CAFFE_docA_48-40_view01.jpeg',
      'RR-009_DE_CAFFE_docA_48-40_view02.jpeg',
    ]);
    expect(deCaffeA?.total.value).toBe(48.40);
    expect(deCaffeA?.subtotals?.[0].value).toBe(37.40);
    expect(deCaffeA?.subtotals?.[1].value).toBe(11.00);

    // 4. D.E. Caffe Doc B: documento distinto
    const deCaffeB = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'DE_CAFFE_DOC_B_001');
    expect(deCaffeB).toBeDefined();
    expect(deCaffeB?.imageRelationship).toBe('SINGLE_IMAGE');
    expect(deCaffeB?.associatedImages).toEqual(['RR-009_DE_CAFFE_docB_3-90_view01.jpeg']);
    expect(deCaffeB?.total.value).toBe(3.90);

    // 5. Panificio Panzieri: 2 scontrini distinti
    const panzieriA = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'PANIFICIO_PANZIERI_DOC_A_001');
    const panzieriB = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'PANIFICIO_PANZIERI_DOC_B_001');
    expect(panzieriA).toBeDefined();
    expect(panzieriB).toBeDefined();
    expect(panzieriA?.associatedImages).toEqual(['RR-011_PANIFICIO_PANZIERI_docA_0109.jpeg']);
    expect(panzieriB?.associatedImages).toEqual(['RR-011_PANIFICIO_PANZIERI_docB_0110.jpeg']);
    expect(panzieriA?.total.value).toBe(2.00);
    expect(panzieriB?.total.value).toBe(2.00);
  });

  it('Verifica che lo stato conclusivo sia DRAFT_AWAITING_INDEPENDENT_AUDIT per tutti i documenti', () => {
    for (const doc of RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH) {
      expect(doc.status).toBe('DRAFT_AWAITING_INDEPENDENT_AUDIT');
    }
  });

  it('Verifica che ogni campo utilizzi uno stato di certezza consentito', () => {
    const validStatuses = [
      'CONFIRMED',
      'PARTIAL',
      'UNCERTAIN',
      'ILLEGIBLE',
      'NOT_VISIBLE',
      'NOT_APPLICABLE',
    ];

    for (const doc of RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH) {
      expect(validStatuses).toContain(doc.merchant.status);
      expect(validStatuses).toContain(doc.category.status);
      expect(validStatuses).toContain(doc.date.status);
      expect(validStatuses).toContain(doc.total.status);
      expect(validStatuses).toContain(doc.paymentMethod.status);
      expect(validStatuses).toContain(doc.lineCount.status);

      for (const item of doc.lineItems) {
        expect(validStatuses).toContain(item.description.status);
        if (item.totalPrice) {
          expect(validStatuses).toContain(item.totalPrice.status);
        }
      }
    }
  });

  it('Verifica che la farmacia contenga la nota di mascheramento codice fiscale', () => {
    const farmacia = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'FARMACIA_LA_NAVE_001');
    expect(farmacia).toBeDefined();
    expect(farmacia?.privacyMasked?.some((m) => m.toLowerCase().includes('codice fiscale'))).toBe(true);
  });

  it('Verifica sostanziale trascrizione documenti 4-7 (Carrefour, Leroy Merlin, Orizzonte, Tuo Espresso)', () => {
    // 1. CARREFOUR_CONTACT_001
    const carrefour = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'CARREFOUR_CONTACT_001');
    expect(carrefour).toBeDefined();
    expect(carrefour?.total.value).toBe(7.17);
    expect(carrefour?.date.value).toBe('2026-08-06');
    expect(carrefour?.time.value).toBe('12:47');
    expect(carrefour?.paymentMethod.value).toBe('Contanti');
    expect(carrefour?.lineCount.value).toBe(3);
    expect(carrefour?.lineItems).toHaveLength(3);
    const carrefourSum = carrefour!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(carrefourSum * 100) / 100).toBe(7.17);

    // Verifica semantica rettifica contanti (−0,02 €) e importo effettivamente pagato (7,15 €)
    const roundingSubtotal = carrefour?.subtotals?.find((s) => s.value === -0.02);
    expect(roundingSubtotal).toBeDefined();
    expect(roundingSubtotal?.value).toBe(-0.02);

    const paidSubtotal = carrefour?.subtotals?.find((s) => s.value === 7.15);
    expect(paidSubtotal).toBeDefined();
    expect(paidSubtotal?.value).toBe(7.15);

    // 2. LEROY_MERLIN_001 (deduplicato tra p01 e p02)
    const leroy = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'LEROY_MERLIN_001');
    expect(leroy).toBeDefined();
    expect(leroy?.date.value).toBe('2026-08-14');
    expect(leroy?.time.value).toBe('19:40');
    expect(leroy?.paymentMethod.value).toBe('Carta di credito / Debito Contactless');
    expect(leroy?.lineCount.value).toBe(8);
    expect(leroy?.lineItems).toHaveLength(8);
    const leroySum = leroy!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(leroySum * 100) / 100).toBe(68.45);

    // 3. ORIZZONTE_001 (deduplicato tra p01 e p02)
    const orizzonte = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'ORIZZONTE_001');
    expect(orizzonte).toBeDefined();
    expect(orizzonte?.date.value).toBe('2026-08-28');
    expect(orizzonte?.time.value).toBe('15:48');
    expect(orizzonte?.paymentMethod.value).toBe('Pagamento elettronico');
    expect(orizzonte?.lineCount.value).toBe(10);
    expect(orizzonte?.lineItems).toHaveLength(10);
    const orizzonteSum = orizzonte!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(orizzonteSum * 100) / 100).toBe(20.25);

    // 4. TUO_ESPRESSO_001
    const tuo = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'TUO_ESPRESSO_001');
    expect(tuo).toBeDefined();
    expect(tuo?.date.value).toBe('2026-08-03');
    expect(tuo?.time.value).toBe('12:06');
    expect(tuo?.paymentMethod.value).toBe('PAGAMENTO ELETTRONICO');
    expect(tuo?.lineCount.value).toBe(3);
    expect(tuo?.lineItems).toHaveLength(3);
    const tuoSum = tuo!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(tuoSum * 100) / 100).toBe(26.65);
  });

  it('Verifica sostanziale trascrizione documenti 8-11 (Farmacia La Nave, D.E. Caffe A, D.E. Caffe B, R-Store)', () => {
    // 8. FARMACIA_LA_NAVE_001
    const farmacia = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'FARMACIA_LA_NAVE_001');
    expect(farmacia).toBeDefined();
    expect(farmacia?.total.value).toBe(8.02);
    expect(farmacia?.date.value).toBe('2026-09-01');
    expect(farmacia?.time.value).toBe('12:54');
    expect(farmacia?.paymentMethod.value).toBe('Pagamento elettronico');
    expect(farmacia?.lineCount.value).toBe(1);
    expect(farmacia?.lineItems).toHaveLength(1);
    const farmaciaItem = farmacia!.lineItems[0];
    expect(farmaciaItem.totalPrice?.value).toBe(8.02);
    expect(farmaciaItem.unitPrice?.value).toBe(8.02);
    expect(farmaciaItem.quantity?.value).toBe(1);
    expect(farmaciaItem.description?.status).toBe('PARTIAL');
    expect(farmaciaItem.description?.note).toMatch(/sanitari|normalizzat|detraibile/i);
    const farmaciaSum = farmacia!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(farmaciaSum * 100) / 100).toBe(8.02);

    // 9. DE_CAFFE_DOC_A_001 (Multi-view con 8 consumazioni fiscali + 11.00 altri importi)
    const deCaffeA = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'DE_CAFFE_DOC_A_001');
    expect(deCaffeA).toBeDefined();
    expect(deCaffeA?.total.value).toBe(48.40);
    expect(deCaffeA?.date.value).toBe('2026-08-18');
    expect(deCaffeA?.time.value).toBe('11:42');
    expect(deCaffeA?.paymentMethod.value).toBe('Pagamento elettronico');
    expect(deCaffeA?.lineCount.value).toBe(8);
    expect(deCaffeA?.lineItems).toHaveLength(8);

    // Righe 1-7 CONFIRMED
    for (let i = 0; i < 7; i++) {
      expect(deCaffeA!.lineItems[i]?.description?.status).toBe('CONFIRMED');
      expect(deCaffeA!.lineItems[i]?.totalPrice?.status).toBe('CONFIRMED');
    }

    // Ottava riga PARTIAL
    const item8 = deCaffeA!.lineItems[7];
    expect(item8.quantity?.value).toBe(2);
    expect(item8.unitPrice?.value).toBe(1.75);
    expect(item8.totalPrice?.value).toBe(3.50);
    expect(item8.description?.status).toBe('PARTIAL');
    expect(item8.description?.note).toMatch(/parzialmente leggibile/i);

    const deCaffeASum = deCaffeA!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(deCaffeASum * 100) / 100).toBe(37.40); // Totale fiscale consumazioni

    const fiscalSubtotal = deCaffeA?.subtotals?.find((s) => s.value === 37.40);
    expect(fiscalSubtotal).toBeDefined();
    const otherSubtotal = deCaffeA?.subtotals?.find((s) => s.value === 11.00);
    expect(otherSubtotal).toBeDefined();
    const totalSubtotal = deCaffeA?.subtotals?.find((s) => s.value === 48.40);
    expect(totalSubtotal).toBeDefined();

    // 10. DE_CAFFE_DOC_B_001 (Documento distinto con 3 consumazioni tutte CONFIRMED)
    const deCaffeB = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'DE_CAFFE_DOC_B_001');
    expect(deCaffeB).toBeDefined();
    expect(deCaffeB?.total.value).toBe(3.90);
    expect(deCaffeB?.date.value).toBe('2026-08-18');
    expect(deCaffeB?.time.value).toBe('15:12');
    expect(deCaffeB?.paymentMethod.value).toBe('Contanti');
    expect(deCaffeB?.lineCount.value).toBe(3);
    expect(deCaffeB?.lineItems).toHaveLength(3);
    for (const item of deCaffeB!.lineItems) {
      expect(item.description?.status).toBe('CONFIRMED');
      expect(item.totalPrice?.status).toBe('CONFIRMED');
    }
    const deCaffeBSum = deCaffeB!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(deCaffeBSum * 100) / 100).toBe(3.90);

    // 11. R_STORE_001 (1 accessorio Apple/IT, riga PARTIAL)
    const rStore = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'R_STORE_001');
    expect(rStore).toBeDefined();
    expect(rStore?.total.value).toBe(19.00);
    expect(rStore?.date.value).toBe('2026-08-22');
    expect(rStore?.time.value).toBe('16:35');
    expect(rStore?.paymentMethod.value).toBe('Pagamento elettronico');
    expect(rStore?.lineCount.value).toBe(1);
    expect(rStore?.lineItems).toHaveLength(1);
    const rStoreItem = rStore!.lineItems[0];
    expect(rStoreItem.quantity?.value).toBe(1);
    expect(rStoreItem.unitPrice?.value).toBe(19.00);
    expect(rStoreItem.totalPrice?.value).toBe(19.00);
    expect(rStoreItem.description?.status).toBe('PARTIAL');
    expect(rStoreItem.description?.note).toMatch(/merceologica|non integralmente leggibile/i);
    const rStoreSum = rStore!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(rStoreSum * 100) / 100).toBe(19.00);
  });

  it('Verifica privacy: assenza di sequenze numeriche lunghe e presenza categorie generiche nei documenti 4-6 e 8-11', () => {
    const targetDocIds = [
      'CARREFOUR_CONTACT_001',
      'LEROY_MERLIN_001',
      'ORIZZONTE_001',
      'FARMACIA_LA_NAVE_001',
      'DE_CAFFE_DOC_A_001',
      'DE_CAFFE_DOC_B_001',
      'R_STORE_001',
    ];
    for (const docId of targetDocIds) {
      const doc = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === docId);
      expect(doc).toBeDefined();
      if (doc?.privacyMasked && doc.privacyMasked.length > 0) {
        for (const note of doc.privacyMasked) {
          // Nessuna sequenza numerica reale o lunga (>= 4 cifre consecutive) deve apparire nelle note
          expect(note).not.toMatch(/\d{4,}/);
        }
      }
    }

    // Presenza categorie generiche nei documenti interessati
    const carrefour = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'CARREFOUR_CONTACT_001');
    expect(carrefour?.privacyMasked?.some((m) => m.toLowerCase().includes('fedeltà'))).toBe(true);

    const leroy = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'LEROY_MERLIN_001');
    expect(leroy?.privacyMasked?.some((m) => m.toLowerCase().includes('fedeltà'))).toBe(true);
    expect(leroy?.privacyMasked?.some((m) => m.toLowerCase().includes('pan') || m.toLowerCase().includes('carta'))).toBe(true);
    expect(leroy?.privacyMasked?.some((m) => m.toLowerCase().includes('pos'))).toBe(true);

    const orizzonte = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'ORIZZONTE_001');
    expect(orizzonte?.privacyMasked?.some((m) => m.toLowerCase().includes('pos') || m.toLowerCase().includes('autorizzazione'))).toBe(true);
    expect(orizzonte?.privacyMasked?.some((m) => m.toLowerCase().includes('transazione'))).toBe(true);

    const farmacia = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'FARMACIA_LA_NAVE_001');
    expect(farmacia?.privacyMasked?.some((m) => m.toLowerCase().includes('codice fiscale'))).toBe(true);

    const rStore = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'R_STORE_001');
    expect(rStore?.privacyMasked?.some((m) => m.toLowerCase().includes('pan') || m.toLowerCase().includes('carta'))).toBe(true);
    expect(rStore?.privacyMasked?.some((m) => m.toLowerCase().includes('pos') || m.toLowerCase().includes('autorizzazione'))).toBe(true);
  });

  it('Verifica rettifica semantica TODIS_001 (lineCount 9, sconto escluso da articoli e registrato in subtotals)', () => {
    const todis = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'TODIS_001');
    expect(todis).toBeDefined();
    expect(todis?.total.value).toBe(21.90);
    expect(todis?.lineCount.value).toBe(9);
    expect(todis?.lineItems).toHaveLength(9);

    // Nessun articolo deve essere uno sconto fittizio o avere flag isDiscount
    expect(todis?.lineItems.every((item) => !item.isDiscount)).toBe(true);
    expect(todis?.lineItems.every((item) => !item.description.value.toLowerCase().includes('sconto'))).toBe(true);

    // Somma delle 9 righe merce prima della rettifica di arrotondamento = 21.92
    const goodsSum = todis!.lineItems.reduce((acc, item) => acc + (item.totalPrice?.value || 0), 0);
    expect(Math.round(goodsSum * 100) / 100).toBe(21.92);

    // Presenza delle tre componenti nei subtotali
    const sumBeforeSubtotal = todis?.subtotals?.find((s) => s.value === 21.92);
    expect(sumBeforeSubtotal).toBeDefined();
    expect(sumBeforeSubtotal?.status).toBe('CONFIRMED');

    const roundingSubtotal = todis?.subtotals?.find((s) => s.value === -0.02);
    expect(roundingSubtotal).toBeDefined();
    expect(roundingSubtotal?.status).toBe('CONFIRMED');

    const paidSubtotal = todis?.subtotals?.find((s) => s.value === 21.90);
    expect(paidSubtotal).toBeDefined();
    expect(paidSubtotal?.status).toBe('CONFIRMED');
  });

  it('Verifica sostanziale trascrizione documenti 12-15 (Panzieri A, Panzieri B, Eurorisparmio Casa, I Quadri)', () => {
    // 12. PANIFICIO_PANZIERI_DOC_A_001
    const panzieriA = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'PANIFICIO_PANZIERI_DOC_A_001');
    expect(panzieriA).toBeDefined();
    expect(panzieriA?.total.value).toBe(2.00);
    expect(panzieriA?.date.value).toBe('2026-08-03');
    expect(panzieriA?.time.value).toBe('12:06');
    expect(panzieriA?.paymentMethod.value).toBe('Contanti');
    expect(panzieriA?.lineCount.value).toBe(1);
    expect(panzieriA?.lineItems).toHaveLength(1);
    const panzieriAItem = panzieriA!.lineItems[0];
    expect(panzieriAItem.description.value).toBe('REPARTO 4%');
    expect(panzieriAItem.description.status).toBe('CONFIRMED');
    expect(panzieriAItem.quantity?.value).toBe(1);
    expect(panzieriAItem.unitPrice?.value).toBe(2.00);
    expect(panzieriAItem.totalPrice?.value).toBe(2.00);
    expect(panzieriAItem.vatRate?.value).toBe(4);
    expect(panzieriA?.fiscalLines?.some((l) => l.includes('0618-0109'))).toBe(true);

    // 13. PANIFICIO_PANZIERI_DOC_B_001 (documento distinto sequenziale)
    const panzieriB = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'PANIFICIO_PANZIERI_DOC_B_001');
    expect(panzieriB).toBeDefined();
    expect(panzieriB?.total.value).toBe(2.00);
    expect(panzieriB?.date.value).toBe('2026-08-03');
    expect(panzieriB?.time.value).toBe('12:06');
    expect(panzieriB?.paymentMethod.value).toBe('Contanti');
    expect(panzieriB?.lineCount.value).toBe(1);
    expect(panzieriB?.lineItems).toHaveLength(1);
    const panzieriBItem = panzieriB!.lineItems[0];
    expect(panzieriBItem.description.value).toBe('REPARTO 4%');
    expect(panzieriBItem.description.status).toBe('CONFIRMED');
    expect(panzieriBItem.quantity?.value).toBe(1);
    expect(panzieriBItem.unitPrice?.value).toBe(2.00);
    expect(panzieriBItem.totalPrice?.value).toBe(2.00);
    expect(panzieriBItem.vatRate?.value).toBe(4);
    expect(panzieriB?.fiscalLines?.some((l) => l.includes('0618-0110'))).toBe(true);

    // 14. EURORISPARMIO_CASA_001
    const eurorisparmio = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'EURORISPARMIO_CASA_001');
    expect(eurorisparmio).toBeDefined();
    expect(eurorisparmio?.total.value).toBe(5.90);
    expect(eurorisparmio?.date.value).toBe('2026-08-27');
    expect(eurorisparmio?.time.value).toBe('13:11');
    expect(eurorisparmio?.paymentMethod.value).toBe('Pagamento elettronico');
    expect(eurorisparmio?.lineCount.value).toBe(1);
    expect(eurorisparmio?.lineItems).toHaveLength(1);
    const eurorisparmioItem = eurorisparmio!.lineItems[0];
    expect(eurorisparmioItem.description.value).toBe('REPARTO 1');
    expect(eurorisparmioItem.description.status).toBe('CONFIRMED');
    expect(eurorisparmioItem.quantity?.value).toBe(1);
    expect(eurorisparmioItem.unitPrice?.value).toBe(5.90);
    expect(eurorisparmioItem.totalPrice?.value).toBe(5.90);
    expect(eurorisparmioItem.vatRate?.value).toBe(22);
    expect(eurorisparmio?.fiscalLines?.some((l) => l.includes('0273-0021'))).toBe(true);

    // 15. I_QUADRI_001
    const iQuadri = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === 'I_QUADRI_001');
    expect(iQuadri).toBeDefined();
    expect(iQuadri?.total.value).toBe(142.60);
    expect(iQuadri?.date.value).toBe('2026-08-24');
    expect(iQuadri?.time.value).toBe('15:24');
    expect(iQuadri?.paymentMethod.value).toBe('Pagamento elettronico');
    expect(iQuadri?.lineCount.value).toBe(1);
    expect(iQuadri?.lineItems).toHaveLength(1);
    const iQuadriItem = iQuadri!.lineItems[0];
    expect(iQuadriItem.description.value).toBe('PASTO COMPLETO');
    expect(iQuadriItem.description.status).toBe('CONFIRMED');
    expect(iQuadriItem.quantity?.value).toBe(1);
    expect(iQuadriItem.unitPrice?.value).toBe(142.60);
    expect(iQuadriItem.totalPrice?.value).toBe(142.60);
    expect(iQuadriItem.vatRate?.value).toBe(10);
    expect(iQuadri?.fiscalLines?.some((l) => l.includes('0016-0027'))).toBe(true);
  });
});
