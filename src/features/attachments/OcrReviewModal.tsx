import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Terminal,
  Copy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { db } from '../../database/db';
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
  const [progressText, setProgressText] = useState<string>('Caricamento e analisi dati OCR in corso...');
  const [progressPercentage, setProgressPercentage] = useState<number>(0);

  // Concurrency, idempotency and lifecycle cancellation guard (Fase CI-R3)
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

  // Review Lines Navigation Filter state
  type LineFilterMode = 'all' | 'error' | 'unclassified' | 'modified' | 'discounts' | 'returns';
  const [activeLineFilter, setActiveLineFilter] = useState<LineFilterMode>('all');

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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [editableLines, setEditableLines] = useState<EditableReviewLine[]>([]);
  const [existingExpense, setExistingExpense] = useState<Expense | null>(null);
  const [isDiscrepancyApproved, setIsDiscrepancyApproved] = useState<boolean>(false);
  const [isDateDetectedFromOcr, setIsDateDetectedFromOcr] = useState<boolean>(false);

  // Diagnostic State for inspecting real Tesseract output
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
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
      // 1. Identify active session and ocrProcess
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
        // Find session linked to ocrProcess
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

      // 2. Determine if OCR recognition should be started
      // Conditions:
      // - Valid session exists
      // - Process is not already confirmed by user
      // - Process is missing OR in 'pending' status OR lacks non-empty rawText
      // - Process is not already completed with non-empty rawText
      // - Not already executing in local guard ref
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
              `Riconoscimento OCR non riuscito: ${ocrErr?.message || 'Errore durante la scansione del testo'}. È comunque possibile inserire i dati a mano.`
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

      // Fallback process creation if neither existed nor recognize created one
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

      // 3. Ensure rawText parsed & lines extracted
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

      // Run classification proposal
      let proposal: ReceiptClassificationProposal | null = null;
      try {
        proposal = await productClassificationService.classifyReceiptLines(activeOcrProcess.id);
      } catch (classErr) {
        console.warn('[OcrReviewModal] Error during classification:', classErr);
      }

      if (!isCurrent()) return;

      setSession(activeSession);
      setOcrProcess(activeOcrProcess);

      // 3. Load segments & attachments for image viewer
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

      // 4. Load catalog options (Suppliers, Products, Categories)
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

      // Check if existing expense is already linked
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

      const hasOcrDate = Boolean(activeOcrProcess.detectedDate);
      setIsDateDetectedFromOcr(hasOcrDate);
      setExpenseDate(
        activeOcrProcess.detectedDate || new Date().toISOString().substring(0, 10)
      );

      setDocumentTotal(activeOcrProcess.detectedTotal || 0);

      // Inizializza paymentMethod da OCR o metadati con massima priorità a Contanti/Resto
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
        // Controllo diretto sul testo grezzo o normalizzato per indizi inequivocabili di contanti
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

      // 6. Load OCR receipt lines & merge with proposals
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
        const hasUnsafeWarnings =
          uniqueWarnings.includes('VAT_PRICE_AMBIGUOUS') ||
          uniqueWarnings.includes('PRICE_NOT_DETECTED') ||
          uniqueWarnings.includes('LOW_CONFIDENCE') ||
          uniqueWarnings.includes('OCR_TEXT_SUSPECT') ||
          uniqueWarnings.includes('DISCOUNT_VALUE_NOT_DETECTED') ||
          uniqueWarnings.includes('prezzo_riga_non_rilevato') ||
          (line.unitPrice === 0 && line.lineTotal === 0 && !line.description.toUpperCase().includes('SCONTO'));

        const isDocUnsafe =
          hasTotalDiscrepancy ||
          (typeof ocrProcess?.confidence === 'number' && ocrProcess.confidence < 60) ||
          hasUnsafeWarnings;

        let initialActionMode: 'link_existing' | 'create_new' | 'unlinked' = savedMeta.actionMode || 'unlinked';
        if (!savedMeta.actionMode) {
          if (isDocUnsafe) {
            initialActionMode = 'unlinked';
          } else if (initialProdId) {
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
          hasConflict: prop?.hasConflict || hasUnsafeWarnings || false,
          conflictDetails: prop?.conflictDetails,
          warnings: uniqueWarnings,
          isNewRow: false,
          actionMode: initialActionMode,
          newProductDisplayName: savedNewProductName,
        };
      });

      if (!isCurrent()) return;
      setEditableLines(reviewLines);

      // Update session status to ready_for_review
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
      // Invalida qualsiasi caricamento asincrono pendente al cambio dipendenze o allo smontaggio
      loadRequestIdRef.current++;
    };
  }, [isOpen, loadReviewData]);

  // Calculations & Navigation Filter groups (Punto 14.5)
  const calculatedSumLines = editableLines.reduce(
    (acc, line) => acc + (line.lineTotal > 0 ? line.lineTotal : line.quantity * line.unitPrice),
    0
  );

  const roundedSumLines = Math.round(calculatedSumLines * 100) / 100;
  const roundedDocTotal = Math.round(documentTotal * 100) / 100;
  const hasTotalDiscrepancy = Math.abs(roundedSumLines - roundedDocTotal) > 0.01;

  const linesWithError = editableLines.filter(
    (l) =>
      !l.categoryId ||
      l.categoryId === 'cat-unclassified' ||
      l.quantity <= 0 ||
      (l.unitPrice <= 0 && l.lineTotal <= 0 && l.lineTotal >= 0) ||
      l.hasConflict ||
      (l.warnings && l.warnings.length > 0)
  );

  const linesUnclassified = editableLines.filter(
    (l) => !l.categoryId || l.categoryId === 'cat-unclassified' || l.proposedCategoryName?.toLowerCase().includes('classificare')
  );

  const linesModified = editableLines.filter((l) => l.reviewStatus === 'modified' || l.isNewRow);

  const linesDiscounts = editableLines.filter(
    (l) => l.lineTotal < 0 || /SCONTO|PROMO|ABBUONO|COUPON|BUONO/i.test(l.description) || (l.warnings && l.warnings.includes('DISCOUNT_LINE'))
  );

  const linesReturns = editableLines.filter(
    (l) => l.lineTotal < 0 || /RESO|STORNO|RESTITUITO/i.test(l.description)
  );

  const visibleLines = (() => {
    switch (activeLineFilter) {
      case 'error':
        return linesWithError;
      case 'unclassified':
        return linesUnclassified;
      case 'modified':
        return linesModified;
      case 'discounts':
        return linesDiscounts;
      case 'returns':
        return linesReturns;
      default:
        return editableLines;
    }
  })();

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

        // Se viene inserito un prezzo valido > 0, rimuovi i warning di prezzo non rilevato
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

      // Remove lines deleted in review form (batch deletion)
      const idsToDelete = existingDbLines
        .filter((dbLine) => !currentLineIds.has(dbLine.id))
        .map((l) => l.id);
      if (idsToDelete.length > 0) {
        await db.ocrReceiptLines.bulkDelete(idsToDelete);
      }

      // Upsert current lines with category & subcategory metadata
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
        // Pulizia atomica delle righe precedenti non confermate per garantire idempotenza
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
  };

  // Punto 14.4: Validazione Finale prima della conferma definitiva
  const getFinalValidationErrors = (): string[] => {
    const errors: string[] = [];

    // 1. Campi obbligatori
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

    const docCategory = session?.detectedDocumentCategory || (ocrProcess?.metadata as Record<string, any>)?.documentCategory;
    const isPaymentProof = docCategory === 'PAYMENT_PROOF';

    if (!isPaymentProof && (!editableLines || editableLines.length === 0)) {
      errors.push('Il documento non contiene alcuna riga articolo.');
    }

    // 2. Quadratura (solo se sono presenti righe o non è una ricevuta POS/PAYMENT_PROOF senza righe)
    if (editableLines.length > 0 && hasTotalDiscrepancy && !isDiscrepancyApproved) {
      errors.push(
        `Discrepanza sul totale scontrino non approvata: somma righe (€ ${roundedSumLines.toFixed(
          2
        )}) ≠ totale scontrino (€ ${roundedDocTotal.toFixed(
          2
        )}). Spunta "Confermo la discrepanza sul totale" per proseguire.`
      );
    }

    // 3. Prodotti non classificati / Categorie mancanti & Importi incoerenti
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

  // Confirm Review (Mark confirmedByUser: true, learn aliases and create products safely)
  const handleConfirmReview = async () => {
    if (!ocrProcess) return;
    setIsSaving(true);
    setErrorMessage(null);

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

  // Punto 10 & 11: Creation of Accounting Registration (Expense) from OCR session
  const handleCreateAccountingRegistration = async () => {
    if (!ocrProcess) return;
    setIsSaving(true);
    setErrorMessage(null);

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

      // Identify deleted lines to be removed inside the atomic transaction
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

      // Passa sia le opzioni della spesa che le decisioni di classificazione per l'esecuzione in un'UNICA TRANSAZIONE ATOMICA
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

  // Funzione per copiare l'intero stato diagnostico OCR grezzo e strutturato
  const handleCopyDiagnostics = async () => {
    try {
      const finalSupplierName =
        selectedSupplierId === 'new'
          ? newSupplierName.trim()
          : suppliers.find((s) => s.id === selectedSupplierId)?.name || detectedSupplierName;

      const raw = ocrProcess?.rawText || '';
      const metaObj = (ocrProcess?.metadata as Record<string, any>) || {};
      const metaNorm = metaObj.normalizedLines;
      const normalizedLines = Array.isArray(metaNorm) && metaNorm.length > 0
        ? metaNorm
        : (raw ? TextNormalizationModule.normalize(raw).normalizedLines : []);

      const persistedDbLines = ocrProcess?.id
        ? await ocrReceiptLineRepository.getByOcrProcessId(ocrProcess.id)
        : [];

      const diagData = {
        timestamp: new Date().toISOString(),
        ocrProcessId: ocrProcess?.id || null,
        sessionId: session?.id || null,
        documentTitle: (session?.metadata?.title as string) || null,
        confidence: ocrProcess?.confidence || null,
        selectedVariant: metaObj.selectedVariant || null,
        variantScores: metaObj.variantScores || [],
        detectedSupplier: detectedSupplierName,
        selectedSupplier: finalSupplierName,
        detectedDate: expenseDate,
        isDateDetectedFromOcr,
        detectedTotal: documentTotal,
        paymentMethod,
        rawText: raw,
        normalizedLines,
        persistedDbLinesCount: persistedDbLines.length,
        extractedLines: editableLines.map((l, index) => ({
          index: index + 1,
          id: l.id,
          originalText: l.originalText,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          isNegative: l.lineTotal < 0,
          confidence: l.confidence,
          warnings: Array.isArray(l.warnings) ? l.warnings : [],
          categoryId: l.categoryId,
          productId: l.productId,
          actionMode: l.actionMode,
        })),
        calculatedSumLines: roundedSumLines,
        discrepancy: Math.abs(roundedDocTotal - roundedSumLines),
        hasDiscrepancy: hasTotalDiscrepancy,
        isDiscrepancyApproved,
        validationErrors: getFinalValidationErrors(),
      };
      await navigator.clipboard.writeText(JSON.stringify(diagData, null, 2));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch (err) {
      console.error('Errore nella copia della diagnostica:', err);
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
        <div className="space-y-4">
          {/* Error Banner with Retry */}
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
                    {isDateDetectedFromOcr ? (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Data rilevata da scontrino ({expenseDate})
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Data presunta: verificare data reale su scontrino
                      </p>
                    )}
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
                      <option value="cash">Contanti</option>
                      <option value="debitCard">Carta di Debito / Bancomat</option>
                      <option value="creditCard">Carta di Credito</option>
                      <option value="bankTransfer">Bonifico Bancario</option>
                      <option value="digitalWallet">Digital Wallet (Satispay, Apple Pay)</option>
                      <option value="other">Altro / Da verificare</option>
                    </select>
                  </div>
                </div>

                {/* Discrepancy Alert Box */}
                {documentTotal > 0 &&
                  editableLines.length > 0 &&
                  Math.abs(documentTotal - Math.round(editableLines.reduce((s, l) => s + (l.lineTotal || 0), 0) * 100) / 100) > 0.01 && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-2 mt-3">
                      <div className="flex items-center gap-2 font-bold">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Discrepanza Rilevata negli Importi</span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        Il totale dello scontrino (€ {documentTotal.toFixed(2)}) differisce dalla somma delle righe (€ {(Math.round(editableLines.reduce((s, l) => s + (l.lineTotal || 0), 0) * 100) / 100).toFixed(2)}).
                        Differenza: € {Math.abs(documentTotal - Math.round(editableLines.reduce((s, l) => s + (l.lineTotal || 0), 0) * 100) / 100).toFixed(2)}.
                      </p>
                      <label className="flex items-center gap-2 pt-1 font-semibold cursor-pointer text-amber-950 dark:text-amber-100">
                        <input
                          type="checkbox"
                          checked={isDiscrepancyApproved}
                          onChange={(e) => setIsDiscrepancyApproved(e.target.checked)}
                          className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
                        />
                        <span>Confermo la discrepanza e approvo il totale dello scontrino</span>
                      </label>
                    </div>
                  )}
              </div>

              {/* Line Items Table Box */}
              <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs">
                <div className="flex flex-col space-y-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Righe Scontrino & Classificazione Prodotti ({editableLines.length})
                    </h4>
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

                  {/* Navigation Filter Bar (Punto 14.5) */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveLineFilter('all')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                        activeLineFilter === 'all'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      Tutte ({editableLines.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveLineFilter('error')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
                        activeLineFilter === 'error'
                          ? 'bg-rose-600 text-white'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
                      }`}
                    >
                      <span>Errore / Sospette</span>
                      <span className="px-1.5 py-0.2 text-[10px] bg-rose-200 dark:bg-rose-900 rounded-full font-bold">{linesWithError.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveLineFilter('unclassified')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
                        activeLineFilter === 'unclassified'
                          ? 'bg-amber-600 text-white'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100'
                      }`}
                    >
                      <span>Non Classificate</span>
                      <span className="px-1.5 py-0.2 text-[10px] bg-amber-200 dark:bg-amber-900 rounded-full font-bold">{linesUnclassified.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveLineFilter('modified')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
                        activeLineFilter === 'modified'
                          ? 'bg-purple-600 text-white'
                          : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100'
                      }`}
                    >
                      <span>Modificate</span>
                      <span className="px-1.5 py-0.2 text-[10px] bg-purple-200 dark:bg-purple-900 rounded-full font-bold">{linesModified.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveLineFilter('discounts')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
                        activeLineFilter === 'discounts'
                          ? 'bg-teal-600 text-white'
                          : 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 hover:bg-teal-100'
                      }`}
                    >
                      <span>Sconti</span>
                      <span className="px-1.5 py-0.2 text-[10px] bg-teal-200 dark:bg-teal-900 rounded-full font-bold">{linesDiscounts.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveLineFilter('returns')}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors flex items-center gap-1 ${
                        activeLineFilter === 'returns'
                          ? 'bg-sky-600 text-white'
                          : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100'
                      }`}
                    >
                      <span>Resi</span>
                      <span className="px-1.5 py-0.2 text-[10px] bg-sky-200 dark:bg-sky-900 rounded-full font-bold">{linesReturns.length}</span>
                    </button>
                  </div>
                </div>

                {editableLines.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    Nessuna riga rilevata. Clicca "+ Aggiungi Riga" per inserire manualmente un articolo.
                  </div>
                ) : visibleLines.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    Nessuna riga trovata per il filtro selezionato ({activeLineFilter}).
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleLines.map((line, idx) => {
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
                              {/* Suspicious Line Badge */}
                              {(line.unitPrice === 0 || (line.warnings && line.warnings.includes('prezzo_riga_non_rilevato'))) && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-700">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  Riga Sospetta (Prezzo Mancante)
                                </span>
                              )}

                              {/* Discount / Promo Badge */}
                              {(line.lineTotal < 0 || /SCONTO|PROMO|ABBUONO|COUPON|BUONO/i.test(line.description) || (line.warnings && line.warnings.includes('DISCOUNT_LINE'))) && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/60 px-2 py-0.5 rounded-md border border-teal-200 dark:border-teal-800">
                                  Sconto / Promozione
                                </span>
                              )}

                              {/* Negative Amount / Return Badge */}
                              {(line.lineTotal < 0 || /RESO|STORNO|RESTITUITO/i.test(line.description)) && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-800">
                                  Reso / Storno (Importo Negativo)
                                </span>
                              )}

                              {/* Unclassified Badge */}
                              {(!line.categoryId || line.categoryId === 'cat-unclassified' || line.proposedCategoryName?.toLowerCase().includes('classificare')) && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700">
                                  Da Classificare
                                </span>
                              )}

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

              {/* Existing Expense Notice */}
              {existingExpense ? (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold block">
                      Registrazione contabile già effettuata
                    </span>
                    Spesa registrata il {existingExpense.expenseDate} per l'importo di {existingExpense.amount} €.
                  </div>
                </div>
              ) : (
                /* Offline Protection Notice */
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block mb-0.5">
                      Modalità Revisione & Registrazione Contabile
                    </span>
                    La <strong>Conferma revisione dati</strong> convalida i dati estratti dall'OCR. Utilizza <strong>Crea Registrazione Contabile</strong> per generare direttamente la Spesa reale a bilancio.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Strumento di Diagnostica OCR (Non-invasivo per debug e verifica input reale Tesseract) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="w-full flex items-center justify-between p-3.5 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-300">
                <Terminal className="w-4 h-4 text-indigo-500" />
                <span>Mostra diagnostica OCR (Raw Tesseract & Parser State)</span>
                {ocrProcess && (
                  <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                    ({ocrProcess.rawText ? `${ocrProcess.rawText.length} car.` : '0 car.'} • {editableLines.length} righe)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-slate-500">
                <span className="text-[11px] font-semibold">{showDiagnostics ? 'Comprimi' : 'Espandi'}</span>
                {showDiagnostics ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </button>

            {showDiagnostics && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3 bg-white dark:bg-slate-950">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Visualizza il testo grezzo ricevuto direttamente da Tesseract nel browser e le righe analizzate. Questa sezione è dedicata al debug e non compare nella registrazione contabile.
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyDiagnostics}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs self-start sm:self-auto"
                  >
                    {copySuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Diagnostica copiata!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copia diagnostica</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Metadata & Variant Selection Details */}
                {ocrProcess && (
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-300 font-mono text-[11px] space-y-2">
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                      <span>1. Testo Grezzo OCR (rawText):</span>
                      <span className="font-mono text-[10px] text-slate-400 font-normal">
                        {ocrProcess?.rawText ? `${ocrProcess.rawText.split('\n').length} righe` : '0'}
                      </span>
                    </label>
                    <pre className="p-3 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-xl overflow-auto max-h-56 whitespace-pre-wrap select-all border border-slate-800 leading-relaxed">
                      {ocrProcess?.rawText || '(Nessun testo grezzo salvato nel processo OCR)'}
                    </pre>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                      <span>2. Righe Normalizzate & Riconosciute:</span>
                      <span className="font-mono text-[10px] text-slate-400 font-normal">
                        {editableLines.length} elementi
                      </span>
                    </label>
                    <pre className="p-3 bg-slate-950 text-cyan-300 font-mono text-[11px] rounded-xl overflow-auto max-h-56 whitespace-pre-wrap select-all border border-slate-800 leading-relaxed">
                      {((ocrProcess?.metadata as Record<string, any>)?.normalizedLines || []).join('\n') ||
                        editableLines
                          .map(
                            (l, idx) =>
                              `#${idx + 1} | [${l.description}] ${l.quantity} x € ${l.unitPrice.toFixed(
                                2
                              )} = € ${l.lineTotal.toFixed(2)}${l.warnings?.length ? ` (${l.warnings.join(', ')})` : ''}`
                          )
                          .join('\n') ||
                        '(Nessuna riga)'}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Actions Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
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
                  className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  Elimina scansione
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
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
                  (editableLines.length > 0 && hasTotalDiscrepancy && !isDiscrepancyApproved) ||
                  valErrors.length > 0;

                return (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleConfirmReview}
                    disabled={isConfirmBlocked}
                    title={
                      editableLines.length > 0 && hasTotalDiscrepancy && !isDiscrepancyApproved
                        ? 'Discrepanza non approvata: spunta la casella di conferma per abilitare il pulsante'
                        : valErrors.length > 0
                        ? `Impossibile confermare: ${valErrors[0]}`
                        : 'Conferma revisione dati'
                    }
                    icon={
                      isSaving ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      )
                    }
                  >
                    Conferma revisione dati
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
                  Registrazione già creata
                </Button>
              ) : (
                (() => {
                  const valErrors = getFinalValidationErrors();
                  const isBlocked =
                    isSaving ||
                    (editableLines.length > 0 && hasTotalDiscrepancy && !isDiscrepancyApproved) ||
                    valErrors.length > 0;

                  return (
                    <Button
                      type="button"
                      variant={isBlocked ? 'secondary' : 'emerald'}
                      onClick={handleCreateAccountingRegistration}
                      disabled={isBlocked}
                      title={
                        editableLines.length > 0 && hasTotalDiscrepancy && !isDiscrepancyApproved
                          ? 'Discrepanza non approvata: spunta la casella di conferma per abilitare la registrazione'
                          : valErrors.length > 0
                          ? `Impossibile registrare: ${valErrors[0]}`
                          : 'Crea Spesa a bilancio'
                      }
                      icon={
                        isSaving ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )
                      }
                    >
                      <span>{isSaving ? 'Registrazione in corso...' : 'Crea Registrazione Contabile'}</span>
                    </Button>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
