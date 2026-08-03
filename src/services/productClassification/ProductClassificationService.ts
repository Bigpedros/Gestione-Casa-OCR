import { db } from '../../database/db';
import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
  productRepository,
  productAliasRepository,
  supplierRepository,
  categoryRepository,
  auditLogRepository,
  documentSessionRepository,
} from '../../repositories';
import type { Product, ProductAlias, Supplier, OCRReceiptLine, Category, Expense, ExpenseItem } from '../../types';
import { ProductFingerprintService } from './ProductFingerprint';
import type {
  ReceiptClassificationProposal,
  ClassificationMatchResult,
  SupplierClassificationProposal,
  CandidateMatch,
  ProposedCategoryInfo,
  ConfidenceLevel,
  ConfirmReceiptClassificationParams,
  CreateAccountingRegistrationParams,
} from './types';

export class ProductClassificationService {
  /**
   * Esegue la classificazione automatica e idempotente delle righe estratti da un processo OCR.
   * Restituisce una proposta di classificazione completa SENZA creare alcuna entità definitiva.
   */
  public async classifyReceiptLines(ocrProcessId: string): Promise<ReceiptClassificationProposal> {
    // 1. Carica il processo OCR e le sue righe estratti
    const ocrProcess = await ocrProcessRepository.getById(ocrProcessId);
    if (!ocrProcess) {
      throw new Error(`Processo OCR ${ocrProcessId} non trovato`);
    }

    const ocrLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProcessId);

    // 2. Classifica il fornitore (proposta)
    const supplierProposal = await this.classifySupplier(ocrProcess.detectedSupplier);

    // 3. Carica prodotti, alias e categorie esistenti per il matching offline local-first
    const allProducts = await productRepository.getAll();
    const allAliases = await productAliasRepository.getAll();
    const allCategories = await categoryRepository.getAll();

    const categoryMap = new Map<string, Category>(allCategories.map((c) => [c.id, c]));

    // Trova categoria predefinita "Da classificare" / "Varie"
    const unclassifiedCat =
      allCategories.find((c) => c.code === 'CAT_MISC' || c.name.toLowerCase().includes('varie')) ||
      allCategories[0];

    const defaultUnclassifiedCategoryInfo: ProposedCategoryInfo = unclassifiedCat
      ? { id: unclassifiedCat.id, name: unclassifiedCat.name, code: unclassifiedCat.code, isDefaultUnclassified: true }
      : { id: 'cat-unclassified', name: 'Da classificare', code: 'UNCLASSIFIED', isDefaultUnclassified: true };

    // Costruisce la mappa degli alias raggruppati per productId
    const aliasByProductMap = new Map<string, ProductAlias[]>();
    for (const alias of allAliases) {
      const list = aliasByProductMap.get(alias.productId) || [];
      list.push(alias);
      aliasByProductMap.set(alias.productId, list);
    }

    // Pre-calcola i fingerprint di tutti i prodotti in catalogo
    const productFingerprintMap = new Map<
      string,
      { product: Product; aliases: ProductAlias[]; fingerprint: ReturnType<typeof ProductFingerprintService.buildFingerprintFromProduct> }
    >();

    for (const prod of allProducts) {
      const prodAliases = aliasByProductMap.get(prod.id) || [];
      const fp = ProductFingerprintService.buildFingerprintFromProduct(prod, prodAliases, {
        supplierId: supplierProposal.matchedSupplier?.id || null,
      });
      productFingerprintMap.set(prod.id, { product: prod, aliases: prodAliases, fingerprint: fp });
    }

    // 4. Classifica ciascuna riga scontrino
    const lineProposals: ClassificationMatchResult[] = [];

    for (const line of ocrLines) {
      const result = this.classifySingleLine(
        line,
        allProducts,
        allAliases,
        productFingerprintMap,
        supplierProposal.matchedSupplier,
        categoryMap,
        defaultUnclassifiedCategoryInfo
      );
      lineProposals.push(result);
    }

    // 5. Calcola le metriche di riepilogo
    const knownProductCount = lineProposals.filter((l) => l.matchedProduct !== null && l.confidence >= 75).length;
    const newProductCount = lineProposals.filter((l) => l.proposedNewProduct !== null).length;
    const conflictCount = lineProposals.filter((l) => l.hasConflict).length;
    const unclassifiedCount = lineProposals.filter((l) => l.proposedCategory?.isDefaultUnclassified).length;

    return {
      ocrProcessId,
      supplierProposal,
      lineProposals,
      unclassifiedCount,
      knownProductCount,
      newProductCount,
      conflictCount,
      isProvisional: true,
    };
  }

  /**
   * Classifica il fornitore individuato dal parser OCR
   */
  private async classifySupplier(detectedSupplierName?: string | null): Promise<SupplierClassificationProposal> {
    if (!detectedSupplierName || detectedSupplierName.trim().length === 0) {
      return {
        detectedName: null,
        matchedSupplier: null,
        confidence: 0,
        proposedNewSupplier: null,
        isNewSupplier: false,
      };
    }

    const normName = detectedSupplierName.trim();
    const matched = await supplierRepository.getByNameOrAlias(normName);

    if (matched) {
      return {
        detectedName: normName,
        matchedSupplier: matched,
        confidence: 95,
        proposedNewSupplier: null,
        isNewSupplier: false,
      };
    }

    return {
      detectedName: normName,
      matchedSupplier: null,
      confidence: 50,
      proposedNewSupplier: {
        name: normName,
        aliases: [],
        status: 'new',
        suggestedCategoryCode: 'CAT_FOOD',
      },
      isNewSupplier: true,
    };
  }

  /**
   * Classifica una singola riga di scontrino confrontandola con il catalogo offline
   */
  private classifySingleLine(
    line: OCRReceiptLine,
    allProducts: Product[],
    allAliases: ProductAlias[],
    productFingerprintMap: Map<
      string,
      { product: Product; aliases: ProductAlias[]; fingerprint: ReturnType<typeof ProductFingerprintService.buildFingerprintFromProduct> }
    >,
    matchedSupplier: Supplier | null,
    categoryMap: Map<string, Category>,
    defaultUnclassifiedCat: ProposedCategoryInfo
  ): ClassificationMatchResult {
    const rawDesc = line.originalText || line.description;
    const normDesc = ProductFingerprintService.normalizeText(line.description || line.originalText);

    // Build line fingerprint
    const lineFp = ProductFingerprintService.buildFingerprintFromText(rawDesc, {
      supplierId: matchedSupplier?.id || null,
      unitPrice: line.unitPrice,
    });

    const candidateMatches: CandidateMatch[] = [];

    // Stage 1: Barcode match (if EAN present)
    if (lineFp.barcode) {
      for (const prod of allProducts) {
        if (prod.barcode && prod.barcode === lineFp.barcode) {
          candidateMatches.push({
            product: prod,
            score: 100,
            matchType: 'exact_barcode',
            reasons: ['Corrispondenza esatta codice a barre EAN/GTIN'],
          });
        }
      }
    }

    // Stage 2: ProductAlias match
    for (const alias of allAliases) {
      const aliasNorm = alias.normalizedText;
      if (aliasNorm === normDesc || alias.originalText.toUpperCase().trim() === rawDesc.toUpperCase().trim()) {
        const prod = allProducts.find((p) => p.id === alias.productId);
        if (prod) {
          let score = alias.confidence || 90;
          const reasons = [`Match alias conosciuto: "${alias.originalText}"`];

          if (matchedSupplier && alias.supplierId === matchedSupplier.id) {
            score = Math.min(98, score + 5);
            reasons.push(`Alias specifico del fornitore "${matchedSupplier.name}"`);
          }

          candidateMatches.push({
            product: prod,
            alias,
            score,
            matchType: 'exact_alias',
            reasons,
          });
        }
      }
    }

    // Stage 3: Product Name direct match
    for (const prod of allProducts) {
      if (prod.normalizedName === normDesc || prod.displayName.toUpperCase().trim() === rawDesc.toUpperCase().trim()) {
        candidateMatches.push({
          product: prod,
          score: 90,
          matchType: 'exact_name',
          reasons: ['Corrispondenza esatta nome prodotto'],
        });
      }
    }

    // Stage 4: Product Fingerprint comparison across all catalog products
    for (const [, item] of productFingerprintMap) {
      const comp = ProductFingerprintService.compareFingerprints(lineFp, item.fingerprint);
      if (comp.score >= 35) {
        // Evita di duplicare candidate se già aggiunto tramite barcode/alias/name esatto
        const existingCandidate = candidateMatches.find((c) => c.product.id === item.product.id);
        if (!existingCandidate) {
          candidateMatches.push({
            product: item.product,
            score: comp.score,
            matchType: 'fingerprint',
            reasons: comp.reasons,
          });
        } else if (comp.score > existingCandidate.score) {
          existingCandidate.score = comp.score;
          existingCandidate.reasons.push(...comp.reasons);
        }
      }
    }

    // Ordinamento dei candidati per punteggio decrescente
    candidateMatches.sort((a, b) => b.score - a.score);

    // Rimozione candidati duplicati per stesso prodotto mantenendo il punteggio più alto
    const uniqueCandidates: CandidateMatch[] = [];
    const seenProductIds = new Set<string>();

    for (const cand of candidateMatches) {
      if (!seenProductIds.has(cand.product.id)) {
        seenProductIds.add(cand.product.id);
        uniqueCandidates.push(cand);
      }
    }

    // Valutazione conflitti e decisione finale
    let hasConflict = false;
    let conflictType: ClassificationMatchResult['conflictType'] = undefined;
    let conflictDetails: string | undefined = undefined;
    const warnings: string[] = [];

    // Controllo descrizione molto corta (es. "P.S.", "ART.12")
    const alphaNumDesc = normDesc.replace(/[^A-Z0-9]/g, '');
    if (alphaNumDesc.length < 3) {
      hasConflict = true;
      conflictType = 'short_description';
      conflictDetails = 'Descrizione riga troppo breve o ambigua per il matching automatico.';
      warnings.push('Descrizione riga troppo corta (< 3 caratteri)');
    }

    const topCandidate = uniqueCandidates.length > 0 ? uniqueCandidates[0] : null;
    const secondCandidate = uniqueCandidates.length > 1 ? uniqueCandidates[1] : null;

    // Controllo prodotti ambigui (due candidati con punteggi simili)
    if (topCandidate && secondCandidate && topCandidate.score >= 50 && (topCandidate.score - secondCandidate.score) <= 10) {
      hasConflict = true;
      conflictType = 'ambiguous_products';
      conflictDetails = `Coppia di prodotti compatibili con punteggio simile: "${topCandidate.product.displayName}" (${topCandidate.score}%) e "${secondCandidate.product.displayName}" (${secondCandidate.score}%).`;
      warnings.push('Presenza di prodotti alternativi compatibili');
    }

    // Calcolo livello di confidenza
    let confidenceLevel: ConfidenceLevel = 'unresolved';
    if (hasConflict) {
      confidenceLevel = 'unresolved';
    } else if (topCandidate && topCandidate.score >= 50) {
      if (topCandidate.matchType === 'exact_barcode' || topCandidate.matchType === 'exact_alias') {
        confidenceLevel = 'exact';
      } else if (topCandidate.score >= 80) {
        confidenceLevel = 'high_confidence';
      } else {
        confidenceLevel = 'possible';
      }
    } else {
      confidenceLevel = 'new_product';
    }

    // Decisione associazione prodotto e proposta
    if (topCandidate && topCandidate.score >= 50) {
      const matchedProduct = topCandidate.product;

      // Determinazione categoria e sottocategoria da prodotto o fornitore
      let proposedCat: ProposedCategoryInfo | null = null;
      let proposedSubcat: ProposedCategoryInfo | null = null;

      if (matchedProduct.categoryId && categoryMap.has(matchedProduct.categoryId)) {
        const cat = categoryMap.get(matchedProduct.categoryId)!;
        proposedCat = { id: cat.id, name: cat.name, code: cat.code };
      } else if (matchedSupplier?.defaultCategoryId && categoryMap.has(matchedSupplier.defaultCategoryId)) {
        const cat = categoryMap.get(matchedSupplier.defaultCategoryId)!;
        proposedCat = { id: cat.id, name: cat.name, code: cat.code };
      } else {
        proposedCat = defaultUnclassifiedCat;
      }

      if (matchedProduct.subcategoryId && categoryMap.has(matchedProduct.subcategoryId)) {
        const subcat = categoryMap.get(matchedProduct.subcategoryId)!;
        proposedSubcat = { id: subcat.id, name: subcat.name, code: subcat.code };
      }

      return {
        lineId: line.id,
        originalDescription: line.originalText,
        normalizedDescription: normDesc,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        matchedProduct,
        matchedAlias: topCandidate.alias || null,
        confidence: topCandidate.score,
        confidenceLevel,
        matchType: topCandidate.matchType,
        proposedCategory: proposedCat,
        proposedSubcategory: proposedSubcat,
        proposedNewProduct: null,
        candidateMatches: uniqueCandidates,
        hasConflict,
        conflictType,
        conflictDetails,
        warnings,
      };
    }

    // Nessun match con confidenza >= 50%: Proposta NUOVO PRODOTTO provvisorio
    const proposedBrand = lineFp.brand;
    const proposedUom = lineFp.unitOfMeasure;

    const isAdjustmentOrDiscountLine =
      line.lineTotal < 0 ||
      /SCONTO|ABBUONO|PROMO|PROMOZIONE|COUPON|BUONO|ARROTONDAMENTO|RESO|STORNO|RESTITUITO/i.test(line.description || line.originalText);

    return {
      lineId: line.id,
      originalDescription: line.originalText,
      normalizedDescription: normDesc,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      matchedProduct: null,
      matchedAlias: null,
      confidence: topCandidate ? topCandidate.score : 0,
      confidenceLevel: isAdjustmentOrDiscountLine ? 'unresolved' : confidenceLevel,
      matchType: 'none',
      proposedCategory: defaultUnclassifiedCat,
      proposedSubcategory: null,
      proposedNewProduct: isAdjustmentOrDiscountLine
        ? null
        : {
            normalizedName: normDesc,
            displayName: line.description || line.originalText,
            brand: proposedBrand,
            barcode: lineFp.barcode,
            unitOfMeasure: proposedUom,
            categoryId: defaultUnclassifiedCat.id,
            subcategoryId: null,
            suggestedCategoryName: 'Da classificare',
            reason: topCandidate
              ? `Punteggio del candidato più simile insufficiente (${topCandidate.score}%)`
              : 'Nessuna corrispondenza trovata nel catalogo prodotti',
          },
      candidateMatches: uniqueCandidates,
      hasConflict,
      conflictType,
      conflictDetails,
      warnings,
    };
  }

  /**
   * Conferma la classificazione delle righe scontrino con garanzia di consistenza transazionale (Dexie),
   * apprendimento automatico di alias e creazione controllata di nuovi prodotti previa verifica anti-duplicato.
   */
  public async confirmReceiptClassifications(params: ConfirmReceiptClassificationParams): Promise<{
    updatedLinesCount: number;
    createdProductsCount: number;
    createdAliasesCount: number;
  }> {
    let createdProductsCount = 0;
    let createdAliasesCount = 0;
    let updatedLinesCount = 0;

    await db.transaction(
      'rw',
      [
        db.categories,
        db.documentSessions,
        db.ocrProcesses,
        db.ocrReceiptLines,
        db.products,
        db.productAliases,
        db.suppliers,
        db.expenses,
        db.expenseItems,
        db.auditLogs,
      ],
      async () => {
        // 1. Verfica e aggiorna processo OCR
        const ocrProc = await ocrProcessRepository.getById(params.ocrProcessId);
        if (!ocrProc) {
          throw new Error(`Processo OCR ${params.ocrProcessId} non trovato`);
        }

        // Idempotenza: Se il processo è già stato confermato in precedenza, evita duplicazione
        if (ocrProc.confirmedByUser) {
          return;
        }

        // 2. Eliminazione atomica delle righe rimosse dall'utente
        if (params.deletedLineIds && params.deletedLineIds.length > 0) {
          for (const lineId of params.deletedLineIds) {
            if (!lineId.startsWith('temp-line-')) {
              await ocrReceiptLineRepository.delete(lineId);
            }
          }
        }

        let supplierId: string | null = params.supplierId || null;
        if (params.supplierName && (!supplierId || supplierId === 'new')) {
          const supMatch = await supplierRepository.getByNameOrAlias(params.supplierName);
          if (supMatch) {
            supplierId = supMatch.id;
          } else {
            const newSup = await supplierRepository.create({
              name: params.supplierName.trim(),
              aliases: [],
              status: 'confirmed',
            });
            supplierId = newSup.id;
          }
        }

        await ocrProcessRepository.update(params.ocrProcessId, {
          detectedSupplier: params.supplierName || ocrProc.detectedSupplier,
          detectedDate: params.expenseDate || ocrProc.detectedDate,
          detectedTotal: params.documentTotal ?? ocrProc.detectedTotal,
          confirmedByUser: true,
          status: 'completed',
        });

        // 2. Processa ciascuna decisione riga
        for (const decision of params.decisions) {
          const rawDesc = decision.description || decision.originalText;
          const normText = ProductFingerprintService.normalizeText(rawDesc);
          const cleanNormName = ProductFingerprintService.computeCleanNormalizedName(rawDesc);

          let finalProductId: string | null = null;

          if (decision.action === 'link_existing' && decision.productId) {
            finalProductId = decision.productId;

            // Apprendimento progressivo: crea alias se non esiste già per questo prodotto e testo
            const existingAliases = await productAliasRepository.getByProduct(finalProductId);
            const aliasExists = existingAliases.some(
              (a) => a.normalizedText === normText || a.originalText.toUpperCase().trim() === rawDesc.toUpperCase().trim()
            );

            if (!aliasExists && normText.length > 1) {
              await productAliasRepository.create({
                productId: finalProductId,
                originalText: decision.originalText || decision.description,
                normalizedText: normText,
                supplierId: supplierId || null,
                confidence: 100,
                confirmedByUser: true,
              });
              createdAliasesCount++;
            }
          } else if (decision.action === 'create_new') {
            // Controllo anti-duplicato per nome normalizzato
            const existingProduct = await productRepository.getByNormalizedName(cleanNormName);

            if (existingProduct) {
              finalProductId = existingProduct.id;
            } else {
              // Creazione nuovo prodotto solo su conferma esplicita
              const details = decision.newProductDetails;
              const newProd = await productRepository.create({
                displayName: details?.displayName || decision.description,
                normalizedName: cleanNormName,
                brand: details?.brand || ProductFingerprintService.extractBrand(rawDesc) || null,
                barcode: details?.barcode || ProductFingerprintService.extractBarcode(rawDesc) || null,
                unitOfMeasure:
                  details?.unitOfMeasure ||
                  ProductFingerprintService.extractUnitOfMeasure(rawDesc).unitOfMeasure ||
                  null,
                categoryId: decision.categoryId || details?.categoryId || null,
                subcategoryId: decision.subcategoryId || details?.subcategoryId || null,
              });
              finalProductId = newProd.id;
              createdProductsCount++;
            }

            // Crea alias per il nuovo prodotto creato o riutilizzato
            const existingAliases = await productAliasRepository.getByProduct(finalProductId);
            const aliasExists = existingAliases.some(
              (a) => a.normalizedText === normText || a.originalText.toUpperCase().trim() === rawDesc.toUpperCase().trim()
            );

            if (!aliasExists && normText.length > 1) {
              await productAliasRepository.create({
                productId: finalProductId,
                originalText: decision.originalText || decision.description,
                normalizedText: normText,
                supplierId: supplierId || null,
                confidence: 100,
                confirmedByUser: true,
              });
              createdAliasesCount++;
            }
          }

          // Aggiorna o crea riga scontrino nel DB
          if (decision.lineId && !decision.lineId.startsWith('temp-line-')) {
            await ocrReceiptLineRepository.update(decision.lineId, {
              description: decision.description,
              quantity: decision.quantity,
              unitPrice: decision.unitPrice,
              lineTotal: decision.lineTotal,
              productId: finalProductId,
              reviewStatus: 'confirmed',
            });
            updatedLinesCount++;
          } else {
            await ocrReceiptLineRepository.create({
              ocrProcessId: params.ocrProcessId,
              originalText: decision.originalText || decision.description,
              description: decision.description,
              quantity: decision.quantity,
              unitPrice: decision.unitPrice,
              lineTotal: decision.lineTotal,
              confidence: decision.confidence || 100,
              reviewStatus: 'confirmed',
              productId: finalProductId,
            });
            updatedLinesCount++;
          }
        }

        // Audit Log
        await auditLogRepository.create({
          entityType: 'ocrProcess',
          entityId: params.ocrProcessId,
          action: 'update',
          newValues: {
            updatedLinesCount,
            createdProductsCount,
            createdAliasesCount,
            supplierId,
          },
        });
      }
    );

    return { updatedLinesCount, createdProductsCount, createdAliasesCount };
  }

  /**
   * PUNTO 11: Salvataggio Atomico dell'intero fascicolo OCR (Expense, ExpenseItems, Products, Aliases, Session, Process).
   * L'operazione è rigorosamente atomica (singola transazione Dexie a 9 tabelle) e completamente idempotente.
   */
  public async createAccountingRegistration(
    params: CreateAccountingRegistrationParams
  ): Promise<Expense> {
    const {
      ocrProcessId,
      sessionId,
      paymentMethod = 'cash',
      notes,
      supplierName: paramSupplierName,
      expenseDate: paramExpenseDate,
      documentTotal: paramDocumentTotal,
      decisions,
      deletedLineIds,
    } = params;

    // 1. Carica il processo OCR
    const ocrProc = await ocrProcessRepository.getById(ocrProcessId);
    if (!ocrProc) {
      throw new Error(`Processo OCR ${ocrProcessId} non trovato`);
    }

    // Carica eventuale DocumentSession collegata
    let session = sessionId ? await documentSessionRepository.getById(sessionId) : null;
    if (!session && ocrProc.id) {
      const allSessions = await documentSessionRepository.getAll();
      session = allSessions.find((s) => s.ocrProcessId === ocrProc.id) || null;
    }

    // 2. PRECONDIZIONI & IDEMPOTENZA (Punto 11 - Sezione 3)
    if (!ocrProc.confirmedByUser && (!decisions || decisions.length === 0)) {
      throw new Error(
        `Impossibile creare la registrazione contabile: la revisione OCR non è stata ancora confermata dall'utente`
      );
    }

    if (
      session &&
      session.status !== 'ready_for_review' &&
      session.status !== 'reviewed' &&
      session.status !== 'completed'
    ) {
      throw new Error(
        `Impossibile creare la registrazione contabile: la sessione ${session.id} si trova nello stato non consentito '${session.status}'`
      );
    }

    // 3. CONTROLLO ANTI-DUPLICAZIONE / IDEMPOTENZA (Punto 11 - Sezione 3)
    if (session?.expenseId) {
      const existing = await db.expenses.get(session.expenseId);
      if (existing) return existing;
    }

    if (ocrProc.expenseId) {
      const existing = await db.expenses.get(ocrProc.expenseId);
      if (existing) return existing;
    }

    const allExpenses = await db.expenses.toArray();
    const existingByMeta = allExpenses.find((e) => {
      const m = e.metadata as Record<string, any> | undefined;
      return (
        m?.ocrProcessId === ocrProc.id ||
        (session?.id && m?.documentSessionId === session.id)
      );
    });
    if (existingByMeta) return existingByMeta;

    // Controllo AuditLog per prevenzione doppio salvataggio
    const allAuditLogs = await db.auditLogs.toArray();
    const existingAuditLog = allAuditLogs.find((l) => {
      if (l.entityType !== 'expense') return false;
      const nv = l.newValues as Record<string, any> | undefined;
      return (
        nv?.ocrProcessId === ocrProc.id ||
        (session?.id && nv?.documentSessionId === session.id)
      );
    });
    if (existingAuditLog) {
      const expId = existingAuditLog.entityId || (existingAuditLog.newValues as any)?.expenseId;
      if (expId) {
        const existing = await db.expenses.get(expId);
        if (existing) return existing;
      }
    }

    let createdProductsCount = 0;
    let createdAliasesCount = 0;
    let createdExpense: Expense | null = null;

    // 4. UNICA TRANSAZIONE ATOMICA SU TUTTE LE TABELLE (Punto 11 - Sezione 1 & 2)
    await db.transaction(
      'rw',
      [
        db.categories,
        db.documentSessions,
        db.ocrProcesses,
        db.ocrReceiptLines,
        db.products,
        db.productAliases,
        db.suppliers,
        db.expenses,
        db.expenseItems,
        db.auditLogs,
      ],
      async () => {
        // Re-check atomico idempotenza dentro la transazione
        if (session?.id) {
          const sInDb = await db.documentSessions.get(session.id);
          if (sInDb?.expenseId) {
            const expInDb = await db.expenses.get(sInDb.expenseId);
            if (expInDb) {
              createdExpense = expInDb;
              return;
            }
          }
        }
        const procInDb = await db.ocrProcesses.get(ocrProc.id);
        if (procInDb?.expenseId) {
          const expInDb = await db.expenses.get(procInDb.expenseId);
          if (expInDb) {
            createdExpense = expInDb;
            return;
          }
        }

        // Fornitore e dati generali
        let supplierId: string | null = params.supplierId || null;
        const effectiveSupplierName = paramSupplierName || ocrProc.detectedSupplier || 'Fornitore scontrino';

        if (effectiveSupplierName && (!supplierId || supplierId === 'new')) {
          const supMatch = await supplierRepository.getByNameOrAlias(effectiveSupplierName);
          if (supMatch) {
            supplierId = supMatch.id;
          } else if (effectiveSupplierName.trim()) {
            const newSup = await supplierRepository.create({
              name: effectiveSupplierName.trim(),
              aliases: [],
              status: 'confirmed',
            });
            supplierId = newSup.id;
          }
        }

        // Cancellazione righe eliminati
        if (deletedLineIds && deletedLineIds.length > 0) {
          for (const lineId of deletedLineIds) {
            if (!lineId.startsWith('temp-line-')) {
              await ocrReceiptLineRepository.delete(lineId);
            }
          }
        }

        // Elaborazione decisioni di classificazione se fornite integratamente
        if (decisions && decisions.length > 0) {
          for (const decision of decisions) {
            const rawDesc = decision.description || decision.originalText;
            const normText = ProductFingerprintService.normalizeText(rawDesc);
            const cleanNormName = ProductFingerprintService.computeCleanNormalizedName(rawDesc);

            let finalProductId: string | null = null;

            if (decision.action === 'link_existing' && decision.productId) {
              finalProductId = decision.productId;

              const existingAliases = await productAliasRepository.getByProduct(finalProductId);
              const aliasExists = existingAliases.some(
                (a) => a.normalizedText === normText || a.originalText.toUpperCase().trim() === rawDesc.toUpperCase().trim()
              );

              if (!aliasExists && normText.length > 1) {
                await productAliasRepository.create({
                  productId: finalProductId,
                  originalText: decision.originalText || decision.description,
                  normalizedText: normText,
                  supplierId: supplierId || null,
                  confidence: 100,
                  confirmedByUser: true,
                });
                createdAliasesCount++;
              }
            } else if (decision.action === 'create_new') {
              const existingProduct = await productRepository.getByNormalizedName(cleanNormName);

              if (existingProduct) {
                finalProductId = existingProduct.id;
              } else {
                const details = decision.newProductDetails;
                const newProd = await productRepository.create({
                  displayName: details?.displayName || decision.description,
                  normalizedName: cleanNormName,
                  brand: details?.brand || ProductFingerprintService.extractBrand(rawDesc) || null,
                  barcode: details?.barcode || ProductFingerprintService.extractBarcode(rawDesc) || null,
                  unitOfMeasure:
                    details?.unitOfMeasure ||
                    ProductFingerprintService.extractUnitOfMeasure(rawDesc).unitOfMeasure ||
                    null,
                  categoryId: decision.categoryId || details?.categoryId || null,
                  subcategoryId: decision.subcategoryId || details?.subcategoryId || null,
                });
                finalProductId = newProd.id;
                createdProductsCount++;
              }

              const existingAliases = await productAliasRepository.getByProduct(finalProductId);
              const aliasExists = existingAliases.some(
                (a) => a.normalizedText === normText || a.originalText.toUpperCase().trim() === rawDesc.toUpperCase().trim()
              );

              if (!aliasExists && normText.length > 1) {
                await productAliasRepository.create({
                  productId: finalProductId,
                  originalText: decision.originalText || decision.description,
                  normalizedText: normText,
                  supplierId: supplierId || null,
                  confidence: 100,
                  confirmedByUser: true,
                });
                createdAliasesCount++;
              }
            }

            if (decision.lineId && !decision.lineId.startsWith('temp-line-')) {
              await ocrReceiptLineRepository.update(decision.lineId, {
                description: decision.description,
                quantity: decision.quantity,
                unitPrice: decision.unitPrice,
                lineTotal: decision.lineTotal,
                productId: finalProductId,
                reviewStatus: 'confirmed',
              });
            } else {
              await ocrReceiptLineRepository.create({
                ocrProcessId,
                originalText: decision.originalText || decision.description,
                description: decision.description,
                quantity: decision.quantity,
                unitPrice: decision.unitPrice,
                lineTotal: decision.lineTotal,
                confidence: decision.confidence || 100,
                reviewStatus: 'confirmed',
                productId: finalProductId,
              });
            }
          }
        }

        // Righe scontrino confermate
        const ocrLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProc.id);
        const confirmedLines = ocrLines.filter((l) => l.reviewStatus === 'confirmed');
        const linesToImport = confirmedLines.length > 0 ? confirmedLines : ocrLines;

        if (!supplierId && effectiveSupplierName) {
          const matchedSup = await supplierRepository.getByNameOrAlias(effectiveSupplierName);
          if (matchedSup) supplierId = matchedSup.id;
        }

        const expenseDate = paramExpenseDate || ocrProc.detectedDate || new Date().toISOString().substring(0, 10);
        const d = new Date(expenseDate);
        const competenceYear = isNaN(d.getFullYear()) ? new Date().getFullYear() : d.getFullYear();
        const competenceMonth = isNaN(d.getMonth()) ? new Date().getMonth() + 1 : d.getMonth() + 1;

        const lineTotalSum = Math.round(linesToImport.reduce((sum, line) => sum + (line.lineTotal || 0), 0) * 100) / 100;
        const totalAmount =
          typeof paramDocumentTotal === 'number' && paramDocumentTotal > 0
            ? Math.round(paramDocumentTotal * 100) / 100
            : typeof ocrProc.detectedTotal === 'number' && ocrProc.detectedTotal > 0
            ? Math.round(ocrProc.detectedTotal * 100) / 100
            : lineTotalSum;

        // Punto 12 (Sezione 6): Blocco in caso di discrepanza non approvata
        if (
          linesToImport.length > 0 &&
          totalAmount > 0 &&
          lineTotalSum > 0 &&
          Math.abs(totalAmount - lineTotalSum) > 0.01 &&
          !params.allowDiscrepancy
        ) {
          const diff = Math.abs(totalAmount - lineTotalSum).toFixed(2);
          throw new Error(
            `Discrepanza di € ${diff} tra il totale del documento (€ ${totalAmount.toFixed(2)}) e la somma delle righe (€ ${lineTotalSum.toFixed(2)}). Conferma la discrepanza o modifica gli importi per proseguire.`
          );
        }

        // Categorie
        const allCategories = await categoryRepository.getAll();
        let mainCategoryId = params.categoryId || null;
        let mainSubcategoryId = params.subcategoryId || null;

        if (!mainCategoryId) {
          if (supplierId) {
            const sup = await supplierRepository.getById(supplierId);
            if (sup?.defaultCategoryId) {
              mainCategoryId = sup.defaultCategoryId;
              mainSubcategoryId = sup.defaultSubcategoryId || null;
            }
          }
          if (!mainCategoryId) {
            for (const line of linesToImport) {
              if (line.productId) {
                const prod = await productRepository.getById(line.productId);
                if (prod?.categoryId) {
                  mainCategoryId = prod.categoryId;
                  mainSubcategoryId = prod.subcategoryId || null;
                  break;
                }
              }
            }
          }
          if (!mainCategoryId) {
            const defaultCat =
              allCategories.find((c) => c.code === 'CAT_FOOD' || c.code === 'CAT_MISC') || allCategories[0];
            mainCategoryId = defaultCat?.id || 'cat-food';
          }
        }

        if (!mainSubcategoryId) {
          const subs = await categoryRepository.getSubcategories(mainCategoryId);
          mainSubcategoryId = subs[0]?.id || mainCategoryId;
        }

        const expenseId = `exp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const now = new Date().toISOString();

        const expense: Expense = {
          id: expenseId,
          entryMode: 'receipt',
          supplierId,
          description: `Scontrino ${effectiveSupplierName}`,
          amount: totalAmount,
          expenseDate,
          paymentDate: expenseDate,
          competenceMonth,
          competenceYear,
          categoryId: mainCategoryId,
          subcategoryId: mainSubcategoryId,
          paymentMethod,
          status: 'paid',
          classification: 'necessary',
          notified: false,
          notes: notes || undefined,
          metadata: {
            createdAt: now,
            updatedAt: now,
            version: 1,
            documentSessionId: session?.id || null,
            ocrProcessId: ocrProc.id,
            origin: 'OCR',
          } as any,
        };

        const decisionMap = new Map(decisions?.map((d) => [d.lineId || d.originalText, d]));

        const expenseItems: ExpenseItem[] = linesToImport.map((line, idx) => {
          const dec = decisionMap.get(line.id) || decisionMap.get(line.originalText);
          const itemCatId = dec?.categoryId || (line as any).categoryId || mainCategoryId!;
          const itemSubcatId = dec?.subcategoryId || (line as any).subcategoryId || mainSubcategoryId!;

          return {
            id: `exp-item-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
            expenseId,
            description: line.description || line.originalText,
            quantity: line.quantity || 1,
            unitPrice: line.unitPrice || line.lineTotal || 0,
            total: line.lineTotal || 0,
            categoryId: itemCatId,
            subcategoryId: itemSubcatId,
            classification: 'necessary',
            classificationSource: line.reviewStatus === 'modified' ? 'userCorrected' : 'automatic',
            productId: line.productId || null,
            ocrReceiptLineId: line.id,
            metadata: { createdAt: now, updatedAt: now, version: 1 },
          };
        });

        // Scrittura spesa e righe
        await db.expenses.add(expense);

        if (expenseItems.length > 0) {
          await db.expenseItems.bulkAdd(expenseItems);
        }

        // Stato definitivo DocumentSession
        if (session?.id) {
          await db.documentSessions.update(session.id, {
            status: 'completed',
            expenseId: expense.id,
            updatedAt: now,
          });
        }

        // Stato definitivo OCRProcess
        await db.ocrProcesses.update(ocrProc.id, {
          detectedSupplier: effectiveSupplierName,
          detectedDate: expenseDate,
          detectedTotal: totalAmount,
          expenseId: expense.id,
          status: 'completed',
          confirmedByUser: true,
        });

        // Audit Log finale esteso (Punto 11 - Sezione 7)
        await db.auditLogs.add({
          id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          entityType: 'expense',
          entityId: expense.id,
          action: 'create',
          newValues: {
            expenseId: expense.id,
            documentSessionId: session?.id || null,
            ocrProcessId: ocrProc.id,
            importedLinesCount: expenseItems.length,
            createdProductsCount,
            createdAliasesCount,
            supplierId: expense.supplierId || null,
            supplierName: effectiveSupplierName,
            amount: expense.amount,
            confirmedByUser: true,
            origin: 'OCR',
            timestamp: now,
          },
          timestamp: now,
        });

        createdExpense = expense;
      }
    );

    if (!createdExpense) {
      throw new Error('Errore durante la creazione della registrazione contabile: spesa non generata');
    }

    return createdExpense;
  }
}

export const productClassificationService = new ProductClassificationService();
