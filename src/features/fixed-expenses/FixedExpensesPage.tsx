import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fixedExpenseRepository, categoryRepository } from '../../repositories';
import { formatCurrency, getCurrentYearMonth, getMonthName } from '../../utils/formatters';
import { validateDueDay } from '../../utils/dueDayValidation';
import {
  validateDurationMonths,
  calculateEndMonthYear,
  formatRecurringSummary,
} from '../../utils/recurringExpenseUtils';
import { budgetService } from '../../services/budgetService';
import {
  PageHeader,
  EmptyState,
  Modal,
  Button,
  Badge,
  DashboardCard,
} from '../../components/common';
import { Calendar, Plus, Pencil, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Frequency, Priority, PaymentMethod, FixedExpense, FixedExpenseStatus } from '../../types';

const getFrequencyMonths = (freq: Frequency): number => {
  switch (freq) {
    case 'monthly':
      return 1;
    case 'bimonthly':
      return 2;
    case 'quarterly':
      return 3;
    case 'fourMonthly':
      return 4;
    case 'semiannual':
      return 6;
    case 'annual':
      return 12;
    default:
      return 1;
  }
};

const getFrequencyLabel = (freq: Frequency): string => {
  switch (freq) {
    case 'monthly':
      return 'Mensile';
    case 'bimonthly':
      return 'Bimestrale';
    case 'quarterly':
      return 'Trimestrale';
    case 'fourMonthly':
      return 'Quadrimestrale';
    case 'semiannual':
      return 'Semestrale';
    case 'annual':
      return 'Annuale';
    default:
      return freq;
  }
};

export const FixedExpensesPage: React.FC = () => {
  const fixedExpenses = useLiveQuery(() => fixedExpenseRepository.getAll(), []);
  const categories = useLiveQuery(() => categoryRepository.getParents(), []);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<FixedExpense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FixedExpense | null>(null);

  const { year: currentYear, month: currentMonth } = getCurrentYearMonth();
  const [refMonth, setRefMonth] = useState<number>(currentMonth);
  const [refYear, setRefYear] = useState<number>(currentYear);

  const [name, setName] = useState('');
  const [expectedAmount, setExpectedAmount] = useState<number | ''>('');
  const [dueDay, setDueDay] = useState<number | ''>('');
  const [durationMonths, setDurationMonths] = useState<number | ''>('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [priority, setPriority] = useState<Priority>('high');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<FixedExpenseStatus>('active');

  const [formError, setFormError] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const daysInMonth = new Date(refYear, refMonth, 0).getDate();

  const openCreateModal = () => {
    setEditingExpense(null);
    setName('');
    setExpectedAmount('');
    setDueDay('');
    setDurationMonths('');
    setFrequency('monthly');
    setPriority('high');
    setStatus('active');
    setRefMonth(currentMonth);
    setRefYear(currentYear);
    if (categories && categories.length > 0) {
      setCategoryId(categories[0].id);
    } else {
      setCategoryId('');
    }
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (fe: FixedExpense) => {
    setEditingExpense(fe);
    setName(fe.name);
    setExpectedAmount(fe.expectedAmount);
    setDueDay(fe.dueDay);
    setDurationMonths(fe.durationMonths || '');
    setFrequency(fe.frequency);
    setPriority(fe.priority);
    setStatus(fe.status || 'active');
    setCategoryId(fe.categoryId);
    setRefMonth(fe.startMonth || currentMonth);
    setRefYear(fe.startYear || currentYear);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleMonthChange = (newMonth: number) => {
    setRefMonth(newMonth);
    if (dueDay !== '') {
      const err = validateDueDay(dueDay, newMonth, refYear);
      setFormError(err);
    }
  };

  const handleYearChange = (newYear: number) => {
    setRefYear(newYear);
    if (dueDay !== '') {
      const err = validateDueDay(dueDay, refMonth, newYear);
      setFormError(err);
    }
  };

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Il nome della spesa fissa è obbligatorio');
      return;
    }
    if (!expectedAmount || Number(expectedAmount) <= 0) {
      setFormError("L'importo previsto deve essere maggiore di zero");
      return;
    }

    const durationErr = validateDurationMonths(durationMonths);
    if (durationErr) {
      setFormError(durationErr);
      return;
    }

    const dueDayErr = validateDueDay(dueDay, refMonth, refYear);
    if (dueDayErr) {
      setFormError(dueDayErr);
      return;
    }

    const validDueDay = Number(dueDay);
    const numDuration = Number(durationMonths);

    if (!categoryId) {
      setFormError('Seleziona una categoria valida');
      return;
    }

    const { endMonth, endYear } = calculateEndMonthYear(refMonth, refYear, numDuration);
    const startDateStr = `${refYear}-${String(refMonth).padStart(2, '0')}-01`;
    const daysInEndMonth = new Date(endYear, endMonth, 0).getDate();
    const endDateStr = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(daysInEndMonth).padStart(2, '0')}`;

    try {
      const subCats = await categoryRepository.getSubcategories(categoryId);
      const subId = subCats[0]?.id || categoryId;

      if (editingExpense) {
        await fixedExpenseRepository.update(editingExpense.id, {
          name: name.trim(),
          categoryId,
          subcategoryId: subId,
          expectedAmount: Number(expectedAmount),
          frequency,
          dueDay: validDueDay,
          priority,
          status,
          startMonth: refMonth,
          startYear: refYear,
          durationMonths: numDuration,
          endMonth,
          endYear,
          startDate: startDateStr,
          endDate: endDateStr,
        });
        await budgetService.ensureRecurringExpenseMovements(editingExpense.id);
        showFeedback('Spesa fissa modificata con successo');
      } else {
        const created = await fixedExpenseRepository.create({
          name: name.trim(),
          categoryId,
          subcategoryId: subId,
          expectedAmount: Number(expectedAmount),
          frequency,
          dueDay: validDueDay,
          priority,
          paymentMethod: 'directDebit' as PaymentMethod,
          status: status || 'active',
          generateAutomatically: true,
          monthlyProvisioningEnabled: false,
          startMonth: refMonth,
          startYear: refYear,
          durationMonths: numDuration,
          endMonth,
          endYear,
          startDate: startDateStr,
          endDate: endDateStr,
        });
        await budgetService.ensureRecurringExpenseMovements(created.id);
        showFeedback('Nuova spesa fissa creata con successo');
      }

      setIsModalOpen(false);
      setEditingExpense(null);
    } catch (err: any) {
      setFormError(err?.message || 'Errore durante il salvataggio');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await budgetService.deleteFixedExpenseAndFutureMovements(deleteTarget.id);
      showFeedback('Spesa fissa ed eventuali movimenti futuri non pagati eliminati con successo');
      setDeleteTarget(null);
    } catch (err: any) {
      alert(err?.message || "Errore durante l'eliminazione");
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PageHeader
        icon={<Calendar className="w-6 h-6 text-indigo-600" />}
        title="Spese Fisse e Ricorrenti"
        subtitle="Gestisci abbonamenti, utenze fisse e impegni periodici."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={openCreateModal}
          >
            Nuova Spesa Fissa
          </Button>
        }
      />

      {feedbackMsg && (
        <div className="flex items-center gap-2 p-4 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 rounded-2xl text-sm font-semibold border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Fixed Expenses List Card */}
      <DashboardCard
        title="Elenco Spese Fisse e Ricorrenti"
        subtitle={`${fixedExpenses?.length || 0} ${(fixedExpenses?.length || 0) === 1 ? 'spesa fissa e ricorrente registrata' : 'spese fisse e ricorrenti registrate'}`}
      >
        {!fixedExpenses || fixedExpenses.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-7 h-7 text-indigo-500" />}
            title="Nessuna spesa fissa registrata"
            description="Aggiungi uscite ricorrenti come affitto, utenze o abbonamenti."
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-5 -mb-5 mt-2">
            {fixedExpenses.map((fe) => {
              const cat = categories?.find((c) => c.id === fe.categoryId);
              return (
                <div
                  key={fe.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 dark:text-white text-base">{fe.name}</h3>
                      <Badge
                        variant={
                          fe.status === 'active'
                            ? 'success'
                            : fe.status === 'suspended'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {fe.status === 'active'
                          ? 'Attiva'
                          : fe.status === 'suspended'
                          ? 'Sospesa'
                          : 'Terminata'}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      {cat && (
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {cat.name}
                        </span>
                      )}
                      <span>
                        Scadenza: Giorno <strong className="text-slate-700 dark:text-slate-300">{fe.dueDay}</strong> del mese
                      </span>
                      {fe.durationMonths && fe.startMonth && fe.startYear && fe.endMonth && fe.endYear && (
                        <span>
                          Durata:{' '}
                          <strong className="text-slate-700 dark:text-slate-300">
                            {fe.durationMonths} {fe.durationMonths === 1 ? 'mese' : 'mesi'} ({getMonthName(fe.startMonth)} {fe.startYear} — {getMonthName(fe.endMonth)} {fe.endYear})
                          </strong>
                        </span>
                      )}
                      <span>
                        Frequenza:{' '}
                        <strong className="text-slate-700 dark:text-slate-300">
                          {getFrequencyLabel(fe.frequency)}
                        </strong>
                      </span>
                      <span>
                        Accantonamento:{' '}
                        <strong className="text-indigo-600 dark:text-indigo-400 font-semibold">
                          {formatCurrency(fe.expectedAmount / getFrequencyMonths(fe.frequency))}/mese
                        </strong>
                      </span>
                      <span>
                        Priorità:{' '}
                        <strong className="text-slate-700 dark:text-slate-300">
                          {fe.priority === 'high'
                            ? 'Alta'
                            : fe.priority === 'medium'
                            ? 'Media'
                            : 'Bassa'}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 dark:border-slate-800">
                    <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                      {formatCurrency(fe.expectedAmount)}
                    </p>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(fe)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="Modifica"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(fe)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="Elimina"
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

      {/* Confirmation Modal for Delete */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Elimina Spesa Fissa"
        subtitle="Conferma l'eliminazione della spesa selezionata"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-rose-600">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">
              Vuoi interrompere questa spesa ricorrente ed eliminare i movimenti futuri non ancora pagati?
            </p>
          </div>

          {deleteTarget && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-white text-sm">
              {deleteTarget.name} ({formatCurrency(deleteTarget.expectedAmount)})
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

      {/* Modal for Create/Edit */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingExpense ? 'Modifica Spesa Fissa' : 'Nuova Spesa Fissa'}
        subtitle="Inserisci o aggiorna i dettagli della spesa fissa"
      >
        {formError && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-medium border border-rose-200 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-sm">
          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Nome Spesa Fissa
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (formError) setFormError(null);
              }}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Es. Affitto, Internet, Telecom ITALIA"
              required
            />
          </div>

          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Importo Previsto (€)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={expectedAmount}
              onChange={(e) => {
                setExpectedAmount(e.target.value ? parseFloat(e.target.value) : '');
                if (formError) setFormError(null);
              }}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="0.00"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">Frequenza</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="monthly">Mensile</option>
                <option value="bimonthly">Bimestrale</option>
                <option value="quarterly">Trimestrale</option>
                <option value="fourMonthly">Quadrimestrale</option>
                <option value="semiannual">Semestrale</option>
                <option value="annual">Annuale</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">Priorità</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="high">Alta</option>
                <option value="medium">Media</option>
                <option value="low">Bassa</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Accantonamento Mensile (Importo / Frequenza)
            </label>
            <div className="w-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white font-bold flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">Quota mensile calcolata:</span>
              <span className="text-indigo-600 dark:text-indigo-400 text-base font-extrabold">
                {expectedAmount && Number(expectedAmount) > 0
                  ? `${formatCurrency(Number(expectedAmount) / getFrequencyMonths(frequency))}/mese`
                  : '€ 0,00/mese'}
              </span>
            </div>
          </div>

          {/* Mese e Anno iniziale della spesa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ref-month-select" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
                Mese iniziale <span className="text-rose-500">*</span>
              </label>
              <select
                id="ref-month-select"
                value={refMonth}
                onChange={(e) => handleMonthChange(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {getMonthName(m)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ref-year-select" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
                Anno iniziale <span className="text-rose-500">*</span>
              </label>
              <select
                id="ref-year-select"
                value={refYear}
                onChange={(e) => handleYearChange(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer text-sm"
              >
                {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Durata in mesi e Giorno di scadenza */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="duration-months-input" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
                Durata in mesi <span className="text-rose-500">*</span>
              </label>
              <input
                id="duration-months-input"
                type="number"
                min={1}
                step={1}
                required
                inputMode="numeric"
                value={durationMonths}
                placeholder="Inserisci i mesi"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setDurationMonths('');
                    if (formError) setFormError(null);
                  } else if (raw.includes('.') || raw.includes(',')) {
                    const num = parseFloat(raw.replace(',', '.'));
                    setDurationMonths(num);
                    setFormError('La durata deve essere espressa con un numero intero di mesi.');
                  } else {
                    const num = parseInt(raw, 10);
                    setDurationMonths(isNaN(num) ? '' : num);
                    if (formError) setFormError(null);
                  }
                }}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div>
              <label htmlFor="due-day-input" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
                Giorno di scadenza <span className="text-rose-500">*</span>
              </label>
              <input
                id="due-day-input"
                type="number"
                min={1}
                max={daysInMonth}
                step={1}
                required
                inputMode="numeric"
                value={dueDay}
                placeholder="Inserisci il giorno"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setDueDay('');
                    if (formError) setFormError(null);
                  } else if (raw.includes('.') || raw.includes(',')) {
                    const num = parseFloat(raw.replace(',', '.'));
                    setDueDay(num);
                    setFormError('Il giorno di scadenza deve essere un numero intero.');
                  } else {
                    const num = parseInt(raw, 10);
                    setDueDay(isNaN(num) ? '' : num);
                    if (formError) setFormError(null);
                  }
                }}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Ammesso: da 1 a {daysInMonth}
              </p>
            </div>
          </div>

          {/* Riepilogo periodo calcolato */}
          {durationMonths !== '' && Number(durationMonths) > 0 && Number.isInteger(Number(durationMonths)) && (
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 rounded-xl text-xs text-indigo-900 dark:text-indigo-200 font-medium">
              {formatRecurringSummary(refMonth, refYear, Number(durationMonths))}
            </div>
          )}

          <div>
            <label htmlFor="status-select" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">Stato</label>
            <select
              id="status-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as FixedExpenseStatus)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm cursor-pointer"
            >
              <option value="active">Attiva</option>
              <option value="suspended">Sospesa</option>
              <option value="terminated">Terminata</option>
            </select>
          </div>

          <div>
            <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">Categoria</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
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

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant="primary"
            >
              Salva
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
