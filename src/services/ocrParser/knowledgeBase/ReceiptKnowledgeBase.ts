/**
 * =========================================================================
 * RECEIPT KNOWLEDGE BASE v1 — SERVICE FACADE
 * =========================================================================
 *
 * Facade centralizzato per la consultazione semantica e strutturale dei termini
 * dello scontrino.
 *
 * Supporta i tre livelli architetturali:
 * 1. BUILT-IN (read-only, distribuito con l'app, versionato);
 * 2. LOCAL LEARNED (correzioni e alias appresi localmente senza alterare il built-in);
 * 3. SHARED DICTIONARY (predisposto per il futuro, senza sync remoto attivo).
 *
 * PRINCIPIO ARCHITETTURALE:
 * La Knowledge Base non prende decisioni categoriche da sola, ma arricchisce
 * e calibra la confidenza decisionale del parser (STRUTTURA + CONTESTO + KB + CONFIDENZA).
 */

import {
  ReceiptKnowledgeRole,
  ReceiptKnowledgeEntry,
  KnowledgeLookupResult,
  MerchantMatchResult,
  MerchantDirectoryEntry,
} from './types';
import {
  KNOWLEDGE_BASE_VERSION,
  BUILTIN_KNOWLEDGE_ENTRIES,
  BUILTIN_OCR_ALIASES,
} from './builtinKnowledge';
import { MerchantDirectoryService } from './merchantDirectory';

export class ReceiptKnowledgeBaseService {
  private static instance: ReceiptKnowledgeBaseService;
  private builtinEntries: ReceiptKnowledgeEntry[] = BUILTIN_KNOWLEDGE_ENTRIES;
  private learnedEntries: ReceiptKnowledgeEntry[] = [];

  private constructor() {}

  public static getInstance(): ReceiptKnowledgeBaseService {
    if (!ReceiptKnowledgeBaseService.instance) {
      ReceiptKnowledgeBaseService.instance = new ReceiptKnowledgeBaseService();
    }
    return ReceiptKnowledgeBaseService.instance;
  }

  public getVersion(): string {
    return KNOWLEDGE_BASE_VERSION;
  }

  /**
   * Restituisce tutte le entry correnti (Built-in + Local Learned)
   */
  public getAllEntries(): ReceiptKnowledgeEntry[] {
    return [...this.builtinEntries, ...this.learnedEntries];
  }

  /**
   * Aggiunge una voce al Livello 2 (Local Learned)
   */
  public registerLearnedEntry(entry: Omit<ReceiptKnowledgeEntry, 'source' | 'version'>): void {
    const newEntry: ReceiptKnowledgeEntry = {
      ...entry,
      source: 'learned',
      version: KNOWLEDGE_BASE_VERSION,
    };
    this.learnedEntries.push(newEntry);
  }

  /**
   * Applica le sostituzioni conservative note degli OCR Aliases
   */
  public normalizeOcrAliases(text: string): string {
    if (!text) return text;
    let normalized = text;
    for (const rule of BUILTIN_OCR_ALIASES) {
      normalized = normalized.replace(rule.pattern, rule.replacement);
    }
    return normalized;
  }

  /**
   * Cerca la corrispondenza semantica per un testo candidato tra le entry registrate
   */
  public lookupRole(text: string, allowedRoles?: ReceiptKnowledgeRole[]): KnowledgeLookupResult {
    if (!text || text.trim().length === 0) {
      return { matched: false, role: null, entry: null, confidence: 0 };
    }

    const clean = text.trim().toUpperCase().replace(/^[‘'"`«“\s*_\-|]+/, '').replace(/[\s*_\-|]+$/, '');
    const entries = this.getAllEntries();

    for (const entry of entries) {
      if (allowedRoles && !allowedRoles.includes(entry.semanticRole)) {
        continue;
      }

      // 1. Verifica canonical esatto
      if (entry.canonical.toUpperCase() === clean) {
        return {
          matched: true,
          role: entry.semanticRole,
          entry,
          confidence: entry.confidenceWeight ?? 1.0,
          matchedTerm: entry.canonical,
        };
      }

      // 2. Verifica aliases
      if (entry.aliases) {
        for (const alias of entry.aliases) {
          const aliasUpper = alias.toUpperCase();
          if (aliasUpper === clean) {
            return {
              matched: true,
              role: entry.semanticRole,
              entry,
              confidence: entry.confidenceWeight ?? 0.95,
              matchedTerm: alias,
            };
          }

          // Per sottostringhe, verificare i boundary di parola per evitare falsi positivi (es. "EUR" dentro "EUROSPIN")
          const escapedAlias = aliasUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const boundaryRegex = new RegExp(`(?:^|[^A-Z0-9])${escapedAlias}(?:$|[^A-Z0-9])`, 'i');
          if (boundaryRegex.test(clean)) {
            return {
              matched: true,
              role: entry.semanticRole,
              entry,
              confidence: entry.confidenceWeight ?? 0.95,
              matchedTerm: alias,
            };
          }
        }
      }

      // 3. Verifica patterns regex
      if (entry.patterns) {
        for (const pattern of entry.patterns) {
          if (pattern.test(clean)) {
            return {
              matched: true,
              role: entry.semanticRole,
              entry,
              confidence: entry.confidenceWeight ?? 0.9,
              matchedTerm: clean,
            };
          }
        }
      }
    }

    return { matched: false, role: null, entry: null, confidence: 0 };
  }

  /**
   * Verifica se il testo soddisfa un determinato ruolo semantico
   */
  public hasRole(text: string, role: ReceiptKnowledgeRole): boolean {
    const res = this.lookupRole(text, [role]);
    return res.matched;
  }

  /**
   * Identifica se il testo contiene un indizio di shopper/busta/contenitore commerciale
   */
  public isCommercialCarrierHint(text: string): boolean {
    return this.hasRole(text, 'COMMERCIAL_CARRIER_HINT');
  }

  /**
   * Identifica se il testo è un'intestazione di documento commerciale
   */
  public isCommercialDocumentHeader(text: string): boolean {
    return this.hasRole(text, 'COMMERCIAL_DOCUMENT_HEADER');
  }

  /**
   * Identifica se il testo è un marker di subtotale
   */
  public isSubtotalMarker(text: string): boolean {
    return this.hasRole(text, 'SUBTOTAL');
  }

  /**
   * Identifica se il testo è un candidato a totale finale
   */
  public isFinalTotalCandidate(text: string): boolean {
    return this.hasRole(text, 'FINAL_TOTAL_CANDIDATE');
  }

  /**
   * Identifica se il testo è un'evidenza di pagamento
   */
  public isPaymentMarker(text: string): boolean {
    return (
      this.hasRole(text, 'PAYMENT') ||
      this.hasRole(text, 'CASH_PAYMENT') ||
      this.hasRole(text, 'CARD_PAYMENT') ||
      this.hasRole(text, 'DEBIT_CARD_PAYMENT') ||
      this.hasRole(text, 'CREDIT_PAYMENT') ||
      this.hasRole(text, 'CHANGE') ||
      this.hasRole(text, 'UNPAID_OR_CREDIT_STATUS')
    );
  }

  /**
   * Identifica se il testo è un'evidenza di prova POS / transazione di pagamento
   */
  public isPaymentProofEvidence(text: string): boolean {
    return this.hasRole(text, 'PAYMENT_PROOF_EVIDENCE');
  }

  /**
   * Identifica se il testo appartiene ai metadati di coda/chiusura/cassa
   */
  public isTrailingMetadata(text: string): boolean {
    return (
      this.hasRole(text, 'TRAILING_METADATA') ||
      this.hasRole(text, 'LOYALTY_METADATA') ||
      this.hasRole(text, 'MARKETING_OR_CLOSING_FOOTER') ||
      this.hasRole(text, 'PAYMENT_DETAILS_HEADER')
    );
  }

  /**
   * Identifica se il testo è un dato di loyalty / fidelity card
   */
  public isLoyaltyMetadata(text: string): boolean {
    return this.hasRole(text, 'LOYALTY_METADATA');
  }

  /**
   * Identifica se il testo è un testo di marketing / chiusura
   */
  public isMarketingOrClosing(text: string): boolean {
    return this.hasRole(text, 'MARKETING_OR_CLOSING_FOOTER');
  }

  /**
   * Identifica se il testo è un metadato fiscale/sanitario
   */
  public isFiscalHealthMetadata(text: string): boolean {
    return this.hasRole(text, 'FISCAL_HEALTH_METADATA');
  }

  /**
   * Identifica se il testo è un'intestazione di reparto
   */
  public isDepartmentHeader(text: string): boolean {
    return this.hasRole(text, 'DEPARTMENT_HEADER');
  }

  /**
   * Identifica se il testo è un identificatore secondario di prodotto (es. codice EAN su riga successiva)
   */
  public isProductSecondaryIdentifier(text: string): boolean {
    return this.hasRole(text, 'PRODUCT_IDENTIFIER');
  }

  /**
   * Disambiguazione fornitore tramite Merchant Directory (supporto semantico/fuzzy)
   */
  public lookupMerchant(candidateName: string, customEntries?: MerchantDirectoryEntry[]): MerchantMatchResult {
    return MerchantDirectoryService.matchMerchant(candidateName, customEntries);
  }

  /**
   * Restituisce il conteggio delle entry raggruppate per ruolo semantico
   */
  public getEntryCountsByCategory(): Record<ReceiptKnowledgeRole, number> {
    const counts: Partial<Record<ReceiptKnowledgeRole, number>> = {};
    for (const entry of this.getAllEntries()) {
      counts[entry.semanticRole] = (counts[entry.semanticRole] || 0) + 1;
    }
    return counts as Record<ReceiptKnowledgeRole, number>;
  }
}

export const receiptKnowledgeBase = ReceiptKnowledgeBaseService.getInstance();
