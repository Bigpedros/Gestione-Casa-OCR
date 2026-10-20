import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { documentSessionRepository, ocrProcessRepository } from '../../repositories';
import { FileSearch } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { formatDate, formatCurrency } from '../../utils/formatters';
import type { DocumentSession, OCRProcess } from '../../types';

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
      const ocrMap = new Map(ocrProcesses.map((p) => [p.id, p]));

      return all
        .filter((s) => {
          if (s.status === 'reviewed' || s.status === 'cancelled' || s.expenseId) return false;
          const proc = s.ocrProcessId ? ocrMap.get(s.ocrProcessId) : undefined;
          if (proc?.expenseId) return false;
          return s.status === 'ready' || s.status === 'ready_for_review' || s.status === 'completed' || s.status === 'failed';
        })
        .map((s) => {
          const proc = s.ocrProcessId ? ocrMap.get(s.ocrProcessId) : undefined;
          const isReady = Boolean(
            (s.status === 'ready_for_review' || s.status === 'completed') &&
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
  const pendingReviewSessions = usePendingOcrReviewSessions();

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
        onClose={() => setIsSessionPickerOpen(false)}
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
    </>
  );
};
