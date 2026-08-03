import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button } from '../../components/common';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Plus,
  Trash2,
  Save,
  Check,
  FileText,
  Sparkles,
  Package,
  Tag,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Store,
  Calendar,
  CreditCard,
  Info,
} from 'lucide-react';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  ocrReceiptLineRepository,
  supplierRepository,
  productRepository,
  categoryRepository,
} from '../../repositories';
import { productClassificationService } from '../../services/productClassification/ProductClassificationService';
import { receiptParserService } from '../../services/ocrParser/receiptParserService';
import { ocrService } from '../../services/ocrService';
import type {
  DocumentSession,
  DocumentPageSegment,
  OCRProcess,
  Supplier,
  Product,
  Category,
  PaymentMethod,
  OCRLineReviewStatus,
  Attachment,
} from '../../types';
import type {
  ReceiptClassificationProposal,
  ClassificationMatchResult,
  ConfidenceLevel,
  CandidateMatch,
  LineClassificationDecision,
} from '../../services/productClassification/types';

export interface OcrReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
  ocrProcessId?: string | null;
  onReviewConfirmed?: (ocrProcessId: string) => void;
}

export interface EditableReviewLine {
  id: string; // database ID or temporary ID
  ocrProcessId: string;
  originalText: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  confidence: number;
  reviewStatus: OCRLineReviewStatus;
  productId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  // Proposal details
  confidenceLevel?: ConfidenceLevel;
  candidateMatches?: CandidateMatch[];
  matchedProduct?: Product | null;
  proposedCategoryName?: string;
  proposedSubcategoryName?: string;
  hasConflict?: boolean;
  conflictDetails?: string;
  warnings?: string[];
  isNewRow?: boolean;
  actionMode?: 'link_existing' | 'create_new' | 'unlinked';
  newProductDisplayName?: string;
}

export const OcrReviewModal: React.FC<OcrReviewModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  ocrProcessId,
  onReviewConfirmed,
}) => {
  // Loading & Error States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Entities loaded from database
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [segments, setSegments] = useState<DocumentPageSegment[]>([]);
  const [attachmentsMap, setAttachmentsMap] = useState<Record<string, Attachment>>({});
  const [ocrProcess, setOcrProcess] = useState<OCRProcess | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [parentCategories, setParentCategories] = useState<Category[]>([]);

  // Mobile layout tab state ('image' vs 'data')
  const [activeMobileTab, setActiveMobileTab] = useState<'image' | 'data'>('data');

  // Image Viewer State
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);

  // Editable Form State
  const [detectedSupplierName, setDetectedSupplierName] = useState<string>('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('new'); // 'new' or supplierId
  const [newSupplierName, setNewSupplierName] = useState<string>('');
  const [expenseDate, setExpenseDate] = useState<string>('');
  const [documentTotal, setDocumentTotal] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('debitCard');
  const [editableLines, setEditableLines] = useState<EditableReviewLine[]>([]);

  // Load database entities & initialize review draft
  const loadReviewData = useCallback(async () => {
    if (!isOpen) return;
    setIsLoading(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      // 1. Identify active session and ocrProcess
      let activeSession: DocumentSession | null = null;
      let activeOcrProcess: OCRProcess | null = null;

      if (sessionId) {
        activeSession = await documentSessionRepository.getById(sessionId) || null;
      }
      if (ocrProcessId) {
        activeOcrProcess = await ocrProcessRepository.getById(ocrProcessId) || null;
      }

      if (!activeSession && activeOcrProcess) {
        // Find session linked to ocrProcess
        const allSessions = await documentSessionRepository.getAll();
        activeSession = allSessions.find((s) => s.ocrProcessId === activeOcrProcess?.id) || null;
      }

      if (activeSession && !activeOcrProcess && activeSession.ocrProcessId) {
        activeOcrProcess = await ocrProcessRepository.getById(activeSession.ocrProcessId) || null;
      }

      // If session exists but no OCRProcess, run recognition or create OCRProcess
      if (activeSession && !activeOcrProcess) {
        try {
          activeOcrProcess = await ocrService.recognize(activeSession.id);
        } catch {
          // If recognize fails because rawText is empty, create minimal process
          const segs = await documentPageSegmentRepository.getBySessionId(activeSession.id);
          if (segs.length > 0) {
            activeOcrProcess = await ocrProcessRepository.create({
              attachmentId: segs[0].attachmentId,
              status: 'pending',
              confirmationRequired: true,
              confirmedByUser: false,
            });
            await documentSessionRepository.update(activeSession.id, { ocrProcessId: activeOcrProcess.id });
          }
        }
      }

      if (!activeOcrProcess) {
        throw new Error('Impossibile caricare il processo OCR per la revisione');
      }

      // 2. Ensure rawText parsed & classified
      if (!activeOcrProcess.detectedSupplier && activeOcrProcess.rawText) {
        try {
          await receiptParserService.parse(activeOcrProcess.id);
          activeOcrProcess = await ocrProcessRepository.getById(activeOcrProcess.id) || activeOcrProcess;
        } catch (parseErr) {
          console.warn('[OcrReviewModal] Error during parsing:', parseErr);
        }
      }

      // Run classification proposal
      let proposal: ReceiptClassificationProposal | null = null;
      try {
        proposal = await productClassificationService.classifyReceiptLines(activeOcrProcess.id);
      } catch (classErr) {
        console.warn('[OcrReviewModal] Error during classification:', classErr);
      }

      setSession(activeSession);
      setOcrProcess(activeOcrProcess);

      // 3. Load segments & attachments for image viewer
      if (activeSession) {
        const segs = await documentPageSegmentRepository.getBySessionId(activeSession.id);
        setSegments(segs);

        const atts: Record<string, Attachment> = {};
        for (const seg of segs) {
          if (seg.attachmentId) {
            const att = await attachmentRepository.getById(seg.attachmentId);
            if (att) atts[seg.id] = att;
          }
        }
        setAttachmentsMap(atts);
      } else if (activeOcrProcess.attachmentId) {
        const att = await attachmentRepository.getById(activeOcrProcess.attachmentId);
        if (att) {
          setAttachmentsMap({ default: att });
        }
      }

      // 4. Load catalog options (Suppliers, Products, Categories)
      const [allSuppliers, allProducts, allCategories] = await Promise.all([
        supplierRepository.getAll(),
        productRepository.getAll(),
        categoryRepository.getAll(),
      ]);

      setSuppliers(allSuppliers);
      setProducts(allProducts);
      setCategories(allCategories);
      setParentCategories(allCategories.filter((c) => c.level === 1));

      // 5. Initialize Editable Form Fields
      const detSup = activeOcrProcess.detectedSupplier || proposal?.supplierProposal.detectedName || '';
      setDetectedSupplierName(detSup);

      // Match supplier in catalog
      const matchedSup = proposal?.supplierProposal.matchedSupplier;
      if (matchedSup) {
        setSelectedSupplierId(matchedSup.id);
        setNewSupplierName(detSup);
      } else if (detSup) {
        const supMatch = allSuppliers.find(
          (s) => s.name.toLowerCase() === detSup.toLowerCase() || s.aliases.some((a) => a.toLowerCase() === detSup.toLowerCase())
        );
        if (supMatch) {
          setSelectedSupplierId(supMatch.id);
          setNewSupplierName(detSup);
        } else {
          setSelectedSupplierId('new');
          setNewSupplierName(detSup);
        }
      } else {
        setSelectedSupplierId('new');
        setNewSupplierName('');
      }

      setExpenseDate(
        activeOcrProcess.detectedDate || new Date().toISOString().substring(0, 10)
      );

      setDocumentTotal(activeOcrProcess.detectedTotal || 0);

      // 6. Load OCR receipt lines & merge with proposals
      const dbLines = await ocrReceiptLineRepository.getByOcrProcessId(activeOcrProcess.id);
      const proposalMap = new Map<string, ClassificationMatchResult>();
      if (proposal) {
        for (const prop of proposal.lineProposals) {
          if (prop.lineId) proposalMap.set(prop.lineId, prop);
        }
      }

      const reviewLines: EditableReviewLine[] = dbLines.map((line) => {
        const prop = proposalMap.get(line.id);
        const catId = prop?.proposedCategory?.id || null;
        const subcatId = prop?.proposedSubcategory?.id || null;

        const matchedProd = prop?.matchedProduct || null;
        const initialProdId = line.productId || matchedProd?.id || null;

        let initialActionMode: 'link_existing' | 'create_new' | 'unlinked' = 'unlinked';
        if (initialProdId) {
          initialActionMode = 'link_existing';
        } else if (prop?.proposedNewProduct) {
          initialActionMode = 'create_new';
        }

        return {
          id: line.id,
          ocrProcessId: line.ocrProcessId,
          originalText: line.originalText || line.description,
          description: line.description || line.originalText,
          quantity: line.quantity || 1,
          unitPrice: line.unitPrice || 0,
          lineTotal: line.lineTotal || 0,
          confidence: line.confidence || 80,
          reviewStatus: line.reviewStatus || 'pending',
          productId: initialProdId,
          categoryId: catId,
          subcategoryId: subcatId,
          confidenceLevel: prop?.confidenceLevel || (initialProdId ? 'exact' : 'new_product'),
          candidateMatches: prop?.candidateMatches || [],
          matchedProduct: matchedProd,
          proposedCategoryName: prop?.proposedCategory?.name,
          proposedSubcategoryName: prop?.proposedSubcategory?.name,
          hasConflict: prop?.hasConflict || false,
          conflictDetails: prop?.conflictDetails,
          warnings: prop?.warnings || [],
          isNewRow: false,
          actionMode: initialActionMode,
          newProductDisplayName: prop?.proposedNewProduct?.displayName || line.description || line.originalText,
        };
      });

      setEditableLines(reviewLines);

      // Update session status to ready_for_review
      if (activeSession && activeSession.status !== 'ready_for_review' && activeSession.status !== 'reviewed') {
        await documentSessionRepository.update(activeSession.id, { status: 'ready_for_review' });
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Errore durante la preparazione della schermata di revisione');
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, sessionId, ocrProcessId]);

  useEffect(() => {
    if (isOpen) {
      loadReviewData();
    }
  }, [isOpen, loadReviewData]);

  // Calculations & Validation checks
  const calculatedSumLines = editableLines.reduce(
    (acc, line) => acc + (line.lineTotal > 0 ? line.lineTotal : line.quantity * line.unitPrice),
    0
  );

  const roundedSumLines = Math.round(calculatedSumLines * 100) / 100;
  const roundedDocTotal = Math.round(documentTotal * 100) / 100;
  const hasTotalDiscrepancy = Math.abs(roundedSumLines - roundedDocTotal) > 0.01;

  // Handlers for Form Edits
  const handleLineChange = (
    lineId: string,
    field: keyof EditableReviewLine,
    value: any
  ) => {
    setEditableLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const updated = { ...line, [field]: value, reviewStatus: 'modified' as OCRLineReviewStatus };

        // Auto-recalculate lineTotal if quantity or unitPrice changes
        if (field === 'quantity' || field === 'unitPrice') {
          const qty = field === 'quantity' ? Number(value) : line.quantity;
          const price = field === 'unitPrice' ? Number(value) : line.unitPrice;
          updated.lineTotal = Math.round(qty * price * 100) / 100;
        }

        // If product selected, auto-set default category if available
        if (field === 'productId' && value) {
          const prod = products.find((p) => p.id === value);
          if (prod) {
            if (prod.categoryId) updated.categoryId = prod.categoryId;
            if (prod.subcategoryId) updated.subcategoryId = prod.subcategoryId;
          }
        }

        return updated;
      })
    );
  };

  const handleAddLine = () => {
    const tempId = `temp-line-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newLine: EditableReviewLine = {
      id: tempId,
      ocrProcessId: ocrProcess?.id || '',
      originalText: '[Inserimento manuale]',
      description: 'Nuovo articolo',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      confidence: 100,
      reviewStatus: 'modified',
      productId: null,
      categoryId: categories.find((c) => c.level === 1)?.id || null,
      subcategoryId: null,
      isNewRow: true,
    };
    setEditableLines((prev) => [...prev, newLine]);
  };

  const handleDeleteLine = (lineId: string) => {
    setEditableLines((prev) => prev.filter((l) => l.id !== lineId));
  };

  // Save Review Draft (Progressive save without finalization)
  const handleSaveDraft = async () => {
    if (!ocrProcess) return;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      // Determine final supplier name for draft
      const finalSupplierName =
        selectedSupplierId === 'new'
          ? newSupplierName.trim()
          : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

      // Update OCRProcess record
      await ocrProcessRepository.update(ocrProcess.id, {
        detectedSupplier: finalSupplierName || null,
        detectedDate: expenseDate || null,
        detectedTotal: documentTotal || null,
        confirmedByUser: false,
      });

      // Update / Create / Delete lines in database
      const existingDbLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id);
      const currentLineIds = new Set(editableLines.map((l) => l.id));

      // Remove lines deleted in review form
      for (const dbLine of existingDbLines) {
        if (!currentLineIds.has(dbLine.id)) {
          await ocrReceiptLineRepository.delete(dbLine.id);
        }
      }

      // Upsert current lines
      for (const line of editableLines) {
        if (line.isNewRow || line.id.startsWith('temp-line-')) {
          await ocrReceiptLineRepository.create({
            ocrProcessId: ocrProcess.id,
            originalText: line.originalText,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            confidence: line.confidence,
            reviewStatus: 'modified',
            productId: line.productId || null,
          });
        } else {
          await ocrReceiptLineRepository.update(line.id, {
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            productId: line.productId || null,
            reviewStatus: line.reviewStatus,
          });
        }
      }

      // Update session status
      if (session) {
        await documentSessionRepository.update(session.id, {
          status: 'ready_for_review',
        });
      }

      setFeedbackMessage('Bozza di revisione salvata con successo');
      setTimeout(() => setFeedbackMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Errore durante il salvataggio della bozza di revisione');
    } finally {
      setIsSaving(false);
    }
  };

  // Confirm Review (Mark confirmedByUser: true, learn aliases and create products safely)
  const handleConfirmReview = async () => {
    if (!ocrProcess) return;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const finalSupplierName =
        selectedSupplierId === 'new'
          ? newSupplierName.trim()
          : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

      // Identify deleted lines to be removed inside the atomic confirmation transaction
      const existingDbLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id);
      const currentLineIds = new Set(editableLines.map((l) => l.id));
      const deletedLineIds: string[] = [];

      for (const dbLine of existingDbLines) {
        if (!currentLineIds.has(dbLine.id)) {
          deletedLineIds.push(dbLine.id);
        }
      }

      // Map line classification decisions
      const decisions: LineClassificationDecision[] = editableLines.map((line) => {
        let action: 'link_existing' | 'create_new' | 'unlinked' = line.actionMode || 'unlinked';

        if (line.productId && line.productId !== 'CREATE_NEW') {
          action = 'link_existing';
        } else if (line.productId === 'CREATE_NEW' || action === 'create_new') {
          action = 'create_new';
        }

        return {
          lineId: line.id,
          originalText: line.originalText,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          confidence: line.confidence,
          action,
          productId: action === 'link_existing' ? line.productId : null,
          newProductDetails:
            action === 'create_new'
              ? {
                  displayName: line.newProductDisplayName || line.description,
                  categoryId: line.categoryId || null,
                  subcategoryId: line.subcategoryId || null,
                }
              : undefined,
          categoryId: line.categoryId || null,
          subcategoryId: line.subcategoryId || null,
        };
      });

      await productClassificationService.confirmReceiptClassifications({
        ocrProcessId: ocrProcess.id,
        supplierId: selectedSupplierId === 'new' ? null : selectedSupplierId,
        supplierName: finalSupplierName,
        expenseDate,
        documentTotal,
        decisions,
        deletedLineIds,
      });

      // Update Session status to 'reviewed'
      if (session) {
        await documentSessionRepository.update(session.id, {
          status: 'reviewed',
        });
      }

      if (onReviewConfirmed) {
        onReviewConfirmed(ocrProcess.id);
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Errore durante la conferma della revisione');
    } finally {
      setIsSaving(false);
    }
  };

  // Image Viewer Helpers
  const activeSegment = segments[activeSegmentIndex];
  const activeAttachment = activeSegment
    ? attachmentsMap[activeSegment.id]
    : Object.values(attachmentsMap)[0];
  const activeImageUrl = activeAttachment?.storageKey || '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Revisione e Verifica Dati OCR"
      subtitle={
        session?.metadata?.title
          ? `Documento: ${session.metadata.title as string}`
          : 'Confronta il documento originale con la proposta OCR prima della conferma'
      }
      maxWidth="5xl"
    >
      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Caricamento e classificazione dati OCR in corso...
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Error Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2.5 p-3.5 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-2xl text-xs font-semibold border border-rose-200 dark:border-rose-900">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="flex-1">{errorMessage}</span>
            </div>
          )}

          {/* Feedback Banner */}
          {feedbackMessage && (
            <div className="flex items-center gap-2.5 p-3.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 rounded-2xl text-xs font-semibold border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span className="flex-1">{feedbackMessage}</span>
            </div>
          )}

          {/* Discrepancy Alert */}
          {hasTotalDiscrepancy && (
            <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block text-slate-900 dark:text-white mb-0.5">
                  Attenzione: Discrepanza sul Totale Documento
                </span>
                La somma delle righe ({roundedSumLines.toFixed(2)} €) non corrisponde al totale dichiarato nel documento ({roundedDocTotal.toFixed(2)} €). Verifica la presenza di sconti o errori di lettura.
              </div>
            </div>
          )}

          {/* Mobile Tab Switcher */}
          <div className="flex sm:hidden items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveMobileTab('image')}
              className={`flex-1 py-2 rounded-lg transition-all ${
                activeMobileTab === 'image'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Documento Originale
            </button>
            <button
              type="button"
              onClick={() => setActiveMobileTab('data')}
              className={`flex-1 py-2 rounded-lg transition-all ${
                activeMobileTab === 'data'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Dati Estratti & Righe ({editableLines.length})
            </button>
          </div>

          {/* Main 2-Column Split View */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start max-h-[72vh] overflow-hidden">
            {/* COLUMN 1: Image Viewer (Desktop: 5 cols, Mobile: hidden unless activeMobileTab === 'image') */}
            <div
              className={`lg:col-span-5 flex flex-col h-full bg-slate-950 rounded-3xl border border-slate-800 overflow-hidden min-h-[420px] max-h-[68vh] ${
                activeMobileTab === 'image' ? 'block' : 'hidden lg:flex'
              }`}
            >
              {/* Image Controls Header */}
              <div className="flex items-center justify-between p-3 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-300">
                <div className="flex items-center gap-1.5 font-medium min-w-0">
                  <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="truncate">
                    {activeSegment ? `Pag. ${activeSegmentIndex + 1}/${segments.length}` : 'Immagine'}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                    className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-[11px] font-mono px-1">{Math.round(zoomLevel * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                    className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotationDegrees((r) => (r + 90) % 360)}
                    className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300"
                    title="Ruota 90°"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoomLevel(1);
                      setRotationDegrees(0);
                    }}
                    className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300"
                    title="Ripristina vista"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Image Container */}
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950 relative min-h-[340px]">
                {activeImageUrl ? (
                  activeAttachment?.mimeType?.includes('pdf') ? (
                    <iframe
                      src={activeImageUrl}
                      title="PDF Document"
                      className="w-full h-full rounded-xl border-0"
                    />
                  ) : (
                    <img
                      src={activeImageUrl}
                      alt="Documento OCR"
                      className="max-w-full max-h-[58vh] object-contain transition-transform duration-150 rounded-lg shadow-xl"
                      style={{
                        transform: `scale(${zoomLevel}) rotate(${rotationDegrees + (activeSegment?.rotationDegrees || 0)}deg)`,
                      }}
                    />
                  )
                ) : (
                  <div className="text-center text-slate-500 text-xs">
                    Nessun allegato immagine caricato
                  </div>
                )}
              </div>

              {/* Page Navigator Footer */}
              {segments.length > 1 && (
                <div className="flex items-center justify-between p-2.5 bg-slate-900/90 border-t border-slate-800 text-xs text-slate-300">
                  <button
                    type="button"
                    onClick={() => setActiveSegmentIndex((i) => Math.max(0, i - 1))}
                    disabled={activeSegmentIndex === 0}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" /> Pagina precedente
                  </button>

                  <span className="font-semibold text-slate-200">
                    {activeSegmentIndex + 1} / {segments.length}
                  </span>

                  <button
                    type="button"
                    onClick={() => setActiveSegmentIndex((i) => Math.min(segments.length - 1, i + 1))}
                    disabled={activeSegmentIndex === segments.length - 1}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
                  >
                    Pagina successiva <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* COLUMN 2: Editable Form & Line Items (Desktop: 7 cols, Mobile: hidden unless activeMobileTab === 'data') */}
            <div
              className={`lg:col-span-7 space-y-4 overflow-y-auto max-h-[68vh] pr-1.5 ${
                activeMobileTab === 'data' ? 'block' : 'hidden lg:block'
              }`}
            >
              {/* Document Header Metadata Box */}
              <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-3.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Store className="w-4 h-4 text-indigo-500" />
                    Intestazione Documento & Fornitore
                  </h4>
                  {ocrProcess?.confidence && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900">
                      <Sparkles className="w-3 h-3 text-indigo-500" />
                      Confidenza OCR: {ocrProcess.confidence}%
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Fornitore Select & Input */}
                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      Fornitore (Rilevato: "{detectedSupplierName || 'Non identificato'}")
                    </label>
                    <select
                      value={selectedSupplierId}
                      onChange={(e) => setSelectedSupplierId(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="new">
                        ➕ Crea / Proponi Nuovo Fornitore ({newSupplierName || 'Inserisci nome'})
                      </option>
                      {suppliers.map((sup) => (
                        <option key={sup.id} value={sup.id}>
                          🏢 {sup.name}
                        </option>
                      ))}
                    </select>

                    {selectedSupplierId === 'new' && (
                      <input
                        type="text"
                        value={newSupplierName}
                        onChange={(e) => setNewSupplierName(e.target.value)}
                        placeholder="Nome del nuovo fornitore"
                        className="w-full mt-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    )}
                  </div>

                  {/* Data Documento */}
                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-indigo-500" /> Data Acquisto
                    </label>
                    <input
                      type="date"
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Totale Documento */}
                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      Totale Scontrino (€)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={documentTotal || ''}
                      onChange={(e) => setDocumentTotal(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Metodo di Pagamento */}
                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <CreditCard className="w-3.5 h-3.5 text-indigo-500" /> Metodo di Pagamento
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="debitCard">Carta di Debito / Bancomat</option>
                      <option value="creditCard">Carta di Credito</option>
                      <option value="cash">Contanti</option>
                      <option value="bankTransfer">Bonifico Bancario</option>
                      <option value="digitalWallet">Digital Wallet (Satispay, Apple Pay)</option>
                      <option value="other">Altro</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Line Items Table Box */}
              <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Righe Scontrino & Classificazione Prodotti ({editableLines.length})
                    </h4>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAddLine}
                    icon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Aggiungi Riga
                  </Button>
                </div>

                {editableLines.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    Nessuna riga rilevata. Clicca "+ Aggiungi Riga" per inserire manualmente un articolo.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {editableLines.map((line, idx) => {
                      return (
                        <div
                          key={line.id}
                          className={`p-3.5 rounded-2xl border transition-all text-xs space-y-2.5 ${
                            line.hasConflict
                              ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-300 dark:border-amber-900'
                              : 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          {/* Top Row: Line Index & Original OCR Text */}
                          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200/50 dark:border-slate-700/50 pb-1.5">
                            <span className="font-bold text-indigo-600 dark:text-indigo-400">
                              # {idx + 1} • Testo OCR: "{line.originalText}"
                            </span>

                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Confidence Level Badge */}
                              {line.confidenceLevel === 'exact' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                                  <Package className="w-3 h-3 text-emerald-500" />
                                  Match Esatto (100%)
                                </span>
                              )}
                              {line.confidenceLevel === 'high_confidence' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800">
                                  <Package className="w-3 h-3 text-indigo-500" />
                                  Alta Confidenza ({line.confidence}%)
                                </span>
                              )}
                              {line.confidenceLevel === 'possible' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-md border border-sky-200 dark:border-sky-800">
                                  <Package className="w-3 h-3 text-sky-500" />
                                  Possibile Match ({line.confidence}%)
                                </span>
                              )}
                              {line.confidenceLevel === 'new_product' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800">
                                  <Plus className="w-3 h-3 text-purple-500" />
                                  Proposto come Nuovo Prodotto
                                </span>
                              )}
                              {line.confidenceLevel === 'unresolved' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800">
                                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                                  Da Verificare
                                </span>
                              )}

                              {line.hasConflict && (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-md"
                                  title={line.conflictDetails}
                                >
                                  <AlertTriangle className="w-3 h-3" /> Ambiguità / Conflitto
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={() => handleDeleteLine(line.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-md ml-auto"
                                title="Elimina riga"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Editable Fields Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                            {/* Descrizione (5 cols) */}
                            <div className="sm:col-span-5">
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Descrizione Articolo (da scontrino)
                              </label>
                              <input
                                type="text"
                                value={line.description}
                                onChange={(e) => handleLineChange(line.id, 'description', e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-1.5 font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>

                            {/* Quantità (2 cols) */}
                            <div className="sm:col-span-2">
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Quantità
                              </label>
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                value={line.quantity || ''}
                                onChange={(e) => handleLineChange(line.id, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2 py-1.5 font-semibold text-slate-900 dark:text-white text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>

                            {/* Prezzo Unitario (2.5 cols) */}
                            <div className="sm:col-span-2">
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Prezzo Unit. (€)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={line.unitPrice || ''}
                                onChange={(e) => handleLineChange(line.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2 py-1.5 font-semibold text-slate-900 dark:text-white text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>

                            {/* Totale Riga (2.5 cols) */}
                            <div className="sm:col-span-3">
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Totale Riga (€)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={line.lineTotal || ''}
                                onChange={(e) => handleLineChange(line.id, 'lineTotal', parseFloat(e.target.value) || 0)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2 py-1.5 font-bold text-slate-900 dark:text-white text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          </div>

                          {/* Classification Selection: Product & Category */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                            {/* Product Selector */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 flex items-center gap-1">
                                <Package className="w-3 h-3 text-indigo-500" /> Prodotto Associato
                              </label>
                              <select
                                value={line.productId || (line.actionMode === 'create_new' ? 'CREATE_NEW' : '')}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'CREATE_NEW') {
                                    handleLineChange(line.id, 'productId', null);
                                    handleLineChange(line.id, 'actionMode', 'create_new');
                                  } else if (val) {
                                    handleLineChange(line.id, 'productId', val);
                                    handleLineChange(line.id, 'actionMode', 'link_existing');
                                  } else {
                                    handleLineChange(line.id, 'productId', null);
                                    handleLineChange(line.id, 'actionMode', 'unlinked');
                                  }
                                }}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-1.5 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="">Nessun prodotto (Incollegato / Provvisorio)</option>
                                <option value="CREATE_NEW">➕ Crea nuovo prodotto nel catalogo</option>
                                {line.candidateMatches && line.candidateMatches.length > 0 && (
                                  <optgroup label="Candidati consigliati dall'algoritmo">
                                    {line.candidateMatches.map((c) => (
                                      <option key={c.product.id} value={c.product.id}>
                                        {c.product.displayName} ({c.score}% match)
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="Tutti i prodotti in catalogo">
                                  {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.displayName} {p.brand ? `(${p.brand})` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>

                              {line.actionMode === 'create_new' && (
                                <div className="mt-2 p-2 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-xl space-y-1">
                                  <label className="block text-[10px] font-bold text-purple-800 dark:text-purple-300">
                                    Nome da salvare in catalogo:
                                  </label>
                                  <input
                                    type="text"
                                    value={line.newProductDisplayName || line.description}
                                    onChange={(e) => handleLineChange(line.id, 'newProductDisplayName', e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-500 font-semibold"
                                  />
                                  <span className="block text-[10px] text-purple-600 dark:text-purple-400 italic">
                                    Verrà creato nel catalogo solo alla conferma, evitando duplicati.
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Category Selector */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5 flex items-center gap-1">
                                <Tag className="w-3 h-3 text-indigo-500" /> Categoria Proposta
                              </label>
                              <select
                                value={line.categoryId || ''}
                                onChange={(e) => handleLineChange(line.id, 'categoryId', e.target.value || null)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-1.5 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="">Seleziona Categoria...</option>
                                {parentCategories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Offline Protection Notice */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200 block mb-0.5">
                    Modalità Revisione Senza Scritture Contabili Defentive
                  </span>
                  La conferma della revisione convalida i dati estratti dall'OCR ed aggiorna lo stato della sessione a "reviewed", ma <strong>NON crea alcuna Spesa o Movimento di Bilancio</strong> fino alla successiva registrazione esplicita.
                </div>
              </div>
            </div>
          </div>

          {/* Modal Actions Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Annulla
            </Button>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={handleSaveDraft}
                disabled={isSaving}
                icon={<Save className="w-4 h-4 text-slate-600 dark:text-slate-300" />}
              >
                Salva bozza revisionata
              </Button>

              <Button
                type="button"
                variant="emerald"
                onClick={handleConfirmReview}
                disabled={isSaving}
                icon={
                  isSaving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )
                }
              >
                <span>{isSaving ? 'Salvataggio...' : 'Conferma revisione dati'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
