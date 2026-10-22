import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button } from '../../components/common';
import {
  CheckCircle2,
  AlertCircle,
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
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Calendar,
  Terminal,
  Copy,
  Download,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { db } from '../../database/db';
import { buildDiagnosticReport } from '../../utils/diagnosticReport';
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
import { TextNormalizationModule } from '../../services/ocrParser/modules/TextNormalizationModule';
import { bindDigitalReconstructionSemantics } from '../../vendor/motore-ocr-ai/core/reconstruction/digitalReconstruction';
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
  Expense,
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
  id: string;
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
  manuallyValidated?: boolean;
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
  const [progressText, setProgressText] = useState<string>('Caricamento e analisi dati OCR in corso...');
  const [progressPercentage, setProgressPercentage] = useState<number>(0);

  // Concurrency and lifecycle guards
  const processingSessionsRef = useRef<Set<string>>(new Set());
  const loadRequestIdRef = useRef<number>(0);

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
  const [reconstructionView, setReconstructionView] = useState<'digital' | 'compare'>('digital');

  // Editable Form State
  const [detectedSupplierName, setDetectedSupplierName] = useState<string>('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('new');
  const [newSupplierName, setNewSupplierName] = useState<string>('');
  const [expenseDate, setExpenseDate] = useState<string>('');
  const [documentTotal, setDocumentTotal] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [editableLines, setEditableLines] = useState<EditableReviewLine[]>([]);
  const [existingExpense, setExistingExpense] = useState<Expense | null>(null);
  const [isDiscrepancyApproved, setIsDiscrepancyApproved] = useState<boolean>(false);
  const [isDateDetectedFromOcr, setIsDateDetectedFromOcr] = useState<boolean>(false);

  // Inline row edit active ID & expanded product details ID
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [expandedDetailsRowId, setExpandedDetailsRowId] = useState<string | null>(null);

  // Diagnostics Modal State
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Load database entities & initialize review draft
  const loadReviewData = useCallback(async () => {
    if (!isOpen) return;
    const currentRequestId = ++loadRequestIdRef.current;
    const isCurrent = () => loadRequestIdRef.current === currentRequestId;

    setIsLoading(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      let activeSession: DocumentSession | null = null;
      let activeOcrProcess: OCRProcess | null = null;

      if (sessionId) {
        activeSession = await documentSessionRepository.getById(sessionId) || null;
      }
      if (!isCurrent()) return;

      if (ocrProcessId) {
        activeOcrProcess = await ocrProcessRepository.getById(ocrProcessId) || null;
      }
      if (!isCurrent()) return;

      if (!activeSession && activeOcrProcess) {
        const allSessions = await documentSessionRepository.getAll();
        if (!isCurrent()) return;
        activeSession = allSessions.find((s) => s.ocrProcessId === activeOcrProcess?.id) || null;
        if (!activeSession && activeOcrProcess.attachmentId) {
          const allSegments = await db.documentPageSegments.toArray();
          if (!isCurrent()) return;
          const seg = allSegments.find((s: DocumentPageSegment) => s.attachmentId === activeOcrProcess?.attachmentId);
          if (seg?.sessionId) {
            activeSession = await documentSessionRepository.getById(seg.sessionId) || null;
          }
        }
      }
      if (!isCurrent()) return;

      if (activeSession && !activeOcrProcess && activeSession.ocrProcessId) {
        activeOcrProcess = await ocrProcessRepository.getById(activeSession.ocrProcessId) || null;
      }
      if (!isCurrent()) return;

      const hasValidCompletedText = Boolean(
        activeOcrProcess &&
        activeOcrProcess.status === 'completed' &&
        activeOcrProcess.rawText &&
        activeOcrProcess.rawText.trim().length > 0
      );

      const needsOcrRecognition = Boolean(
        activeSession &&
        !activeOcrProcess?.confirmedByUser &&
        !hasValidCompletedText &&
        activeOcrProcess?.status !== 'processing' &&
        !processingSessionsRef.current.has(activeSession.id)
      );

      if (needsOcrRecognition && activeSession) {
        processingSessionsRef.current.add(activeSession.id);
        if (isCurrent()) {
          setProgressText('Inizializzazione motore OCR e riconoscimento testo...');
        }
        try {
          activeOcrProcess = await ocrService.recognize(activeSession.id, (prog) => {
            if (!isCurrent()) return;
            if (prog.statusText) setProgressText(prog.statusText);
            if (typeof prog.progressPercentage === 'number') {
              setProgressPercentage(prog.progressPercentage);
            }
          });
        } catch (ocrErr: any) {
          console.error('[OcrReviewModal] Errore recognize OCR:', ocrErr);
          if (isCurrent()) {
            setErrorMessage(
              `Riconoscimento OCR non riuscito: ${ocrErr?.message || 'Errore durante la scansione'}. È comunque possibile inserire i dati a mano.`
            );
          }
          if (activeSession.ocrProcessId) {
            activeOcrProcess = await ocrProcessRepository.getById(activeSession.ocrProcessId) || null;
          }
        } finally {
          processingSessionsRef.current.delete(activeSession.id);
        }
      }

      if (!isCurrent()) return;

      if (!activeOcrProcess && activeSession) {
        const segs = await documentPageSegmentRepository.getBySessionId(activeSession.id);
        if (!isCurrent()) return;
        if (segs.length > 0) {
          activeOcrProcess = await ocrProcessRepository.create({
            attachmentId: segs[0].attachmentId,
            status: 'pending',
            confirmationRequired: true,
            confirmedByUser: false,
          });
          if (!isCurrent()) return;
          await documentSessionRepository.update(activeSession.id, { ocrProcessId: activeOcrProcess.id });
        }
      }

      if (!isCurrent()) return;

      if (!activeOcrProcess) {
        throw new Error('Impossibile caricare il processo OCR per la revisione');
      }

      const hasRawText = Boolean(activeOcrProcess.rawText && activeOcrProcess.rawText.trim().length > 0);
      const existingLines = await ocrReceiptLineRepository.getByOcrProcessId(activeOcrProcess.id);
      if (!isCurrent()) return;

      if (
        hasRawText &&
        !activeOcrProcess.confirmedByUser &&
        (existingLines.length === 0 || (!activeOcrProcess.detectedSupplier && !activeOcrProcess.detectedTotal))
      ) {
        try {
          if (isCurrent()) {
            setProgressText('Analisi strutturata dello scontrino ed estrazione righe...');
          }
          await receiptParserService.parse(activeOcrProcess.id);
          if (!isCurrent()) return;
          activeOcrProcess = (await ocrProcessRepository.getById(activeOcrProcess.id)) || activeOcrProcess;
        } catch (parseErr: any) {
          console.warn('[OcrReviewModal] Errore parsing scontrino:', parseErr);
          if (isCurrent()) {
            setErrorMessage(
              `Parsing scontrino parziale: ${parseErr?.message || 'Nessun dato strutturato estratto'}. Completa o modifica i campi manualmente.`
            );
          }
        }
      } else if (!hasRawText && activeOcrProcess.status === 'completed') {
        if (isCurrent()) {
          setFeedbackMessage('Nessun testo rilevato nel documento. Puoi inserire i dati dello scontrino manualmente.');
        }
      }

      if (!isCurrent()) return;

      let proposal: ReceiptClassificationProposal | null = null;
      try {
        proposal = await productClassificationService.classifyReceiptLines(activeOcrProcess.id);
      } catch (classErr) {
        console.warn('[OcrReviewModal] Error during classification:', classErr);
      }

      if (!isCurrent()) return;

      setSession(activeSession);
      setOcrProcess(activeOcrProcess);

      if (activeSession) {
        const segs = await documentPageSegmentRepository.getBySessionId(activeSession.id);
        if (!isCurrent()) return;
        setSegments(segs);

        const atts: Record<string, Attachment> = {};
        for (const seg of segs) {
          if (seg.attachmentId) {
            const att = await attachmentRepository.getById(seg.attachmentId);
            if (!isCurrent()) return;
            if (att) atts[seg.id] = att;
          }
        }
        if (!isCurrent()) return;
        setAttachmentsMap(atts);
      } else if (activeOcrProcess.attachmentId) {
        const att = await attachmentRepository.getById(activeOcrProcess.attachmentId);
        if (!isCurrent()) return;
        if (att) {
          setAttachmentsMap({ default: att });
        }
      }

      if (!isCurrent()) return;

      const [allSuppliers, allProducts, allCategories] = await Promise.all([
        supplierRepository.getAll(),
        productRepository.getAll(),
        categoryRepository.getAll(),
      ]);

      if (!isCurrent()) return;

      setSuppliers(allSuppliers);
      setProducts(allProducts);
      setCategories(allCategories);
      setParentCategories(allCategories.filter((c) => c.level === 1));

      let foundExp: Expense | null = null;
      if (activeSession?.expenseId) {
        foundExp = (await db.expenses.get(activeSession.expenseId)) || null;
      }
      if (!isCurrent()) return;

      if (!foundExp && activeOcrProcess?.expenseId) {
        foundExp = (await db.expenses.get(activeOcrProcess.expenseId)) || null;
      }
      if (!isCurrent()) return;

      if (!foundExp) {
        const allExp = await db.expenses.toArray();
        if (!isCurrent()) return;
        foundExp =
          allExp.find((e) => {
            const m = e.metadata as Record<string, any> | undefined;
            return (
              m?.ocrProcessId === activeOcrProcess.id ||
              (activeSession?.id && m?.documentSessionId === activeSession.id)
            );
          }) || null;
      }
      if (!isCurrent()) return;
      setExistingExpense(foundExp);

      const detSup = activeOcrProcess.detectedSupplier || proposal?.supplierProposal.detectedName || '';
      setDetectedSupplierName(detSup);

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

      const hasOcrDate = Boolean(activeOcrProcess.detectedDate);
      setIsDateDetectedFromOcr(hasOcrDate);
      setExpenseDate(
        activeOcrProcess.detectedDate || new Date().toISOString().substring(0, 10)
      );

      setDocumentTotal(activeOcrProcess.detectedTotal || 0);

      const detectedPayMethod = (activeOcrProcess.metadata as Record<string, any>)?.detectedPaymentMethod;
      if (detectedPayMethod === 'contanti' || detectedPayMethod === 'cash') {
        setPaymentMethod('cash');
      } else if (detectedPayMethod === 'carta' || detectedPayMethod === 'creditCard') {
        setPaymentMethod('creditCard');
      } else if (detectedPayMethod === 'bancomat' || detectedPayMethod === 'debitCard') {
        setPaymentMethod('debitCard');
      } else if (detectedPayMethod === 'bonifico' || detectedPayMethod === 'bankTransfer') {
        setPaymentMethod('bankTransfer');
      } else if (detectedPayMethod === 'digitalWallet') {
        setPaymentMethod('digitalWallet');
      } else {
        const rawUpper = (activeOcrProcess.rawText || '').toUpperCase();
        if (/\b(?:CONTANT[EI]|RESTO\b|RESTO\s*[:=]?\s*\d|CASH)\b/i.test(rawUpper)) {
          setPaymentMethod('cash');
        } else if (/\b(?:BANCOMAT|PAGOBANCOMAT|DEBITO)\b/i.test(rawUpper)) {
          setPaymentMethod('debitCard');
        } else if (/\b(?:CARTA\s+CREDITO|CREDITO|POS|CONTACTLESS|VISA|MASTERCARD)\b/i.test(rawUpper)) {
          setPaymentMethod('creditCard');
        } else {
          setPaymentMethod('cash');
        }
      }

      const dbLines = await ocrReceiptLineRepository.getByOcrProcessId(activeOcrProcess.id);
      if (!isCurrent()) return;

      const proposalMap = new Map<string, ClassificationMatchResult>();
      if (proposal) {
        for (const prop of proposal.lineProposals) {
          if (prop.lineId) proposalMap.set(prop.lineId, prop);
        }
      }

      const reviewLines: EditableReviewLine[] = dbLines.map((line) => {
        const prop = proposalMap.get(line.id);
        const savedMeta = (line.metadata as Record<string, any>) || {};

        const catId = savedMeta.categoryId !== undefined ? savedMeta.categoryId : (prop?.proposedCategory?.id || null);
        const subcatId = savedMeta.subcategoryId !== undefined ? savedMeta.subcategoryId : (prop?.proposedSubcategory?.id || null);

        const matchedProd = prop?.matchedProduct || null;
        const initialProdId = line.productId || matchedProd?.id || null;

        const lineWarnings = [
          ...((savedMeta.warnings as string[]) || []),
          ...(prop?.warnings || []),
          ...(Array.isArray((line.metadata as Record<string, any>)?.warnings) ? (line.metadata as Record<string, any>).warnings : []),
        ];
        const uniqueWarnings = Array.from(new Set(lineWarnings));

        let initialActionMode: 'link_existing' | 'create_new' | 'unlinked' = savedMeta.actionMode || 'unlinked';
        if (!savedMeta.actionMode) {
          if (initialProdId) {
            initialActionMode = 'link_existing';
          } else if (prop?.proposedNewProduct) {
            initialActionMode = 'create_new';
          }
        }

        const savedNewProductName = savedMeta.newProductDisplayName || prop?.proposedNewProduct?.displayName || line.description || line.originalText;

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
          warnings: uniqueWarnings,
          isNewRow: false,
          actionMode: initialActionMode,
          newProductDisplayName: savedNewProductName,
          manuallyValidated: line.reviewStatus === 'confirmed' || line.reviewStatus === 'modified',
        };
      });

      if (!isCurrent()) return;
      setEditableLines(reviewLines);

      if (activeSession && activeSession.status !== 'ready_for_review' && activeSession.status !== 'reviewed') {
        await documentSessionRepository.update(activeSession.id, { status: 'ready_for_review' });
      }
    } catch (err: any) {
      if (isCurrent()) {
        setErrorMessage(err?.message || 'Errore durante la preparazione della schermata di revisione');
      }
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  }, [isOpen, sessionId, ocrProcessId]);

  useEffect(() => {
    if (isOpen) {
      loadReviewData();
    }
    return () => {
      loadRequestIdRef.current++;
    };
  }, [isOpen, loadReviewData]);

  const calculatedSumLines = editableLines.reduce(
    (acc, line) => acc + (line.lineTotal > 0 ? line.lineTotal : line.quantity * line.unitPrice),
    0
  );

  const roundedSumLines = Math.round(calculatedSumLines * 100) / 100;
  const roundedDocTotal = Math.round(documentTotal * 100) / 100;

  const documentCategory =
    session?.detectedDocumentCategory ||
    (ocrProcess?.metadata as Record<string, any>)?.documentCategory;

  const isPaymentProof = documentCategory === 'PAYMENT_PROOF';

  const rawDiscrepancy = Math.abs(roundedSumLines - roundedDocTotal);
  const effectiveDiscrepancy = isPaymentProof ? 0 : rawDiscrepancy;
  const hasTotalDiscrepancy = !isPaymentProof && effectiveDiscrepancy > 0.01;

  // Metadata extracted fields from ocrProcess metadata if available
  const ocrMeta = (ocrProcess?.metadata as Record<string, any>) || {};
  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const address = ocrMeta.detectedAddress || selectedSupplier?.address || '';
  const city = ocrMeta.detectedCity || '';
  const phone = ocrMeta.detectedPhone || '';
  const vatId = ocrMeta.detectedVatId || selectedSupplier?.taxCodeOrVatNumber || '';
  const time = ocrMeta.detectedTime || '';
  const vendor = ocrMeta.detectedVendor || '';
  const estimatedVat = Math.round(documentTotal * 0.10 * 100) / 100; // 10% average or estimated VAT

  const handleLineChange = (
    lineId: string,
    field: keyof EditableReviewLine,
    value: any
  ) => {
    setEditableLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const updated = { ...line, [field]: value, reviewStatus: 'modified' as OCRLineReviewStatus, manuallyValidated: true };

        if (field === 'quantity' || field === 'unitPrice') {
          const qty = field === 'quantity' ? Number(value) : line.quantity;
          const price = field === 'unitPrice' ? Number(value) : line.unitPrice;
          updated.lineTotal = Math.round(qty * price * 100) / 100;
        }

        if (field === 'unitPrice' || field === 'lineTotal') {
          const valNum = Number(value);
          if (valNum > 0 && Array.isArray(updated.warnings)) {
            updated.warnings = updated.warnings.filter(
              (w) =>
                w !== 'PRICE_NOT_DETECTED' &&
                w !== 'PRICE_ASSOCIATION_UNCERTAIN' &&
                w !== 'VAT_PRICE_AMBIGUOUS' &&
                w !== 'DISCOUNT_VALUE_NOT_DETECTED' &&
                w !== 'prezzo_riga_non_rilevato'
            );
          }
        }

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
    setEditingRowId(tempId);
  };

  const handleDeleteLine = (lineId: string) => {
    setEditableLines((prev) => prev.filter((l) => l.id !== lineId));
  };

  const handleConfirmLine = (lineId: string) => {
    const line = editableLines.find((l) => l.id === lineId);
    if (!line) return;

    const isDiscountOrReturn =
      line.lineTotal < 0 ||
      /SCONTO|PROMO|ABBUONO|COUPON|BUONO|RESO|STORNO|ARROTONDAMENTO/i.test(line.description || '');
    const hasBlockingOcrError =
      (!isDiscountOrReturn && line.unitPrice <= 0 && line.lineTotal <= 0) ||
      (line.warnings && line.warnings.includes('OCR_TEXT_SUSPECT'));

    if (hasBlockingOcrError) {
      setErrorMessage(`Impossibile confermare la riga "${line.description || line.originalText}": presenta un errore bloccante OCR.`);
      return;
    }

    setErrorMessage(null);
    setEditableLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        return {
          ...l,
          reviewStatus: 'confirmed' as OCRLineReviewStatus,
          manuallyValidated: true,
        };
      })
    );
  };

  const handleSaveDraft = async () => {
    if (!ocrProcess) return;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const finalSupplierName =
        selectedSupplierId === 'new'
          ? newSupplierName.trim()
          : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

      await ocrProcessRepository.update(ocrProcess.id, {
        detectedSupplier: finalSupplierName || null,
        detectedDate: expenseDate || null,
        detectedTotal: documentTotal || null,
        confirmedByUser: false,
      });

      const existingDbLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id);
      const currentLineIds = new Set(editableLines.map((l) => l.id));

      const idsToDelete = existingDbLines
        .filter((dbLine) => !currentLineIds.has(dbLine.id))
        .map((l) => l.id);
      if (idsToDelete.length > 0) {
        await db.ocrReceiptLines.bulkDelete(idsToDelete);
      }

      for (const line of editableLines) {
        const lineMetadata = {
          categoryId: line.categoryId || null,
          subcategoryId: line.subcategoryId || null,
          actionMode: line.actionMode || null,
          newProductDisplayName: line.newProductDisplayName || null,
        };

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
            metadata: lineMetadata,
          });
        } else {
          const existingLine = existingDbLines.find((l) => l.id === line.id);
          await ocrReceiptLineRepository.update(line.id, {
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            productId: line.productId || null,
            reviewStatus: line.reviewStatus,
            metadata: {
              ...((existingLine?.metadata as Record<string, any>) || {}),
              ...lineMetadata,
            },
          });
        }
      }

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

  const handleDeleteSession = async () => {
    if (!session && !ocrProcess) return;
    if (existingExpense) {
      setErrorMessage('Impossibile eliminare una scansione già registrata a bilancio');
      return;
    }

    const confirmed = window.confirm('Sei sicuro di voler eliminare questa scansione e i relativi dati OCR?');
    if (!confirmed) return;

    setIsSaving(true);
    try {
      if (session) {
        await documentSessionRepository.delete(session.id);
      } else if (ocrProcess) {
        await ocrReceiptLineRepository.deleteUnconfirmedByOcrProcessId(ocrProcess.id);
        await ocrProcessRepository.delete(ocrProcess.id);
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Errore durante l\'eliminazione della scansione');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRerunOcr = async () => {
    if (!session) return;
    setIsLoading(true);
    setErrorMessage(null);
    setEditableLines([]);
    setProgressText('Riavvio motore OCR...');
    try {
      if (ocrProcess) {
        await ocrReceiptLineRepository.deleteUnconfirmedByOcrProcessId(ocrProcess.id);
        await ocrProcessRepository.update(ocrProcess.id, {
          status: 'pending',
          rawText: undefined,
          detectedSupplier: undefined,
          detectedDate: undefined,
          detectedTotal: undefined,
          errorMessage: null,
        });
      }
      const updatedOcr = await ocrService.recognize(session.id, (prog) => {
        if (prog.statusText) setProgressText(prog.statusText);
        if (typeof prog.progressPercentage === 'number') {
          setProgressPercentage(prog.progressPercentage);
        }
      });
      if (updatedOcr && updatedOcr.rawText) {
        await receiptParserService.parse(updatedOcr.id);
      }
      await loadReviewData();
      setFeedbackMessage('Riconoscimento OCR completato con successo');
      setTimeout(() => setFeedbackMessage(null), 3000);
    } catch (err: any) {
      setErrorMessage(`Errore durante il riesame OCR: ${err?.message || 'Errore imprevisto'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const executeConfirmClassifications = async () => {
    if (!ocrProcess) return;

    const finalSupplierName =
      selectedSupplierId === 'new'
        ? newSupplierName.trim()
        : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

    const existingDbLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id);
    const currentLineIds = new Set(editableLines.map((l) => l.id));
    const deletedLineIds: string[] = [];

    for (const dbLine of existingDbLines) {
      if (!currentLineIds.has(dbLine.id)) {
        deletedLineIds.push(dbLine.id);
      }
    }

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

    if (session) {
      await documentSessionRepository.update(session.id, {
        status: 'reviewed',
      });
    }
  };

  const getFinalValidationErrors = (): string[] => {
    const errors: string[] = [];

    if (!expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      errors.push('Data acquisto mancante o non valida (formato AAAA-MM-GG).');
    }

    const finalSupplierName =
      selectedSupplierId === 'new'
        ? newSupplierName.trim()
        : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;
    if (!finalSupplierName || finalSupplierName.trim().length === 0) {
      errors.push('Fornitore non specificato: inserisci il nome del fornitore.');
    }

    if (documentTotal === undefined || documentTotal === null || isNaN(documentTotal) || documentTotal <= 0) {
      errors.push('Totale scontrino non valido (deve essere un importo maggiore di 0 €).');
    }

    if (!isPaymentProof && (!editableLines || editableLines.length === 0)) {
      errors.push('Il documento non contiene alcuna riga articolo.');
    }

    if (!isPaymentProof && editableLines.length > 0 && hasTotalDiscrepancy && !isDiscrepancyApproved) {
      errors.push(
        `Discrepanza sul totale scontrino non approvata: somma righe (€ ${roundedSumLines.toFixed(
          2
        )}) ≠ totale scontrino (€ ${roundedDocTotal.toFixed(
          2
        )}). Spunta "Confermo la discrepanza sul totale" per proseguire.`
      );
    }

    editableLines.forEach((line, index) => {
      const lineName = line.description?.trim() || line.originalText?.trim() || `Riga #${index + 1}`;

      if (!line.description || line.description.trim().length === 0) {
        errors.push(`Riga #${index + 1}: descrizione articolo mancante.`);
      }

      if (!line.categoryId || line.categoryId === 'cat-unclassified') {
        errors.push(`"${lineName}": categoria mancante. Seleziona una categoria valida prima di confermare.`);
      }

      if (line.quantity <= 0) {
        errors.push(`"${lineName}": quantità non valida (${line.quantity}).`);
      }

      const isDiscountOrReturn =
        line.lineTotal < 0 ||
        /SCONTO|PROMO|ABBUONO|COUPON|BUONO|RESO|STORNO|ARROTONDAMENTO/i.test(line.description || '');

      const lineWarns = Array.isArray(line.warnings) ? line.warnings : [];
      const hasUnresolvedPriceWarning =
        lineWarns.includes('PRICE_NOT_DETECTED') ||
        lineWarns.includes('PRICE_ASSOCIATION_UNCERTAIN') ||
        lineWarns.includes('VAT_PRICE_AMBIGUOUS') ||
        lineWarns.includes('DISCOUNT_VALUE_NOT_DETECTED') ||
        lineWarns.includes('prezzo_riga_non_rilevato');

      if (!isDiscountOrReturn) {
        if (hasUnresolvedPriceWarning) {
          errors.push(`"${lineName}": prezzo non rilevato o ambiguo dall'OCR. Inserisci manualmente il prezzo prima di confermare.`);
        } else if (line.unitPrice <= 0 && line.lineTotal <= 0) {
          errors.push(`"${lineName}": importo riga non valido (prezzo unitario e totale <= 0). Inserisci il prezzo prima di confermare.`);
        }
      }

      if (lineWarns.includes('OCR_TEXT_SUSPECT')) {
        errors.push(`"${lineName}": testo OCR sospetto o corrotto. Correggi la descrizione prima di confermare.`);
      }
    });

    return errors;
  };

  const handleConfirmReview = async () => {
    if (!ocrProcess) return;
    setIsSaving(true);
    setErrorMessage(null);

    // Auto-confirm pending valid lines
    setEditableLines((prev) =>
      prev.map((line) => {
        if (line.reviewStatus === 'pending') {
          const isDiscountOrReturn =
            line.lineTotal < 0 ||
            /SCONTO|PROMO|ABBUONO|COUPON|BUONO|RESO|STORNO|ARROTONDAMENTO/i.test(line.description || '');
          const hasBlockingOcrError =
            (!isDiscountOrReturn && line.unitPrice <= 0 && line.lineTotal <= 0) ||
            (line.warnings && line.warnings.includes('OCR_TEXT_SUSPECT'));
          if (!hasBlockingOcrError) {
            return {
              ...line,
              reviewStatus: 'confirmed' as OCRLineReviewStatus,
              manuallyValidated: true,
            };
          }
        }
        return line;
      })
    );

    const valErrors = getFinalValidationErrors();
    if (valErrors.length > 0) {
      setIsSaving(false);
      setErrorMessage(`Impossibile confermare la revisione (${valErrors.length} errore/i da correggere):\n• ${valErrors.join('\n• ')}`);
      return;
    }

    try {
      await executeConfirmClassifications();

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

  const handleCreateAccountingRegistration = async () => {
    if (!ocrProcess) return;
    setIsSaving(true);
    setErrorMessage(null);

    // Auto-confirm pending valid lines
    setEditableLines((prev) =>
      prev.map((line) => {
        if (line.reviewStatus === 'pending') {
          const isDiscountOrReturn =
            line.lineTotal < 0 ||
            /SCONTO|PROMO|ABBUONO|COUPON|BUONO|RESO|STORNO|ARROTONDAMENTO/i.test(line.description || '');
          const hasBlockingOcrError =
            (!isDiscountOrReturn && line.unitPrice <= 0 && line.lineTotal <= 0) ||
            (line.warnings && line.warnings.includes('OCR_TEXT_SUSPECT'));
          if (!hasBlockingOcrError) {
            return {
              ...line,
              reviewStatus: 'confirmed' as OCRLineReviewStatus,
              manuallyValidated: true,
            };
          }
        }
        return line;
      })
    );

    const valErrors = getFinalValidationErrors();
    if (valErrors.length > 0) {
      setIsSaving(false);
      setErrorMessage(`Impossibile registrare la spesa in contabilità (${valErrors.length} errore/i da correggere):\n• ${valErrors.join('\n• ')}`);
      return;
    }

    try {
      const finalSupplierName =
        selectedSupplierId === 'new'
          ? newSupplierName.trim()
          : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

      const existingDbLines = await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id);
      const currentLineIds = new Set(editableLines.map((l) => l.id));
      const deletedLineIds: string[] = [];

      for (const dbLine of existingDbLines) {
        if (!currentLineIds.has(dbLine.id)) {
          deletedLineIds.push(dbLine.id);
        }
      }

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

      const createdExp = await productClassificationService.createAccountingRegistration({
        ocrProcessId: ocrProcess.id,
        sessionId: session?.id,
        paymentMethod,
        supplierId: selectedSupplierId === 'new' ? null : selectedSupplierId,
        supplierName: finalSupplierName,
        expenseDate,
        documentTotal,
        decisions,
        deletedLineIds,
        allowDiscrepancy: isDiscrepancyApproved,
      });

      setExistingExpense(createdExp);
      setFeedbackMessage('Registrazione contabile (Spesa) creata con successo!');
      if (onReviewConfirmed) {
        onReviewConfirmed(ocrProcess.id);
      }
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Errore durante la creazione della registrazione contabile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    try {
      const finalSupplierName =
        selectedSupplierId === 'new'
          ? newSupplierName.trim()
          : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

      const persistedDbLines = ocrProcess?.id
        ? await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id)
        : [];

      const raw = ocrProcess?.rawText || '';
      const metaObj = (ocrProcess?.metadata as Record<string, any>) || {};
      const metaNorm = metaObj.normalizedLines;
      const normalizedLines = Array.isArray(metaNorm) && metaNorm.length > 0
        ? metaNorm
        : (raw ? TextNormalizationModule.normalize(raw).normalizedLines : []);

      const diagData = await buildDiagnosticReport({
        session,
        segments,
        attachmentsMap,
        ocrProcess,
        editableLines,
        documentCategory,
        calculatedSumLines: roundedSumLines,
        discrepancy: effectiveDiscrepancy,
        hasDiscrepancy: hasTotalDiscrepancy,
        isDiscrepancyApproved,
        validationErrors: getFinalValidationErrors(),
        detectedSupplierName,
        selectedSupplierName: finalSupplierName,
        expenseDate,
        isDateDetectedFromOcr,
        documentTotal,
        paymentMethod,
        persistedDbLinesCount: persistedDbLines.length,
        normalizedLines,
      });
      await navigator.clipboard.writeText(JSON.stringify(diagData, null, 2));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch (err) {
      console.error('Errore nella copia della diagnostica:', err);
    }
  };

  const handleDownloadDiagnostics = async () => {
    try {
      const finalSupplierName =
        selectedSupplierId === 'new'
          ? newSupplierName.trim()
          : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

      const persistedDbLines = ocrProcess?.id
        ? await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id)
        : [];

      const raw = ocrProcess?.rawText || '';
      const metaObj = (ocrProcess?.metadata as Record<string, any>) || {};
      const metaNorm = metaObj.normalizedLines;
      const normalizedLines = Array.isArray(metaNorm) && metaNorm.length > 0
        ? metaNorm
        : (raw ? TextNormalizationModule.normalize(raw).normalizedLines : []);

      const diagData = await buildDiagnosticReport({
        session,
        segments,
        attachmentsMap,
        ocrProcess,
        editableLines,
        documentCategory,
        calculatedSumLines: roundedSumLines,
        discrepancy: effectiveDiscrepancy,
        hasDiscrepancy: hasTotalDiscrepancy,
        isDiscrepancyApproved,
        validationErrors: getFinalValidationErrors(),
        detectedSupplierName,
        selectedSupplierName: finalSupplierName,
        expenseDate,
        isDateDetectedFromOcr,
        documentTotal,
        paymentMethod,
        persistedDbLinesCount: persistedDbLines.length,
        normalizedLines,
      });
      const blob = new Blob([JSON.stringify(diagData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagnostic-report-D1-${session?.id || 'session'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Errore nel download della diagnostica:', err);
    }
  };

  // Strict & Granular Visual State Helpers (Normal, Yellow, Red, Green)
  const getLineVisualState = (line: EditableReviewLine): 'normal' | 'yellow' | 'red' | 'green' => {
    // 1. Manually validated / modified / confirmed / new row => GREEN
    if (
      line.reviewStatus === 'modified' ||
      line.reviewStatus === 'confirmed' ||
      line.isNewRow ||
      line.manuallyValidated
    ) {
      return 'green';
    }

    const isDiscountOrReturn =
      line.lineTotal < 0 ||
      /SCONTO|PROMO|ABBUONO|COUPON|BUONO|RESO|STORNO|ARROTONDAMENTO/i.test(line.description || '');

    // 2. Real blocking OCR error / invalid price => RED (hasConflict is classification, not blocking OCR error)
    const hasBlockingOcrError =
      (!isDiscountOrReturn && line.unitPrice <= 0 && line.lineTotal <= 0) ||
      (line.warnings && line.warnings.includes('OCR_TEXT_SUSPECT'));

    if (hasBlockingOcrError) {
      return 'red';
    }

    // Normalize confidence (support both 0-1 and 0-100)
    const confVal = typeof line.confidence === 'number' ? line.confidence : 80;
    const confPct = confVal > 0 && confVal <= 1 ? confVal * 100 : confVal;

    // 3. Warning / classification conflict / low confidence / unclassified => YELLOW
    const hasClassificationConflict = Boolean(line.hasConflict);
    const hasWarnings = Array.isArray(line.warnings) && line.warnings.length > 0;
    const isLowConfidence = confPct < 60;
    const isUnclassified = !line.categoryId || line.categoryId === 'cat-unclassified';

    if (hasClassificationConflict || isLowConfidence || hasWarnings || isUnclassified) {
      return 'yellow';
    }

    // 4. Otherwise => NORMAL
    return 'normal';
  };

  const activeSegment = segments[activeSegmentIndex];
  const activeAttachment = activeSegment
    ? attachmentsMap[activeSegment.id]
    : Object.values(attachmentsMap)[0];
  const activeImageUrl = activeAttachment?.storageKey || '';
  const digitalReconstructions = Array.isArray((ocrProcess?.metadata as Record<string, any> | undefined)?.digitalReconstructions)
    ? ((ocrProcess?.metadata as Record<string, any>).digitalReconstructions as any[])
    : [];
  const activeDigitalReconstruction =
    digitalReconstructions.find((page: any) => page?.pageNumber === activeSegmentIndex + 1) ||
    digitalReconstructions[activeSegmentIndex] ||
    null;
  const canonicalRasters = Array.isArray((ocrProcess?.metadata as Record<string, any> | undefined)?.canonicalRasters)
    ? ((ocrProcess?.metadata as Record<string, any>).canonicalRasters as any[])
    : [];
  const activeCanonicalRaster =
    canonicalRasters.find((raster: any) => raster?.pageNumber === activeSegmentIndex + 1) ||
    canonicalRasters[activeSegmentIndex] ||
    null;
  const reconstructionElementMap = new Map<string, any>(
    (activeDigitalReconstruction?.elements || []).map((element: any) => [element.id, element])
  );


  const semanticBindings = activeDigitalReconstruction
    ? bindDigitalReconstructionSemantics(
        activeDigitalReconstruction,
        editableLines.map((line) => ({
          id: line.id,
          text: `${line.originalText || ''} ${line.description || ''}`,
          amount: line.lineTotal,
        }))
      )
    : [];
  const reconstructionBindings = new Map<string, string>(
    semanticBindings.map((binding) => [binding.lineId, binding.targetId])
  );
  const usedReviewLineIds = new Set<string>(semanticBindings.map((binding) => binding.targetId));

  const selectedReviewLine = editingRowId
    ? editableLines.find((line) => line.id === editingRowId) || null
    : null;
  const unmappedEditableLines = editableLines.filter((line) => !usedReviewLineIds.has(line.id));

  const getSvgReviewPalette = (line: EditableReviewLine | null) => {
    if (!line) return { fill: '#f8fafc', stroke: '#cbd5e1', text: '#0f172a' };
    switch (getLineVisualState(line)) {
      case 'green': return { fill: '#dcfce7', stroke: '#16a34a', text: '#166534' };
      case 'red': return { fill: '#ffe4e6', stroke: '#e11d48', text: '#9f1239' };
      case 'yellow': return { fill: '#fef3c7', stroke: '#d97706', text: '#92400e' };
      default: return { fill: '#f8fafc', stroke: '#94a3b8', text: '#0f172a' };
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Revisione e Verifica Dati OCR"
      subtitle={
        session?.metadata?.title
          ? `Documento: ${session.metadata.title as string}`
          : 'Digital Reconstruction 3.1 - Facsimile raster normalizzato con revisione interattiva'
      }
      maxWidth="5xl"
    >
      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-4">
          <RefreshCw className="w-9 h-9 text-indigo-600 animate-spin" />
          <div className="text-center max-w-md px-4 space-y-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {progressText}
            </p>
            {progressPercentage > 0 && progressPercentage <= 100 && (
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, progressPercentage))}%` }}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4 relative">
          {/* Error Banner */}
          {errorMessage && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-2xl text-xs font-semibold border border-rose-200 dark:border-rose-900">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
              {session && (
                <button
                  type="button"
                  onClick={handleRerunOcr}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Riprova OCR
                </button>
              )}
            </div>
          )}

          {/* Feedback Banner */}
          {feedbackMessage && (
            <div className="flex items-center gap-2.5 p-3.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 rounded-2xl text-xs font-semibold border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span className="flex-1">{feedbackMessage}</span>
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
              Fotografia Scontrino
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
              Copia Digitale ({editableLines.length} righe)
            </button>
          </div>

          {/* Main 2-Column Split View */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start max-h-[70vh] overflow-hidden">
            
            {/* COLUMN 1: Fotografia Originale dello Scontrino (Desktop: 5 cols) */}
            <div
              className={`lg:col-span-5 flex flex-col h-full bg-slate-950 rounded-3xl border border-slate-800 overflow-hidden min-h-[440px] max-h-[68vh] ${
                activeMobileTab === 'image' ? 'block' : 'hidden lg:flex'
              }`}
            >
              <div className="flex items-center justify-between p-3 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-300">
                <div className="flex items-center gap-1.5 font-medium min-w-0">
                  <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="truncate">
                    {activeSegment ? `Pag. ${activeSegmentIndex + 1}/${segments.length}` : 'Fotografia Scontrino'}
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

              <div
                className={`flex-1 overflow-auto p-4 flex bg-slate-950 relative min-h-[360px] ${
                  zoomLevel > 1 ? 'items-start justify-start' : 'items-center justify-center'
                }`}
              >
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
                      alt="Fotografia Scontrino Originale"
                      className="max-w-full max-h-[58vh] object-contain transition-transform duration-150 rounded-lg shadow-xl"
                      style={{
                        transform: `scale(${zoomLevel}) rotate(${rotationDegrees + (activeSegment?.rotationDegrees || 0)}deg)`,
                        transformOrigin: zoomLevel > 1 ? 'top left' : 'center center',
                      }}
                    />
                  )
                ) : (
                  <div className="text-center text-slate-500 text-xs">
                    Nessun allegato immagine disponibile
                  </div>
                )}
              </div>

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

            {/* COLUMN 2: Copia Digitale dello Scontrino (Desktop: 7 cols) */}
            <div
              className={`lg:col-span-7 space-y-3 overflow-y-auto max-h-[68vh] pr-1.5 ${
                activeMobileTab === 'data' ? 'block' : 'hidden lg:block'
              }`}
            >
              {/* Receipt Paper Styling Container (Ivory/White paper sheet) */}
              <div className="p-5 bg-[#fdfcf7] text-slate-900 rounded-xl border border-slate-300 font-mono text-xs shadow-md space-y-4 relative">
                
                {activeDigitalReconstruction && activeDigitalReconstruction.width > 0 && activeDigitalReconstruction.height > 0 && (
                  <div className="space-y-2 pb-4 border-b border-dashed border-slate-300" data-testid="digital-reconstruction-3-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] uppercase font-bold tracking-wide text-slate-500">
                          Digital Reconstruction 3.1
                        </div>
                        <div className="text-[9px] text-slate-400">
                          raster guida invisibile + testo digitale ricostruito
                        </div>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden font-sans">
                        <button
                          type="button"
                          onClick={() => setReconstructionView('digital')}
                          className={`px-2 py-1 text-[10px] ${reconstructionView === 'digital' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
                        >
                          Copia digitale
                        </button>
                        <button
                          type="button"
                          onClick={() => setReconstructionView('compare')}
                          className={`px-2 py-1 text-[10px] border-l border-slate-300 ${reconstructionView === 'compare' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
                        >
                          Confronto
                        </button>
                      </div>
                    </div>

                    <div
                      className="relative w-full overflow-hidden bg-[#fffef9] border border-slate-200 rounded-lg"
                      data-testid="digital-text-reconstruction"
                    >
                      {activeCanonicalRaster?.dataUrl && (
                        <img
                          src={activeCanonicalRaster.dataUrl}
                          alt=""
                          aria-hidden="true"
                          className="block w-full h-auto select-none pointer-events-none"
                          style={{ opacity: reconstructionView === 'compare' ? 0.28 : 0 }}
                          draggable={false}
                          data-testid="canonical-raster-guide"
                        />
                      )}

                      <svg
                        viewBox={`0 0 ${activeDigitalReconstruction.width} ${activeDigitalReconstruction.height}`}
                        className={activeCanonicalRaster?.dataUrl
                          ? 'absolute inset-0 block w-full h-full'
                          : 'block w-full h-auto'}
                        preserveAspectRatio="xMidYMin meet"
                        aria-label="Testo digitale ricostruito del documento"
                      >
                        <rect
                          x="0"
                          y="0"
                          width={activeDigitalReconstruction.width}
                          height={activeDigitalReconstruction.height}
                          fill={activeCanonicalRaster?.dataUrl ? 'transparent' : '#fffef9'}
                        />
                        {(activeDigitalReconstruction.lines || []).map((line: any) => {
                          const boundId = reconstructionBindings.get(line.id);
                          const reviewLine = boundId ? editableLines.find((item) => item.id === boundId) || null : null;
                          const palette = getSvgReviewPalette(reviewLine);
                          const selected = Boolean(reviewLine && editingRowId === reviewLine.id);
                          return (
                            <g
                              key={line.id}
                              onClick={() => reviewLine && setEditingRowId(reviewLine.id)}
                              className={reviewLine ? 'cursor-pointer' : undefined}
                              role={reviewLine ? 'button' : undefined}
                              aria-label={reviewLine ? `Modifica riga ${reviewLine.description || reviewLine.originalText}` : undefined}
                            >
                              {reviewLine && (
                                <rect
                                  x={Math.max(0, line.box.x - 4)}
                                  y={Math.max(0, line.box.y - 2)}
                                  width={Math.max(1, line.box.width + 8)}
                                  height={Math.max(1, line.box.height + 4)}
                                  rx={3}
                                  fill={palette.fill}
                                  fillOpacity={selected ? 0.18 : 0}
                                  stroke={palette.stroke}
                                  strokeWidth={selected ? 2.5 : 1}
                                  strokeOpacity={selected ? 0.95 : 0.42}
                                />
                              )}
                              {(line.segments || []).map((segment: any) => {
                                const segmentText = (segment.elementIds || [])
                                  .map((id: string) => reconstructionElementMap.get(id)?.text || '')
                                  .filter(Boolean)
                                  .join(' ');
                                if (!segmentText) return null;
                                const isRight = segment.alignment === 'right';
                                const isCenter = segment.alignment === 'center';
                                const x = isRight
                                  ? segment.box.x + segment.box.width
                                  : isCenter
                                  ? segment.box.x + segment.box.width / 2
                                  : segment.box.x;
                                return (
                                  <text
                                    key={segment.id}
                                    x={x}
                                    y={line.baselineY}
                                    fontSize={Math.max(6, line.fontSize || 10)}
                                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                                    fontWeight="500"
                                    fill="#111827"
                                    textAnchor={isRight ? 'end' : isCenter ? 'middle' : 'start'}
                                  >
                                    {segmentText}
                                  </text>
                                );
                              })}
                              {reviewLine && <title>{reviewLine.description || reviewLine.originalText}</title>}
                            </g>
                          );
                        })}
                      </svg>
                    </div>

                    <p className="text-[9px] leading-tight text-slate-400 font-sans">
                      In “Copia digitale” il raster normalizzato resta invisibile e mantiene soltanto la geometria; sopra viene renderizzato il testo digitale. “Confronto” rende temporaneamente visibile il raster per verificare l’allineamento.
                    </p>
                  </div>
                )}

                {/* 1. INTESTAZIONE ESERCENTE */}
                <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
                  <div className="flex items-center justify-center">
                    <select
                      value={selectedSupplierId}
                      onChange={(e) => setSelectedSupplierId(e.target.value)}
                      className="bg-transparent font-bold text-center text-sm text-slate-900 border-b border-dotted border-slate-400 focus:outline-none cursor-pointer max-w-[280px] truncate"
                    >
                      <option value="new">➕ {newSupplierName || detectedSupplierName || 'Nuovo Fornitore'}</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  {selectedSupplierId === 'new' && (
                    <input
                      type="text"
                      value={newSupplierName}
                      onChange={(e) => setNewSupplierName(e.target.value)}
                      placeholder="Nome fornitore"
                      className="text-center bg-white border border-slate-300 rounded px-2 py-0.5 text-xs w-48 mx-auto block mt-1"
                    />
                  )}
                  {address && <div className="text-[11px] text-slate-600">{address}</div>}
                  {city && <div className="text-[11px] text-slate-600">{city}</div>}
                  {phone && <div className="text-[10px] text-slate-500">Tel: {phone}</div>}
                  {vatId && <div className="text-[10px] font-semibold text-slate-700">P.IVA / C.F.: {vatId}</div>}
                </div>

                {/* 2. TIPO DOCUMENTO */}
                <div className="text-center pb-2 border-b border-dashed border-slate-300">
                  <div className="font-bold text-xs uppercase tracking-widest text-slate-800">
                    {documentCategory || 'DOCUMENTO COMMERCIALE'}
                  </div>
                </div>

                {/* 3. REVISIONE INTERATTIVA — unica superficie collegata alla ricostruzione geometrica */}
                <div className="space-y-2 py-1">
                  <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-500 pb-1 border-b border-slate-300">
                    <span>Revisione riga selezionata</span>
                    <span>{usedReviewLineIds.size}/{editableLines.length} righe localizzate</span>
                  </div>

                  {editableLines.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      Nessun articolo. Usa “Aggiungi Articolo” per inserirne uno manualmente.
                    </div>
                  ) : selectedReviewLine ? (
                    <div className="p-2 rounded-lg border border-indigo-300 bg-indigo-50/40 space-y-2 font-sans">
                      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2 items-end">
                        <label className="text-[10px] text-slate-500">
                          Descrizione
                          <input
                            type="text"
                            value={selectedReviewLine.description}
                            onChange={(e) => handleLineChange(selectedReviewLine.id, 'description', e.target.value)}
                            className="mt-0.5 w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-900"
                          />
                        </label>
                        <label className="text-[10px] text-slate-500">
                          Prezzo (€)
                          <input
                            type="number"
                            step="0.01"
                            value={selectedReviewLine.lineTotal}
                            onChange={(e) => handleLineChange(selectedReviewLine.id, 'lineTotal', parseFloat(e.target.value) || 0)}
                            className="mt-0.5 w-full bg-white border border-slate-300 rounded px-2 py-1 text-right text-xs font-bold text-slate-900"
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {selectedReviewLine.reviewStatus === 'confirmed' || selectedReviewLine.manuallyValidated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Confermata
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConfirmLine(selectedReviewLine.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg text-xs font-semibold"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Conferma
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedDetailsRowId(expandedDetailsRowId === selectedReviewLine.id ? null : selectedReviewLine.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-white"
                        >
                          <Package className="w-3.5 h-3.5" />
                          Prodotto/Categoria
                          {expandedDetailsRowId === selectedReviewLine.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleDeleteLine(selectedReviewLine.id);
                            setEditingRowId(null);
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                          title="Elimina riga"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {expandedDetailsRowId === selectedReviewLine.id && (
                        <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          <label className="text-[10px] text-slate-500">
                            Prodotto Catalogo
                            <select
                              value={selectedReviewLine.productId || (selectedReviewLine.actionMode === 'create_new' ? 'CREATE_NEW' : '')}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'CREATE_NEW') {
                                  handleLineChange(selectedReviewLine.id, 'productId', null);
                                  handleLineChange(selectedReviewLine.id, 'actionMode', 'create_new');
                                } else if (val) {
                                  handleLineChange(selectedReviewLine.id, 'productId', val);
                                  handleLineChange(selectedReviewLine.id, 'actionMode', 'link_existing');
                                } else {
                                  handleLineChange(selectedReviewLine.id, 'productId', null);
                                  handleLineChange(selectedReviewLine.id, 'actionMode', 'unlinked');
                                }
                              }}
                              className="mt-0.5 w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900"
                            >
                              <option value="">Nessun collegamento</option>
                              <option value="CREATE_NEW">➕ Crea nuovo prodotto</option>
                              {products.map((product) => (
                                <option key={product.id} value={product.id}>{product.displayName}</option>
                              ))}
                            </select>
                          </label>

                          <label className="text-[10px] text-slate-500">
                            Categoria
                            <select
                              value={selectedReviewLine.categoryId || ''}
                              onChange={(e) => handleLineChange(selectedReviewLine.id, 'categoryId', e.target.value || null)}
                              className="mt-0.5 w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900"
                            >
                              <option value="">Seleziona Categoria...</option>
                              {parentCategories.map((category) => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4 px-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-[11px] text-slate-500 font-sans">
                      Clicca una riga evidenziata nella Digital Reconstruction 3.1 per modificarla o confermarla.
                    </div>
                  )}

                  {unmappedEditableLines.length > 0 && (
                    <div className="pt-1 space-y-1 font-sans">
                      <div className="text-[10px] uppercase font-semibold text-amber-700">
                        Righe non ancora localizzate nella geometria ({unmappedEditableLines.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {unmappedEditableLines.map((line) => (
                          <button
                            key={line.id}
                            type="button"
                            onClick={() => setEditingRowId(line.id)}
                            className="px-2 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-[10px] hover:bg-amber-100 max-w-full truncate"
                            title={line.description || line.originalText}
                          >
                            {line.description || line.originalText}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleAddLine}
                      className="w-full py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-indigo-600 font-semibold hover:bg-indigo-50/50 flex items-center justify-center gap-1.5 font-sans"
                    >
                      <Plus className="w-3.5 h-3.5" /> Aggiungi Articolo
                    </button>
                  </div>
                </div>

                {/* 4. RIEPILOGO */}
                <div className="pt-3 border-t border-dashed border-slate-300 space-y-1 text-xs font-mono">
                  <div className="flex items-center justify-between font-bold text-slate-900 text-sm">
                    <span>TOTALE COMPLESSIVO</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.01"
                        value={documentTotal || ''}
                        onChange={(e) => setDocumentTotal(parseFloat(e.target.value) || 0)}
                        className="w-24 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right font-bold text-sm"
                      />
                      <span>€</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-slate-600 text-[11px]">
                    <span>di cui IVA (stimata)</span>
                    <span>€ {estimatedVat.toFixed(2)}</span>
                  </div>

                  {hasTotalDiscrepancy && (
                    <div className="p-2 bg-amber-50 rounded-lg text-amber-900 text-[11px] space-y-1 mt-1 font-sans">
                      <div>Discrepanza con somma righe (€ {roundedSumLines.toFixed(2)})</div>
                      <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                        <input
                          type="checkbox"
                          checked={isDiscrepancyApproved}
                          onChange={(e) => setIsDiscrepancyApproved(e.target.checked)}
                          className="rounded text-amber-600 w-3.5 h-3.5"
                        />
                        <span>Confermo la discrepanza sul totale</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* 5. PAGAMENTO */}
                <div className="pt-3 border-t border-dashed border-slate-300 space-y-1.5 text-xs font-mono">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Pagamento elettronico</span>
                    <span className="font-bold">€ {documentTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Importo pagato</span>
                    <span className="font-bold">€ {documentTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-semibold text-slate-700 uppercase">Metodo / Circuito</span>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs font-sans cursor-pointer"
                    >
                      <option value="cash">CONTANTI</option>
                      <option value="debitCard">BANCOMAT</option>
                      <option value="creditCard">CARTA DI CREDITO</option>
                      <option value="bankTransfer">BONIFICO</option>
                      <option value="digitalWallet">DIGITAL WALLET</option>
                      <option value="other">ALTRO</option>
                    </select>
                  </div>
                </div>

                {/* 6. CHIUSURA DOCUMENTO (Data, ora, n. doc, venditore) */}
                <div className="pt-3 border-t border-dashed border-slate-300 space-y-1 text-[11px] text-slate-600 font-mono">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-indigo-500" /> Data e Ora:
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={expenseDate}
                        onChange={(e) => setExpenseDate(e.target.value)}
                        className="bg-transparent font-mono text-xs text-slate-800 cursor-pointer"
                      />
                      {time && <span>{time}</span>}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span>DOCUMENTO N.</span>
                    <span className="font-bold">{ocrProcess?.id ? ocrProcess.id.substring(0, 10).toUpperCase() : '1034-0037'}</span>
                  </div>

                  {vendor && (
                    <div className="flex items-center justify-between">
                      <span>VENDITORE:</span>
                      <span className="font-bold uppercase">{vendor}</span>
                    </div>
                  )}
                </div>

                {existingExpense && (
                  <div className="p-2.5 bg-emerald-50 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-sans">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Registrazione contabile già effettuata il {existingExpense.expenseDate}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* BOTTOM ACTIONS & DIAGNOSTICA BUTTON                          */}
          {/* ============================================================ */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={isSaving}
              >
                Chiudi
              </Button>

              {!existingExpense && (session || ocrProcess) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDeleteSession}
                  disabled={isSaving}
                  icon={<Trash2 className="w-4 h-4 text-rose-500" />}
                  className="text-rose-600 dark:text-rose-400 hover:bg-rose-50"
                >
                  Elimina scansione
                </Button>
              )}
            </div>

            {/* Pulsante Diagnostica in basso a destra */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowDiagnosticsModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md cursor-pointer border border-slate-700"
                title="Apri pannello di diagnostica tecnica OCR"
              >
                <Terminal className="w-4 h-4 text-indigo-400" />
                <span>Diagnostica</span>
                {ocrProcess && (
                  <span className="px-1.5 py-0.5 bg-slate-900 rounded-lg text-[10px] font-mono text-indigo-300">
                    {ocrProcess.rawText ? `${ocrProcess.rawText.length}c` : '0c'}
                  </span>
                )}
              </button>

              <div className="flex items-center gap-2">
                {!existingExpense && session && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleRerunOcr}
                    disabled={isSaving}
                    icon={<RefreshCw className="w-4 h-4 text-indigo-500" />}
                  >
                    Riprova OCR
                  </Button>
                )}

                {!existingExpense && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleSaveDraft}
                    disabled={isSaving}
                    icon={<Save className="w-4 h-4 text-slate-600 dark:text-slate-300" />}
                  >
                    Salva bozza
                  </Button>
                )}

                {(() => {
                  const valErrors = getFinalValidationErrors();
                  const isConfirmBlocked =
                    isSaving ||
                    (hasTotalDiscrepancy && !isDiscrepancyApproved) ||
                    valErrors.length > 0;

                  return (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleConfirmReview}
                      disabled={isConfirmBlocked}
                      icon={
                        isSaving ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 text-emerald-600" />
                        )
                      }
                    >
                      Conferma revisione
                    </Button>
                  );
                })()}

                {existingExpense ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={true}
                    icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  >
                    Registrata
                  </Button>
                ) : (
                  (() => {
                    const valErrors = getFinalValidationErrors();
                    const isBlocked =
                      isSaving ||
                      (hasTotalDiscrepancy && !isDiscrepancyApproved) ||
                      valErrors.length > 0;

                    return (
                      <Button
                        type="button"
                        variant={isBlocked ? 'secondary' : 'emerald'}
                        onClick={handleCreateAccountingRegistration}
                        disabled={isBlocked}
                        icon={
                          isSaving ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )
                        }
                      >
                        <span>{isSaving ? 'Registrazione...' : 'Crea Registrazione'}</span>
                      </Button>
                    );
                  })()
                )}
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* DIAGNOSTICS MODAL (Drawer / Overlay)                         */}
          {/* ============================================================ */}
          {showDiagnosticsModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                
                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-indigo-500" />
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                        Diagnostica Tecnica OCR (Schema D1 & Decision Engine)
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Raw Tesseract, OCRS/RTen, Decision Summary e Telemetria completa
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyDiagnostics}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                    >
                      {copySuccess ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copiato!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copia D1 JSON</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadDiagnostics}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs border border-slate-700"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Scarica JSON</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDiagnosticsModal(false)}
                      className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                  {ocrProcess && (
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl text-slate-300 font-mono text-[11px] space-y-2">
                      <div className="text-amber-400 font-bold flex items-center justify-between">
                        <span>Variante Selezionata: {(ocrProcess.metadata as Record<string, any>)?.selectedVariant || 'original'}</span>
                        <span>Confidenza complessiva: {ocrProcess.confidence || 0}%</span>
                      </div>
                      {Array.isArray((ocrProcess.metadata as Record<string, any>)?.variantScores) &&
                        (ocrProcess.metadata as Record<string, any>).variantScores.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-slate-800">
                            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                              Punteggi Varianti Pre-Processing:
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {(ocrProcess.metadata as Record<string, any>).variantScores.map((v: any, idx: number) => (
                                <div
                                  key={idx}
                                  className={`p-1.5 rounded-lg border text-[10px] ${
                                    v.variant === (ocrProcess.metadata as Record<string, any>)?.selectedVariant
                                      ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
                                      : 'bg-slate-950 border-slate-800 text-slate-400'
                                  }`}
                                >
                                  <div className="font-bold flex items-center justify-between">
                                    <span>{v.label || v.variant}</span>
                                    <span>Score: {v.overallScore} (Conf: {v.confidence}%)</span>
                                  </div>
                                  {Array.isArray(v.reasons) && v.reasons.length > 0 && (
                                    <div className="text-[9px] text-slate-400 truncate mt-0.5">
                                      {v.reasons.join(', ')}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                        <span>1. Testo Grezzo OCR (rawText):</span>
                        <span className="font-mono text-[10px] text-slate-400 font-normal">
                          {ocrProcess?.rawText ? `${ocrProcess.rawText.split('\n').length} righe` : '0'}
                        </span>
                      </label>
                      <pre className="p-3 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-xl overflow-auto max-h-64 whitespace-pre-wrap select-all border border-slate-800 leading-relaxed">
                        {ocrProcess?.rawText || '(Nessun testo grezzo salvato)'}
                      </pre>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                        <span>2. Righe Normalizzate & Riconosciute:</span>
                        <span className="font-mono text-[10px] text-slate-400 font-normal">
                          {editableLines.length} elements
                        </span>
                      </label>
                      <pre className="p-3 bg-slate-950 text-cyan-300 font-mono text-[11px] rounded-xl overflow-auto max-h-64 whitespace-pre-wrap select-all border border-slate-800 leading-relaxed">
                        {((ocrProcess?.metadata as Record<string, any>)?.normalizedLines || []).join('\n') ||
                          editableLines
                            .map(
                              (l, idx) =>
                                `#${idx + 1} | [${l.description}] ${l.quantity} x € ${l.unitPrice.toFixed(
                                  2
                                )} = € ${l.lineTotal.toFixed(2)}`
                            )
                            .join('\n') ||
                          '(Nessuna riga)'}
                      </pre>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end p-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowDiagnosticsModal(false)}
                  >
                    Chiudi Diagnostica
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
