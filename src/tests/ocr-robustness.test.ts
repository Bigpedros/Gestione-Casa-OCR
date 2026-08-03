import { describe, it, expect, beforeEach } from 'vitest';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import { db } from '../database/db';
import { productClassificationService } from '../services/productClassification/ProductClassificationService';
import {
  ocrProcessRepository,
  productRepository,
  productAliasRepository,
  supplierRepository,
  expenseRepository,
  documentSessionRepository,
} from '../repositories';

describe('Punto 13 – Robustezza Motore OCR e Gestione Scontrini Reali', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('1. Gestisce correttamente scontrini con SCONTI di riga e SCONTI generali', () => {
    const rawText = `
SUPERMERCATO CONAD
P.IVA 01234567890
PASTA BARILLA 500G 1,20 A
SCONTO -0,20
BISCOTTI INTEGRALI 2,50 A
SCONTO CARTA -0,50
BUONO SCONTO SPESA -1,00
TOTALE EURO 2,00
    `;

    const draft = receiptParserService.parseText(rawText);

    expect(draft.lines.length).toBeGreaterThan(0);

    // Prima riga: Pasta Barilla con sconto riga 0.20 -> totale 1.00
    const pastaLine = draft.lines.find((l) => l.normalizedDescription.includes('PASTA BARILLA'));
    expect(pastaLine).toBeDefined();
    expect(pastaLine?.discount).toBe(0.20);
    expect(pastaLine?.lineTotal).toBe(1.00);

    // Seconda riga: Biscotti Integrali con sconto carta 0.50 -> totale 2.00
    const biscottiLine = draft.lines.find((l) => l.normalizedDescription.includes('BISCOTTI INTEGRALI'));
    expect(biscottiLine).toBeDefined();
    expect(biscottiLine?.discount).toBe(0.50);
    expect(biscottiLine?.lineTotal).toBe(2.00);

    // Buono sconto generico presente come riga di aggiustamento negativa
    const buonoLine = draft.lines.find((l) => l.normalizedDescription.includes('BUONO SCONTO'));
    expect(buonoLine).toBeDefined();
    expect(buonoLine?.lineTotal).toBe(-1.00);

    // Quadratura perfetta: 1.00 + 2.00 - 1.00 = 2.00
    const totalLines = draft.lines.reduce((acc, l) => acc + l.lineTotal, 0);
    expect(Math.round(totalLines * 100) / 100).toBe(2.00);
    expect(draft.total.value).toBe(2.00);
  });

  it('2. Riconosce promozioni e abbuoni senza trasformarli in prodotti autonomi', async () => {
    const rawText = `
IPERMERCATO ESSELUNGA
OLIO EXTRAVERGINE 1L 8,90 A
PROMOZIONE -2,00
TOTALE EURO 6,90
    `;

    const draft = receiptParserService.parseText(rawText);
    const olioLine = draft.lines.find((l) => l.normalizedDescription.includes('OLIO'));
    expect(olioLine).toBeDefined();
    expect(olioLine?.discount).toBe(2.00);
    expect(olioLine?.lineTotal).toBe(6.90);

    // Verifica classificazione: non viene creato un prodotto chiamato PROMOZIONE
    const session = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: session.id,
      rawText,
      confidence: 90,
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);
    const promoProposals = proposal.lineProposals.filter((l) => l.normalizedDescription.includes('PROMOZIONE'));
    expect(promoProposals.length).toBe(0);
  });

  it('3. Gestisce correttamente RESI, STORNI e IMPORTI NEGATIVI (formati -2,50 e 2,50-)', () => {
    const rawText = `
COOP LOMBARDIA
LATTE INTERO 1,50 A
STORNO PASTA -1,20 A
RESO MERCE 2,00-
TOTALE EURO -1,70
    `;

    const draft = receiptParserService.parseText(rawText);

    // Riga storno
    const stornoLine = draft.lines.find((l) => l.normalizedDescription.includes('STORNO'));
    expect(stornoLine).toBeDefined();
    expect(stornoLine?.isNegative).toBe(true);
    expect(stornoLine?.lineTotal).toBe(-1.20);

    // Riga reso con formato trailing minus "2,00-"
    const resoLine = draft.lines.find((l) => l.normalizedDescription.includes('RESO'));
    expect(resoLine).toBeDefined();
    expect(resoLine?.isNegative).toBe(true);
    expect(resoLine?.lineTotal).toBe(-2.00);

    // Somma: 1.50 - 1.20 - 2.00 = -1.70
    const sum = draft.lines.reduce((acc, l) => acc + l.lineTotal, 0);
    expect(Math.round(sum * 100) / 100).toBe(-1.70);
  });

  it('4. Unifica correttamente righe spezzate (descrizione su riga N, prezzo/quantità su riga N+1)', () => {
    const rawText = `
PANIFICIO CENTRALE
PANE PUGLIESE BIOLOGICO
500G 2,50 A
CAFFE MACINATO ARABICA
2 X 3,00 6,00 A
TOTALE EURO 8,50
    `;

    const draft = receiptParserService.parseText(rawText);

    // Deve aver creato solo 2 righe unificate senza righe orfane a 0.00€
    expect(draft.lines.length).toBe(2);

    const paneLine = draft.lines[0];
    expect(paneLine.normalizedDescription).toContain('PANE PUGLIESE BIOLOGICO');
    expect(paneLine.lineTotal).toBe(2.50);

    const caffeLine = draft.lines[1];
    expect(caffeLine.normalizedDescription).toContain('CAFFE MACINATO ARABICA');
    expect(caffeLine.quantity).toBe(2);
    expect(caffeLine.unitPrice).toBe(3.00);
    expect(caffeLine.lineTotal).toBe(6.00);
  });

  it('5. Elimina righe vuote e spurie (rumore OCR, numeri di cassa, linee decorative)', () => {
    const rawText = `
*** SCONTRINO FISCALE ***
=========================
DOCUMENTO COMMERCIALE
CASSA 01 OPERATORE 005
ACQUA MINERALE 0,40 A
-------------------------
ARTICOLI 1
SUBTOTALE 0,40
TOTALE EURO 0,40
GRAZIE E ARRIVEDERCI
    `;

    const draft = receiptParserService.parseText(rawText);

    // Solo l'acqua minerale deve essere presente tra i prodotti
    expect(draft.lines.length).toBe(1);
    expect(draft.lines[0].normalizedDescription).toContain('ACQUA MINERALE');
    expect(draft.lines[0].lineTotal).toBe(0.40);
  });

  it('6. Gestisce subtotali e arrotondamenti', () => {
    const rawText = `
ALIMENTARI VERDI
CEREALI 3,50 A
SUBTOTALE 3,50
ARROTONDAMENTO -0,02
TOTALE EURO 3,48
    `;

    const draft = receiptParserService.parseText(rawText);

    const arrLine = draft.lines.find((l) => l.normalizedDescription.includes('ARROTONDAMENTO'));
    expect(arrLine).toBeDefined();
    expect(arrLine?.lineTotal).toBe(-0.02);

    const totalLines = draft.lines.reduce((acc, l) => acc + l.lineTotal, 0);
    expect(Math.round(totalLines * 100) / 100).toBe(3.48);
    expect(draft.total.value).toBe(3.48);
  });

  it('7. Rileva correttamente la quadratura e genera warning in caso di discrepanza', () => {
    const rawText = `
NEGOZIO PROVA
PRODOTTO A 5,00 A
PRODOTTO B 3,00 A
TOTALE EURO 10,00
    `;

    const draft = receiptParserService.parseText(rawText);

    // Somma righe = 8.00, Totale = 10.00 -> Discrepanza di 2.00
    const mismatchWarning = draft.warnings.find((w) => w.code === 'LINE_SUM_MISMATCH');
    expect(mismatchWarning).toBeDefined();
    expect(mismatchWarning?.severity).toBe('medium');
  });

  it('8. Previene duplicazione di Product, Alias e Supplier in fase di registrazione', async () => {
    // Crea fornitore e prodotto preesistenti
    const supp = await supplierRepository.create({
      name: 'Supermercato Test',
      aliases: ['SUPERMERCATO TEST'],
      status: 'confirmed',
    });

    const prod = await productRepository.create({
      normalizedName: 'PASTA BARILLA 500G',
      displayName: 'Pasta Barilla 500g',
    });

    await productAliasRepository.create({
      productId: prod.id,
      supplierId: supp.id,
      originalText: 'PASTA BARILLA 500G',
      normalizedText: 'PASTA BARILLA 500G',
      confidence: 100,
      confirmedByUser: true,
    });

    const session = await documentSessionRepository.create({
      status: 'ready_for_review',
      documentType: 'receipt',
      sourceMode: 'singleImage',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: session.id,
      rawText: 'SUPERMERCATO TEST\nPASTA BARILLA 500G 1,20 A\nTOTALE EURO 1,20',
      confidence: 90,
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await receiptParserService.parse(ocrProc.id);
    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    // Esegue registrazione contabile con conferma e creazione Expense
    await productClassificationService.createAccountingRegistration({
      ocrProcessId: ocrProc.id,
      sessionId: session.id,
      supplierId: supp.id,
      supplierName: supp.name,
      paymentMethod: 'debitCard',
      expenseDate: '2026-08-01',
      documentTotal: 1.20,
      decisions: [
        {
          lineId: proposal.lineProposals[0].lineId,
          originalText: 'PASTA BARILLA 500G 1,20 A',
          description: 'PASTA BARILLA 500G',
          quantity: 1,
          unitPrice: 1.20,
          lineTotal: 1.20,
          action: 'link_existing',
          productId: prod.id,
        },
      ],
      allowDiscrepancy: false,
    });

    // Verifica assenza di duplicati
    const suppliers = await supplierRepository.getAll();
    expect(suppliers.length).toBe(1);

    const products = await productRepository.getAll();
    expect(products.length).toBe(1);

    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(1);
  });
});
