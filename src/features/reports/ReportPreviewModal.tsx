import React, { useEffect, useRef } from 'react';
import { X, Printer } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { EconomicReportDocument, EconomicReportDocumentProps } from './EconomicReportDocument';

export interface ReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPrint: () => void;
  documentProps: EconomicReportDocumentProps;
  triggerButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
  isOpen,
  onClose,
  onPrint,
  documentProps,
  triggerButtonRef,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus the close button upon opening
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Restore focus to trigger button upon closing
      triggerButtonRef?.current?.focus();
    };
  }, [isOpen, onClose, triggerButtonRef]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Anteprima Report Economico"
      className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex flex-col report-preview-modal-overlay overflow-hidden animate-in fade-in duration-200"
    >
      {/* Command Bar (Hidden during print) */}
      <div className="no-print report-preview-command-bar bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xs shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-extrabold text-sm">
            GC
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-tight">
              Anteprima Report Economico
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {documentProps.docTitle}
            </p>
          </div>
        </div>

        {/* Command Buttons in exact required order: 1. Chiudi, 2. Stampa Report */}
        <div className="flex items-center gap-2.5">
          <Button
            ref={closeButtonRef}
            variant="outline"
            size="sm"
            icon={<X className="w-4 h-4" />}
            onClick={onClose}
            aria-label="Chiudi anteprima del report"
            title="Chiudi anteprima del report"
          >
            Chiudi
          </Button>

          <Button
            variant="primary"
            size="sm"
            icon={<Printer className="w-4 h-4" />}
            onClick={onPrint}
            aria-label="Stampa il report visualizzato"
            title="Stampa il report visualizzato"
          >
            Stampa Report
          </Button>
        </div>
      </div>

      {/* Scrollable Preview Body */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 bg-slate-100 dark:bg-slate-950">
        <div className="max-w-5xl mx-auto bg-white dark:bg-slate-900 shadow-xl rounded-3xl p-4 sm:p-8 md:p-10 border border-slate-200 dark:border-slate-800 report-print-area">
          <EconomicReportDocument {...documentProps} />
        </div>
      </div>
    </div>
  );
};
