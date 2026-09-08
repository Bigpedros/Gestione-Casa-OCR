import { createWorker, Worker } from 'tesseract.js';
import {
  ocrProcessRepository,
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  expenseRepository,
} from '../repositories';
import { OCRProcess, OCRProgress, OCRProgressStatus } from '../types';
import {
  createReceiptImageVariants,
  evaluateReceiptOcrQuality,
  ReceiptVariantName,
  OcrQualityEvaluation,
} from '../utils/imagePreprocessing';
import {
  runRegionalSecondPassShadow,
} from './ocrParser/regional';

/**
 * RC-05F-R1: Kill Switch immutabile e non esposto a runtime.
 */
const SECOND_PASS_SHADOW_ENABLED: boolean = true;

interface ActiveProcessEntry {
  sessionId: string;
  ocrProcessId: string;
  worker: Worker | null;
  cancelled: boolean;
  progress: OCRProgress;
  onProgress?: (progress: OCRProgress) => void;
}

export interface TopologicalOverlapMatch {
  overlapInNextCount: number;
  headOffset: number;
  matchedLinesCount: number;
  score: number;
  avgSim: number;
  matchedStartInPrev: number;
}

export type OCRRecognitionFunction = (
  imageSource: string | Blob | File,
  pageIndex: number,
  totalPages: number,
  onProgressPercentage: (percentage: number) => void
) => Promise<{ text: string; confidence: number }>;

class OCRService {
  private activeProcesses = new Map<string, ActiveProcessEntry>();
  private activePromises = new Map<string, Promise<OCRProcess>>();
  private mockEngine: OCRRecognitionFunction | null = null;

  /**
   * Consente di iniettare un motore OCR di test (es. per Vitest/JSDOM dove WASM/Canvas non sono disponibili).
   */
  public setMockEngine(fn: OCRRecognitionFunction | null) {
    this.mockEngine = fn;
  }

  /**
   * Riconosce il testo di una DocumentSession in stato ready o draft.
   */
  public async recognize(
    sessionId: string,
    onProgress?: (progress: OCRProgress) => void
  ): Promise<OCRProcess> {
    if (this.activePromises.has(sessionId)) {
      return this.activePromises.get(sessionId)!;
    }

    const taskPromise = this.executeRecognize(sessionId, onProgress);
    this.activePromises.set(sessionId, taskPromise);

    try {
      return await taskPromise;
    } finally {
      this.activePromises.delete(sessionId);
    }
  }

  private async executeRecognize(
    sessionId: string,
    onProgress?: (progress: OCRProgress) => void
  ): Promise<OCRProcess> {
    // 1. Carica la DocumentSession
    const session = await documentSessionRepository.getById(sessionId);
    if (!session) {
      throw new Error(`Sessione documentale ${sessionId} non trovata`);
    }

    // 2. Recupera i segmenti ordinati per sequenceIndex
    const segments = await documentPageSegmentRepository.getBySessionId(sessionId);

    // Gestione documento vuoto (Requisito 12)
    if (!segments || segments.length === 0) {
      await documentSessionRepository.update(sessionId, { status: 'failed' });
      let ocrProc: OCRProcess;
      if (session.ocrProcessId) {
        ocrProc = await ocrProcessRepository.update(session.ocrProcessId, {
          status: 'failed',
          errorMessage: 'Documento vuoto: nessuna pagina o immagine trovata',
        });
      } else {
        ocrProc = await ocrProcessRepository.create({
          attachmentId: 'none',
          status: 'failed',
          confirmationRequired: true,
          confirmedByUser: false,
          errorMessage: 'Documento vuoto: nessuna pagina o immagine trovata',
        });
        await documentSessionRepository.update(sessionId, { ocrProcessId: ocrProc.id });
      }
      throw new Error('Documento vuoto: nessuna pagina o immagine trovata');
    }

    // 3. Verifica o crea il record OCRProcess associato
    let ocrProcess: OCRProcess;
    if (session.ocrProcessId) {
      const existing = await ocrProcessRepository.getById(session.ocrProcessId);
      if (existing) {
        ocrProcess = await ocrProcessRepository.update(existing.id, {
          status: 'processing',
          errorMessage: null,
        });
      } else {
        ocrProcess = await ocrProcessRepository.create({
          attachmentId: segments[0].attachmentId,
          status: 'processing',
          confirmationRequired: true,
          confirmedByUser: false,
        });
      }
    } else {
      ocrProcess = await ocrProcessRepository.create({
        attachmentId: segments[0].attachmentId,
        status: 'processing',
        confirmationRequired: true,
        confirmedByUser: false,
      });
    }

    // Aggiorna la sessione in stato processing e associa ocrProcessId
    await documentSessionRepository.update(sessionId, {
      status: 'processing',
      ocrProcessId: ocrProcess.id,
    });

    // 4. Inizializza tracciamento avanzamento
    const totalPages = segments.length;
    const initialProgress: OCRProgress = {
      sessionId,
      ocrProcessId: ocrProcess.id,
      status: 'loading_model',
      currentPage: 0,
      totalPages,
      progressPercentage: 0,
      statusText: 'Inizializzazione motore OCR locale in corso...',
    };

    const processEntry: ActiveProcessEntry = {
      sessionId,
      ocrProcessId: ocrProcess.id,
      worker: null,
      cancelled: false,
      progress: initialProgress,
      onProgress,
    };

    this.activeProcesses.set(sessionId, processEntry);
    this.activeProcesses.set(ocrProcess.id, processEntry);

    this.emitProgress(processEntry, 'loading_model', 0, 0, 'Inizializzazione motore OCR locale...');

    let worker: Worker | null = null;
    let workerInitError: Error | null = null;
    const pageResults: Array<{
      text: string;
      confidence: number;
      sequenceIndex: number;
      selectedVariant?: ReceiptVariantName;
      variantScores?: Array<{
        variant: ReceiptVariantName;
        label: string;
        confidence: number;
        overallScore: number;
        reasons: string[];
        snippet: string;
      }>;
    }> = [];

    try {
      // Se non c'è un mockEngine, crea il Worker Tesseract locale
      if (!this.mockEngine) {
        try {
          worker = await createWorker('ita', 1, {
            logger: (m) => {
              const active = this.activeProcesses.get(sessionId);
              if (active && !active.cancelled && m.status === 'recognizing text') {
                const pageProgress = Math.round((m.progress || 0) * 100);
                const overallPct = Math.round(
                  ((active.progress.currentPage - 1) / totalPages) * 100 + pageProgress / totalPages
                );
                this.emitProgress(
                  active,
                  'processing_page',
                  active.progress.currentPage,
                  Math.min(99, Math.max(0, overallPct)),
                  `Riconoscimento testo pagina ${active.progress.currentPage} di ${totalPages} (${pageProgress}%)`
                );
              }
            },
          });

          // Configurazione parametri Tesseract per scontrini e ricevute POS (colonna singola, conservazione spazi)
          try {
            await worker.setParameters({
              preserve_interword_spaces: '1',
              user_defined_dpi: '300',
              tessedit_pageseg_mode: '4' as any,
            });
          } catch (paramErr) {
            console.warn('[OCRService] worker.setParameters non critico fallito:', paramErr);
          }

          processEntry.worker = worker;
        } catch (workerErr: any) {
          console.warn('[OCRService] Impossibile creare Tesseract worker:', workerErr);
          workerInitError = new Error(`Inizializzazione motore OCR fallita: ${workerErr?.message || 'Worker Tesseract non disponibile'}`);
        }
      }

      let primaryImageSource: string | null = null;

      // 5. Riconoscimento pagina per pagina in ordine di sequenceIndex
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];

        // Verifica annullamento
        if (processEntry.cancelled) {
          return await this.handleCancellation(processEntry);
        }

        const currentPage = i + 1;
        this.emitProgress(
          processEntry,
          'processing_page',
          currentPage,
          Math.round(((i) / totalPages) * 100),
          `Elaborazione pagina ${currentPage} di ${totalPages}...`
        );

        // Verifica tipo di file / PDF non convertito (Requisito 7 & 12)
        if (seg.originalMimeType === 'application/pdf' && !seg.attachmentId) {
          throw new Error('Formato PDF vettoriale non supportato senza pre-elaborazione pagine');
        }

        const attachment = await attachmentRepository.getById(seg.attachmentId);
        if (!attachment || !attachment.storageKey) {
          throw new Error(`Allegato non trovato per la pagina #${currentPage} (ID: ${seg.attachmentId})`);
        }

        let pageText = '';
        let pageConfidence = 0;
        let pageSelectedVariant: ReceiptVariantName = 'original';
        let pageVariantScores: Array<{
          variant: ReceiptVariantName;
          label: string;
          confidence: number;
          overallScore: number;
          reasons: string[];
          snippet: string;
        }> = [];

        if (this.mockEngine) {
          if (i === 0) {
            primaryImageSource = attachment.storageKey;
          }
          // Utilizza motore mock (per test di unità)
          const mockRes = await this.mockEngine(
            attachment.storageKey,
            i,
            totalPages,
            (pct) => {
              const overall = Math.round((i / totalPages) * 100 + pct / totalPages);
              this.emitProgress(
                processEntry,
                'processing_page',
                currentPage,
                Math.min(99, overall),
                `Riconoscimento mock pagina ${currentPage} (${pct}%)`
              );
            }
          );
          pageText = mockRes.text;
          pageConfidence = mockRes.confidence;
          pageSelectedVariant = 'original';
          pageVariantScores.push({
            variant: 'original',
            label: 'Mock Engine',
            confidence: pageConfidence,
            overallScore: pageConfidence,
            reasons: ['Esecuzione con mockEngine'],
            snippet: pageText.slice(0, 100),
          });
        } else if (worker) {
          // 1. Generazione non-distruttiva delle varianti dell'immagine
          const variants = await createReceiptImageVariants(attachment.storageKey, {
            rotationDegrees: seg.rotationDegrees || 0,
            maxDimension: 2400,
          });

          // Testiamo le varianti generate (prioritizzando la conservazione dell'originale e contrasto dolce)
          interface VariantCandidate {
            name: ReceiptVariantName;
            label: string;
            text: string;
            confidence: number;
            evaluation: OcrQualityEvaluation;
            dataUrl: string;
          }
          const candidates: VariantCandidate[] = [];

          for (let vIdx = 0; vIdx < variants.length; vIdx++) {
            const v = variants[vIdx];
            try {
              const res = await worker.recognize(v.dataUrl);
              const txt = res.data.text || '';
              const conf = Math.round(res.data.confidence || 0);
              const evaluation = evaluateReceiptOcrQuality(txt, conf);

              candidates.push({
                name: v.name,
                label: v.label,
                text: txt,
                confidence: conf,
                evaluation,
                dataUrl: v.dataUrl,
              });

              // Se la prima variante ha già un punteggio eccellente (> 88), confidenza elevata e importo/totale rilevato, possiamo terminare in anticipo
              const hasAmountEvidence = /\b(?:TOTALE|IMPORTO|IMP\.?|EUR|EURO|€)\b/i.test(txt) && /\b\d+[.,]\d{2}\b/.test(txt);
              if (evaluation.overallScore >= 88 && conf >= 75 && hasAmountEvidence) {
                break;
              }
            } catch (vErr) {
              console.warn(`[OCRService] Errore riconoscimento variante ${v.name}:`, vErr);
            }
          }

          if (candidates.length > 0) {
            // Ordiniamo le varianti in base al punteggio complessivo oggettivo
            candidates.sort((a, b) => b.evaluation.overallScore - a.evaluation.overallScore);
            const winner = candidates[0];

            pageText = winner.text;
            pageConfidence = winner.confidence;
            pageSelectedVariant = winner.name;
            if (i === 0) {
              primaryImageSource = winner.dataUrl;
            }

            pageVariantScores = candidates.map((c) => ({
              variant: c.name,
              label: c.label,
              confidence: c.confidence,
              overallScore: c.evaluation.overallScore,
              reasons: c.evaluation.reasons,
              snippet: c.text.slice(0, 120).replace(/\n+/g, ' '),
            }));
          } else {
            // Fallback diretto sull'allegato senza varianti
            const res = await worker.recognize(attachment.storageKey);
            pageText = res.data.text || '';
            pageConfidence = Math.round(res.data.confidence || 0);
            pageSelectedVariant = 'original';
            if (i === 0) {
              primaryImageSource = attachment.storageKey;
            }
          }
        } else {
          throw workerInitError || new Error('Nessun motore OCR disponibile o inizializzato per elaborare l\'immagine');
        }

        pageResults.push({
          text: pageText,
          confidence: pageConfidence,
          sequenceIndex: seg.sequenceIndex,
          selectedVariant: pageSelectedVariant,
          variantScores: pageVariantScores,
        });

        // Aggiorna lo stato del segmento
        await documentPageSegmentRepository.update(seg.id, {
          processingStatus: 'processed',
        });
      }

      // Check annullamento prima del salvataggio finale
      if (processEntry.cancelled) {
        return await this.handleCancellation(processEntry);
      }

      // 6. Concatenazione testo rispettando l'ordine di sequenceIndex (Requisito 6)
      this.emitProgress(
        processEntry,
        'concatenating',
        totalPages,
        99,
        'Concatenazione del testo estratto dalle pagine...'
      );

      pageResults.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      const combinedRawText = this.stitchSegmentTexts(pageResults.map((p) => p.text));

      const avgConfidence =
        pageResults.length > 0
          ? Math.round(pageResults.reduce((acc, p) => acc + p.confidence, 0) / pageResults.length)
          : 0;

      const primarySelectedVariant = pageResults[0]?.selectedVariant || 'original';
      const allVariantScores = pageResults.flatMap((p) => p.variantScores || []);

      // 6.5. Second-Pass Regional OCR — Controlled Shadow Runtime Integration (RC-05F / RC-05F-R1)
      try {
        const shadowEnabled = SECOND_PASS_SHADOW_ENABLED;
        await runRegionalSecondPassShadow({
          worker,
          imageSource: primaryImageSource,
          combinedRawText,
          overallConfidence: avgConfidence,
          shadowEnabled,
          variantUsed: primarySelectedVariant,
          sourceCount: segments.length,
          restoreParameters: {
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
            tessedit_pageseg_mode: '4',
          },
        });
      } catch (shadowErr) {
        console.warn('[OCRService:SecondPass] Errore non gestito nello shadow runner:', shadowErr);
      }

      // 7. Aggiorna OCRProcess e DocumentSession (Nessuna interpretazione / Nessun Expense creato)
      const now = new Date().toISOString();
      const updatedOcrProcess = await ocrProcessRepository.update(ocrProcess.id, {
        status: 'completed',
        rawText: combinedRawText,
        confidence: avgConfidence,
        processedAt: now,
        errorMessage: null,
        metadata: {
          ...ocrProcess.metadata,
          selectedVariant: primarySelectedVariant,
          variantScores: allVariantScores,
        } as any,
      });

      await documentSessionRepository.update(sessionId, {
        status: 'completed',
        ocrProcessId: ocrProcess.id,
      });

      // Rilascia la memoria del Worker
      if (worker) {
        await worker.terminate();
      }

      // Verifica tassativa: Nessun Expense deve essere stato creato (Requisito 11)
      const allExpenses = await expenseRepository.getAll();
      if (allExpenses.length > 0) {
        console.warn('[OCRService] ATTENZIONE: Il motore OCR non deve creare alcuna spesa.');
      }

      this.emitProgress(
        processEntry,
        'completed',
        totalPages,
        100,
        'Riconoscimento OCR completato con successo'
      );

      this.cleanup(sessionId, ocrProcess.id);
      return updatedOcrProcess;
    } catch (err: any) {
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          // Ignora errori di terminazione worker
        }
      }

      const errorMessage = err?.message || 'Errore imprevisto durante l\'elaborazione OCR';

      await ocrProcessRepository.update(ocrProcess.id, {
        status: 'failed',
        errorMessage,
      });

      await documentSessionRepository.update(sessionId, {
        status: 'failed',
      });

      this.emitProgress(
        processEntry,
        'failed',
        processEntry.progress.currentPage,
        processEntry.progress.progressPercentage,
        errorMessage
      );

      this.cleanup(sessionId, ocrProcess.id);
      throw err;
    }
  }

  /**
   * Annulla l'elaborazione OCR in corso per la sessione o il processo specificato.
   */
  public async cancel(processIdOrSessionId: string): Promise<void> {
    const entry = this.activeProcesses.get(processIdOrSessionId);
    if (!entry) return;

    entry.cancelled = true;

    if (entry.worker) {
      try {
        await entry.worker.terminate();
        entry.worker = null;
      } catch {
        // Ignora errori durante la terminazione del worker
      }
    }

    await this.handleCancellation(entry);
  }

  /**
   * Restituisce lo stato e l'avanzamento corrente dell'elaborazione per la sessione o il processo.
   */
  public getProgress(processIdOrSessionId: string): OCRProgress | null {
    const entry = this.activeProcesses.get(processIdOrSessionId);
    return entry ? { ...entry.progress } : null;
  }

  private async handleCancellation(entry: ActiveProcessEntry): Promise<OCRProcess> {
    const errorMessage = 'Elaborazione annullata dall\'utente';

    const updatedOcrProcess = await ocrProcessRepository.update(entry.ocrProcessId, {
      status: 'failed',
      errorMessage,
    });

    await documentSessionRepository.update(entry.sessionId, {
      status: 'draft',
    });

    this.emitProgress(
      entry,
      'cancelled',
      entry.progress.currentPage,
      entry.progress.progressPercentage,
      errorMessage
    );

    this.cleanup(entry.sessionId, entry.ocrProcessId);
    return updatedOcrProcess;
  }

  private emitProgress(
    entry: ActiveProcessEntry,
    status: OCRProgressStatus,
    currentPage: number,
    progressPercentage: number,
    statusText: string
  ) {
    entry.progress = {
      sessionId: entry.sessionId,
      ocrProcessId: entry.ocrProcessId,
      status,
      currentPage,
      totalPages: entry.progress.totalPages,
      progressPercentage,
      statusText,
    };

    if (entry.onProgress) {
      entry.onProgress({ ...entry.progress });
    }
  }

  private cleanup(sessionId: string, ocrProcessId: string) {
    this.activeProcesses.delete(sessionId);
    this.activeProcesses.delete(ocrProcessId);
  }

  /**
   * Pulisce una riga per la comparazione di deduplicazione topologica
   */
  private cleanLineForStitchCompare(line: string): string {
    return line.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Calcola la similarità OCR-tollerante tra due righe (Jaccard su bigrammi e prefisso comune)
   */
  private computeStitchLineSimilarity(l1: string, l2: string): number {
    const c1 = this.cleanLineForStitchCompare(l1);
    const c2 = this.cleanLineForStitchCompare(l2);
    if (!c1 && !c2) return 1;
    if (!c1 || !c2) return 0;
    if (c1 === c2) return 1;

    let commonPrefix = 0;
    while (commonPrefix < c1.length && commonPrefix < c2.length && c1[commonPrefix] === c2[commonPrefix]) {
      commonPrefix++;
    }
    if (commonPrefix >= 8 && commonPrefix / Math.min(c1.length, c2.length) >= 0.70) {
      return 0.85;
    }

    const bigrams = (s: string) => {
      const bg = new Map<string, number>();
      for (let i = 0; i < s.length - 1; i++) {
        const b = s.slice(i, i + 2);
        bg.set(b, (bg.get(b) || 0) + 1);
      }
      return bg;
    };
    const bg1 = bigrams(c1);
    const bg2 = bigrams(c2);
    let intersection = 0;
    let total1 = 0;
    let total2 = 0;
    for (const count of bg1.values()) total1 += count;
    for (const count of bg2.values()) total2 += count;
    for (const [b, count1] of bg1.entries()) {
      const count2 = bg2.get(b) || 0;
      intersection += Math.min(count1, count2);
    }
    const total = total1 + total2;
    return total === 0 ? 0 : (2 * intersection) / total;
  }

  /**
   * Determina se una riga ha contenuto informativo sufficiente per corroborare un overlap
   * (evita falsi positivi su brevi parole generiche o frammenti isolati).
   */
  private isInformativeStitchLine(line: string): boolean {
    const cleaned = this.cleanLineForStitchCompare(line);
    if (cleaned.length < 6) return false;

    // Token fiscali/generici isolati che non bastano da soli a garantire unicità di giunzione
    const genericTokens = new Set([
      'GRAZIE',
      'ARRIVEDERCI',
      'SCONTRINO',
      'SCONTRINOFISCALE',
      'DOCUMENTOCOMMERCIALE',
      'PAGAMENTO',
      'CONTANTI',
      'BANCOMAT',
      'SUBTOTALE',
      'TOTALE',
      'ARRIVEDERCIERIGRAZIE',
      'BENVENUTI',
      'CLIENTE',
    ]);
    if (genericTokens.has(cleaned)) return false;

    // Se contiene sia lettere che numeri ed è lunga almeno 6 caratteri (es. codice, prezzo o quantità)
    const hasLetters = /[A-Z]/.test(cleaned);
    const hasDigits = /[0-9]/.test(cleaned);
    if (hasLetters && hasDigits && cleaned.length >= 6) return true;

    // Oppure testo descrittivo sufficientemente lungo (>= 10 caratteri)
    return cleaned.length >= 10;
  }

  /**
   * Ricerca l'overlap topologico di giunzione tra due segmenti consecutivi.
   * Utilizza:
   * 1. Finestra di ricerca sulla coda di prevLines (fino a 30 righe);
   * 2. Offset iniziale headOffset (0..3) in nextLines per tollerare artefatti/frammenti di taglio iniziali;
   * 3. Tolleranza limitata al wrap (1 riga prev <-> 2 righe next, 2 righe prev <-> 1 riga next);
   * 4. Corroborazione flessibile: almeno 2 righe informative, avgSim >= 0.75, sequenzialità preservata,
   *    con tolleranza controllata a un singolo mismatch isolato.
   */
  public findTopologicalOverlap(
    prevLines: string[],
    nextLines: string[]
  ): TopologicalOverlapMatch | null {
    if (prevLines.length === 0 || nextLines.length === 0) return null;

    const windowSize = Math.min(prevLines.length, 30);
    const searchWindow = prevLines.slice(prevLines.length - windowSize);
    const maxHeadOffset = Math.min(3, Math.max(0, nextLines.length - 2));

    let bestMatch: TopologicalOverlapMatch | null = null;

    for (let headOffset = 0; headOffset <= maxHeadOffset; headOffset++) {
      const candidateLines = nextLines.slice(headOffset);
      if (candidateLines.length < 2) continue;

      for (let startInWindow = 0; startInWindow < searchWindow.length; startInWindow++) {
        let p = startInWindow;
        let n = 0;
        let matchedItems = 0;
        let informativeMatches = 0;
        let totalMatchedChars = 0;
        let totalSim = 0;
        let mismatches = 0;

        while (p < searchWindow.length && n < candidateLines.length) {
          const pLine = searchWindow[p];
          const nLine = candidateLines[n];

          const cleanP0 = this.cleanLineForStitchCompare(pLine);
          const cleanN0 = this.cleanLineForStitchCompare(nLine);

          // Salta linee puramente grafiche/rumore senza caratteri alfanumerici
          if (cleanP0.length < 2 && p + 1 < searchWindow.length) {
            p++;
            continue;
          }
          if (cleanN0.length < 2 && n + 1 < candidateLines.length) {
            n++;
            continue;
          }

          // 1. Confronto standard 1-to-1
          const sim11 = this.computeStitchLineSimilarity(pLine, nLine);

          // 2. Tolleranza wrap 1 riga p01 <-> 2 righe p02
          // Il wrap è valido solo se la seconda riga da sola non costituisce già un match quasi perfetto (evita di inglobare righe spurie antecedenti)
          const simN1Alone = (n + 1 < candidateLines.length)
            ? this.computeStitchLineSimilarity(pLine, candidateLines[n + 1])
            : 0;
          const sim12 = (n + 1 < candidateLines.length && simN1Alone < 0.85)
            ? this.computeStitchLineSimilarity(pLine, `${nLine} ${candidateLines[n + 1]}`)
            : 0;

          // 3. Tolleranza wrap 2 righe p01 <-> 1 riga p02
          const simP1Alone = (p + 1 < searchWindow.length)
            ? this.computeStitchLineSimilarity(searchWindow[p + 1], nLine)
            : 0;
          const sim21 = (p + 1 < searchWindow.length && simP1Alone < 0.85)
            ? this.computeStitchLineSimilarity(`${pLine} ${searchWindow[p + 1]}`, nLine)
            : 0;

          let chosenSim = 0;
          let stepP = 0;
          let stepN = 0;

          if (sim11 >= 0.70) {
            if (sim12 > sim11 + 0.15 && sim11 < 0.80) {
              chosenSim = sim12;
              stepP = 1;
              stepN = 2;
            } else if (sim21 > sim11 + 0.15 && sim11 < 0.80) {
              chosenSim = sim21;
              stepP = 2;
              stepN = 1;
            } else {
              chosenSim = sim11;
              stepP = 1;
              stepN = 1;
            }
          } else if (sim12 >= 0.70 && sim12 >= sim21) {
            chosenSim = sim12;
            stepP = 1;
            stepN = 2;
          } else if (sim21 >= 0.70) {
            chosenSim = sim21;
            stepP = 2;
            stepN = 1;
          }

          if (chosenSim >= 0.70) {
            matchedItems++;
            totalSim += chosenSim;

            const matchedTextP = stepP === 2 ? `${pLine} ${searchWindow[p + 1]}` : pLine;
            const matchedTextN = stepN === 2 ? `${nLine} ${candidateLines[n + 1]}` : nLine;

            p += stepP;
            n += stepN;

            const cleanP = this.cleanLineForStitchCompare(matchedTextP);
            const cleanN = this.cleanLineForStitchCompare(matchedTextN);
            totalMatchedChars += Math.max(cleanP.length, cleanN.length);

            if (this.isInformativeStitchLine(matchedTextP) || this.isInformativeStitchLine(matchedTextN)) {
              informativeMatches++;
            }
          } else {
            // Mismatch: tolleriamo al massimo 1 piccolo mismatch isolato se abbiamo già almeno 1 match
            if (mismatches === 0 && matchedItems >= 1) {
              let lookaheadSuccess = false;

              // Prova a saltare 1 riga in p (se p01 ha una riga anomala)
              if (p + 1 < searchWindow.length) {
                const simNextP = this.computeStitchLineSimilarity(searchWindow[p + 1], nLine);
                if (simNextP >= 0.75) {
                  p += 1;
                  mismatches++;
                  lookaheadSuccess = true;
                }
              }

              // Se non ha funzionato, prova a saltare 1 riga in n (se p02 ha una riga anomala)
              if (!lookaheadSuccess && n + 1 < candidateLines.length) {
                const simNextN = this.computeStitchLineSimilarity(pLine, candidateLines[n + 1]);
                if (simNextN >= 0.75) {
                  n += 1;
                  mismatches++;
                  lookaheadSuccess = true;
                }
              }

              if (!lookaheadSuccess) {
                break;
              }
            } else {
              break;
            }
          }
        }

        // Criteri di accettazione corroborati e conservativi
        if (
          matchedItems >= 2 &&
          informativeMatches >= 2 &&
          totalMatchedChars >= 18 &&
          n >= 2
        ) {
          const avgSim = totalSim / matchedItems;
          const matchRatio = matchedItems / (matchedItems + mismatches);

          if (avgSim >= 0.75 && matchRatio >= 0.66) {
            const score =
              matchedItems * 15 +
              totalMatchedChars * 0.5 +
              avgSim * 10 -
              mismatches * 5 -
              headOffset * 2;

            if (!bestMatch || score > bestMatch.score) {
              bestMatch = {
                overlapInNextCount: headOffset + n,
                headOffset,
                matchedLinesCount: matchedItems,
                score,
                avgSim,
                matchedStartInPrev: prevLines.length - windowSize + startInWindow,
              };
            }
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Concatena i testi di più segmenti/foto di uno scontrino lungo o multipagina,
   * eseguendo una dedup topologica di giunzione della sovrapposizione tra segmenti consecutivi.
   */
  public stitchSegmentTexts(segmentTexts: string[]): string {
    const validSegments = segmentTexts.map((s) => s.trim()).filter(Boolean);
    if (validSegments.length === 0) return '';
    if (validSegments.length === 1) return validSegments[0];

    let combined = validSegments[0];

    for (let sIdx = 1; sIdx < validSegments.length; sIdx++) {
      const nextSegment = validSegments[sIdx];
      const prevLines = combined.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const nextLines = nextSegment.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

      // Cerca prima overlap topologico di giunzione con tolleranza OCR e sliding window
      const topoMatch = this.findTopologicalOverlap(prevLines, nextLines);

      if (topoMatch && topoMatch.overlapInNextCount > 0) {
        const nonOverlappingNextLines = nextLines.slice(topoMatch.overlapInNextCount);
        if (nonOverlappingNextLines.length > 0) {
          combined = `${combined}\n${nonOverlappingNextLines.join('\n')}`;
        }
      } else {
        // Nessuna sovrapposizione rilevata: concatenazione standard
        combined = `${combined}\n\n${nextSegment}`;
      }
    }

    return combined;
  }
}

export const ocrService = new OCRService();
