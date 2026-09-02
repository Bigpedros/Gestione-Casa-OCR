import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  expenseRepository,
  categoryRepository,
  supplierRepository,
  projectRepository,
  fixedExpenseRepository,
} from '../../repositories';
import { budgetService } from '../../services/budgetService';
import { formatCurrency, formatDate, getCurrentYearMonth, getMonthName } from '../../utils/formatters';
import {
  Modal,
  Button,
  Badge,
} from '../../components/common';
import {
  Plus,
  TrendingDown,
  Calendar,
  Tag,
  Store,
  Pencil,
  Trash2,
  AlertTriangle,
  ScanLine,
  ShoppingBag,
  Clock,
  CalendarCheck,
  Info,
  ArrowRight,
} from 'lucide-react';
import type { ExpenseClassification, ExpenseStatus, Expense } from '../../types';
import { ScanReceiptModal } from '../attachments/ScanReceiptModal';
import { OcrReviewModal } from '../attachments/OcrReviewModal';
import { PendingOcrReviewBanner } from '../attachments/PendingOcrReviewBanner';

type ProvisionExpense = Expense & { isProvision?: boolean; provisionType?: 'project' | 'fixedExpense' };

const isCancelledStatus = (s?: string | null) => {
  if (!s) return false;
  const lower = s.toLowerCase();
  return (
    lower === 'cancelled' ||
    lower === 'canceled' ||
    lower === 'annullata' ||
    lower === 'annullato' ||
    lower === 'deleted' ||
    lower === 'inactive'
  );
};

export const ExpensesPage: React.FC = () => {
  const location = useLocation();
  const { year, month } = getCurrentYearMonth();
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);

  // Modal & Edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'expense' | 'purchase'>('expense');
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ProvisionExpense | null>(null);

  // "Vedi tutte / tutti" Modal State
  const [viewAllModal, setViewAllModal] = useState<'spese' | 'acquisti' | null>(null);

  // OCR Review Modal State
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewOcrProcessId, setReviewOcrProcessId] = useState<string | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);

  // Delete Confirmation State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingExpenseTarget, setDeletingExpenseTarget] = useState<ProvisionExpense | null>(null);

  // Form State
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().substring(0, 10));
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [classification, setClassification] = useState<ExpenseClassification>('necessary');
  const [status, setStatus] = useState<ExpenseStatus>('paid');
  const [formError, setFormError] = useState<string | null>(null);

  const categories = useLiveQuery(() => categoryRepository.getParents(), []);
  const subcategories = useLiveQuery(() => (categoryId ? categoryRepository.getSubcategories(categoryId) : []), [categoryId]);
  const suppliers = useLiveQuery(() => supplierRepository.getAll(), []);
  const activeProjects = useLiveQuery(() => projectRepository.getActive(), []);
  const allProjects = useLiveQuery(() => projectRepository.getAll(), []);
  const allFixedExpenses = useLiveQuery(() => fixedExpenseRepository.getAll(), []);

  const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
  const nextYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
  const nextMonthExpenses = useLiveQuery(
    () => expenseRepository.getByMonthYear(nextYear, nextMonth),
    [nextYear, nextMonth],
  );

  // Check URL params for quick actions from Home
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'new-expense') {
      openNewExpenseModal();
    } else if (params.get('action') === 'scan-receipt') {
      setIsScanModalOpen(true);
    }
  }, [location.search]);

  useEffect(() => {
    let isActive = true;
    async function prepareMonth() {
      try {
        await budgetService.ensureMonthlyExpenseMovements(selectedYear, selectedMonth);
      } catch (err) {
        if (isActive) {
          console.error('Errore durante la sincronizzazione delle spese fisse:', err);
        }
      }
    }
    prepareMonth();
    return () => {
      isActive = false;
    };
  }, [selectedYear, selectedMonth]);

  const allExpenses = useLiveQuery(
    () => expenseRepository.getByMonthYear(selectedYear, selectedMonth),
    [selectedYear, selectedMonth],
  );

  const currentYM = year * 12 + month;
  const selectedYM = selectedYear * 12 + selectedMonth;

  const generatedProvisions: ProvisionExpense[] = [];

  // Generate Project Provisions starting from current month up to target date
  if (allProjects && allProjects.length > 0) {
    allProjects.forEach((proj) => {
      if (proj.status === 'active' && proj.monthlyQuota > 0) {
        let projStartYM = currentYM;
        if (proj.startDate) {
          const parts = proj.startDate.split('-');
          if (parts.length >= 2) {
            projStartYM = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10);
          }
        }

        let projTargetYM = projStartYM + (proj.remainingMonths || 1) - 1;
        if (proj.targetDate) {
          const parts = proj.targetDate.split('-');
          if (parts.length >= 2) {
            projTargetYM = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10);
          }
        }

        const effectiveStartYM = Math.max(currentYM, projStartYM);
        if (selectedYM >= effectiveStartYM && selectedYM <= projTargetYM) {
          const existingProjectExpense = (allExpenses || []).some((e) => e.projectId === proj.id);
          if (!existingProjectExpense) {
            generatedProvisions.push({
              id: `acc-proj-${proj.id}-${selectedYear}-${selectedMonth}`,
              entryMode: 'projectPurchase',
              description: `Accantonamento Progetto: ${proj.name}`,
              amount: proj.monthlyQuota,
              expenseDate: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`,
              competenceMonth: selectedMonth,
              competenceYear: selectedYear,
              categoryId: categories?.[0]?.id || '',
              subcategoryId: categories?.[0]?.id || '',
              paymentMethod: 'debitCard',
              status: selectedYM <= currentYM ? 'paid' : 'planned',
              classification: 'necessary',
              notified: true,
              recurring: true,
              projectId: proj.id,
              metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
              isProvision: true,
              provisionType: 'project',
            });
          }
        }
      }
    });
  }

  const combinedExpenses: ProvisionExpense[] = [...(allExpenses || []), ...generatedProvisions];

  // 1. Spese: Uscite pianificate, fisse, straordinarie o beni durevoli (entryMode !== 'receipt')
  const speseList = React.useMemo(() => {
    return combinedExpenses
      .filter((exp) => !isCancelledStatus(exp.status) && exp.entryMode !== 'receipt')
      .sort((a, b) => (b.expenseDate || '').localeCompare(a.expenseDate || ''));
  }, [combinedExpenses]);

  // 2. Acquisti: Beni e servizi di consumo ordinario (entryMode === 'receipt')
  const acquistiList = React.useMemo(() => {
    return combinedExpenses
      .filter((exp) => !isCancelledStatus(exp.status) && exp.entryMode === 'receipt')
      .sort((a, b) => (b.expenseDate || '').localeCompare(a.expenseDate || ''));
  }, [combinedExpenses]);

  // Recenti da mostrare nei due pannelli principali (max 4 per card)
  const recentSpese = speseList.slice(0, 4);
  const recentAcquisti = acquistiList.slice(0, 4);

  // 4 KPI conformi a SCR-PC-004 Pagebook Beta R02
  const totalExpenses = combinedExpenses
    .filter((exp) => !isCancelledStatus(exp.status))
    .reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  const totalSpese = speseList.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
  const totalAcquisti = acquistiList.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  const totalDaPagare = combinedExpenses
    .filter((exp) => !isCancelledStatus(exp.status) && exp.status !== 'paid')
    .reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  // Spese del mese corrente (scadenze e pagamenti da completare)
  const currentMonthDue = React.useMemo(() => {
    return combinedExpenses
      .filter((exp) => !isCancelledStatus(exp.status) && exp.status !== 'paid')
      .slice(0, 5);
  }, [combinedExpenses]);

  // Spese del mese successivo (promemoria prossime scadenze)
  const nextMonthUpcoming = React.useMemo(() => {
    const list: { id: string; name: string; amount: number; dueDay?: number; date?: string; category?: string }[] = [];

    (allFixedExpenses || []).forEach((fe) => {
      if (fe.status === 'active') {
        const cat = categories?.find((c) => c.id === fe.categoryId);
        list.push({
          id: `fe-${fe.id}`,
          name: fe.name,
          amount: fe.expectedAmount,
          dueDay: fe.dueDay,
          category: cat?.name,
        });
      }
    });

    (nextMonthExpenses || []).forEach((exp) => {
      if (!isCancelledStatus(exp.status)) {
        const cat = categories?.find((c) => c.id === exp.categoryId);
        list.push({
          id: `exp-${exp.id}`,
          name: exp.description || cat?.name || 'Spesa programmata',
          amount: exp.amount,
          date: exp.expenseDate,
          category: cat?.name,
        });
      }
    });

    return list.slice(0, 5);
  }, [allFixedExpenses, nextMonthExpenses, categories]);

  const openNewPurchaseModal = () => {
    setModalMode('purchase');
    setEditingExpense(null);
    setFormError(null);
    setDescription('');
    setAmount('');
    setExpenseDate(new Date().toISOString().substring(0, 10));
    setCategoryId(categories?.[0]?.id || '');
    setSubcategoryId('');
    setClassification('voluntary');
    setStatus('paid');
    setSupplierId('');
    setProjectId('');
    setIsModalOpen(true);
  };

  const openNewExpenseModal = () => {
    setModalMode('expense');
    setEditingExpense(null);
    setFormError(null);
    setDescription('');
    setAmount('');
    setExpenseDate(new Date().toISOString().substring(0, 10));
    setCategoryId(categories?.[0]?.id || '');
    setSubcategoryId('');
    setClassification('necessary');
    setStatus('paid');
    setSupplierId('');
    setProjectId('');
    setIsModalOpen(true);
  };

  const openEditModal = (exp: ProvisionExpense) => {
    setEditingExpense(exp);
    setModalMode(exp.entryMode === 'receipt' ? 'purchase' : 'expense');
    setFormError(null);
    setDescription(exp.description || '');
    setAmount(exp.amount);
    setExpenseDate(exp.expenseDate || new Date().toISOString().substring(0, 10));
    setCategoryId(exp.categoryId || (categories?.[0]?.id || ''));
    setSubcategoryId(exp.subcategoryId || '');
    setClassification(exp.classification || 'necessary');
    setStatus(exp.status || 'paid');
    setSupplierId(exp.supplierId || '');
    setProjectId(exp.projectId || '');
    setIsModalOpen(true);
  };

  const openDeleteModal = (exp: ProvisionExpense) => {
    setDeletingExpenseTarget(exp);
    setIsDeleteModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!description.trim()) {
      setFormError('Inserisci una descrizione valida.');
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setFormError('Inserisci un importo valido e maggiore di zero.');
      return;
    }

    if (!expenseDate) {
      setFormError('Inserisci una data valida.');
      return;
    }

    if (!categoryId) {
      setFormError('Seleziona una categoria principale.');
      return;
    }

    if (!subcategoryId) {
      setFormError('Seleziona una sottocategoria.');
      return;
    }

    const [yStr, mStr] = expenseDate.split('-');
    const cYear = parseInt(yStr, 10);
    const cMonth = parseInt(mStr, 10);

    if (isNaN(cYear) || isNaN(cMonth)) {
      setFormError('Data non valida.');
      return;
    }

    try {
      if (editingExpense) {
        if (editingExpense.id.startsWith('acc-')) {
          await expenseRepository.create({
            entryMode: editingExpense.provisionType === 'project' ? 'projectPurchase' : 'fixedExpense',
            description: description || 'Spesa',
            amount: Number(amount),
            expenseDate,
            paymentDate: status === 'paid' ? expenseDate : null,
            competenceMonth: cMonth,
            competenceYear: cYear,
            categoryId,
            subcategoryId,
            supplierId: supplierId || null,
            projectId: projectId || null,
            paymentMethod: 'debitCard',
            status,
            classification,
            notified: true,
            recurring: false,
          });
        } else {
          const existing = await expenseRepository.getById(editingExpense.id);
          if (!existing) {
            setFormError('La voce selezionata non esiste più nel database.');
            return;
          }

          await expenseRepository.update(editingExpense.id, {
            description: description || 'Spesa',
            amount: Number(amount),
            expenseDate,
            paymentDate: status === 'paid' ? expenseDate : null,
            competenceMonth: cMonth,
            competenceYear: cYear,
            categoryId,
            subcategoryId,
            supplierId: supplierId || null,
            projectId: projectId || null,
            status,
            classification,
          });
        }
      } else {
        const mode = modalMode === 'purchase' ? 'receipt' : (projectId ? 'projectPurchase' : 'manual');
        await expenseRepository.create({
          entryMode: mode,
          description: description || (modalMode === 'purchase' ? 'Acquisto' : 'Spesa'),
          amount: Number(amount),
          expenseDate,
          paymentDate: status === 'paid' ? expenseDate : null,
          competenceMonth: cMonth,
          competenceYear: cYear,
          categoryId,
          subcategoryId,
          supplierId: supplierId || null,
          projectId: projectId || null,
          paymentMethod: 'debitCard',
          status,
          classification,
          notified: true,
          recurring: false,
        });
      }

      setIsModalOpen(false);
      setEditingExpense(null);
      setDescription('');
      setAmount('');
      setSupplierId('');
      setProjectId('');
    } catch (err) {
      console.error('Errore durante il salvataggio:', err);
      setFormError('Si è verificato un errore durante il salvataggio. Riprova.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingExpenseTarget) return;
    try {
      if (!deletingExpenseTarget.id.startsWith('acc-')) {
        await expenseRepository.delete(deletingExpenseTarget.id);
      }
      setIsDeleteModalOpen(false);
      setDeletingExpenseTarget(null);
    } catch (err) {
      console.error('Errore durante l’eliminazione:', err);
    }
  };

  const handleStatusChange = async (id: string, newStatus: ExpenseStatus) => {
    if (id.startsWith('acc-')) {
      const provItem = generatedProvisions.find((p) => p.id === id);
      if (provItem) {
        await expenseRepository.create({
          entryMode: provItem.provisionType === 'project' ? 'projectPurchase' : 'fixedExpense',
          description: provItem.description,
          amount: provItem.amount,
          expenseDate: provItem.expenseDate,
          paymentDate: newStatus === 'paid' ? provItem.expenseDate : null,
          competenceMonth: provItem.competenceMonth,
          competenceYear: provItem.competenceYear,
          categoryId: provItem.categoryId || (categories?.[0]?.id || ''),
          subcategoryId: provItem.subcategoryId || (categories?.[0]?.id || ''),
          projectId: provItem.projectId || null,
          fixedExpenseId: provItem.fixedExpenseId || null,
          paymentMethod: 'debitCard',
          status: newStatus,
          classification: 'necessary',
          notified: true,
          recurring: false,
        });
      }
    } else {
      await expenseRepository.update(id, {
        status: newStatus,
        paymentDate: newStatus === 'paid' ? new Date().toISOString().substring(0, 10) : null,
      });
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header Bar conforme a Tavola SCR-PC-004 R02 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0 shadow-xs">
            <TrendingDown className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Uscite</h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Gestisci separatamente spese pianificabili e acquisti di consumo ordinario.
            </p>
          </div>
        </div>

        {/* 3 Azioni Specifiche conformi a Tavola SCR-PC-004 R02 */}
        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
          <Button
            variant="secondary"
            icon={<ShoppingBag className="w-4 h-4 text-slate-600" />}
            onClick={openNewPurchaseModal}
            className="shadow-xs"
          >
            Nuovo acquisto
          </Button>

          <Button
            variant="emerald"
            icon={<ScanLine className="w-4 h-4" />}
            onClick={() => setIsScanModalOpen(true)}
            className="shadow-xs"
            aria-label="Acquisisci documento o scontrino"
          >
            Acquisisci scontrino
          </Button>

          <Button
            variant="rose"
            icon={<Plus className="w-4 h-4" />}
            onClick={openNewExpenseModal}
            className="shadow-xs"
          >
            Nuova spesa
          </Button>
        </div>
      </div>

      {/* Nota informativa anti-doppio conteggio */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 font-medium">
        <Info className="w-4 h-4 text-indigo-600 shrink-0" />
        <span>Ogni movimento viene conteggiato una sola volta.</span>
      </div>

      {/* Banner per documenti OCR in attesa di revisione */}
      <PendingOcrReviewBanner
        onOpenReview={(sessionId, ocrProcId) => {
          setReviewSessionId(sessionId);
          setReviewOcrProcessId(ocrProcId);
          setIsReviewModalOpen(true);
        }}
      />

      {/* Filtri Bar Periodo (Mese, Anno) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Periodo di riferimento:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {getMonthName(m)}
              </option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
          >
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <span className="text-xs text-slate-400 font-medium">
          Visualizzazione separata Spese e Acquisti
        </span>
      </div>

      {/* 2. 4 KPI Cards conformi a SCR-PC-004 Pagebook Beta R02:
          1. Uscite del mese
          2. Spese
          3. Acquisti
          4. Da pagare */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Uscite del mese */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Uscite del mese
            </span>
            <p className="text-2xl font-black text-rose-600 mt-1">
              {formatCurrency(totalExpenses)}
            </p>
            <span className="text-[11px] text-slate-400 font-medium">
              Totale periodo
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
            <TrendingDown className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 2: Spese */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Spese
            </span>
            <p className="text-2xl font-black text-indigo-600 mt-1">
              {formatCurrency(totalSpese)}
            </p>
            <span className="text-[11px] text-slate-400 font-medium">
              Uscite pianificate e fisse
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <CalendarCheck className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 3: Acquisti */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Acquisti
            </span>
            <p className="text-2xl font-black text-emerald-600 mt-1">
              {formatCurrency(totalAcquisti)}
            </p>
            <span className="text-[11px] text-slate-400 font-medium">
              Consumo ordinario
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <ShoppingBag className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 4: Da pagare */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Da pagare
            </span>
            <p className="text-2xl font-black text-amber-600 mt-1">
              {formatCurrency(totalDaPagare)}
            </p>
            <span className="text-[11px] text-slate-400 font-medium">
              Scadenze da completare
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 3. Due Pannelli Centrali Distinti: SPESE & ACQUISTI conformi a SCR-PC-004 R02 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 3.5 Pannello Spese */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
              <div>
                <div className="flex items-center gap-2">
                  <CalendarCheck className="w-5 h-5 text-indigo-600" />
                  <h2 className="font-bold text-slate-900 text-base">Spese</h2>
                </div>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  Uscite pianificate, periodiche, straordinarie o relative a beni durevoli.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewAllModal('spese')}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 shrink-0 cursor-pointer pt-0.5"
              >
                <span>Vedi tutte</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="pt-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
                Spese recenti
              </span>

              {recentSpese.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 font-medium bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  Nessuna spesa registrata.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentSpese.map((exp) => {
                    const cat = categories?.find((c) => c.id === exp.categoryId);
                    return (
                      <div
                        key={exp.id}
                        className="p-3 bg-slate-50/80 hover:bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {exp.description || cat?.name || 'Spesa'}
                            </span>
                            <Badge variant={exp.status === 'paid' ? 'success' : 'warning'}>
                              {exp.status === 'paid' ? 'Pagata' : 'Da pagare'}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span>{cat?.name || 'Categoria'}</span>
                            <span>•</span>
                            <span>{formatDate(exp.expenseDate)}</span>
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-extrabold text-slate-900">
                            - {formatCurrency(exp.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => openEditModal(exp)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg cursor-pointer"
                            title="Modifica spesa"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(exp)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                            title="Elimina spesa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Totale spese periodo:</span>
            <span className="font-bold text-slate-900">{formatCurrency(totalSpese)} ({speseList.length} totali)</span>
          </div>
        </div>

        {/* 3.6 Pannello Acquisti */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
              <div>
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-emerald-600" />
                  <h2 className="font-bold text-slate-900 text-base">Acquisti</h2>
                </div>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  Beni e servizi di consumo ordinario acquistati con una certa frequenza.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewAllModal('acquisti')}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 shrink-0 cursor-pointer pt-0.5"
              >
                <span>Vedi tutti</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="pt-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
                Acquisti recenti
              </span>

              {recentAcquisti.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 font-medium bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  Nessun acquisto registrato.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentAcquisti.map((exp) => {
                    const cat = categories?.find((c) => c.id === exp.categoryId);
                    const supp = suppliers?.find((s) => s.id === exp.supplierId);
                    return (
                      <div
                        key={exp.id}
                        className="p-3 bg-slate-50/80 hover:bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <span className="text-xs font-bold text-slate-900 truncate block">
                            {exp.description || supp?.name || 'Acquisto'}
                          </span>
                          <p className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span>{cat?.name || 'Spesa'}</span>
                            {supp && <span>• {supp.name}</span>}
                            <span>• {formatDate(exp.expenseDate)}</span>
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-extrabold text-emerald-600">
                            - {formatCurrency(exp.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => openEditModal(exp)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg cursor-pointer"
                            title="Modifica acquisto"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(exp)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                            title="Elimina acquisto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Totale acquisti periodo:</span>
            <span className="font-bold text-slate-900">{formatCurrency(totalAcquisti)} ({acquistiList.length} totali)</span>
          </div>
        </div>
      </div>

      {/* 4. 3.7 Pannelli Inferiori: Spese del mese corrente & Spese del mese successivo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Spese del mese corrente */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-slate-900 text-sm">Spese del mese corrente</h3>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Scadenze e pagamenti da completare.
              </p>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {getMonthName(selectedMonth)} {selectedYear}
            </span>
          </div>

          {currentMonthDue.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 font-medium">
              Nessuna scadenza o pagamento da completare.
            </div>
          ) : (
            <div className="space-y-2.5">
              {currentMonthDue.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center justify-between p-3 rounded-2xl bg-amber-50/50 border border-amber-200/80"
                >
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-xs font-bold text-slate-900 block truncate">
                      {exp.description || 'Spesa da saldare'}
                    </span>
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      Scadenza: {formatDate(exp.expenseDate)}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-xs font-extrabold text-amber-600 block">
                      {formatCurrency(exp.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStatusChange(exp.id, 'paid')}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 underline cursor-pointer"
                    >
                      Paga ora
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Spese del mese successivo */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <CalendarCheck className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-sm">Spese del mese successivo</h3>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Promemoria delle prossime scadenze.
              </p>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {getMonthName(nextMonth)} {nextYear}
            </span>
          </div>

          {nextMonthUpcoming.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 font-medium">
              Nessuna scadenza prevista.
            </div>
          ) : (
            <div className="space-y-2.5">
              {nextMonthUpcoming.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-2xl bg-indigo-50/40 border border-indigo-100"
                >
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-xs font-bold text-slate-900 block truncate">
                      {item.name}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {item.dueDay
                        ? `Giorno ${item.dueDay} del mese`
                        : item.date
                        ? `Data: ${formatDate(item.date)}`
                        : 'Spesa ricorrente'}
                      {item.category && ` • ${item.category}`}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-xs font-extrabold text-indigo-600 block">
                      {formatCurrency(item.amount)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Stima prevista</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Elenco Completo ("Vedi tutte / tutti") */}
      <Modal
        isOpen={viewAllModal !== null}
        onClose={() => setViewAllModal(null)}
        title={viewAllModal === 'spese' ? 'Tutte le Spese' : 'Tutti gli Acquisti'}
        subtitle={`Elenco completo per ${getMonthName(selectedMonth)} ${selectedYear}`}
        maxWidth="2xl"
      >
        <div className="space-y-4">
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
            {(viewAllModal === 'spese' ? speseList : acquistiList).length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 font-medium">
                {viewAllModal === 'spese' ? 'Nessuna spesa registrata.' : 'Nessun acquisto registrato.'}
              </div>
            ) : (
              (viewAllModal === 'spese' ? speseList : acquistiList).map((exp) => {
                const cat = categories?.find((c) => c.id === exp.categoryId);
                const supp = suppliers?.find((s) => s.id === exp.supplierId);
                const proj = activeProjects?.find((p) => p.id === exp.projectId);

                return (
                  <div
                    key={exp.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">
                          {exp.description || cat?.name || 'Movimento'}
                        </span>
                        <Badge
                          variant={
                            exp.classification === 'necessary'
                              ? 'info'
                              : exp.classification === 'voluntary'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {exp.classification === 'necessary'
                            ? 'Necessaria'
                            : exp.classification === 'voluntary'
                            ? 'Volontaria'
                            : 'Da Valutare'}
                        </Badge>
                        <Badge variant={exp.status === 'paid' ? 'success' : 'warning'}>
                          {exp.status === 'paid' ? 'Pagata' : 'Da pagare'}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5 text-slate-400" />
                          {cat?.name || 'Categoria'}
                        </span>
                        {supp && (
                          <span className="flex items-center gap-1">
                            <Store className="w-3.5 h-3.5 text-slate-400" />
                            {supp.name}
                          </span>
                        )}
                        {proj && (
                          <span className="text-indigo-600 font-medium">
                            [Progetto: {proj.name}]
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {formatDate(exp.expenseDate)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 justify-between sm:justify-end">
                      <span className="text-base font-extrabold text-slate-900 whitespace-nowrap">
                        - {formatCurrency(exp.amount)}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setViewAllModal(null);
                            openEditModal(exp);
                          }}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                          title="Modifica"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setViewAllModal(null);
                            openDeleteModal(exp);
                          }}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                          title="Elimina"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setViewAllModal(null)}>
              Chiudi
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Nuova / Modifica Voce */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExpense(null);
        }}
        title={
          editingExpense
            ? 'Modifica Movimento'
            : modalMode === 'purchase'
            ? 'Nuovo Acquisto'
            : 'Nuova Spesa'
        }
        subtitle={
          editingExpense
            ? 'Modifica i dettagli del movimento registrato'
            : modalMode === 'purchase'
            ? 'Registra un acquisto di consumo ordinario'
            : 'Registra un’uscita pianificata, periodica o straordinaria'
        }
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4 text-sm">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 mb-1">Descrizione</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
              placeholder={modalMode === 'purchase' ? 'Es. Spesa Alimentari Supermercato' : 'Es. Assicurazione Casa, Tagliando Auto'}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Importo (€)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value ? parseFloat(e.target.value) : '')}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Data</label>
              <input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Categoria Principale</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubcategoryId('');
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
                required
              >
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Sottocategoria</label>
              <select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
                required
              >
                <option value="">Seleziona...</option>
                {subcategories?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Classificazione</label>
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value as ExpenseClassification)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
              >
                <option value="necessary">Necessaria</option>
                <option value="voluntary">Volontaria</option>
                <option value="toEvaluate">Da Valutare</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Stato</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ExpenseStatus)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
              >
                <option value="paid">Pagata</option>
                <option value="planned">Pianificata</option>
                <option value="draft">Bozza</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Fornitore (Opzionale)</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
            >
              <option value="">Nessuno</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {modalMode === 'expense' && (
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Collega a Progetto (Opzionale)
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
              >
                <option value="">Nessun Progetto</option>
                {activeProjects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                setEditingExpense(null);
              }}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant={modalMode === 'purchase' ? 'emerald' : 'rose'}
            >
              {editingExpense ? 'Salva Modifiche' : modalMode === 'purchase' ? 'Salva Acquisto' : 'Salva Spesa'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Conferma Eliminazione */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeletingExpenseTarget(null);
        }}
        title="Conferma eliminazione"
        subtitle="Eliminazione definitiva movimento"
      >
        <div className="space-y-4 text-sm">
          <p className="font-semibold text-slate-900 text-base">
            Vuoi eliminare definitivamente questa voce?
          </p>

          {deletingExpenseTarget && (
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {categories?.find((c) => c.id === deletingExpenseTarget.categoryId)?.name || 'Categoria'}
                </span>
                <span>{formatDate(deletingExpenseTarget.expenseDate)}</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="font-medium text-slate-900">
                  {deletingExpenseTarget.description || 'Movimento'}
                </span>
                <span className="font-bold text-slate-900">
                  - {formatCurrency(deletingExpenseTarget.amount)}
                </span>
              </div>
            </div>
          )}

          <p className="text-xs text-rose-600 font-medium">
            Questa operazione non può essere annullata.
          </p>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsDeleteModalOpen(false);
                setDeletingExpenseTarget(null);
              }}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="rose"
              onClick={handleConfirmDelete}
            >
              Elimina
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal di Scansione & Acquizione Documento */}
      <ScanReceiptModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        onScanComplete={(_attId, ocrProcId) => {
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
          setIsReviewModalOpen(false);
          setReviewSessionId(null);
          setReviewOcrProcessId(null);
        }}
      />
    </div>
  );
};
