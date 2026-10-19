import { db } from '../../database/db';
import type { Expense, OCRProcess, DocumentSession, Attachment } from '../../types';
import { ProductFingerprintService } from '../productClassification/ProductFingerprint';
import { supplierRepository, documentSessionRepository, attachmentRepository } from '../../repositories';

export type DuplicateMatchLevel = 'EXACT_DUPLICATE' | 'PROBABLE_DUPLICATE' | 'NO_DUPLICATE';

export interface FileHashPreflightResult {
  action: 'PROCEED' | 'ACTIVE_SESSION' | 'EXACT_DUPLICATE' | 'REUSE_ORPHAN_ATTACHMENT';
  activeSession?: DocumentSession | null;
  matchedExpenseId?: string;
  matchedExpense?: Expense | null;
  existingAttachment?: Attachment | null;
  userMessage?: string;
  reason?: string;
}

export interface DuplicateDetectionSignals {
  exactFileHash: boolean;
  sameSupplier: boolean;
  supplierSimilarity: number; // 0 - 100
  sameDate: boolean;
  dateDifferenceDays: number | null;
  sameTime: boolean | null; // null se l'ora è assente in uno o entrambi i documenti
  timeDifferenceMinutes: number | null;
  sameTotal: boolean;
  totalDifference: number;
  lineItemsSimilarity: number | null; // 0.0 - 1.0 (null se non ci sono righe da confrontare)
  sharedLineCount: number;
  totalIncomingLines: number;
  totalCandidateLines: number;
}

export interface DuplicateDetectionResult {
  matchLevel: DuplicateMatchLevel;
  confidenceScore: number; // 0 - 100
  matchedExpenseId?: string;
  matchedExpense?: Expense;
  reasons: string[];
  signals: DuplicateDetectionSignals;
}

export interface DuplicateDetectionInput {
  ocrProcessId?: string | null;
  sessionId?: string | null;
  excludeExpenseId?: string | null;
  fileHash?: string | null;
  supplierName?: string | null;
  supplierId?: string | null;
  taxIdentifier?: string | null;
  expenseDate?: string | null; // Formato YYYY-MM-DD
  time?: string | null; // Formato HH:mm o HH:mm:ss
  total?: number | null;
  lines?: Array<{
    description?: string;
    originalText?: string;
    quantity?: number;
    unitPrice?: number;
    lineTotal?: number;
  }>;
  rawText?: string | null;
}

export class DuplicateReceiptDetector {
  /**
   * Esegue l'analisi deterministica di duplicazione su un documento OCR o su parametri di spesa.
   */
  public static async detect(input: DuplicateDetectionInput): Promise<DuplicateDetectionResult> {
    const defaultSignals: DuplicateDetectionSignals = {
      exactFileHash: false,
      sameSupplier: false,
      supplierSimilarity: 0,
      sameDate: false,
      dateDifferenceDays: null,
      sameTime: null,
      timeDifferenceMinutes: null,
      sameTotal: false,
      totalDifference: 0,
      lineItemsSimilarity: null,
      sharedLineCount: 0,
      totalIncomingLines: 0,
      totalCandidateLines: 0,
    };

    // 1. Idratazione dati mancanti da database se fornito ocrProcessId o sessionId
    const hydrated = await this.hydrateInput(input);

    // 2. Controllo HARD MATCH: stesso fileHash storico già collegato a una spesa completata
    if (hydrated.fileHash) {
      const fileHashMatch = await this.findExpenseByFileHash(
        hydrated.fileHash,
        hydrated.sessionId,
        hydrated.ocrProcessId,
        hydrated.excludeExpenseId
      );
      if (fileHashMatch) {
        return {
          matchLevel: 'EXACT_DUPLICATE',
          confidenceScore: 100,
          matchedExpenseId: fileHashMatch.id,
          matchedExpense: fileHashMatch,
          reasons: [
            `Stesso file (fileHash identico) già contabilizzato nella spesa ${fileHashMatch.id} (${fileHashMatch.description} - ${fileHashMatch.amount.toFixed(2)} €)`,
          ],
          signals: {
            ...defaultSignals,
            exactFileHash: true,
            sameDate: fileHashMatch.expenseDate === hydrated.expenseDate,
            sameTotal: Math.abs(fileHashMatch.amount - (hydrated.total ?? 0)) <= 0.02,
          },
        };
      }
    }

    // Se mancano data e totale minimi, non possiamo effettuare un confronto semantico affidabile
    if (!hydrated.expenseDate || hydrated.total === null || hydrated.total === undefined || hydrated.total <= 0) {
      return {
        matchLevel: 'NO_DUPLICATE',
        confidenceScore: 0,
        reasons: ['Dati insufficienti per il rilevamento duplicati (data o totale mancanti)'],
        signals: defaultSignals,
      };
    }

    // 3. Recupera tutte le spese registrate nel database (escludendo quella associata al processo corrente e excludeExpenseId)
    const allExpenses = await db.expenses.toArray();
    const candidateExpenses = allExpenses.filter((e) => {
      // Regola: se candidateExpense.id === excludeExpenseId => ignorare il candidato
      if (hydrated.excludeExpenseId && e.id === hydrated.excludeExpenseId) return false;
      const m = e.metadata as Record<string, any> | undefined;
      // Escludi la spesa già creata dalla sessione / processo OCR corrente (gestita dall'idempotenza base)
      if (hydrated.ocrProcessId && m?.ocrProcessId === hydrated.ocrProcessId) return false;
      if (hydrated.sessionId && m?.documentSessionId === hydrated.sessionId) return false;
      return true;
    });

    if (candidateExpenses.length === 0) {
      return {
        matchLevel: 'NO_DUPLICATE',
        confidenceScore: 0,
        reasons: ['Nessuna spesa storica presente nel database'],
        signals: defaultSignals,
      };
    }

    // 4. Valutazione di ciascuna spesa candidata
    let bestResult: DuplicateDetectionResult = {
      matchLevel: 'NO_DUPLICATE',
      confidenceScore: 0,
      reasons: [],
      signals: defaultSignals,
    };

    for (const candidate of candidateExpenses) {
      const evalResult = await this.evaluateCandidate(hydrated, candidate);
      if (evalResult.confidenceScore > bestResult.confidenceScore) {
        bestResult = evalResult;
      }
      // Se troviamo un EXACT match con confidenza massima, possiamo fermarci subito
      if (bestResult.matchLevel === 'EXACT_DUPLICATE' && bestResult.confidenceScore >= 98) {
        break;
      }
    }

    return bestResult;
  }

  /**
   * Cerca una spesa già registrata a partire dal fileHash dell'allegato o dei segmenti di pagina
   */
  public static async findExpenseByFileHash(
    fileHash: string,
    excludeSessionId?: string | null,
    excludeOcrProcessId?: string | null,
    excludeExpenseId?: string | null
  ): Promise<Expense | null> {
    if (!fileHash) return null;

    // 1. Cerca nei segmenti di pagina collegati a sessioni completate o con spesa
    const segments = await db.documentPageSegments.where('fileHash').equals(fileHash).toArray();
    for (const seg of segments) {
      if (excludeSessionId && seg.sessionId === excludeSessionId) continue;
      const sess = await db.documentSessions.get(seg.sessionId);
      if (sess && sess.expenseId) {
        if (excludeExpenseId && sess.expenseId === excludeExpenseId) continue;
        const exp = await db.expenses.get(sess.expenseId);
        if (exp) {
          if (excludeExpenseId && exp.id === excludeExpenseId) continue;
          const m = exp.metadata as Record<string, any> | undefined;
          if (excludeOcrProcessId && m?.ocrProcessId === excludeOcrProcessId) continue;
          return exp;
        }
      }
    }

    // 2. Cerca negli allegati diretti
    const attachments = await db.attachments.where('fileHash').equals(fileHash).toArray();
    for (const att of attachments) {
      if (att.expenseId) {
        if (excludeExpenseId && att.expenseId === excludeExpenseId) continue;
        const exp = await db.expenses.get(att.expenseId);
        if (exp) {
          if (excludeExpenseId && exp.id === excludeExpenseId) continue;
          const m = exp.metadata as Record<string, any> | undefined;
          if (excludeOcrProcessId && m?.ocrProcessId === excludeOcrProcessId) continue;
          return exp;
        }
      }
      if (att.entityType === 'expense' && att.entityId) {
        if (excludeExpenseId && att.entityId === excludeExpenseId) continue;
        const exp = await db.expenses.get(att.entityId);
        if (exp) {
          if (excludeExpenseId && exp.id === excludeExpenseId) continue;
          const m = exp.metadata as Record<string, any> | undefined;
          if (excludeOcrProcessId && m?.ocrProcessId === excludeOcrProcessId) continue;
          return exp;
        }
      }
      if (att.entityId) {
        // Allegato collegato a una DocumentSession (es. entityType 'unlinked' o 'documentSession')
        const sess = await db.documentSessions.get(att.entityId);
        if (sess && sess.expenseId) {
          if (excludeSessionId && sess.id === excludeSessionId) continue;
          if (excludeExpenseId && sess.expenseId === excludeExpenseId) continue;
          const exp = await db.expenses.get(sess.expenseId);
          if (exp) {
            if (excludeExpenseId && exp.id === excludeExpenseId) continue;
            const m = exp.metadata as Record<string, any> | undefined;
            if (excludeOcrProcessId && m?.ocrProcessId === excludeOcrProcessId) continue;
            return exp;
          }
        }
        // Allegato collegato a un OCRProcess
        const proc = await db.ocrProcesses.get(att.entityId);
        if (proc) {
          if (excludeOcrProcessId && proc.id === excludeOcrProcessId) continue;
          if (proc.expenseId) {
            if (excludeExpenseId && proc.expenseId === excludeExpenseId) continue;
            const exp = await db.expenses.get(proc.expenseId);
            if (exp) {
              if (excludeExpenseId && exp.id === excludeExpenseId) continue;
              return exp;
            }
          }
          const procMeta = proc.metadata as Record<string, any> | undefined;
          if (procMeta?.expenseId) {
            if (excludeExpenseId && procMeta.expenseId === excludeExpenseId) continue;
            const exp = await db.expenses.get(procMeta.expenseId);
            if (exp) {
              if (excludeExpenseId && exp.id === excludeExpenseId) continue;
              return exp;
            }
          }
          if (procMeta?.sessionId) {
            const sessFromProc = await db.documentSessions.get(procMeta.sessionId);
            if (sessFromProc?.expenseId) {
              if (excludeSessionId && sessFromProc.id === excludeSessionId) continue;
              if (excludeExpenseId && sessFromProc.expenseId === excludeExpenseId) continue;
              const exp = await db.expenses.get(sessFromProc.expenseId);
              if (exp) {
                if (excludeExpenseId && exp.id === excludeExpenseId) continue;
                return exp;
              }
            }
          }
        }
      }
    }

    // 3. Cerca nelle sessioni con metadata originalPdfAttachmentId o originalFileSha256
    const sessions = await db.documentSessions.toArray();
    for (const sess of sessions) {
      if (excludeSessionId && sess.id === excludeSessionId) continue;
      if (!sess.expenseId) continue;
      if (excludeExpenseId && sess.expenseId === excludeExpenseId) continue;
      const m = sess.metadata as Record<string, any> | undefined;
      if (m?.originalFileSha256 === fileHash || m?.fileHash === fileHash) {
        const exp = await db.expenses.get(sess.expenseId);
        if (exp) {
          if (excludeExpenseId && exp.id === excludeExpenseId) continue;
          return exp;
        }
      }
    }

    // 4. Cerca nei metadati delle spese
    const allExpenses = await db.expenses.toArray();
    for (const exp of allExpenses) {
      if (excludeExpenseId && exp.id === excludeExpenseId) continue;
      const m = exp.metadata as Record<string, any> | undefined;
      if (excludeOcrProcessId && m?.ocrProcessId === excludeOcrProcessId) continue;
      if (
        m?.fileHash === fileHash ||
        m?.originalFileSha256 === fileHash ||
        m?.attachmentFileHash === fileHash ||
        m?.originalFileHash === fileHash
      ) {
        return exp;
      }
    }

    return null;
  }

  /**
   * Preflight deterministico su fileHash PRIMA di qualsiasi creazione di Attachment o esecuzione OCR.
   * Evita ConstraintError sul DB Dexie (attachments.&fileHash UNIQUE).
   */
  public static async preflightFileHash(
    fileHash: string,
    currentSessionId?: string | null
  ): Promise<FileHashPreflightResult> {
    if (!fileHash) {
      return { action: 'PROCEED' };
    }

    // A. Hash presente in sessione realmente ACTIVE
    const activeSession = await documentSessionRepository.findActiveSessionByFileHash(
      fileHash,
      currentSessionId || undefined
    );
    if (activeSession) {
      return {
        action: 'ACTIVE_SESSION',
        activeSession,
        userMessage: `Documento già in lavorazione nella sessione attiva (${activeSession.id}). Impossibile creare una sessione duplicata.`,
        reason: `ACTIVE_SESSION_${activeSession.id}`,
      };
    }

    // B. Hash presente in sessione COMPLETED / già contabilizzata con Expense
    const matchedExpense = await this.findExpenseByFileHash(fileHash, currentSessionId);
    if (matchedExpense) {
      const amountFormatted =
        typeof matchedExpense.amount === 'number'
          ? `€${matchedExpense.amount.toFixed(2).replace('.', ',')}`
          : '';
      const dateFormatted = matchedExpense.expenseDate
        ? `${matchedExpense.expenseDate.split('-').reverse().join('/')}`
        : '';
      let details = '';
      if (amountFormatted && dateFormatted) {
        details = ` Spesa esistente: ${amountFormatted} del ${dateFormatted}${
          matchedExpense.description ? ` (${matchedExpense.description})` : ''
        }.`;
      } else if (amountFormatted) {
        details = ` Spesa esistente: ${amountFormatted}${
          matchedExpense.description ? ` (${matchedExpense.description})` : ''
        }.`;
      }

      return {
        action: 'EXACT_DUPLICATE',
        matchedExpenseId: matchedExpense.id,
        matchedExpense,
        userMessage: `Questo documento risulta già registrato.${details}`,
        reason: 'EXACT_FILE_HASH',
      };
    }

    // C. Hash presente in record Attachment orphan/non contabilizzato
    const existingAtt = await attachmentRepository.getByFileHash(fileHash);
    if (existingAtt) {
      return {
        action: 'REUSE_ORPHAN_ATTACHMENT',
        existingAttachment: existingAtt,
        reason: 'ORPHAN_ATTACHMENT_REUSED',
      };
    }

    // D. File nuovo
    return {
      action: 'PROCEED',
    };
  }

  /**
   * Idrata i campi mancanti caricando le entità da Dexie
   */
  private static async hydrateInput(input: DuplicateDetectionInput): Promise<DuplicateDetectionInput> {
    const result: DuplicateDetectionInput = { ...input };

    let proc: OCRProcess | undefined;
    if (result.ocrProcessId) {
      proc = await db.ocrProcesses.get(result.ocrProcessId);
    }

    let sess: DocumentSession | undefined;
    if (result.sessionId) {
      sess = await db.documentSessions.get(result.sessionId);
    } else if (proc) {
      const allSessions = await db.documentSessions.toArray();
      sess = allSessions.find((s) => s.ocrProcessId === proc!.id);
      if (sess) result.sessionId = sess.id;
    }

    if (proc) {
      if (!result.supplierName && proc.detectedSupplier) {
        result.supplierName = proc.detectedSupplier;
      }
      if (!result.expenseDate && proc.detectedDate) {
        result.expenseDate = proc.detectedDate;
      }
      if ((result.total === null || result.total === undefined) && proc.detectedTotal !== null && proc.detectedTotal !== undefined) {
        result.total = proc.detectedTotal;
      }
      if (!result.rawText && proc.rawText) {
        result.rawText = proc.rawText;
      }
      const meta = proc.metadata as Record<string, any> | undefined;
      if (!result.time && meta?.detectedTime) {
        result.time = meta.detectedTime;
      }
      if (!result.taxIdentifier && meta?.detectedTaxIdentifier) {
        result.taxIdentifier = meta.detectedTaxIdentifier;
      }
    }

    // Carica le righe scontrino se non fornite
    if ((!result.lines || result.lines.length === 0) && result.ocrProcessId) {
      const ocrLines = await db.ocrReceiptLines.where('ocrProcessId').equals(result.ocrProcessId).toArray();
      if (ocrLines.length > 0) {
        result.lines = ocrLines.map((l) => ({
          description: l.description,
          originalText: l.originalText,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        }));
      }
    }

    // Carica il fileHash se non fornito
    if (!result.fileHash && result.sessionId) {
      const segments = await db.documentPageSegments.where('sessionId').equals(result.sessionId).toArray();
      if (segments.length > 0 && segments[0].fileHash) {
        result.fileHash = segments[0].fileHash;
      }
    }
    if (!result.fileHash && proc?.attachmentId) {
      const att = await db.attachments.get(proc.attachmentId);
      if (att?.fileHash) {
        result.fileHash = att.fileHash;
      }
    }

    return result;
  }

  /**
   * Valuta un singolo candidato Expense rispetto all'input
   */
  private static async evaluateCandidate(
    input: DuplicateDetectionInput,
    candidate: Expense
  ): Promise<DuplicateDetectionResult> {
    const incomingTotal = input.total ?? 0;
    const candidateTotal = candidate.amount;
    const totalDiff = Math.abs(incomingTotal - candidateTotal);
    const sameTotal = totalDiff <= 0.02;

    const dateDiffDays = this.computeDateDifferenceDays(input.expenseDate, candidate.expenseDate);
    const sameDate = dateDiffDays === 0;

    // Se date o totali sono chiaramente incompatibili, escludi subito
    if (!sameDate || !sameTotal) {
      return {
        matchLevel: 'NO_DUPLICATE',
        confidenceScore: 0,
        matchedExpenseId: candidate.id,
        matchedExpense: candidate,
        reasons: [
          !sameDate ? `Data differente (${input.expenseDate} vs ${candidate.expenseDate})` : '',
          !sameTotal ? `Totale differente (${incomingTotal.toFixed(2)} € vs ${candidateTotal.toFixed(2)} €)` : '',
        ].filter(Boolean),
        signals: {
          exactFileHash: false,
          sameSupplier: false,
          supplierSimilarity: 0,
          sameDate,
          dateDifferenceDays: dateDiffDays,
          sameTime: null,
          timeDifferenceMinutes: null,
          sameTotal,
          totalDifference: totalDiff,
          lineItemsSimilarity: null,
          sharedLineCount: 0,
          totalIncomingLines: input.lines?.length || 0,
          totalCandidateLines: 0,
        },
      };
    }

    // Fornitore: confronto normalizzato e con alias
    let candidateSupplierName = candidate.description;
    let candidateSupplierAliases: string[] = [];
    if (candidate.supplierId) {
      const sup = await supplierRepository.getById(candidate.supplierId);
      if (sup) {
        candidateSupplierName = sup.name;
        candidateSupplierAliases = sup.aliases || [];
      }
    }

    const supplierSimilarity = this.computeSupplierSimilarity(
      input.supplierName || '',
      candidateSupplierName,
      candidateSupplierAliases
    );
    const sameSupplier = supplierSimilarity >= 70 || Boolean(input.supplierId && candidate.supplierId && input.supplierId === candidate.supplierId);

    // Se il fornitore è completamente diverso (es. "FARMACIA" vs "CONAD"), non è duplicato
    if (supplierSimilarity < 45 && !sameSupplier) {
      return {
        matchLevel: 'NO_DUPLICATE',
        confidenceScore: 15,
        matchedExpenseId: candidate.id,
        matchedExpense: candidate,
        reasons: [`Fornitore incompatibile ("${input.supplierName}" vs "${candidateSupplierName}")`],
        signals: {
          exactFileHash: false,
          sameSupplier: false,
          supplierSimilarity,
          sameDate: true,
          dateDifferenceDays: 0,
          sameTime: null,
          timeDifferenceMinutes: null,
          sameTotal: true,
          totalDifference: totalDiff,
          lineItemsSimilarity: null,
          sharedLineCount: 0,
          totalIncomingLines: input.lines?.length || 0,
          totalCandidateLines: 0,
        },
      };
    }

    // Ora: confronto temporale se disponibile
    const incomingTimeMins = this.parseTimeToMinutes(input.time);
    const candidateMeta = candidate.metadata as Record<string, any> | undefined;
    const candidateTimeStr = candidateMeta?.detectedTime || candidateMeta?.time || null;
    const candidateTimeMins = this.parseTimeToMinutes(candidateTimeStr);

    let sameTime: boolean | null = null;
    let timeDiffMins: number | null = null;
    if (incomingTimeMins !== null && candidateTimeMins !== null) {
      timeDiffMins = Math.abs(incomingTimeMins - candidateTimeMins);
      sameTime = timeDiffMins <= 2;
    }

    // Righe Prodotto: confronto fingerprint
    const candidateItems = await db.expenseItems.where('expenseId').equals(candidate.id).toArray();
    const candidateLines = candidateItems.map((ci) => ({
      description: ci.description,
      quantity: ci.quantity,
      unitPrice: ci.unitPrice,
      lineTotal: ci.total,
    }));

    const lineComp = this.compareLineItems(input.lines || [], candidateLines);
    const lineItemsSimilarity = lineComp.similarity;
    const sharedLineCount = lineComp.sharedLines;
    const incomingCount = input.lines?.length || 0;
    const candCount = candidateLines.length;

    const reasons: string[] = [];
    let confidenceScore = 0;
    let matchLevel: DuplicateMatchLevel = 'NO_DUPLICATE';

    // =========================================================================
    // REGOLE DI CLASSIFICAZIONE DETERMINISTICHE
    // =========================================================================

    // Regola 1: Forte identità delle righe prodotto (Hard Multi-Signal Match)
    // Stesso fornitore + stessa data + stesso totale + righe altamente coincidenti (>= 75%)
    if (sameDate && sameTotal && sameSupplier && lineItemsSimilarity !== null && lineItemsSimilarity >= 0.75 && incomingCount >= 1 && candCount >= 1) {
      matchLevel = 'EXACT_DUPLICATE';
      confidenceScore = 97;
      reasons.push(
        `Fornitore ("${candidateSupplierName}"), data (${candidate.expenseDate}), totale (${candidateTotal.toFixed(2)} €) e righe prodotto (${sharedLineCount}/${Math.max(incomingCount, candCount)} articoli coincidenti) identici alla spesa ${candidate.id}`
      );
      if (sameTime === true) {
        confidenceScore = 99;
        reasons.push(`Stessa ora di emissione (${input.time})`);
      }
    }
    // Regola 2: Prodotti differenti accertati (es. due acquisti reali distinti stesso giorno/totale/negozio)
    else if (sameDate && sameTotal && sameSupplier && lineItemsSimilarity !== null && lineItemsSimilarity < 0.25 && incomingCount >= 2 && candCount >= 2) {
      // Se gli orari sono anche significativamente diversi (es. 08:30 vs 17:30)
      if (timeDiffMins !== null && timeDiffMins >= 60) {
        matchLevel = 'NO_DUPLICATE';
        confidenceScore = 20;
        reasons.push(
          `Stesso fornitore e importo ma orario differente (${input.time} vs ${candidateTimeStr}) e prodotti completamente distinti (due acquisti separati)`
        );
      } else {
        // Stesso importo e negozio ma prodotti diversi, ora assente o vicina: PROBABLE con confidenza ridotta
        matchLevel = 'PROBABLE_DUPLICATE';
        confidenceScore = 65;
        reasons.push(
          `Stesso fornitore e totale in data ${candidate.expenseDate}, ma i prodotti registrati sono differenti (possibile acquisto separato)`
        );
      }
    }
    // Regola 3: Stesso fornitore + data + totale, ora coincidente ma righe non disponibili
    else if (sameDate && sameTotal && sameSupplier && sameTime === true && (incomingCount === 0 || candCount === 0)) {
      matchLevel = 'PROBABLE_DUPLICATE';
      confidenceScore = 88;
      reasons.push(
        `Stesso fornitore ("${candidateSupplierName}"), data (${candidate.expenseDate}), totale (${candidateTotal.toFixed(2)} €) e stessa ora (${input.time}) della spesa ${candidate.id}`
      );
    }
    // Regola 4: Stesso fornitore + data + totale, ora assente, righe non disponibili o parziali
    else if (sameDate && sameTotal && sameSupplier) {
      matchLevel = 'PROBABLE_DUPLICATE';
      confidenceScore = 80;
      reasons.push(
        `Stesso fornitore ("${candidateSupplierName}"), data (${candidate.expenseDate}) e totale (${candidateTotal.toFixed(2)} €) della spesa ${candidate.id}`
      );
      if (lineItemsSimilarity !== null && lineItemsSimilarity >= 0.4) {
        confidenceScore = 85;
        reasons.push(`Righe parzialmente coincidenti (${sharedLineCount} articoli)`);
      }
    }
    // Regola 5: Fornitore con variazione OCR (es. 70-85% similarity) + stessa data + stesso totale + righe simili
    else if (sameDate && sameTotal && supplierSimilarity >= 60 && lineItemsSimilarity !== null && lineItemsSimilarity >= 0.5) {
      matchLevel = 'PROBABLE_DUPLICATE';
      confidenceScore = 78;
      reasons.push(
        `Fornitore simile ("${input.supplierName}" ≈ "${candidateSupplierName}"), stessa data e totale con righe coincidenti rispetto alla spesa ${candidate.id}`
      );
    }

    // Se l'ora è esplicitamente differente di molte ore (es. mattina vs sera), riduce la confidenza di duplicazione
    if (timeDiffMins !== null && timeDiffMins >= 120 && matchLevel === 'PROBABLE_DUPLICATE' && (lineItemsSimilarity === null || lineItemsSimilarity < 0.5)) {
      confidenceScore = Math.max(30, confidenceScore - 35);
      if (confidenceScore < 50) {
        matchLevel = 'NO_DUPLICATE';
        reasons.push(`Orari notevolmente distanti (${input.time} vs ${candidateTimeStr}): probabile spesa distinta`);
      }
    }

    return {
      matchLevel,
      confidenceScore,
      matchedExpenseId: candidate.id,
      matchedExpense: candidate,
      reasons,
      signals: {
        exactFileHash: false,
        sameSupplier,
        supplierSimilarity,
        sameDate,
        dateDifferenceDays: 0,
        sameTime,
        timeDifferenceMinutes: timeDiffMins,
        sameTotal,
        totalDifference: totalDiff,
        lineItemsSimilarity,
        sharedLineCount,
        totalIncomingLines: incomingCount,
        totalCandidateLines: candCount,
      },
    };
  }

  /**
   * Calcola la similarità tra il nome fornitore rilevato e il fornitore candidato/alias
   */
  private static computeSupplierSimilarity(
    name1: string,
    candidateName: string,
    candidateAliases: string[]
  ): number {
    const n1 = ProductFingerprintService.normalizeText(name1);
    const n2 = ProductFingerprintService.normalizeText(candidateName);
    if (!n1 || !n2) return 0;
    if (n1 === n2) return 100;
    if (n1.includes(n2) || n2.includes(n1)) return 92;

    // Controlla gli alias del fornitore candidato
    for (const alias of candidateAliases) {
      const nAlias = ProductFingerprintService.normalizeText(alias);
      if (nAlias === n1) return 100;
      if (nAlias.includes(n1) || n1.includes(nAlias)) return 92;
    }

    // Calcolo Jaccard token overlap
    const tokens1 = new Set(n1.split(' ').filter((t) => t.length > 1));
    const tokens2 = new Set(n2.split(' ').filter((t) => t.length > 1));
    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    let inter = 0;
    for (const t of tokens1) {
      if (tokens2.has(t)) inter++;
    }
    const union = new Set([...tokens1, ...tokens2]).size;
    return Math.round((inter / union) * 100);
  }

  /**
   * Calcola la similarità tra insiemi di righe prodotto
   */
  private static compareLineItems(
    incoming: Array<{ description?: string; originalText?: string; lineTotal?: number; unitPrice?: number }>,
    candidate: Array<{ description?: string; lineTotal?: number; unitPrice?: number }>
  ): { similarity: number | null; sharedLines: number } {
    if (incoming.length === 0 || candidate.length === 0) {
      return { similarity: null, sharedLines: 0 };
    }

    const normIncoming = incoming.map((l) => ({
      desc: ProductFingerprintService.normalizeText(l.description || l.originalText || ''),
      price: l.lineTotal !== undefined && l.lineTotal !== null ? l.lineTotal : l.unitPrice ?? null,
    }));

    const normCandidate = candidate.map((c) => ({
      desc: ProductFingerprintService.normalizeText(c.description || ''),
      price: c.lineTotal !== undefined && c.lineTotal !== null ? c.lineTotal : null,
    }));

    let totalScore = 0;
    let sharedLines = 0;
    const usedCandidateIndices = new Set<number>();

    for (const inc of normIncoming) {
      let bestScore = 0;
      let bestIdx = -1;

      for (let j = 0; j < normCandidate.length; j++) {
        if (usedCandidateIndices.has(j)) continue;
        const cand = normCandidate[j];

        const score = this.compareTwoLines(inc, cand);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = j;
        }
      }

      if (bestIdx !== -1 && bestScore >= 0.5) {
        usedCandidateIndices.add(bestIdx);
        totalScore += bestScore;
        sharedLines++;
      }
    }

    const maxLen = Math.max(normIncoming.length, normCandidate.length);
    const similarity = maxLen > 0 ? Number((totalScore / maxLen).toFixed(2)) : 0;
    return { similarity, sharedLines };
  }

  /**
   * Confronta due singole righe per descrizione e prezzo
   */
  private static compareTwoLines(
    l1: { desc: string; price: number | null },
    l2: { desc: string; price: number | null }
  ): number {
    const priceMatches = l1.price !== null && l2.price !== null && Math.abs(l1.price - l2.price) <= 0.02;
    const priceDifferent = l1.price !== null && l2.price !== null && Math.abs(l1.price - l2.price) > 0.05;

    // Token overlap sulle descrizioni
    const t1 = new Set(l1.desc.split(' ').filter((t) => t.length > 1));
    const t2 = new Set(l2.desc.split(' ').filter((t) => t.length > 1));

    let tokenOverlap = 0;
    if (t1.size > 0 && t2.size > 0) {
      let inter = 0;
      for (const t of t1) {
        if (t2.has(t)) inter++;
      }
      tokenOverlap = inter / Math.max(t1.size, t2.size);
    } else if (l1.desc && l2.desc && l1.desc === l2.desc) {
      tokenOverlap = 1.0;
    }

    if (priceMatches && tokenOverlap >= 0.5) return 1.0;
    if (priceMatches && (tokenOverlap > 0 || l1.desc === '' || l2.desc === '')) return 0.85;
    if (priceMatches && tokenOverlap === 0) return 0.4;
    if (!priceMatches && !priceDifferent && tokenOverlap >= 0.8) return 0.65;
    if (tokenOverlap >= 0.6 && !priceDifferent) return 0.5;
    return 0;
  }

  /**
   * Calcola la differenza in giorni tra due date ISO YYYY-MM-DD
   */
  private static computeDateDifferenceDays(d1?: string | null, d2?: string | null): number | null {
    if (!d1 || !d2) return null;
    const t1 = new Date(d1).getTime();
    const t2 = new Date(d2).getTime();
    if (isNaN(t1) || isNaN(t2)) return null;
    return Math.round(Math.abs(t1 - t2) / (1000 * 60 * 60 * 24));
  }

  /**
   * Converte orario stringa (HH:mm o HH:mm:ss) in minuti totali dalla mezzanotte
   */
  private static parseTimeToMinutes(timeStr?: string | null): number | null {
    if (!timeStr) return null;
    const clean = timeStr.trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }
}
