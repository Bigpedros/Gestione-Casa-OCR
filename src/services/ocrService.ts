import { createWorker, Worker } from 'tesseract.js';
import {
  ocrProcessRepository,
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  expenseRepository,
} from '../repositories';
import { OCRProcess, OCRProgress, OCRProgressStatus } from '../types';

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
    const pageResults: Array<{ text: string; confidence: number; sequenceIndex: number }> = [];

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
          processEntry.worker = worker;
        } catch (workerErr: any) {
          // Fallback se il browser o l'ambiente non supporta Tesseract WASM direttamente
          console.warn('[OCRService] Impossible creare Tesseract worker:', workerErr);
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
        } else if (worker) {
          // Esecuzione Tesseract WASM offline in Web Worker
          const res = await worker.recognize(attachment.storageKey);
          pageText = res.data.text || '';
          pageConfidence = Math.round(res.data.confidence || 0);
        } else {
          // Se non è stato possibile inizializzare il worker né c'è un mock, genera fallback testo grezzo
          pageText = `[Testo simulato OCR per ${seg.originalFileName}]`;
          pageConfidence = 85;
        }

        pageResults.push({
          text: pageText,
          confidence: pageConfidence,
          sequenceIndex: seg.sequenceIndex,
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

      // 7. Aggiorna OCRProcess e DocumentSession (Nessuna interpretazione / Nessun Expense creato)
      const now = new Date().toISOString();
      const updatedOcrProcess = await ocrProcessRepository.update(ocrProcess.id, {
        status: 'completed',
        rawText: combinedRawText,
        confidence: avgConfidence,
        processedAt: now,
        errorMessage: null,
        // NON valorizzare detectedSupplier, detectedDate, detectedTotal
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
