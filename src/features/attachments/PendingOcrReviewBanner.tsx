import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { documentSessionRepository, ocrProcessRepository } from '../../repositories';
import { FileSearch, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { formatDate, formatCurrency } from '../../utils/formatters';
import type { DocumentSession, OCRProcess, DocumentPageSegment } from '../../types';

export interface PendingReviewSessionItem extends DocumentSession {
  ocrProcess?: OCRProcess;
  isReady: boolean;
  isFailed: boolean;
}

export function usePendingOcrReviewSessions(): PendingReviewSessionItem[] | undefined {
  return useLiveQuery(
    async () => {
      const all = await documentSessionRepository.getAll();
      const ocrProcesses = await ocrProcessRepository.getAll();
      const allSegments: DocumentPageSegment[] = await db.documentPageSegments.toArray();
      const ocrMap = new Map(ocrProcesses.map((p) => [p.id, p]));

      const segmentsBySession = new Map<string, DocumentPageSegment[]>();
      for (const seg of allSegments) {
        const list = segmentsBySession.get(seg.sessionId) || [];
        list.push(seg);
        segmentsBySession.set(seg.sessionId, list);
      }

      return all
        .filter((s) => {
          // Exclude reviewed, completed, cancelled, or sessions already linked to an expense
          if (s.status === 'reviewed' || s.status === 'completed' || s.status === 'cancelled' || s.expenseId) return false;
          const proc = s.ocrProcessId ? ocrMap.get(s.ocrProcessId) : undefined;
          if (proc?.expenseId) return false;

          // Check segments and OCR status
          const sessionSegments = segmentsBySession.get(s.id) || [];
          const hasSegments = sessionSegments.length > 0;
          const hasPageCount = (s.pageCount ?? 0) > 0;
          const isProcFailed = proc?.status === 'failed';
          const hasOcrText = Boolean(proc?.rawText && proc.rawText.trim().length > 0);

          // Exclude failed or errored sessions that have no segments or pages (they cannot be retried)
          if ((s.status === 'failed' || isProcFailed) && !hasSegments && !hasPageCount) return false;

          // Exclude structurally empty sessions (no segments, no pages, and no extracted OCR content)
          if (!hasSegments && !hasPageCount && !hasOcrText) return false;

          // Allow only reviewable statuses
          return s.status === 'ready' || s.status === 'ready_for_review' || (s.status === 'failed' && hasSegments);
        })
        .map((s) => {
          const proc = s.ocrProcessId ? ocrMap.get(s.ocrProcessId) : undefined;
          const isReady = Boolean(
            s.status === 'ready_for_review' &&
            proc?.status === 'completed' &&
            proc?.rawText &&
            proc.rawText.trim().length > 0
          );
          const isFailed = s.status === 'failed' || proc?.status === 'failed';
          return {
            ...s,
            ocrProcess: proc,
            isReady,
            isFailed,
          };
        });
    },
    [],
  );
}

export interface PendingOcrReviewBannerProps {
  onOpenReview: (sessionId: string, ocrProcessId: string | null) => void;
}

export const PendingOcrReviewBanner: React.FC<PendingOcrReviewBannerProps> = ({ onOpenReview }) => {
  const [isSessionPickerOpen, setIsSessionPickerOpen] = useState<boolean>(false);
  const [sessionToDelete, setSessionToDelete] = useState<PendingReviewSessionItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const pendingReviewSessions = usePendingOcrReviewSessions();

  useEffect(() => {
    if (pendingReviewSessions && pendingReviewSessions.length === 0) {
      setIsSessionPickerOpen(false);
      setSessionToDelete(null);
    }
  }, [pendingReviewSessions]);

  if (!pendingReviewSessions || pendingReviewSessions.length === 0) {
    return null;
  }

  const readyCount = pendingReviewSessions.filter((s) => s.isReady).length;
  const failedCount = pendingReviewSessions.filter((s) => s.isFailed).length;
  const pendingCount = pendingReviewSessions.length - readyCount - failedCount;

  let title = `Documenti OCR pronti per la revisione (${readyCount})`;
  let subtitle = 'Confronta il documento originale ed i dati proposti prima della conferma definitiva.';
  let buttonText = 'Rivedi dati estratti';

  if (readyCount === 0 && pendingCount > 0) {
    title = `Documenti in attesa di elaborazione OCR (${pendingCount})`;
    subtitle = 'Documenti acquisiti non ancora elaborati. Apri per avviare il riconoscimento o completare la revisione.';
    buttonText = 'Avvia ed elabora OCR';
  } else if (readyCount === 0 && failedCount > 0) {
    title = `Documenti con errore OCR (${failedCount})`;
    subtitle = 'Uno o più documenti hanno riscontrato un errore durante la scansione. Apri per riprovare o modificare.';
    buttonText = 'Gestisci errori OCR';
  } else if (readyCount > 0 && (pendingCount > 0 || failedCount > 0)) {
    title = `Documenti OCR: ${readyCount} pronti per la revisione, ${pendingCount + failedCount} da completare`;
    subtitle = 'Verifica i documenti elaborati o gestisci le acquisizioni in sospeso.';
    buttonText = 'Rivedi documenti';
  }

  const handleBannerAction = () => {
    if (pendingReviewSessions.length === 1) {
      onOpenReview(pendingReviewSessions[0].id, pendingReviewSessions[0].ocrProcessId || null);
    } else if (pendingReviewSessions.length > 1) {
      setIsSessionPickerOpen(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (!sessionToDelete) return;

    // Safety guard 1: in-memory session.expenseId or ocrProcess.expenseId
    if (sessionToDelete.expenseId || sessionToDelete.ocrProcess?.expenseId) {
      setDeleteError(
        'Questa acquisizione è già collegata a una spesa e non può essere eliminata da questo elenco.'
      );
      return;
    }

    try {
      setIsDeleting(true);
      setDeleteError(null);

      // Safety guard 2: verify ocrProcess in DB if exists
      if (sessionToDelete.ocrProcessId) {
        const proc = await db.ocrProcesses.get(sessionToDelete.ocrProcessId);
        if (proc?.expenseId) {
          setDeleteError(
            'Questa acquisizione è già collegata a una spesa e non può essere eliminata da questo elenco.'
          );
          setIsDeleting(false);
          return;
        }
      }

      // Safety guard 3: verify no expense in database is linked to this session or ocrProcess
      const allExpenses = await db.expenses.toArray();
      const linkedExpense = allExpenses.find((e) => {
        const m = e.metadata as Record<string, any> | undefined;
        return (
          (sessionToDelete.id && m?.documentSessionId === sessionToDelete.id) ||
          (sessionToDelete.ocrProcessId && m?.ocrProcessId === sessionToDelete.ocrProcessId) ||
          (sessionToDelete.expenseId && e.id === sessionToDelete.expenseId) ||
          (sessionToDelete.ocrProcess?.expenseId && e.id === sessionToDelete.ocrProcess.expenseId)
        );
      });

      if (linkedExpense) {
        setDeleteError(
          'Questa acquisizione è già collegata a una spesa e non può essere eliminata da questo elenco.'
        );
        setIsDeleting(false);
        return;
      }

      // Canonical deletion via repository
      await documentSessionRepository.delete(sessionToDelete.id);

      setSessionToDelete(null);

      if ((pendingReviewSessions?.length ?? 1) <= 1) {
        setIsSessionPickerOpen(false);
      }
    } catch (err: any) {
      setDeleteError(err?.message || "Errore durante l'eliminazione dell'acquisizione");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="p-4 bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
            <FileSearch className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-white">
              {title}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {subtitle}
            </p>
          </div>
        </div>
        <Button
          variant="amber"
          icon={<FileSearch className="w-4 h-4" />}
          onClick={handleBannerAction}
        >
          {buttonText}
        </Button>
      </div>

      {/* Modal di Selezione Sessione OCR da Rivedere */}
      <Modal
        isOpen={isSessionPickerOpen}
        onClose={() => {
          setIsSessionPickerOpen(false);
          setSessionToDelete(null);
          setDeleteError(null);
        }}
        title="Seleziona Documento OCR da Rivedere"
        subtitle="Scegli quale acquisizione o scontrino desideri verificare e confermare."
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {pendingReviewSessions && pendingReviewSessions.length > 0 ? (
            pendingReviewSessions.map((session) => {
              const ocr = session.ocrProcess;
              const title = ocr?.detectedSupplier || `Acquisizione del ${formatDate(session.createdAt.substring(0, 10))}`;
              const amount = ocr?.detectedTotal !== undefined && ocr?.detectedTotal !== null ? formatCurrency(ocr.detectedTotal) : 'Totale non rilevato';
              const date = ocr?.detectedDate ? formatDate(ocr.detectedDate) : formatDate(session.createdAt.substring(0, 10));

              return (
                <div
                  key={session.id}
                  className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 hover:border-amber-400 dark:hover:border-amber-600 transition-colors shadow-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <FileSearch className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {title}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {date} • {amount} • {session.pageCount || 1} pag.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="amber"
                      onClick={() => {
                        setIsSessionPickerOpen(false);
                        onOpenReview(session.id, session.ocrProcessId || null);
                      }}
                    >
                      Rivedi
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      icon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
                      onClick={() => {
                        setSessionToDelete(session);
                        setDeleteError(null);
                      }}
                    >
                      Elimina
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-slate-500 text-center py-6">
              Nessuna sessione in attesa.
            </p>
          )}
        </div>
      </Modal>

      {/* Modal di Conferma Eliminazione Acquisizione Pending */}
      <Modal
        isOpen={sessionToDelete !== null}
        onClose={() => {
          if (!isDeleting) {
            setSessionToDelete(null);
            setDeleteError(null);
          }
        }}
        title="Eliminare questa acquisizione?"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Verranno rimossi la bozza OCR, le pagine e gli allegati locali associati a questa acquisizione.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Le spese già contabilizzate non possono essere eliminate da qui.
          </p>

          {deleteError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 rounded-xl text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              disabled={isDeleting}
              onClick={() => {
                setSessionToDelete(null);
                setDeleteError(null);
              }}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
            >
              {isDeleting ? 'Eliminazione...' : 'Elimina acquisizione'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
