import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { attachmentRepository, expenseRepository, supplierRepository } from '../../repositories';
import { repairOcrAttachmentExpenseLinks } from '../../services/productClassification/ProductClassificationService';
import { formatDate, formatCurrency, formatFileSize } from '../../utils/formatters';
import {
  PageHeader,
  Modal,
  Button,
} from '../../components/common';
import {
  Paperclip,
  Camera,
  Image as ImageIcon,
  FileText,
  Plus,
  Eye,
  Pencil,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Download,
  X,
  File,
  ChevronDown,
  ScanLine,
  ArrowLeft,
} from 'lucide-react';
import type { Attachment, Expense } from '../../types';
import { ScanReceiptModal } from './ScanReceiptModal';
import { OcrReviewModal } from './OcrReviewModal';
import { PendingOcrReviewBanner } from './PendingOcrReviewBanner';
import { ROUTES } from '../../app/routes';

export const AttachmentsPage: React.FC = () => {
  const attachments = useLiveQuery(() => attachmentRepository.getAll(), []);
  const expenses = useLiveQuery(() => expenseRepository.getAll(), []);
  const suppliers = useLiveQuery(() => supplierRepository.getAll(), []);
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'receipts' | 'documents' | 'unlinked'>('all');

  // Menu dropdown state for "+ Nuovo Allegato"
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);

  // OCR Review Modal State
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewOcrProcessId, setReviewOcrProcessId] = useState<string | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);

  // Auto-repair orphan / unlinked OCR attachments when page loads
  useEffect(() => {
    repairOcrAttachmentExpenseLinks().catch(console.error);
  }, []);

  // Hidden input refs for photo, gallery, file
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selected file for new upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadExpenseId, setUploadExpenseId] = useState<string>('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const isAttachmentUnlinked = (a: Attachment): boolean => {
    if (a.expenseId) return false;
    if (a.entityType === 'expense' && a.entityId && a.entityId !== 'unlinked') return false;
    return true;
  };

  const totalSizeBytes = React.useMemo(() => {
    return (attachments || []).reduce((acc, att) => acc + (att.sizeBytes || 0), 0);
  }, [attachments]);

  const receiptsCount = React.useMemo(() => {
    return (attachments || []).filter(
      (a) => a.mimeType?.startsWith('image') || a.fileName.match(/\.(jpg|jpeg|png|webp)$/i)
    ).length;
  }, [attachments]);

  const docsCount = React.useMemo(() => {
    return (attachments || []).filter(
      (a) => a.mimeType?.includes('pdf') || a.fileName.toLowerCase().endsWith('.pdf')
    ).length;
  }, [attachments]);

  const unlinkedCount = React.useMemo(() => {
    return (attachments || []).filter(isAttachmentUnlinked).length;
  }, [attachments]);

  const filteredAttachments = React.useMemo(() => {
    if (!attachments) return [];
    if (activeFilterTab === 'all') return attachments;
    if (activeFilterTab === 'receipts') {
      return attachments.filter(
        (a) => a.mimeType?.startsWith('image') || a.fileName.match(/\.(jpg|jpeg|png|webp)$/i)
      );
    }
    if (activeFilterTab === 'documents') {
      return attachments.filter(
        (a) => a.mimeType?.includes('pdf') || a.fileName.toLowerCase().endsWith('.pdf')
      );
    }
    if (activeFilterTab === 'unlinked') {
      return attachments.filter(isAttachmentUnlinked);
    }
    return attachments;
  }, [attachments, activeFilterTab]);

  // Modals for view, edit, delete
  const [viewingAttachment, setViewingAttachment] = useState<Attachment | null>(null);
  const [editingAttachment, setEditingAttachment] = useState<Attachment | null>(null);
  const [editFileName, setEditFileName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editExpenseId, setEditExpenseId] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);

  // Feedback messages
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    setSelectedFile(file);
    setUploadFileName(file.name);
    setUploadDescription('');
    setUploadExpenseId('');
    setFormError(null);

    const reader = new FileReader();
    reader.onload = () => {
      setFileDataUrl(reader.result as string);
      setIsUploadModalOpen(true);
    };
    reader.readAsDataURL(file);

    // Reset input value so same file can be chosen again
    e.target.value = '';
    setIsMenuOpen(false);
  };

  const handleSaveUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !fileDataUrl) {
      setFormError('Seleziona un file valido');
      return;
    }
    if (!uploadFileName.trim()) {
      setFormError('Il nome del file è obbligatorio');
      return;
    }

    try {
      await attachmentRepository.create({
        entityType: uploadExpenseId ? 'expense' : 'unlinked',
        entityId: uploadExpenseId || 'unlinked',
        fileName: uploadFileName.trim(),
        description: uploadDescription.trim() || undefined,
        mimeType: selectedFile.type || (uploadFileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
        sizeBytes: selectedFile.size,
        storageKey: fileDataUrl,
        fileHash: `${selectedFile.name}-${selectedFile.size}-${Date.now()}`,
        status: 'active',
      });

      showFeedback('Allegato caricato con successo');
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      setFileDataUrl(null);
    } catch (err: any) {
      setFormError(err?.message || 'Errore durante il caricamento');
    }
  };

  const openEditModal = (att: Attachment) => {
    setEditingAttachment(att);
    setEditFileName(att.fileName);
    setEditDescription(att.description || '');
    setEditExpenseId(att.entityType === 'expense' ? att.entityId : '');
    setFormError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAttachment) return;
    if (!editFileName.trim()) {
      setFormError('Il nome del file è obbligatorio');
      return;
    }

    try {
      await attachmentRepository.update(editingAttachment.id, {
        fileName: editFileName.trim(),
        description: editDescription.trim() || undefined,
        entityType: editExpenseId ? 'expense' : 'unlinked',
        entityId: editExpenseId || 'unlinked',
      });

      showFeedback('Allegato aggiornato con successo');
      setEditingAttachment(null);
    } catch (err: any) {
      setFormError(err?.message || 'Errore durante la modifica');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await attachmentRepository.delete(deleteTarget.id);
      showFeedback('Allegato eliminato con successo');
      setDeleteTarget(null);
    } catch (err: any) {
      alert(err?.message || "Errore durante l'eliminazione");
    }
  };

  const findExpense = (attOrId?: Attachment | string): Expense | undefined => {
    if (!attOrId) return undefined;
    if (typeof attOrId === 'object') {
      const targetId = attOrId.expenseId || (attOrId.entityType === 'expense' ? attOrId.entityId : undefined);
      if (!targetId || targetId === 'unlinked') return undefined;
      return expenses?.find((e) => e.id === targetId);
    }
    if (attOrId === 'unlinked') return undefined;
    return expenses?.find((e) => e.id === attOrId);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Hidden File Inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header Banner */}
      <PageHeader
        icon={<Paperclip className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Allegati e Ricevute Scontrini"
        subtitle="Gestisci ed archivia gli scontrini, le fatture ed i documenti delle spese domestiche."
        actions={
          <div className="flex items-center gap-3">
            <Link to={ROUTES.SETTINGS}>
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeft className="w-4 h-4" />}
              >
                Torna a Impostazioni
              </Button>
            </Link>

            <Button
              variant="primary"
              size="sm"
              icon={<ScanLine className="w-4 h-4" />}
              onClick={() => setIsScanModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <span>Scansiona scontrino</span>
            </Button>

            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setIsMenuOpen((prev) => !prev)}
              >
                <span>Nuovo Allegato</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
              </Button>

              {isMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-20 overflow-hidden py-1.5 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        setIsScanModalOpen(true);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors text-left cursor-pointer border-b border-emerald-100 dark:border-emerald-900/50"
                    >
                      <ScanLine className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Scansiona scontrino (Pre-elaborazione OCR)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        cameraInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/60 transition-colors text-left cursor-pointer"
                    >
                      <Camera className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span>Scatta foto rapida</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        galleryInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/60 transition-colors text-left cursor-pointer"
                    >
                      <ImageIcon className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                      <span>Scegli dalla Libreria Foto</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-700/60 transition-colors text-left cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Seleziona File (Immagini / PDF)</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Link
          to={ROUTES.SETTINGS}
          className="hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Impostazioni
        </Link>
        <span>/</span>
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Allegati</span>
      </div>

      {/* Toast / Alert Feedback */}
      {feedbackMsg && (
        <div className="flex items-center gap-2 p-4 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 rounded-2xl text-sm font-semibold border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Banner per documenti OCR in attesa di revisione */}
      <PendingOcrReviewBanner
        onOpenReview={(sessionId, ocrProcId) => {
          setReviewSessionId(sessionId);
          setReviewOcrProcessId(ocrProcId);
          setIsReviewModalOpen(true);
        }}
      />

      {/* Stats & Retention Policy Bar (013-L) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold block">Totale Allegati</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white mt-0.5 block">{attachments?.length || 0} file</span>
          </div>
          <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <Paperclip className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold block">Spazio Occupato</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white mt-0.5 block">{formatFileSize(totalSizeBytes)}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
            <ImageIcon className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold block">Politica Conservazione</span>
            <span className="text-xs font-bold text-slate-900 dark:text-white mt-1 block">6 Mesi (Configurabile)</span>
          </div>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            Locale
          </span>
        </div>
      </div>

      {/* Filter Tabs (013-L Sezioni) */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setActiveFilterTab('all')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
            activeFilterTab === 'all'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          Tutti ({attachments?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveFilterTab('receipts')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeFilterTab === 'receipts'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          Immagini scontrini ({receiptsCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveFilterTab('documents')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeFilterTab === 'documents'
              ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Documenti e PDF ({docsCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveFilterTab('unlinked')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeFilterTab === 'unlinked'
              ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          Senza collegamento ({unlinkedCount})
        </button>
      </div>

      {/* Main List / Table Box with 3 Columns */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs overflow-hidden">
        <div className="overflow-x-auto -mx-6 -my-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-6 py-4">Nome Fornitore</th>
                <th className="px-6 py-4">Data Acquisto</th>
                <th className="px-6 py-4 text-right">Importo Acquisto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {!filteredAttachments || filteredAttachments.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 font-medium">
                    Nessun allegato presente per la sezione selezionata.
                  </td>
                </tr>
              ) : (
                filteredAttachments.map((att) => {
                  const linkedExpense = findExpense(att);
                  const supplier = linkedExpense?.supplierId
                    ? suppliers?.find((s) => s.id === linkedExpense.supplierId)
                    : undefined;

                  const supplierName =
                    supplier?.name ||
                    linkedExpense?.description ||
                    att.description ||
                    att.fileName;

                  const purchaseDate = linkedExpense?.expenseDate
                    ? formatDate(linkedExpense.expenseDate)
                    : formatDate(att.createdAt.substring(0, 10));

                  const purchaseAmount =
                    linkedExpense?.amount !== undefined
                      ? formatCurrency(linkedExpense.amount)
                      : '—';

                  const isPdf = att.mimeType?.includes('pdf') || att.fileName.toLowerCase().endsWith('.pdf');
                  const isImage = att.mimeType?.startsWith('image') || !isPdf;

                  return (
                    <tr
                      key={att.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group"
                    >
                      {/* Column 1: Nome Fornitore */}
                      <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 font-bold text-xs overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                            {isImage && att.storageKey ? (
                              <img
                                src={att.storageKey}
                                alt={att.fileName}
                                className="w-full h-full object-cover"
                              />
                            ) : isPdf ? (
                              <FileText className="w-4 h-4 text-rose-500" />
                            ) : (
                              <File className="w-4 h-4 text-indigo-500" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="block truncate font-semibold text-slate-900 dark:text-white">
                              {supplierName}
                            </span>
                            <span className="block text-xs font-normal text-slate-400 dark:text-slate-500 truncate">
                              {att.fileName} • {formatFileSize(att.sizeBytes)}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Data Acquisto */}
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap">
                        {purchaseDate}
                      </td>

                      {/* Column 3: Importo Acquisto (with actions) */}
                      <td className="px-6 py-4 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        <div className="flex items-center justify-end gap-3">
                          <span>{purchaseAmount}</span>
                          <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => setViewingAttachment(att)}
                              className="p-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-xl transition-colors cursor-pointer"
                              title="Apri allegato"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(att)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                              title="Modifica"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(att)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                              title="Elimina"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Confirmation Modal */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        title="Carica Nuovo Allegato"
        subtitle="Verifica e assegna le informazioni all'allegato"
        maxWidth="lg"
      >
        {formError && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-medium border border-rose-200 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* Thumbnail Preview */}
        {fileDataUrl && (
          <div className="p-3 mb-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center gap-3">
            {selectedFile?.type.startsWith('image') ? (
              <img src={fileDataUrl} alt="Preview" className="w-16 h-16 object-cover rounded-xl shrink-0 border border-slate-200 dark:border-slate-700" />
            ) : (
              <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/50 text-rose-600 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-8 h-8" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white text-xs truncate">
                {selectedFile?.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Dimensione: {selectedFile ? formatFileSize(selectedFile.size) : '0 B'}
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSaveUpload} className="space-y-4 text-sm">
          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Nome File / Titolo Allegato
            </label>
            <input
              type="text"
              value={uploadFileName}
              onChange={(e) => {
                setUploadFileName(e.target.value);
                if (formError) setFormError(null);
              }}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Es. Scontrino Supermercato 27 Luglio"
              required
            />
          </div>

          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Descrizione (opzionale)
            </label>
            <textarea
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Aggiungi eventuali dettagli sul documento o garanzia..."
              rows={2}
            />
          </div>

          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Collega ad una Spesa (opzionale)
            </label>
            <select
              value={uploadExpenseId}
              onChange={(e) => setUploadExpenseId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Nessuna spesa collegata</option>
              {expenses?.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {formatDate(exp.expenseDate)} - {exp.description || 'Spesa'} ({formatCurrency(exp.amount)})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsUploadModalOpen(false)}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant="primary"
            >
              Carica Allegato
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingAttachment}
        onClose={() => setEditingAttachment(null)}
        title="Modifica Dettagli Allegato"
        subtitle="Aggiorna informazioni e collegamento spesa"
      >
        {formError && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-medium border border-rose-200 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSaveEdit} className="space-y-4 text-sm">
          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Nome File
            </label>
            <input
              type="text"
              value={editFileName}
              onChange={(e) => setEditFileName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Descrizione
            </label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows={2}
            />
          </div>

          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Collega ad una Spesa
            </label>
            <select
              value={editExpenseId}
              onChange={(e) => setEditExpenseId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Nessuna spesa collegata</option>
              {expenses?.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {formatDate(exp.expenseDate)} - {exp.description || 'Spesa'} ({formatCurrency(exp.amount)})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingAttachment(null)}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant="primary"
            >
              Salva Modifiche
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Elimina Allegato"
        subtitle="Conferma l'eliminazione dell'allegato"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-rose-600">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">
              Eliminare definitivamente questo allegato?
            </p>
          </div>

          {deleteTarget && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white text-sm">
              {deleteTarget.fileName} ({formatFileSize(deleteTarget.sizeBytes)})
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirmDelete}
            >
              Elimina
            </Button>
          </div>
        </div>
      </Modal>

      {/* Viewing / Preview Modal */}
      {viewingAttachment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-4xl p-6 shadow-2xl space-y-4 max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {viewingAttachment.fileName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {formatDate(viewingAttachment.createdAt.substring(0, 10))} • {formatFileSize(viewingAttachment.sizeBytes)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={viewingAttachment.storageKey}
                  download={viewingAttachment.fileName}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-semibold text-xs rounded-xl hover:bg-indigo-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Scarica
                </a>

                <button
                  onClick={() => setViewingAttachment(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-950 rounded-2xl p-4 flex items-center justify-center min-h-[300px]">
              {viewingAttachment.mimeType?.includes('pdf') || viewingAttachment.fileName.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={viewingAttachment.storageKey}
                  title={viewingAttachment.fileName}
                  className="w-full h-[65vh] rounded-xl border-0"
                />
              ) : (
                <img
                  src={viewingAttachment.storageKey}
                  alt={viewingAttachment.fileName}
                  className="max-w-full max-h-[65vh] object-contain rounded-xl shadow-md"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal di Scansione & Pre-elaborazione Scontrino */}
      <ScanReceiptModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        onScanComplete={(_attId, ocrProcId) => {
          showFeedback('Scontrino scansionato e pre-elaborato con successo');
          setIsScanModalOpen(false);
          setReviewOcrProcessId(ocrProcId);
          setIsReviewModalOpen(true);
        }}
      />

      {/* Modal di Revisione Obbligatoria Dati OCR */}
      <OcrReviewModal
        isOpen={isReviewModalOpen}
        onClose={() => {
          setIsReviewModalOpen(false);
          setReviewSessionId(null);
          setReviewOcrProcessId(null);
        }}
        sessionId={reviewSessionId || undefined}
        ocrProcessId={reviewOcrProcessId || undefined}
        onReviewConfirmed={() => {
          showFeedback('Revisione dati OCR confermata con successo');
          setIsReviewModalOpen(false);
          setReviewSessionId(null);
          setReviewOcrProcessId(null);
        }}
      />
    </div>
  );
};
