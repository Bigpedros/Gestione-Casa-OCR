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

interface ActiveProcessEntry {
  sessionId: string;
  ocrProcessId: string;
  worker: Worker | null;
  cancelled: boolean;
  progress: OCRProgress;
  onProgress?: (progress: OCRProgress) => void;
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

          // Configurazione parametri Tesseract per scontrini a colonne
          try {
            await worker.setParameters({
              preserve_interword_spaces: '1',
              user_defined_dpi: '300',
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

              // Se la prima variante ha già un punteggio eccellente (> 85), possiamo terminare in anticipo per velocità
              if (evaluation.overallScore >= 85 && conf >= 70) {
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
      const combinedRawText = pageResults
        .map((p) => p.text.trim())
        .filter(Boolean)
        .join('\n\n');

      const avgConfidence =
        pageResults.length > 0
          ? Math.round(pageResults.reduce((acc, p) => acc + p.confidence, 0) / pageResults.length)
          : 0;

      const primarySelectedVariant = pageResults[0]?.selectedVariant || 'original';
      const allVariantScores = pageResults.flatMap((p) => p.variantScores || []);

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
}

export const ocrService = new OCRService();
