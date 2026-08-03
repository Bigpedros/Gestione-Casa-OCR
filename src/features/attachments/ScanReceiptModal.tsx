import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Button } from '../../components/common';
import {
  Camera,
  ImageIcon,
  RotateCw,
  Sparkles,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Eye,
  Trash2,
  Plus,
  ArrowUp,
  ArrowDown,
  FileText,
  Clock,
  AlertTriangle,
  FolderOpen,
  FileCheck,
  Layers,
  HelpCircle,
  FileCode,
} from 'lucide-react';
import {
  validateReceiptFile,
  processReceiptImage,
  computeFileHash,
} from '../../utils/imagePreprocessing';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
} from '../../repositories';
import {
  DocumentSession,
  DocumentPageSegment,
  DocumentProcessingMode,
  DocumentSourceMode,
  Attachment,
} from '../../types';

export interface ScanReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete: (attachmentId: string, ocrProcessId: string) => void;
}

type WizardStep = 'recovery' | 'source' | 'pages' | 'summary';

export const ScanReceiptModal: React.FC<ScanReceiptModalProps> = ({
  isOpen,
  onClose,
  onScanComplete,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Wizard Navigation
  const [step, setStep] = useState<WizardStep>('source');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Draft sessions recovery state
  const [draftSessions, setDraftSessions] = useState<DocumentSession[]>([]);
  const [draftThumbnails, setDraftThumbnails] = useState<Record<string, string>>({});

  // Active Document Session state
  const [currentSession, setCurrentSession] = useState<DocumentSession | null>(null);
  const [segments, setSegments] = useState<DocumentPageSegment[]>([]);
  const [attachmentsMap, setAttachmentsMap] = useState<Record<string, Attachment>>({});
  const [processedPreviews, setProcessedPreviews] = useState<Record<string, string>>({});

  // Form & Interaction state
  const [documentTitle, setDocumentTitle] = useState<string>('');
  const [processingMode, setProcessingMode] = useState<DocumentProcessingMode>('singleReceipt');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Replacement target state
  const [replacingSegmentId, setReplacingSegmentId] = useState<string | null>(null);

  // Zoom preview modal state
  const [zoomedSegment, setZoomedSegment] = useState<DocumentPageSegment | null>(null);
  const [zoomViewMode, setZoomViewMode] = useState<'processed' | 'original'>('processed');

  // Delete Draft Confirmation Modal State
  const [confirmDeleteDraftId, setConfirmDeleteDraftId] = useState<string | null>(null);
  const [confirmDeleteCurrent, setConfirmDeleteCurrent] = useState<boolean>(false);

  // Reset internal state
  const resetState = useCallback(() => {
    setStep('source');
    setErrorMsg(null);
    setInfoMsg(null);
    setCurrentSession(null);
    setSegments([]);
    setAttachmentsMap({});
    setProcessedPreviews({});
    setDocumentTitle('');
    setProcessingMode('singleReceipt');
    setIsLoading(false);
    setIsSubmitting(false);
    setReplacingSegmentId(null);
    setZoomedSegment(null);
    setConfirmDeleteDraftId(null);
    setConfirmDeleteCurrent(false);
  }, []);

  // Fetch draft thumbnails helper
  const loadDraftThumbnails = async (drafts: DocumentSession[]) => {
    const thumbs: Record<string, string> = {};
    for (const d of drafts) {
      try {
        const segs = await documentPageSegmentRepository.getBySessionId(d.id);
        if (segs.length > 0 && segs[0].attachmentId) {
          const att = await attachmentRepository.getById(segs[0].attachmentId);
          if (att?.storageKey) {
            thumbs[d.id] = att.storageKey;
          }
        }
      } catch {
        // Ignore thumbnail load errors
      }
    }
    setDraftThumbnails(thumbs);
  };

  // Check for existing draft sessions when modal opens
  const checkForDrafts = useCallback(async () => {
    setIsLoading(true);
    try {
      const drafts = await documentSessionRepository.getDraftSessions();
      setDraftSessions(drafts);

      if (drafts.length > 0 && !currentSession) {
        await loadDraftThumbnails(drafts);
        setStep('recovery');
      } else if (!currentSession) {
        setStep('source');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore nel caricamento delle bozze');
    } finally {
      setIsLoading(false);
    }
  }, [currentSession]);

  useEffect(() => {
    if (isOpen) {
      checkForDrafts();
    } else {
      resetState();
    }
  }, [isOpen, checkForDrafts, resetState]);

  // Load active session segments & attachments from Dexie
  const refreshSessionData = useCallback(async (sessionId: string) => {
    try {
      const updatedSession = await documentSessionRepository.getById(sessionId);
      if (updatedSession) {
        setCurrentSession(updatedSession);
        setProcessingMode(updatedSession.processingMode);
      }

      const segs = await documentPageSegmentRepository.getBySessionId(sessionId);
      setSegments(segs);

      const attMap: Record<string, Attachment> = {};
      const prevMap: Record<string, string> = {};

      for (const seg of segs) {
        if (seg.attachmentId) {
          const att = await attachmentRepository.getById(seg.attachmentId);
          if (att) {
            attMap[seg.id] = att;
            if (att.storageKey && !att.mimeType.includes('pdf')) {
              try {
                const processed = await processReceiptImage(att.storageKey, {
                  rotationDegrees: seg.rotationDegrees,
                  enhanceContrast: true,
                  sharpen: true,
                });
                prevMap[seg.id] = processed.processedDataUrl;
              } catch {
                prevMap[seg.id] = att.storageKey;
              }
            }
          }
        }
      }

      setAttachmentsMap(attMap);
      setProcessedPreviews(prevMap);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore nel caricamento dei dati della sessione');
    }
  }, []);

  // Resume a draft session
  const handleResumeDraft = async (sessionToResume: DocumentSession) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      setCurrentSession(sessionToResume);
      setProcessingMode(sessionToResume.processingMode);
      const title =
        (sessionToResume.metadata?.title as string) ||
        `Documento_${new Date(sessionToResume.createdAt).toLocaleDateString('it-IT').replace(/\//g, '-')}`;
      setDocumentTitle(title);

      await refreshSessionData(sessionToResume.id);
      setStep('pages');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Impossibile riprendere la bozza selezionata');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a specific draft session cleanly from Dexie
  const handleDeleteDraft = async (sessionId: string) => {
    setIsLoading(true);
    try {
      await documentSessionRepository.delete(sessionId);
      const remainingDrafts = await documentSessionRepository.getDraftSessions();
      setDraftSessions(remainingDrafts);

      if (currentSession?.id === sessionId) {
        setCurrentSession(null);
        setSegments([]);
        setStep(remainingDrafts.length > 0 ? 'recovery' : 'source');
      } else if (remainingDrafts.length === 0) {
        setStep('source');
      }
      setConfirmDeleteDraftId(null);
      setInfoMsg('Bozza ed allegati eliminati con successo');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante l\'eliminazione della bozza');
    } finally {
      setIsLoading(false);
    }
  };

  // Create new session & ingest files
  const handleFilesIngest = async (files: FileList | File[], isPdf = false) => {
    if (!files || files.length === 0) return;
    setIsLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      let session = currentSession;

      // Determine initial modes
      const firstFile = files[0];
      const isFirstPdf = isPdf || firstFile.type === 'application/pdf' || firstFile.name.endsWith('.pdf');
      const sourceMode: DocumentSourceMode = isFirstPdf
        ? 'pdf'
        : files.length > 1
        ? 'multiplePages'
        : 'singleImage';

      const initialProcessingMode: DocumentProcessingMode = isFirstPdf
        ? 'multiPageDocument'
        : files.length > 1
        ? 'multiPageDocument'
        : 'singleReceipt';

      // 1. Create DocumentSession if not exists
      if (!session) {
        const todayStr = new Date().toLocaleDateString('it-IT').replace(/\//g, '-');
        const defaultTitle = `Documento_${todayStr}_${new Date().getHours()}${new Date().getMinutes()}`;

        session = await documentSessionRepository.create({
          documentType: isFirstPdf ? 'generic' : 'receipt',
          sourceMode,
          processingMode: initialProcessingMode,
          status: 'draft',
          metadata: { title: defaultTitle },
        });

        setCurrentSession(session);
        setProcessingMode(initialProcessingMode);
        setDocumentTitle(defaultTitle);
      }

      const existingSegments = await documentPageSegmentRepository.getBySessionId(session.id);
      let nextSeqIndex = existingSegments.length;
      let addedCount = 0;
      let duplicateCount = 0;

      // 2. Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const val = validateReceiptFile(file);
        if (!val.valid) {
          setErrorMsg(val.error || `File "${file.name}" non valido`);
          continue;
        }

        const fileHash = await computeFileHash(file);

        // Duplicate check in current session
        const existingHash = await documentPageSegmentRepository.getByHash(session.id, fileHash);
        if (existingHash) {
          duplicateCount++;
          continue;
        }

        // Read file contents
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`Errore nella lettura di ${file.name}`));
          reader.readAsDataURL(file);
        });

        // Save Attachment
        const attachment = await attachmentRepository.create({
          entityType: 'unlinked',
          entityId: session.id,
          fileName: file.name,
          description: `Pagina ${nextSeqIndex + 1} per ${session.id}`,
          mimeType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
          sizeBytes: file.size,
          storageKey: dataUrl,
          fileHash,
          status: 'active',
        });

        // Save PageSegment
        await documentPageSegmentRepository.create({
          sessionId: session.id,
          sequenceIndex: nextSeqIndex,
          attachmentId: attachment.id,
          originalFileName: file.name,
          originalMimeType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
          rotationDegrees: 0,
          segmentMode: session.processingMode === 'longReceipt' ? 'overlappingSegment' : 'page',
          fileHash,
          processingStatus: 'pending',
        });

        nextSeqIndex++;
        addedCount++;
      }

      if (duplicateCount > 0) {
        setInfoMsg(
          `${duplicateCount} file ignorato/i perché già presente/i in questa sessione.`
        );
      } else if (addedCount > 0) {
        setInfoMsg(`${addedCount} file acquisito/i con successo.`);
      }

      await refreshSessionData(session.id);
      setStep('pages');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante l\'acquisizione del file');
    } finally {
      setIsLoading(false);
    }
  };

  // Change processing mode and update Dexie
  const handleProcessingModeChange = async (newMode: DocumentProcessingMode) => {
    setProcessingMode(newMode);
    if (!currentSession) return;
    try {
      await documentSessionRepository.update(currentSession.id, {
        processingMode: newMode,
      });

      // Update segmentMode on all segments if switching to/from longReceipt
      const isLong = newMode === 'longReceipt';
      const segs = await documentPageSegmentRepository.getBySessionId(currentSession.id);
      for (const seg of segs) {
        await documentPageSegmentRepository.update(seg.id, {
          segmentMode: isLong ? 'overlappingSegment' : 'page',
        });
      }
      await refreshSessionData(currentSession.id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante l\'aggiornamento della modalità');
    }
  };

  // Change document title and update Dexie
  const handleTitleChange = async (newTitle: string) => {
    setDocumentTitle(newTitle);
    if (!currentSession) return;
    try {
      await documentSessionRepository.update(currentSession.id, {
        metadata: { ...currentSession.metadata, title: newTitle },
      });
    } catch {
      // Ignore background title update error
    }
  };

  // Rotate a page segment 90 degrees
  const handleRotateSegment = async (segmentId: string) => {
    const seg = segments.find((s) => s.id === segmentId);
    if (!seg || !currentSession) return;

    const nextRot = (seg.rotationDegrees + 90) % 360;
    try {
      await documentPageSegmentRepository.update(segmentId, { rotationDegrees: nextRot });
      await refreshSessionData(currentSession.id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante la rotazione del segmento');
    }
  };

  // Reorder segments (Move Up / Down)
  const handleMoveSegment = async (index: number, direction: 'up' | 'down') => {
    if (!currentSession) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= segments.length) return;

    const newOrder = [...segments];
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    const orderedIds = newOrder.map((s) => s.id);
    try {
      await documentPageSegmentRepository.reorder(currentSession.id, orderedIds);
      await refreshSessionData(currentSession.id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante il riordinamento delle pagine');
    }
  };

  // Delete a single page segment
  const handleDeleteSegment = async (segmentId: string) => {
    if (!currentSession) return;
    try {
      await documentPageSegmentRepository.delete(segmentId);
      const remaining = await documentPageSegmentRepository.getBySessionId(currentSession.id);

      if (remaining.length === 0) {
        // If no segments left, delete session or go to source
        await documentSessionRepository.delete(currentSession.id);
        setCurrentSession(null);
        setSegments([]);
        setStep('source');
      } else {
        await refreshSessionData(currentSession.id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante l\'eliminazione del segmento');
    }
  };

  // Replace a page segment with a new file
  const handleReplaceSegment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !replacingSegmentId || !currentSession) return;

    const file = files[0];
    const val = validateReceiptFile(file);
    if (!val.valid) {
      setErrorMsg(val.error || 'File non valido');
      e.target.value = '';
      setReplacingSegmentId(null);
      return;
    }

    try {
      const fileHash = await computeFileHash(file);
      const targetSeg = segments.find((s) => s.id === replacingSegmentId);

      if (targetSeg) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`Errore nella lettura di ${file.name}`));
          reader.readAsDataURL(file);
        });

        // Update attachment
        if (targetSeg.attachmentId) {
          await attachmentRepository.update(targetSeg.attachmentId, {
            fileName: file.name,
            mimeType: file.type || 'image/jpeg',
            sizeBytes: file.size,
            storageKey: dataUrl,
            fileHash,
          });
        }

        // Update segment
        await documentPageSegmentRepository.update(targetSeg.id, {
          originalFileName: file.name,
          originalMimeType: file.type || 'image/jpeg',
          fileHash,
          rotationDegrees: 0,
        });

        await refreshSessionData(currentSession.id);
        setInfoMsg(`Pagina #${targetSeg.sequenceIndex + 1} sostituita con successo.`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante la sostituzione della pagina');
    } finally {
      e.target.value = '';
      setReplacingSegmentId(null);
    }
  };

  // Final confirmation: "Prepara per il riconoscimento"
  const handleFinalSubmit = async () => {
    if (!currentSession || segments.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // 1. Finalize Session in ready state
      const now = new Date().toISOString();
      await documentSessionRepository.update(currentSession.id, {
        status: 'ready',
        pageCount: segments.length,
        updatedAt: now,
        metadata: {
          ...currentSession.metadata,
          title: documentTitle.trim() || `Documento_${currentSession.id}`,
        },
      });

      // 2. Create single OCRProcess linked to session
      const firstSegment = segments[0];
      const ocrProc = await ocrProcessRepository.create({
        attachmentId: firstSegment.attachmentId,
        status: 'pending',
        confirmationRequired: true,
        confirmedByUser: false,
      });

      // Link OCRProcess ID to session
      await documentSessionRepository.update(currentSession.id, {
        ocrProcessId: ocrProc.id,
      });

      // Callback to parent
      onScanComplete(firstSegment.attachmentId, ocrProc.id);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante la preparazione per il riconoscimento');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Intentional full deletion of active draft ("Annulla ed elimina")
  const handleConfirmCancelAndDeleteCurrent = async () => {
    if (!currentSession) {
      onClose();
      return;
    }
    setIsLoading(true);
    try {
      await documentSessionRepository.delete(currentSession.id);
      setConfirmDeleteCurrent(false);
      resetState();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Errore durante l\'eliminazione della sessione');
    } finally {
      setIsLoading(false);
    }
  };

  // Helpers for labels and dates
  const getProcessingModeLabel = (mode: DocumentProcessingMode): string => {
    switch (mode) {
      case 'singleReceipt':
        return 'Scontrino singolo';
      case 'longReceipt':
        return 'Scontrino lungo (foto sovrapposte)';
      case 'multiPageDocument':
        return 'Documento multipagina';
      case 'invoice':
        return 'Fattura cartacea';
      case 'genericDocument':
        return 'Documento generico';
      case 'structuredElectronicInvoice':
        return 'Fattura elettronica (XML)';
      default:
        return mode;
    }
  };

  const isObsoleteDraft = (updatedAtStr: string): boolean => {
    const updatedDate = new Date(updatedAtStr).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    return Date.now() - updatedDate > thirtyDaysMs;
  };

  const getStepSubtitle = (): string => {
    switch (step) {
      case 'recovery':
        return 'Bozze salvate non terminate — Riprendi o crea nuovo documento';
      case 'source':
        return 'Passo 1 di 3 — Scegli la sorgente di acquisizione';
      case 'pages':
        return `Passo 2 di 3 — Organizza e correggi le pagine (${segments.length} acquisite)`;
      case 'summary':
        return 'Passo 3 di 3 — Riepilogo e preparazione per il riconoscimento';
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          // Default close button (X) preserves draft session in Dexie
          onClose();
        }}
        title="Acquisisci documento di spesa"
        subtitle={getStepSubtitle()}
        maxWidth="2xl"
      >
        {/* Hidden inputs for camera, gallery, pdf, append, replace */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => e.target.files && handleFilesIngest(e.target.files)}
          className="hidden"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/bmp"
          multiple
          onChange={(e) => e.target.files && handleFilesIngest(e.target.files)}
          className="hidden"
        />
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(e) => e.target.files && handleFilesIngest(e.target.files, true)}
          className="hidden"
        />
        <input
          ref={appendInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/bmp,application/pdf,.pdf"
          multiple
          onChange={(e) => e.target.files && handleFilesIngest(e.target.files)}
          className="hidden"
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/bmp,application/pdf,.pdf"
          onChange={handleReplaceSegment}
          className="hidden"
        />

        {/* Global Error Banner */}
        {errorMsg && (
          <div className="flex items-center gap-2.5 p-3.5 mb-4 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-2xl text-xs font-semibold border border-rose-200 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}

        {/* Global Info Banner */}
        {infoMsg && (
          <div className="flex items-center gap-2.5 p-3 mb-4 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 rounded-2xl text-xs font-semibold border border-sky-200 dark:border-sky-900">
            <Sparkles className="w-4 h-4 shrink-0 text-sky-500" />
            <span className="flex-1">{infoMsg}</span>
          </div>
        )}

        {/* Wizard Step Content */}
        {step === 'recovery' && (
          /* SCREEN: Draft Sessions Recovery */
          <div className="space-y-6 py-2">
            <div className="flex items-start justify-between gap-4 p-4 bg-amber-50/80 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-0.5">
                    Sessioni non terminate rilevate
                  </h4>
                  <p>
                    Hai delle bozze di documenti acquisiti ma non ancora inviati al riconoscimento. Puoi riprendere da dove avevi interrotto o iniziare un nuovo documento.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Bozze disponibili ({draftSessions.length})
              </h4>

              <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                {draftSessions.map((draft) => {
                  const isOld = isObsoleteDraft(draft.updatedAt);
                  const thumb = draftThumbnails[draft.id];
                  return (
                    <div
                      key={draft.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
                          {thumb ? (
                            <img src={thumb} alt="Preview" className="w-full h-full object-cover" />
                          ) : (
                            <FileText className="w-6 h-6 text-slate-400" />
                          )}
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                              {(draft.metadata?.title as string) || `Bozza ${draft.id}`}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900">
                              {getProcessingModeLabel(draft.processingMode)}
                            </span>
                            {isOld && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
                                <AlertTriangle className="w-3 h-3" /> Obsoleta (&gt;30 gg)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                            <span>{draft.pageCount} pag.</span>
                            <span>•</span>
                            <span>
                              Modificato il:{' '}
                              {new Date(draft.updatedAt).toLocaleString('it-IT', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteDraftId(draft.id)}
                          className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                          title="Elimina questa bozza"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => handleResumeDraft(draft)}
                          icon={<ArrowRight className="w-4 h-4" />}
                        >
                          Riprendi
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="secondary" onClick={onClose}>
                Chiudi e mantieni bozza
              </Button>
              <Button
                type="button"
                variant="emerald"
                onClick={() => setStep('source')}
                icon={<Plus className="w-4 h-4" />}
              >
                Inizia nuovo documento
              </Button>
            </div>
          </div>
        )}

        {step === 'source' && (
          /* SCREEN: Choose Source */
          <div className="py-4 space-y-6">
            <div className="text-center max-w-md mx-auto space-y-2">
              <div className="w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto border border-indigo-100 dark:border-indigo-900 shadow-xs">
                <FolderOpen className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-slate-900 dark:text-white">
                Come desideri acquisire il documento?
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Puoi scattare foto da smartphone/tablet, selezionare immagini singole o multiple, oppure caricare file PDF.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Camera Action */}
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  cameraInputRef.current?.click();
                }}
                className="flex flex-col items-center justify-center p-5 bg-gradient-to-b from-indigo-50/70 to-white dark:from-slate-800 dark:to-slate-900 border-2 border-dashed border-indigo-200 dark:border-indigo-800 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-3xl transition-all cursor-pointer group text-center space-y-2.5"
              >
                <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform shadow-md">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <span className="block font-bold text-slate-900 dark:text-white text-sm">
                    Scatta con Fotocamera
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Smartphone o Tablet
                  </span>
                </div>
              </button>

              {/* Gallery Images Action */}
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  galleryInputRef.current?.click();
                }}
                className="flex flex-col items-center justify-center p-5 bg-gradient-to-b from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 rounded-3xl transition-all cursor-pointer group text-center space-y-2.5"
              >
                <div className="w-11 h-11 rounded-2xl bg-sky-500 text-white flex items-center justify-center group-hover:scale-110 transition-transform shadow-md">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <div>
                  <span className="block font-bold text-slate-900 dark:text-white text-sm">
                    Scegli Immagini
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    JPG, PNG, WebP, BMP (Multi-selezione)
                  </span>
                </div>
              </button>

              {/* PDF Document Action */}
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  pdfInputRef.current?.click();
                }}
                className="flex flex-col items-center justify-center p-5 bg-gradient-to-b from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 rounded-3xl transition-all cursor-pointer group text-center space-y-2.5"
              >
                <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform shadow-md">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <span className="block font-bold text-slate-900 dark:text-white text-sm">
                    Carica PDF
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Documento PDF (Singola o multipagina)
                  </span>
                </div>
              </button>

              {/* Disabled Electronic Invoice */}
              <div className="flex flex-col items-center justify-center p-5 bg-slate-100/60 dark:bg-slate-900/40 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl opacity-60 text-center space-y-2.5 cursor-not-allowed">
                <div className="w-11 h-11 rounded-2xl bg-slate-400 text-white flex items-center justify-center shadow-xs">
                  <FileCode className="w-5 h-5" />
                </div>
                <div>
                  <span className="block font-bold text-slate-700 dark:text-slate-300 text-sm">
                    Fattura Elettronica
                  </span>
                  <span className="inline-block px-2 py-0.5 mt-1 rounded-md text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    Prossimamente (XML/P7M)
                  </span>
                </div>
              </div>
            </div>

            {/* Local persistence notice */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block mb-0.5">
                  Protezione Bozza Local-First
                </span>
                Ogni immagine o documento selezionato viene salvato immediatamente nella memoria locale del tuo dispositivo. In caso di chiusura accidentale dell'app, potrai riprendere la sessione in qualsiasi momento.
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="secondary" onClick={onClose}>
                Annulla
              </Button>
              {draftSessions.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep('recovery')}
                  icon={<Clock className="w-4 h-4" />}
                >
                  Vedi Bozze Salvate ({draftSessions.length})
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 'pages' && currentSession && (
          /* SCREEN: Pages Editor & Settings */
          <div className="space-y-5 py-2">
            {/* Session Header Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Nome Identificativo Documento
                </label>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Es. Scontrino Spesa 02-08"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Modalità Interpretazione Documento
                </label>
                <select
                  value={processingMode}
                  onChange={(e) => handleProcessingModeChange(e.target.value as DocumentProcessingMode)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="singleReceipt">Scontrino singolo (1 pagina)</option>
                  <option value="longReceipt">Scontrino lungo (foto sovrapposte)</option>
                  <option value="multiPageDocument">Documento / Fattura multipagina</option>
                  <option value="invoice">Fattura cartacea</option>
                  <option value="genericDocument">Documento generico</option>
                </select>
              </div>
            </div>

            {/* Long Receipt Instruction Banner */}
            {processingMode === 'longReceipt' && (
              <div className="flex items-start gap-3 p-3.5 bg-indigo-50/80 dark:bg-indigo-950/40 rounded-2xl border border-indigo-200 dark:border-indigo-900 text-xs text-indigo-800 dark:text-indigo-200">
                <HelpCircle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5">Istruzione Scontrino Lungo:</span>
                  Includi in ciascuna nuova foto una piccola parte finale della foto precedente per permettere la corretta unione sequenziale delle sezioni.
                </div>
              </div>
            )}

            {/* Segments List Header & Add Button */}
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-500" />
                Pagine / Segmenti acquisiti ({segments.length})
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => appendInputRef.current?.click()}
                icon={<Plus className="w-4 h-4" />}
              >
                Aggiungi Pagine
              </Button>
            </div>

            {/* Segments List */}
            {segments.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                  Nessuna pagina presente nella sessione.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => appendInputRef.current?.click()}
                  icon={<Plus className="w-4 h-4" />}
                >
                  Aggiungi Prima Pagina
                </Button>
              </div>
            ) : (
              <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                {segments.map((seg, idx) => {
                  const att = attachmentsMap[seg.id];
                  const previewUrl = processedPreviews[seg.id] || att?.storageKey;
                  const isPdf = seg.originalMimeType.includes('pdf');

                  return (
                    <div
                      key={seg.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                    >
                      {/* Left: Thumbnail & Info */}
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="relative w-14 h-14 rounded-xl bg-slate-950 border border-slate-800 shrink-0 overflow-hidden flex items-center justify-center">
                          {isPdf ? (
                            <FileText className="w-7 h-7 text-emerald-400" />
                          ) : previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={`Pagina ${idx + 1}`}
                              className="w-full h-full object-cover"
                              style={{ transform: `rotate(${seg.rotationDegrees}deg)` }}
                            />
                          ) : (
                            <RefreshCw className="w-5 h-5 text-slate-500 animate-spin" />
                          )}
                          <span className="absolute top-1 left-1 bg-slate-900/90 text-white font-bold text-[10px] px-1.5 py-0.5 rounded-md border border-slate-700">
                            #{idx + 1}
                          </span>
                        </div>

                        <div className="min-w-0 space-y-1">
                          <span className="font-bold text-xs text-slate-900 dark:text-white truncate block">
                            {seg.originalFileName}
                          </span>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                            <span>{isPdf ? 'PDF' : 'Immagine'}</span>
                            <span>•</span>
                            <span>Orientamento: {seg.rotationDegrees}°</span>
                            {att?.sizeBytes && (
                              <>
                                <span>•</span>
                                <span>{Math.round(att.sizeBytes / 1024)} KB</span>
                              </>
                            )}
                          </div>
                          {seg.segmentMode === 'overlappingSegment' && (
                            <span className="inline-block text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                              Segmento sovrapposto scontrino lungo
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                        {/* Move Up */}
                        <button
                          type="button"
                          onClick={() => handleMoveSegment(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-30 cursor-pointer"
                          title="Sposta Su"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>

                        {/* Move Down */}
                        <button
                          type="button"
                          onClick={() => handleMoveSegment(idx, 'down')}
                          disabled={idx === segments.length - 1}
                          className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-30 cursor-pointer"
                          title="Sposta Giù"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>

                        {/* Rotate 90° */}
                        {!isPdf && (
                          <button
                            type="button"
                            onClick={() => handleRotateSegment(seg.id)}
                            className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg cursor-pointer"
                            title="Ruota 90°"
                          >
                            <RotateCw className="w-4 h-4" />
                          </button>
                        )}

                        {/* Zoom Preview */}
                        <button
                          type="button"
                          onClick={() => setZoomedSegment(seg)}
                          className="p-1.5 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/50 rounded-lg cursor-pointer"
                          title="Anteprima ingrandita"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {/* Replace Page */}
                        <button
                          type="button"
                          onClick={() => {
                            setReplacingSegmentId(seg.id);
                            replaceInputRef.current?.click();
                          }}
                          className="p-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded-lg cursor-pointer"
                          title="Sostituisci pagina"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>

                        {/* Delete Page */}
                        <button
                          type="button"
                          onClick={() => handleDeleteSegment(seg.id)}
                          className="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg cursor-pointer"
                          title="Elimina pagina"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Navigation Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDeleteCurrent(true)}
                  className="text-rose-600 hover:text-rose-700"
                >
                  Annulla ed elimina
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                >
                  Chiudi e conserva bozza
                </Button>
              </div>

              <Button
                type="button"
                variant="primary"
                onClick={() => setStep('summary')}
                disabled={segments.length === 0 || isLoading}
                icon={<ArrowRight className="w-4 h-4" />}
              >
                Continua a Riepilogo
              </Button>
            </div>
          </div>
        )}

        {step === 'summary' && currentSession && (
          /* SCREEN: Summary & Final Confirmation */
          <div className="space-y-6 py-2">
            <div className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h4 className="font-bold text-base text-slate-900 dark:text-white">
                    {documentTitle}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ID Sessione: {currentSession.id}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                  <FileCheck className="w-4 h-4 text-emerald-500" />
                  Pronto per Riconoscimento
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
                  <span className="block text-slate-500 dark:text-slate-400 font-semibold mb-0.5">
                    Modalità Documento
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {getProcessingModeLabel(processingMode)}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
                  <span className="block text-slate-500 dark:text-slate-400 font-semibold mb-0.5">
                    Numero Pagine / Foto
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {segments.length}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl col-span-2 sm:col-span-1">
                  <span className="block text-slate-500 dark:text-slate-400 font-semibold mb-0.5">
                    Sorgente Acquisizione
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {currentSession.sourceMode === 'pdf'
                      ? 'Documento PDF'
                      : currentSession.sourceMode === 'singleImage'
                      ? 'Foto singola'
                      : 'Multi-immagine'}
                  </span>
                </div>
              </div>

              {/* Thumbnails grid */}
              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Anteprima Pagine Inserite
                </span>
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {segments.map((seg, idx) => {
                    const att = attachmentsMap[seg.id];
                    const previewUrl = processedPreviews[seg.id] || att?.storageKey;
                    const isPdf = seg.originalMimeType.includes('pdf');
                    return (
                      <div
                        key={seg.id}
                        className="w-16 h-20 bg-slate-950 rounded-xl border border-slate-800 shrink-0 overflow-hidden relative flex items-center justify-center"
                      >
                        {isPdf ? (
                          <FileText className="w-6 h-6 text-emerald-400" />
                        ) : previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={`Segment ${idx}`}
                            className="w-full h-full object-cover"
                            style={{ transform: `rotate(${seg.rotationDegrees}deg)` }}
                          />
                        ) : (
                          <FileText className="w-6 h-6 text-slate-400" />
                        )}
                        <span className="absolute bottom-1 right-1 bg-slate-900/90 text-white font-bold text-[9px] px-1 py-0.2 rounded border border-slate-700">
                          #{idx + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Final Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('pages')}
                disabled={isSubmitting}
              >
                Torna a Modifica Pagine
              </Button>

              <Button
                type="button"
                variant="emerald"
                onClick={handleFinalSubmit}
                disabled={isSubmitting || segments.length === 0}
                icon={
                  isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )
                }
              >
                <span>{isSubmitting ? 'Preparazione in corso...' : 'Prepara per il riconoscimento'}</span>
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* SUB-MODAL: Zoomed Page Preview */}
      {zoomedSegment && (
        <Modal
          isOpen={Boolean(zoomedSegment)}
          onClose={() => setZoomedSegment(null)}
          title={`Anteprima Pagina #${zoomedSegment.sequenceIndex + 1}`}
          subtitle={zoomedSegment.originalFileName}
          maxWidth="2xl"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between p-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
              <span className="text-slate-600 dark:text-slate-300">
                Rotazione applicata: {zoomedSegment.rotationDegrees}°
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoomViewMode('processed')}
                  className={`px-3 py-1 rounded-lg ${
                    zoomViewMode === 'processed'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Ottimizzata
                </button>
                <button
                  type="button"
                  onClick={() => setZoomViewMode('original')}
                  className={`px-3 py-1 rounded-lg ${
                    zoomViewMode === 'original'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Originale
                </button>
              </div>
            </div>

            <div className="bg-slate-950 rounded-2xl p-4 flex items-center justify-center min-h-[300px] max-h-[60vh] overflow-hidden">
              {zoomedSegment.originalMimeType.includes('pdf') ? (
                <div className="text-center text-white space-y-2">
                  <FileText className="w-16 h-16 text-emerald-400 mx-auto" />
                  <p className="text-sm font-semibold">{zoomedSegment.originalFileName}</p>
                  <p className="text-xs text-slate-400">Documento PDF conservato in originale</p>
                </div>
              ) : (
                <img
                  src={
                    zoomViewMode === 'processed'
                      ? processedPreviews[zoomedSegment.id] || attachmentsMap[zoomedSegment.id]?.storageKey
                      : attachmentsMap[zoomedSegment.id]?.storageKey
                  }
                  alt="Zoom"
                  className="max-h-[55vh] max-w-full object-contain rounded-lg"
                  style={{ transform: `rotate(${zoomedSegment.rotationDegrees}deg)` }}
                />
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button type="button" variant="secondary" onClick={() => setZoomedSegment(null)}>
                Chiudi
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* SUB-MODAL: Confirm Delete Single Draft */}
      {confirmDeleteDraftId && (
        <Modal
          isOpen={Boolean(confirmDeleteDraftId)}
          onClose={() => setConfirmDeleteDraftId(null)}
          title="Eliminare questa bozza?"
          subtitle="Azione irreversibile"
          maxWidth="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Sei sicuro di voler eliminare definitivamente questa bozza e tutti i file caricati associati?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmDeleteDraftId(null)}>
                Annulla
              </Button>
              <Button
                type="button"
                variant="rose"
                onClick={() => handleDeleteDraft(confirmDeleteDraftId)}
              >
                Elimina bozza
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* SUB-MODAL: Confirm Delete Active Session */}
      {confirmDeleteCurrent && (
        <Modal
          isOpen={confirmDeleteCurrent}
          onClose={() => setConfirmDeleteCurrent(false)}
          title="Eliminare completamente il documento corrente?"
          subtitle="Pulizia transazionale completa"
          maxWidth="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Sei sicuro di voler cancellare questa sessione di acquisizione? Tutti i segmenti di pagina e gli allegati temporanei verranno rimossi da Dexie senza lasciare dati orfani.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmDeleteCurrent(false)}>
                Mantieni bozza
              </Button>
              <Button
                type="button"
                variant="rose"
                onClick={handleConfirmCancelAndDeleteCurrent}
              >
                Sì, elimina tutto
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export const AcquireExpenseDocumentModal = ScanReceiptModal;
