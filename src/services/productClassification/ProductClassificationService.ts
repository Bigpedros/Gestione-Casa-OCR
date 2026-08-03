import {
  ocrProcessRepository,
  ocrReceiptLineRepository,
  productRepository,
  productAliasRepository,
  supplierRepository,
  categoryRepository,
} from '../../repositories';
import type { Product, ProductAlias, Supplier, OCRReceiptLine, Category } from '../../types';
import { ProductFingerprintService } from './ProductFingerprint';
import type {
  ReceiptClassificationProposal,
  ClassificationMatchResult,
  SupplierClassificationProposal,
  CandidateMatch,
  ProposedCategoryInfo,
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

      // Aggiornamento idempotente di ocrReceiptLines con productId solo se confidenza elevata e senza conflitti bloccanti
      if (result.matchedProduct && result.confidence >= 75 && !result.hasConflict) {
        if (line.productId !== result.matchedProduct.id) {
          await ocrReceiptLineRepository.update(line.id, {
            productId: result.matchedProduct.id,
          });
        }
      } else if (line.productId !== null) {
        await ocrReceiptLineRepository.update(line.id, {
          productId: null,
        });
      }
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

    return {
      lineId: line.id,
      originalDescription: line.originalText,
      normalizedDescription: normDesc,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      matchedProduct: null,
      matchedAlias: null,
      confidence: topCandidate ? topCandidate.score : 0,
      matchType: 'none',
      proposedCategory: defaultUnclassifiedCat,
      proposedSubcategory: null,
      proposedNewProduct: {
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
}

export const productClassificationService = new ProductClassificationService();
