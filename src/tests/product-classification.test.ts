import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../database/db';
import {
  productRepository,
  productAliasRepository,
  supplierRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
  categoryRepository,
  documentSessionRepository,
} from '../repositories';
import { productClassificationService } from '../services/productClassification';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('Sistema di Classificazione Automatica Prodotti OCR (TEST-PRODUCT-CLASSIFICATION)', () => {
  beforeEach(async () => {
    // Pulizia e reset del database di test per garantire test isolati
    await db.products.clear();
    await db.productAliases.clear();
    await db.suppliers.clear();
    await db.ocrProcesses.clear();
    await db.ocrReceiptLines.clear();
    await db.expenses.clear();
    await db.expenseItems.clear();

    // Seeding delle categorie di base per il test
    await seedInitialCategoriesAndSettings();
  });

  it('1. Riconosce un prodotto già noto tramite nome esatto o normalizzato', async () => {
    const categories = await categoryRepository.getAll();
    const foodCategory = categories.find((c) => c.code === 'CAT_FOOD') || categories[0];

    // Crea un prodotto noto in catalogo
    const product = await productRepository.create({
      normalizedName: 'LATTE PARZIALMENTE SCREMATO',
      displayName: 'Latte Parzialmente Scremato 1L',
      brand: 'PARMALAT',
      categoryId: foodCategory.id,
    });

    // Crea processo OCR e riga corrispondente
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'completed',
      rawText: 'CONAD\nLATTE PARZIALMENTE SCREMATO 1.50',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'LATTE PARZIALMENTE SCREMATO 1,50',
      description: 'LATTE PARZIALMENTE SCREMATO',
      quantity: 1,
      unitPrice: 1.5,
      lineTotal: 1.5,
      confidence: 90,
      reviewStatus: 'pending',
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    expect(proposal.knownProductCount).toBe(1);
    expect(proposal.lineProposals.length).toBe(1);

    const lineProp = proposal.lineProposals[0];
    expect(lineProp.matchedProduct?.id).toBe(product.id);
    expect(lineProp.confidence).toBeGreaterThanOrEqual(85);
    expect(lineProp.proposedCategory?.id).toBe(foodCategory.id);
    expect(lineProp.proposedNewProduct).toBeNull();
  });

  it('2. Associa alias differenti allo stesso prodotto (es. LATTE UHT PS -> Latte Parzialmente Scremato)', async () => {
    const categories = await categoryRepository.getAll();
    const foodCat = categories[0];

    const product = await productRepository.create({
      normalizedName: 'LATTE PARZIALMENTE SCREMATO',
      displayName: 'Latte Parzialmente Scremato UHT 1L',
      brand: 'PARMALAT',
      categoryId: foodCat.id,
    });

    // Crea alias per il prodotto
    await productAliasRepository.create({
      productId: product.id,
      originalText: 'LATTE UHT PS',
      normalizedText: 'LATTE UHT PS',
      confidence: 95,
      confirmedByUser: true,
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-2',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'LATTE UHT PS €1.20',
      description: 'LATTE UHT PS',
      quantity: 1,
      unitPrice: 1.2,
      lineTotal: 1.2,
      confidence: 88,
      reviewStatus: 'pending',
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    expect(proposal.lineProposals.length).toBe(1);
    const lineProp = proposal.lineProposals[0];
    expect(lineProp.matchedProduct?.id).toBe(product.id);
    expect(lineProp.matchedAlias?.originalText).toBe('LATTE UHT PS');
    expect(lineProp.confidence).toBeGreaterThanOrEqual(90);
  });

  it('3. Riconosce codici EAN / GTIN con massima priorità (100% confidenza)', async () => {
    const product = await productRepository.create({
      normalizedName: 'PASTA SPAGHETTI 500G',
      displayName: 'Spaghetti n.5 Barilla 500g',
      barcode: '8076809513722',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-3',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'BARILLA SPAGHETTI 8076809513722 0.99',
      description: 'BARILLA SPAGHETTI 8076809513722',
      quantity: 1,
      unitPrice: 0.99,
      lineTotal: 0.99,
      confidence: 95,
      reviewStatus: 'pending',
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);
    const lineProp = proposal.lineProposals[0];

    expect(lineProp.matchedProduct?.id).toBe(product.id);
    expect(lineProp.matchType).toBe('exact_barcode');
    expect(lineProp.confidence).toBe(100);
  });

  it('4. Resilienza agli errori OCR e refusi tramite Product Fingerprint', async () => {
    const product = await productRepository.create({
      normalizedName: 'BISCOTTI GOCCIOTOLE PAVESI 500G',
      displayName: 'Gocciole Pavesi Chocolate 500g',
      brand: 'PAVESI',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-4',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    // Riga OCR con refuso (es. "GOCOTOLE" invece di "GOCCIOTOLE")
    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'BISCOTTI GOCOTOLE PAVESI 500G 2.49',
      description: 'BISCOTTI GOCOTOLE PAVESI 500G',
      quantity: 1,
      unitPrice: 2.49,
      lineTotal: 2.49,
      confidence: 80,
      reviewStatus: 'pending',
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);
    const lineProp = proposal.lineProposals[0];

    expect(lineProp.matchedProduct?.id).toBe(product.id);
    expect(lineProp.confidence).toBeGreaterThanOrEqual(60);
  });

  it('5. Propone un nuovo prodotto provvisorio senza aggiungerlo alla tabella Product se sconosciuto', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-5',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'INVENTO OCCHIALI DA SOLE XYZ 49.90',
      description: 'INVENTO OCCHIALI DA SOLE XYZ',
      quantity: 1,
      unitPrice: 49.9,
      lineTotal: 49.9,
      confidence: 85,
      reviewStatus: 'pending',
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    expect(proposal.newProductCount).toBe(1);
    const lineProp = proposal.lineProposals[0];

    expect(lineProp.matchedProduct).toBeNull();
    expect(lineProp.proposedNewProduct).not.toBeNull();
    expect(lineProp.proposedNewProduct?.displayName).toContain('INVENTO OCCHIALI DA SOLE XYZ');
    expect(lineProp.proposedCategory?.isDefaultUnclassified).toBe(true);

    // TASSATIVO: Nessun record aggiunto alla tabella db.products
    const allDbProducts = await productRepository.getAll();
    expect(allDbProducts.length).toBe(0);
  });

  it('6. Propone un nuovo fornitore provvisorio senza modificare la tabella Supplier se sconosciuto', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-6',
      status: 'completed',
      detectedSupplier: 'SUPERMERCATO NUOVO INESISTENTE SRL',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    expect(proposal.supplierProposal.isNewSupplier).toBe(true);
    expect(proposal.supplierProposal.proposedNewSupplier?.name).toBe('SUPERMERCATO NUOVO INESISTENTE SRL');

    // TASSATIVO: La tabella Supplier rimane vuota
    const suppliers = await supplierRepository.getAll();
    expect(suppliers.length).toBe(0);
  });

  it('7. Riconosce il fornitore se già presente e usa la sua categoria predefinita se il prodotto non ne ha una', async () => {
    const categories = await categoryRepository.getAll();
    const healthCat = categories.find((c) => c.code === 'CAT_HEALTH') || categories[0];

    const supplier = await supplierRepository.create({
      name: 'FARMACIA CENTRALE',
      aliases: ['FARMACIA CENTRALE SRL'],
      defaultCategoryId: healthCat.id,
      status: 'confirmed',
    });

    const productWithoutCategory = await productRepository.create({
      normalizedName: 'ASPIRINA 500MG 10 COMPRESSE',
      displayName: 'Aspirina 500mg 10 Cpr',
      categoryId: null,
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-7',
      status: 'completed',
      detectedSupplier: 'FARMACIA CENTRALE',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ASPIRINA 500MG 10 COMPRESSE 5.50',
      description: 'ASPIRINA 500MG 10 COMPRESSE',
      quantity: 1,
      unitPrice: 5.5,
      lineTotal: 5.5,
      confidence: 90,
      reviewStatus: 'pending',
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    expect(proposal.supplierProposal.isNewSupplier).toBe(false);
    expect(proposal.supplierProposal.matchedSupplier?.id).toBe(supplier.id);

    const lineProp = proposal.lineProposals[0];
    expect(lineProp.matchedProduct?.id).toBe(productWithoutCategory.id);
    // Ereditata dal fornitore
    expect(lineProp.proposedCategory?.id).toBe(healthCat.id);
  });

  it('8. Gestisce i conflitti per prodotti ambigui e descrizioni molto brevi', async () => {
    // Crea due prodotti molto simili
    await productRepository.create({
      normalizedName: 'LATTE FRESCO PARZIALMENTE SCREMATO 1L',
      displayName: 'Latte Fresco P.S. 1L',
    });

    await productRepository.create({
      normalizedName: 'LATTE UHT PARZIALMENTE SCREMATO 1L',
      displayName: 'Latte UHT P.S. 1L',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-8',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    // Riga 1: Descrizione generica ambigua
    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'LATTE PARZIALMENTE SCREMATO 1L 1.30',
      description: 'LATTE PARZIALMENTE SCREMATO 1L',
      quantity: 1,
      unitPrice: 1.3,
      lineTotal: 1.3,
      confidence: 85,
      reviewStatus: 'pending',
    });

    // Riga 2: Descrizione troppo corta ("P.S.")
    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'P.S. 1.20',
      description: 'P.S.',
      quantity: 1,
      unitPrice: 1.2,
      lineTotal: 1.2,
      confidence: 70,
      reviewStatus: 'pending',
    });

    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    expect(proposal.conflictCount).toBeGreaterThan(0);
    const shortLineProp = proposal.lineProposals.find((l) => l.originalDescription === 'P.S. 1.20');
    expect(shortLineProp?.hasConflict).toBe(true);
    expect(shortLineProp?.conflictType).toBe('short_description');
  });

  it('9. Idempotenza: eseguire la classificazione più volte produce il medesimo risultato senza duplicati', async () => {
    await productRepository.create({
      normalizedName: 'PASTA PENNE RIGATE 500G',
      displayName: 'Penne Rigate 500g',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-9',
      status: 'completed',
      detectedSupplier: 'SUPERMERCATO TEST',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PASTA PENNE RIGATE 500G 0.89',
      description: 'PASTA PENNE RIGATE 500G',
      quantity: 1,
      unitPrice: 0.89,
      lineTotal: 0.89,
      confidence: 90,
      reviewStatus: 'pending',
    });

    // Prima esecuzione
    const prop1 = await productClassificationService.classifyReceiptLines(ocrProc.id);

    // Seconda esecuzione
    const prop2 = await productClassificationService.classifyReceiptLines(ocrProc.id);

    expect(prop1.lineProposals.length).toBe(prop2.lineProposals.length);
    expect(prop1.lineProposals[0].confidence).toBe(prop2.lineProposals[0].confidence);
    expect(prop1.lineProposals[0].matchedProduct?.id).toBe(prop2.lineProposals[0].matchedProduct?.id);

    // Verifica assenza di duplicazioni nel DB
    const productsCount = await db.products.count();
    const aliasesCount = await db.productAliases.count();
    const suppliersCount = await db.suppliers.count();

    expect(productsCount).toBe(1);
    expect(aliasesCount).toBe(0);
    expect(suppliersCount).toBe(0);
  });

  it('10. TASSATIVO: Nessuna entità Expense o ExpenseItem viene creata', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-10',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE FRESCO 2.50',
      description: 'PANE FRESCO',
      quantity: 1,
      unitPrice: 2.5,
      lineTotal: 2.5,
      confidence: 95,
      reviewStatus: 'pending',
    });

    await productClassificationService.classifyReceiptLines(ocrProc.id);

    const expenses = await db.expenses.toArray();
    const expenseItems = await db.expenseItems.toArray();

    expect(expenses.length).toBe(0);
    expect(expenseItems.length).toBe(0);
  });

  it('11. Punto 9: Conferma revisione con creazione nuovo prodotto esplicita e apprendimento alias', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-11',
      status: 'completed',
      detectedSupplier: 'SUPERMERCATO DESPAR',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'CREMA SPALMABLE NOCCIOLA 350G 3.99',
      description: 'CREMA SPALMABLE NOCCIOLA 350G',
      quantity: 1,
      unitPrice: 3.99,
      lineTotal: 3.99,
      confidence: 85,
      reviewStatus: 'pending',
    });

    // Conferma con richiesta esplicita di creazione nuovo prodotto
    const result = await productClassificationService.confirmReceiptClassifications({
      ocrProcessId: ocrProc.id,
      supplierName: 'SUPERMERCATO DESPAR',
      decisions: [
        {
          lineId: line.id,
          originalText: line.originalText,
          description: line.description,
          quantity: 1,
          unitPrice: 3.99,
          lineTotal: 3.99,
          action: 'create_new',
          newProductDetails: {
            displayName: 'Crema Spalmabile Nocciola 350g',
          },
        },
      ],
    });

    expect(result.createdProductsCount).toBe(1);
    expect(result.createdAliasesCount).toBe(1);

    const products = await productRepository.getAll();
    expect(products.length).toBe(1);
    expect(products[0].displayName).toBe('Crema Spalmabile Nocciola 350g');

    const aliases = await db.productAliases.toArray();
    expect(aliases.length).toBe(1);
    expect(aliases[0].productId).toBe(products[0].id);

    // Un secondo scontrino con lo stesso testo deve ora fare match esatto tramite l'alias appreso!
    const ocrProc2 = await ocrProcessRepository.create({
      attachmentId: 'att-11-2',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc2.id,
      originalText: 'CREMA SPALMABLE NOCCIOLA 350G 3.99',
      description: 'CREMA SPALMABLE NOCCIOLA 350G',
      quantity: 1,
      unitPrice: 3.99,
      lineTotal: 3.99,
      confidence: 85,
      reviewStatus: 'pending',
    });

    const proposal2 = await productClassificationService.classifyReceiptLines(ocrProc2.id);
    expect(proposal2.lineProposals[0].matchedProduct?.id).toBe(products[0].id);
    expect(proposal2.lineProposals[0].matchType).toBe('exact_alias');
    expect(proposal2.lineProposals[0].confidenceLevel).toBe('exact');
  });

  it('12. Punto 9: Anti-duplicazione - Se un prodotto con stesso nome normalizzato esiste, evita la duplicazione', async () => {
    // Prodotto già esistente
    const existing = await productRepository.create({
      displayName: 'Yogurt Greco 0% 150g',
      normalizedName: 'YOGURT GRECO 0 150G',
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-12',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PROMO YOGURT GRECO 0 150G 1.10',
      description: 'PROMO YOGURT GRECO 0 150G',
      quantity: 1,
      unitPrice: 1.1,
      lineTotal: 1.1,
      confidence: 80,
      reviewStatus: 'pending',
    });

    // L'utente seleziona "Crea nuovo prodotto", ma il nome normalizzato pulito corrisponde a quello esistente
    const result = await productClassificationService.confirmReceiptClassifications({
      ocrProcessId: ocrProc.id,
      decisions: [
        {
          lineId: line.id,
          originalText: line.originalText,
          description: 'YOGURT GRECO 0 150G',
          quantity: 1,
          unitPrice: 1.1,
          lineTotal: 1.1,
          action: 'create_new',
          newProductDetails: {
            displayName: 'Yogurt Greco 0% 150g',
          },
        },
      ],
    });

    // Non crea un duplicato, riutilizza il prodotto esistente
    expect(result.createdProductsCount).toBe(0);
    const allProducts = await productRepository.getAll();
    expect(allProducts.length).toBe(1);
    expect(allProducts[0].id).toBe(existing.id);
  });

  it('13. Punto 9: classifyReceiptLines non modifica productId né reviewStatus nel DB', async () => {
    const categories = await categoryRepository.getAll();
    const prod = await productRepository.create({
      displayName: 'Acqua Naturale 1.5L',
      normalizedName: 'ACQUA NATURALE 1.5L',
      categoryId: categories[0].id,
    });

    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-13',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'ACQUA NATURALE 1.5L 0.40',
      description: 'ACQUA NATURALE 1.5L',
      quantity: 1,
      unitPrice: 0.4,
      lineTotal: 0.4,
      confidence: 95,
      reviewStatus: 'pending',
      productId: null,
    });

    // Esegue la proposta
    const proposal = await productClassificationService.classifyReceiptLines(ocrProc.id);

    // Verifica che la proposta contenga il match
    expect(proposal.lineProposals[0].matchedProduct?.id).toBe(prod.id);

    // Verifica che il DB NON sia stato modificato
    const lineInDb = await ocrReceiptLineRepository.getById(line.id);
    expect(lineInDb?.productId).toBeNull();
    expect(lineInDb?.reviewStatus).toBe('pending');
  });

  it('14. Punto 9: Salva bozza non crea Product, ProductAlias, Supplier né Expense', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-14',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'BISCOTTI INTEGRALI 2.50',
      description: 'BISCOTTI INTEGRALI',
      quantity: 1,
      unitPrice: 2.5,
      lineTotal: 2.5,
      confidence: 80,
      reviewStatus: 'pending',
    });

    // Simulazione del salvataggio bozza (come in OcrReviewModal)
    await ocrProcessRepository.update(ocrProc.id, {
      detectedSupplier: 'SUPERMERCATO TEST',
      confirmedByUser: false,
    });

    await ocrReceiptLineRepository.update(line.id, {
      description: 'BISCOTTI INTEGRALI 500G',
      reviewStatus: 'modified',
      productId: null,
    });

    // Verifiche: nessun Product, Alias, Supplier o Expense creato
    const products = await db.products.toArray();
    const aliases = await db.productAliases.toArray();
    const suppliers = await db.suppliers.toArray();
    const expenses = await db.expenses.toArray();
    const expenseItems = await db.expenseItems.toArray();

    expect(products.length).toBe(0);
    expect(aliases.length).toBe(0);
    expect(suppliers.length).toBe(0);
    expect(expenses.length).toBe(0);
    expect(expenseItems.length).toBe(0);

    const procInDb = await ocrProcessRepository.getById(ocrProc.id);
    expect(procInDb?.confirmedByUser).toBe(false);
  });

  it('15. Punto 9: Transazione atomica di conferma ed eliminazione righe con rollback su errore', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-15',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const line1 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'MELA ANNURCA 1KG 2.00',
      description: 'MELA ANNURCA 1KG',
      quantity: 1,
      unitPrice: 2,
      lineTotal: 2,
      confidence: 90,
      reviewStatus: 'pending',
    });

    const line2 = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'SACCHETTO PLASTICA 0.10',
      description: 'SACCHETTO PLASTICA',
      quantity: 1,
      unitPrice: 0.1,
      lineTotal: 0.1,
      confidence: 90,
      reviewStatus: 'pending',
    });

    // 1. Esegue conferma con richiesta di eliminazione di line2
    const result = await productClassificationService.confirmReceiptClassifications({
      ocrProcessId: ocrProc.id,
      supplierName: 'FRUTTIVENDOLO',
      deletedLineIds: [line2.id],
      decisions: [
        {
          lineId: line1.id,
          originalText: line1.originalText,
          description: line1.description,
          quantity: 1,
          unitPrice: 2,
          lineTotal: 2,
          action: 'create_new',
          newProductDetails: { displayName: 'Mela Annurca' },
        },
      ],
    });

    expect(result.updatedLinesCount).toBe(1);
    const line2InDb = await ocrReceiptLineRepository.getById(line2.id);
    expect(line2InDb).toBeUndefined(); // line2 eliminata atomicamente

    // 2. Rollback test: Se confirmReceiptClassifications viene chiamata per un ocrProcess non esistente, fallisce e nulla cambia
    await expect(
      productClassificationService.confirmReceiptClassifications({
        ocrProcessId: 'non-existing-proc-id',
        deletedLineIds: [line1.id],
        decisions: [],
      })
    ).rejects.toThrow();

    // line1 esiste ancora
    const line1InDb = await ocrReceiptLineRepository.getById(line1.id);
    expect(line1InDb).not.toBeNull();
  });

  it('16. Punto 9: Idempotenza della conferma ripetuta (nessun duplicato creato)', async () => {
    const ocrProc = await ocrProcessRepository.create({
      attachmentId: 'att-16',
      status: 'completed',
      confirmationRequired: true,
      confirmedByUser: false,
    });

    const line = await ocrReceiptLineRepository.create({
      ocrProcessId: ocrProc.id,
      originalText: 'PANE INTEGRALE 1.80',
      description: 'PANE INTEGRALE',
      quantity: 1,
      unitPrice: 1.8,
      lineTotal: 1.8,
      confidence: 85,
      reviewStatus: 'pending',
    });

    const params = {
      ocrProcessId: ocrProc.id,
      supplierName: 'PANIFICIO BIO',
      decisions: [
        {
          lineId: line.id,
          originalText: line.originalText,
          description: line.description,
          quantity: 1,
          unitPrice: 1.8,
          lineTotal: 1.8,
          action: 'create_new' as const,
          newProductDetails: { displayName: 'Pane Integrale 500g' },
        },
      ],
    };

    // Prima conferma
    const res1 = await productClassificationService.confirmReceiptClassifications(params);
    expect(res1.createdProductsCount).toBe(1);
    expect(res1.createdAliasesCount).toBe(1);

    const productsCount1 = (await db.products.toArray()).length;
    const aliasesCount1 = (await db.productAliases.toArray()).length;

    // Seconda conferma dello stesso processo
    const res2 = await productClassificationService.confirmReceiptClassifications(params);
    expect(res2.createdProductsCount).toBe(0);
    expect(res2.createdAliasesCount).toBe(0);

    const productsCount2 = (await db.products.toArray()).length;
    const aliasesCount2 = (await db.productAliases.toArray()).length;

    expect(productsCount2).toBe(productsCount1);
    expect(aliasesCount2).toBe(aliasesCount1);

    // Verifico che NON sono state create Expense
    const expenses = await db.expenses.toArray();
    expect(expenses.length).toBe(0);
  });

  describe('Punto 10: Creazione Controllata della Registrazione Contabile (Expense)', () => {
    it('17. Punto 10: Impedisce la creazione della registrazione se il processo OCR non è stato confermato dall\'utente', async () => {
      const ocrProc = await ocrProcessRepository.create({
        attachmentId: 'att-17',
        status: 'completed',
        confirmationRequired: true,
        confirmedByUser: false, // Non ancora confermato
      });

      await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'MOZZARELLA 2.50',
        description: 'MOZZARELLA',
        quantity: 1,
        unitPrice: 2.5,
        lineTotal: 2.5,
        confidence: 90,
        reviewStatus: 'pending',
      });

      // Tentativo di creazione senza conferma previa
      await expect(
        productClassificationService.createAccountingRegistration({
          ocrProcessId: ocrProc.id,
        })
      ).rejects.toThrow(/revisione OCR non è stata ancora confermata/i);

      // Verifico che nessuna Spesa o riga di spesa sia stata creata
      const expenses = await db.expenses.toArray();
      const expenseItems = await db.expenseItems.toArray();
      expect(expenses.length).toBe(0);
      expect(expenseItems.length).toBe(0);
    });

    it('18. Punto 10: Crea atomicamente Expense e ExpenseItems da una sessione OCR confermata', async () => {
      const categories = await categoryRepository.getAll();
      const foodCat = categories[0];

      // 1. Crea fornitore e prodotto
      const supplier = await supplierRepository.create({
        name: 'SUPERMERCATO CONAD',
        aliases: [],
        status: 'confirmed',
      });

      const product = await productRepository.create({
        displayName: 'Latte Fresco 1L',
        normalizedName: 'LATTE FRESCO 1L',
        categoryId: foodCat.id,
      });

      // 2. Crea sessione e processo OCR
      const ocrProc = await ocrProcessRepository.create({
        attachmentId: 'att-18',
        status: 'completed',
        detectedSupplier: 'SUPERMERCATO CONAD',
        detectedDate: '2026-08-01',
        detectedTotal: 4.5,
        confirmationRequired: true,
        confirmedByUser: false,
      });

      const session = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        processingMode: 'singleReceipt',
        pageCount: 1,
        status: 'ready_for_review',
        ocrProcessId: ocrProc.id,
        metadata: { title: 'Scontrino Conad', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      });

      const line1 = await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'LATTE FRESCO 1.50',
        description: 'LATTE FRESCO 1L',
        quantity: 1,
        unitPrice: 1.5,
        lineTotal: 1.5,
        confidence: 95,
        reviewStatus: 'pending',
      });

      const line2 = await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'PANE BIANCO 3.00',
        description: 'PANE BIANCO',
        quantity: 1,
        unitPrice: 3.0,
        lineTotal: 3.0,
        confidence: 90,
        reviewStatus: 'pending',
      });

      // 3. Esegue la conferma delle classificazioni (Punto 9)
      await productClassificationService.confirmReceiptClassifications({
        ocrProcessId: ocrProc.id,
        supplierName: 'SUPERMERCATO CONAD',
        expenseDate: '2026-08-01',
        documentTotal: 4.5,
        decisions: [
          {
            lineId: line1.id,
            originalText: line1.originalText,
            description: line1.description,
            quantity: 1,
            unitPrice: 1.5,
            lineTotal: 1.5,
            action: 'link_existing',
            productId: product.id,
            categoryId: foodCat.id,
          },
          {
            lineId: line2.id,
            originalText: line2.originalText,
            description: line2.description,
            quantity: 1,
            unitPrice: 3.0,
            lineTotal: 3.0,
            action: 'create_new',
            newProductDetails: { displayName: 'Pane Bianco' },
            categoryId: foodCat.id,
          },
        ],
      });

      // 4. Esegue la creazione della registrazione contabile (Punto 10)
      const createdExpense = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
      });

      expect(createdExpense).toBeDefined();
      expect(createdExpense.amount).toBe(4.5);
      expect(createdExpense.entryMode).toBe('receipt');
      expect(createdExpense.supplierId).toBe(supplier.id);
      expect(createdExpense.expenseDate).toBe('2026-08-01');

      // Verifico ExpenseItems creati
      const items = await db.expenseItems.where('expenseId').equals(createdExpense.id).toArray();
      expect(items.length).toBe(2);

      const item1 = items.find((i) => i.description === 'LATTE FRESCO 1L');
      expect(item1).toBeDefined();
      expect(item1?.productId).toBe(product.id);
      expect(item1?.total).toBe(1.5);

      const item2 = items.find((i) => i.description === 'PANE BIANCO');
      expect(item2).toBeDefined();
      expect(item2?.total).toBe(3.0);

      // Verifico che DocumentSession e OCRProcess siano stati aggiornati con l'expenseId e status 'completed'
      const updatedSession = await db.documentSessions.get(session.id);
      expect(updatedSession?.status).toBe('completed');
      expect(updatedSession?.expenseId).toBe(createdExpense.id);

      const updatedProc = await ocrProcessRepository.getById(ocrProc.id);
      expect(updatedProc?.status).toBe('completed');
      expect(updatedProc?.expenseId).toBe(createdExpense.id);

      // Verifico AuditLog
      const logs = await db.auditLogs.toArray();
      const expenseLog = logs.find((l) => l.entityType === 'expense' && l.entityId === createdExpense.id);
      expect(expenseLog).toBeDefined();
      expect(expenseLog?.action).toBe('create');
      expect((expenseLog?.newValues as any)?.importedLinesCount).toBe(2);
    });

    it('19. Punto 10: Idempotenza della creazione contabile (nessuna doppia registrazione)', async () => {
      const ocrProc = await ocrProcessRepository.create({
        attachmentId: 'att-19',
        status: 'completed',
        detectedSupplier: 'SUPERMERCATO TEST',
        detectedDate: '2026-08-02',
        detectedTotal: 10.0,
        confirmationRequired: true,
        confirmedByUser: true, // Già confermato dall'utente
      });

      const session = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        processingMode: 'singleReceipt',
        pageCount: 1,
        status: 'reviewed',
        ocrProcessId: ocrProc.id,
        metadata: { title: 'Scontrino Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      });

      await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'ARTICOLO TEST 10.00',
        description: 'ARTICOLO TEST',
        quantity: 1,
        unitPrice: 10.0,
        lineTotal: 10.0,
        confidence: 90,
        reviewStatus: 'confirmed',
      });

      // Prima chiamata
      const exp1 = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
      });

      const countAfterFirst = (await db.expenses.toArray()).length;
      const itemsCountAfterFirst = (await db.expenseItems.toArray()).length;
      expect(countAfterFirst).toBe(1);
      expect(itemsCountAfterFirst).toBe(1);

      // Seconda chiamata
      const exp2 = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
      });

      expect(exp2.id).toBe(exp1.id);

      const countAfterSecond = (await db.expenses.toArray()).length;
      const itemsCountAfterSecond = (await db.expenseItems.toArray()).length;

      expect(countAfterSecond).toBe(1); // Nessuna seconda Expense creata
      expect(itemsCountAfterSecond).toBe(1); // Nessuna seconda ExpenseItem creata
    });
  });

  describe('Punto 11: Salvataggio Atomico del Fascicolo OCR & Coerenza Database', () => {
    it('20. Punto 11: Salvataggio atomico integrale in un\'unica chiamata con verifica di tutti i collegamenti e dell\'AuditLog', async () => {
      const categories = await categoryRepository.getAll();
      const foodCat = categories[0];

      const ocrProc = await ocrProcessRepository.create({
        attachmentId: 'att-20',
        status: 'processing',
        detectedSupplier: 'ESSELUNGA TORINO',
        detectedDate: '2026-08-03',
        detectedTotal: 12.5,
        confirmationRequired: true,
        confirmedByUser: false,
      });

      const session = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        processingMode: 'singleReceipt',
        pageCount: 1,
        status: 'ready_for_review',
        ocrProcessId: ocrProc.id,
        metadata: { title: 'Scontrino Esselunga', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      });

      const line1 = await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'YOGURT GRECO 2.50',
        description: 'YOGURT GRECO 150G',
        quantity: 1,
        unitPrice: 2.5,
        lineTotal: 2.5,
        confidence: 90,
        reviewStatus: 'pending',
      });

      const line2 = await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'OLIO EXTRAVERGINE 10.00',
        description: 'OLIO EXTRAVERGINE 1L',
        quantity: 1,
        unitPrice: 10.0,
        lineTotal: 10.0,
        confidence: 95,
        reviewStatus: 'pending',
      });

      // Esecuzione unificata atomica del fascicolo OCR
      const createdExpense = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
        supplierName: 'ESSELUNGA TORINO',
        expenseDate: '2026-08-03',
        documentTotal: 12.5,
        decisions: [
          {
            lineId: line1.id,
            originalText: line1.originalText,
            description: line1.description,
            quantity: 1,
            unitPrice: 2.5,
            lineTotal: 2.5,
            action: 'create_new',
            newProductDetails: { displayName: 'Yogurt Greco 150g' },
            categoryId: foodCat.id,
          },
          {
            lineId: line2.id,
            originalText: line2.originalText,
            description: line2.description,
            quantity: 1,
            unitPrice: 10.0,
            lineTotal: 10.0,
            action: 'create_new',
            newProductDetails: { displayName: 'Olio Extravergine 1L' },
            categoryId: foodCat.id,
          },
        ],
      });

      expect(createdExpense).toBeDefined();
      expect(createdExpense.amount).toBe(12.5);

      // Verifico che le entità collegate siano state create correttamente
      const supplier = await supplierRepository.getByNameOrAlias('ESSELUNGA TORINO');
      expect(supplier).toBeDefined();
      expect(createdExpense.supplierId).toBe(supplier?.id);

      const items = await db.expenseItems.where('expenseId').equals(createdExpense.id).toArray();
      expect(items.length).toBe(2);

      // Verifico collegamenti ExpenseItem -> Product e OCRReceiptLine
      for (const item of items) {
        expect(item.ocrReceiptLineId).toBeDefined();
        expect(item.productId).toBeDefined();

        const lineInDb = await ocrReceiptLineRepository.getById(item.ocrReceiptLineId!);
        expect(lineInDb).toBeDefined();
        expect(lineInDb?.productId).toBe(item.productId);

        const prodInDb = await productRepository.getById(item.productId!);
        expect(prodInDb).toBeDefined();

        // Verifico che sia stato creato il relativo ProductAlias
        const aliases = await productAliasRepository.getByProduct(item.productId!);
        expect(aliases.length).toBeGreaterThan(0);
        expect(aliases[0].productId).toBe(item.productId);
      }

      // Verifico che DocumentSession e OCRProcess siano stati aggiornati atomicamente
      const updatedSession = await db.documentSessions.get(session.id);
      expect(updatedSession?.status).toBe('completed');
      expect(updatedSession?.expenseId).toBe(createdExpense.id);

      const updatedProc = await ocrProcessRepository.getById(ocrProc.id);
      expect(updatedProc?.status).toBe('completed');
      expect(updatedProc?.expenseId).toBe(createdExpense.id);
      expect(updatedProc?.confirmedByUser).toBe(true);

      // Verifico l'AuditLog finale con tutti i campi
      const logs = await db.auditLogs.where('entityId').equals(createdExpense.id).toArray();
      expect(logs.length).toBe(1);
      const log = logs[0];
      expect(log.action).toBe('create');
      const nv = log.newValues as any;
      expect(nv.importedLinesCount).toBe(2);
      expect(nv.createdProductsCount).toBe(2);
      expect(nv.createdAliasesCount).toBe(2);
      expect(nv.documentSessionId).toBe(session.id);
      expect(nv.ocrProcessId).toBe(ocrProc.id);
      expect(nv.confirmedByUser).toBe(true);
    });

    it('21. Punto 11: Rollback completo di tutte le scritture in caso di errore simulato durante la transazione atomica', async () => {
      const initialProductsCount = (await db.products.toArray()).length;
      const initialAliasesCount = (await db.productAliases.toArray()).length;
      const initialExpensesCount = (await db.expenses.toArray()).length;
      const initialItemsCount = (await db.expenseItems.toArray()).length;

      const ocrProc = await ocrProcessRepository.create({
        attachmentId: 'att-21',
        status: 'completed',
        detectedSupplier: 'SUPERMERCATO ERRORE',
        detectedDate: '2026-08-03',
        detectedTotal: 50.0,
        confirmationRequired: true,
        confirmedByUser: true,
      });

      const session = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        processingMode: 'singleReceipt',
        pageCount: 1,
        status: 'ready_for_review',
        ocrProcessId: ocrProc.id,
        metadata: { title: 'Scontrino Errore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      });

      await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'PRODOTTO VALIDO 10.00',
        description: 'PRODOTTO VALIDO',
        quantity: 1,
        unitPrice: 10.0,
        lineTotal: 10.0,
        confidence: 90,
        reviewStatus: 'confirmed',
      });

      // Simulo un errore forzando un repository ad operare su una rimozione invalida o un eccezione dentro la transazione
      const spy = vi.spyOn(db.expenseItems, 'bulkAdd').mockImplementationOnce(() => {
        throw new Error('Errore simulato di scrittura DB durante la transazione atomica');
      });

      await expect(
        productClassificationService.createAccountingRegistration({
          ocrProcessId: ocrProc.id,
          sessionId: session.id,
        })
      ).rejects.toThrow();

      spy.mockRestore();

      // Verifico ROLLBACK COMPLETO: nessuna modifica o entità orfana deve essere rimasta sul DB
      const finalProductsCount = (await db.products.toArray()).length;
      const finalAliasesCount = (await db.productAliases.toArray()).length;
      const finalExpensesCount = (await db.expenses.toArray()).length;
      const finalItemsCount = (await db.expenseItems.toArray()).length;

      expect(finalProductsCount).toBe(initialProductsCount);
      expect(finalAliasesCount).toBe(initialAliasesCount);
      expect(finalExpensesCount).toBe(initialExpensesCount);
      expect(finalItemsCount).toBe(initialItemsCount);

      // Verifico che nè la sessione nè il processo OCR siano rimasti marcati come 'completed' con un expenseId
      const checkSession = await db.documentSessions.get(session.id);
      expect(checkSession?.status).toBe('ready_for_review');
      expect(checkSession?.expenseId).toBeUndefined();

      const checkProc = await db.ocrProcesses.get(ocrProc.id);
      expect(checkProc?.expenseId).toBeUndefined();
    });

    it('22. Punto 11: Idempotenza rigorosa e assenza di doppi salvataggi anche con AuditLog o status preesistenti', async () => {
      const ocrProc = await ocrProcessRepository.create({
        attachmentId: 'att-22',
        status: 'completed',
        detectedSupplier: 'NEGOZIO IDEMPOTENTE',
        detectedDate: '2026-08-03',
        detectedTotal: 15.0,
        confirmationRequired: true,
        confirmedByUser: true,
      });

      const session = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        processingMode: 'singleReceipt',
        pageCount: 1,
        status: 'reviewed',
        ocrProcessId: ocrProc.id,
        metadata: { title: 'Scontrino Idempotenza', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
      });

      await ocrReceiptLineRepository.create({
        ocrProcessId: ocrProc.id,
        originalText: 'ARTICOLO A 15.00',
        description: 'ARTICOLO A',
        quantity: 1,
        unitPrice: 15.0,
        lineTotal: 15.0,
        confidence: 95,
        reviewStatus: 'confirmed',
      });

      // Esecuzione 1
      const exp1 = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
      });

      // Esecuzione 2 (immediatamente successiva)
      const exp2 = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
        sessionId: session.id,
      });

      // Esecuzione 3 (senza passare il sessionId)
      const exp3 = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProc.id,
      });

      expect(exp1.id).toBe(exp2.id);
      expect(exp2.id).toBe(exp3.id);

      // Verifico che nel DB esista solo UN record Expense e un solo gruppo di ExpenseItems
      const allExpensesForProc = (await db.expenses.toArray()).filter((e) => {
        const m = e.metadata as any;
        return m?.ocrProcessId === ocrProc.id;
      });
      expect(allExpensesForProc.length).toBe(1);

      const itemsCount = (await db.expenseItems.where('expenseId').equals(exp1.id).toArray()).length;
      expect(itemsCount).toBe(1);
    });
  });
});
