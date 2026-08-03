import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  expenseRepository,
  categoryRepository,
  supplierRepository,
  projectRepository,
  documentSessionRepository,
} from '../../repositories';
import { budgetService } from '../../services/budgetService';
import { formatCurrency, formatDate, getCurrentYearMonth, getMonthName } from '../../utils/formatters';
import {
  PageHeader,
  FilterBar,
  EmptyState,
  Modal,
  Button,
  Badge,
  DashboardCard,
} from '../../components/common';
import { Plus, TrendingDown, Calendar, Tag, Store, Pencil, Trash2, AlertTriangle, ScanLine, FileSearch } from 'lucide-react';
import type { ExpenseClassification, ExpenseStatus, Expense } from '../../types';
import { ScanReceiptModal } from '../attachments/ScanReceiptModal';
import { OcrReviewModal } from '../attachments/OcrReviewModal';

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
  const { year, month } = getCurrentYearMonth();
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedClassification, setSelectedClassification] = useState<string>('all');

  // Modal & Edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ProvisionExpense | null>(null);

  // OCR Review Modal State
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewOcrProcessId, setReviewOcrProcessId] = useState<string | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);

  // Live Query for Sessions pending OCR Review
  const pendingReviewSessions = useLiveQuery(
    async () => {
      const all = await documentSessionRepository.getAll();
      return all.filter((s) => s.status === 'ready' || s.status === 'ready_for_review');
    },
    [],
  );

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

  const filteredExpenses = combinedExpenses.filter(
    (exp) =>
      !isCancelledStatus(exp.status) &&
      (selectedClassification === 'all' || exp.classification === selectedClassification),
  );

  const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  const totalPaid = filteredExpenses
    .filter((exp) => exp.status === 'paid')
    .reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  const openNewModal = () => {
    setEditingExpense(null);
    setFormError(null);
    setDescription('');
    setAmount('');
    setExpenseDate(new Date().toISOString().substring(0, 10));
    if (categories && categories.length > 0) {
      setCategoryId(categories[0].id);
    } else {
      setCategoryId('');
    }
    setSubcategoryId('');
    setClassification('necessary');
    setStatus('paid');
    setSupplierId('');
    setProjectId('');
    setIsModalOpen(true);
  };

  const openEditModal = (exp: ProvisionExpense) => {
    setEditingExpense(exp);
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
      setFormError('Inserisci una descrizione per la spesa.');
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setFormError('Inserisci un importo valido e maggiore di zero.');
      return;
    }

    if (!expenseDate) {
      setFormError('Inserisci una data spesa valida.');
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
      setFormError('Data spesa non valida.');
      return;
    }

    try {
      if (editingExpense) {
        if (editingExpense.id.startsWith('acc-')) {
          // Provision item being converted / edited as explicit expense
          await expenseRepository.create({
            entryMode: editingExpense.provisionType === 'project' ? 'projectPurchase' : 'fixedExpense',
            description: description || 'SpesaGenerica',
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
          // Verify record exists before updating
          const existing = await expenseRepository.getById(editingExpense.id);
          if (!existing) {
            setFormError('La spesa selezionata non esiste più nel database.');
            return;
          }

          await expenseRepository.update(editingExpense.id, {
            description: description || 'SpesaGenerica',
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
        await expenseRepository.create({
          entryMode: projectId ? 'projectPurchase' : 'manual',
          description: description || 'SpesaGenerica',
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
      console.error('Errore durante il salvataggio della spesa:', err);
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
      console.error('Errore durante l’eliminazione della spesa:', err);
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
      {/* Header Bar */}
      <PageHeader
        icon={<TrendingDown className="w-6 h-6 text-rose-600" />}
        title="Uscite e Spese Domestiche"
        subtitle={`${getMonthName(selectedMonth)} ${selectedYear} — Totale Uscite: ${formatCurrency(totalExpenses)} (di cui Pagato: ${formatCurrency(totalPaid)})`}
        actions={
          <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
            <Button
              variant="emerald"
              icon={<ScanLine className="w-4 h-4" />}
              onClick={() => setIsScanModalOpen(true)}
            >
              Acquisisci documento
            </Button>
            <Button
              variant="rose"
              icon={<Plus className="w-4 h-4" />}
              onClick={openNewModal}
            >
              Nuova Uscita
            </Button>
          </div>
        }
      />

      {/* Banner per documenti OCR in attesa di revisione */}
      {pendingReviewSessions && pendingReviewSessions.length > 0 && (
        <div className="p-4 bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <FileSearch className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                Documenti OCR pronti per la revisione ({pendingReviewSessions.length})
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Verifica ed approva i dati estratti dai documenti prima di procedere al salvataggio finale.
              </p>
            </div>
          </div>
          <Button
            variant="amber"
            icon={<FileSearch className="w-4 h-4" />}
            onClick={() => {
              setReviewSessionId(pendingReviewSessions[0].id);
              setReviewOcrProcessId(pendingReviewSessions[0].ocrProcessId || null);
              setIsReviewModalOpen(true);
            }}
          >
            Rivedi dati estratti
          </Button>
        </div>
      )}

      {/* Filters Bar */}
      <FilterBar>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(Number(e.target.value))}
          className="bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-medium text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          className="bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-medium text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {[2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <select
          value={selectedClassification}
          onChange={(e) => setSelectedClassification(e.target.value)}
          className="bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-medium text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">Tutte le Classificazioni</option>
          <option value="necessary">Necessaria</option>
          <option value="voluntary">Volontaria</option>
          <option value="toEvaluate">Da Valutare</option>
        </select>
      </FilterBar>

      {/* Expense List Card */}
      <DashboardCard
        title="Elenco delle Uscite"
        subtitle={`${getMonthName(selectedMonth)} ${selectedYear} — ${filteredExpenses.length} ${filteredExpenses.length === 1 ? 'uscita registrata' : 'uscite registrate'}`}
      >
        {filteredExpenses.length === 0 ? (
          <EmptyState
            icon={<TrendingDown className="w-7 h-7 text-rose-500" />}
            title="Nessuna spesa trovata"
            description={`Nessuna spesa registrata per ${getMonthName(selectedMonth)} ${selectedYear}.`}
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-5 -mb-5 mt-2">
            {filteredExpenses.map((exp) => {
              const cat = categories?.find((c) => c.id === exp.categoryId);
              const supp = suppliers?.find((s) => s.id === exp.supplierId);
              const proj = activeProjects?.find((p) => p.id === exp.projectId);

              return (
                <div key={exp.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white text-base">
                        {exp.description || cat?.name || 'Spesa'}
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
                      {exp.isProvision && (
                        <Badge variant="info">
                          {exp.provisionType === 'project' ? 'Accantonamento Progetto' : 'Accantonamento Spesa Fissa'}
                        </Badge>
                      )}
                      <Badge
                        variant={
                          exp.status === 'paid' ? 'success' : exp.status === 'planned' ? 'warning' : 'neutral'
                        }
                      >
                        {exp.status === 'paid' ? 'Pagata' : exp.status === 'planned' ? 'Pianificata' : exp.status}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
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
                        <span className="text-indigo-600 dark:text-indigo-400 font-medium">
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
                    <span className="text-lg font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                      - {formatCurrency(exp.amount)}
                    </span>

                    <div className="flex items-center gap-1">
                      <select
                        value={exp.status}
                        onChange={(e) => handleStatusChange(exp.id, e.target.value as ExpenseStatus)}
                        className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="paid">Pagata</option>
                        <option value="planned">Pianificata</option>
                        <option value="draft">Bozza</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => openEditModal(exp)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        title="Modifica uscita"
                        aria-label={`Modifica uscita: ${exp.description || 'Spesa'} ${formatCurrency(exp.amount)}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeleteModal(exp)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-rose-500"
                        title="Elimina uscita"
                        aria-label={`Elimina uscita: ${exp.description || 'Spesa'} ${formatCurrency(exp.amount)}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardCard>

      {/* Modal Nuova / Modifica Uscita */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExpense(null);
        }}
        title={editingExpense ? 'Modifica Uscita' : 'Nuova Uscita / Spesa'}
        subtitle={
          editingExpense
            ? 'Modifica i dati della spesa selezionata'
            : 'Registra una nuova spesa per il budget domestico'
        }
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4 text-sm">
          {formError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Descrizione</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Es. Spesa Supermercato, Bolletta Luce..."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Importo (€)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value ? parseFloat(e.target.value) : '')}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Data Spesa</label>
              <input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Categoria Principale</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubcategoryId('');
                }}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Sottocategoria</label>
              <select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Classificazione</label>
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value as ExpenseClassification)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="necessary">Necessaria</option>
                <option value="voluntary">Volontaria</option>
                <option value="toEvaluate">Da Valutare</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Stato</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ExpenseStatus)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="paid">Pagata</option>
                <option value="planned">Pianificata</option>
                <option value="draft">Bozza</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Fornitore (Opzionale)</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Nessuno</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Collega a Progetto (Opzionale)
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Nessun Progetto</option>
              {activeProjects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
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
              variant="rose"
            >
              {editingExpense ? 'Salva Modifiche' : 'Salva Uscita'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Conferma Eliminazione Uscita */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeletingExpenseTarget(null);
        }}
        title="Conferma eliminazione"
        subtitle="Eliminazione definitiva spesa"
      >
        <div className="space-y-4 text-sm">
          <p className="font-semibold text-slate-900 dark:text-white text-base">
            Vuoi eliminare definitivamente questa uscita?
          </p>

          {deletingExpenseTarget && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {categories?.find((c) => c.id === deletingExpenseTarget.categoryId)?.name || 'Categoria'}
                </span>
                <span>{formatDate(deletingExpenseTarget.expenseDate)}</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="font-medium text-slate-900 dark:text-white">
                  {deletingExpenseTarget.description || 'Spesa'}
                </span>
                <span className="font-bold text-slate-900 dark:text-white">
                  - {formatCurrency(deletingExpenseTarget.amount)}
                </span>
              </div>
            </div>
          )}

          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
            Questa operazione non può essere annullata.
          </p>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
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
