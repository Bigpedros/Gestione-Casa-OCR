import React, { useState, useEffect } from 'react';
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
import { Modal, Button } from '../common';
import { AlertCircle } from 'lucide-react';
import type { Frequency, Priority, FixedExpense, FixedExpenseStatus } from '../../types';

interface FixedExpenseFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  editingExpense?: FixedExpense | null;
}

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

export const FixedExpenseFormModal: React.FC<FixedExpenseFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editingExpense = null,
}) => {
  const categories = useLiveQuery(() => categoryRepository.getParents(), []);

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

  const daysInMonth = new Date(refYear, refMonth, 0).getDate();

  useEffect(() => {
    if (isOpen) {
      if (editingExpense) {
        setName(editingExpense.name);
        setExpectedAmount(editingExpense.expectedAmount);
        setDueDay(editingExpense.dueDay);
        setDurationMonths(editingExpense.durationMonths || '');
        setFrequency(editingExpense.frequency);
        setPriority(editingExpense.priority);
        setStatus(editingExpense.status || 'active');
        setCategoryId(editingExpense.categoryId);
        setRefMonth(editingExpense.startMonth || currentMonth);
        setRefYear(editingExpense.startYear || currentYear);
      } else {
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
      }
      setFormError(null);
    }
  }, [isOpen, editingExpense, currentMonth, currentYear, categories]);

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
          paymentMethod: 'directDebit',
          generateAutomatically: true,
          monthlyProvisioningEnabled: true,
        });
      } else {
        await fixedExpenseRepository.create({
          name: name.trim(),
          categoryId,
          subcategoryId: subId,
          expectedAmount: Number(expectedAmount),
          frequency,
          dueDay: validDueDay,
          priority,
          status: 'active',
          startMonth: refMonth,
          startYear: refYear,
          durationMonths: numDuration,
          endMonth,
          endYear,
          startDate: startDateStr,
          endDate: endDateStr,
          paymentMethod: 'directDebit',
          generateAutomatically: true,
          monthlyProvisioningEnabled: true,
        });
      }

      await budgetService.ensureMonthlyExpenseMovements(currentYear, currentMonth);

      onClose();
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Errore durante il salvataggio della spesa fissa:', err);
      setFormError('Si è verificato un errore nel salvataggio');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingExpense ? 'Modifica Spesa Fissa' : 'Nuova Spesa Fissa'}
      subtitle="Aggiungi una spesa ricorrente per la gestione domestica"
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
            placeholder="Es. Affitto, Internet, Assicurazione..."
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
            <label htmlFor="modal-ref-month-select" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Mese iniziale <span className="text-rose-500">*</span>
            </label>
            <select
              id="modal-ref-month-select"
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
            <label htmlFor="modal-ref-year-select" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Anno iniziale <span className="text-rose-500">*</span>
            </label>
            <select
              id="modal-ref-year-select"
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
            <label htmlFor="modal-duration-months-input" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Durata in mesi <span className="text-rose-500">*</span>
            </label>
            <input
              id="modal-duration-months-input"
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
            <label htmlFor="modal-due-day-input" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
              Giorno di scadenza <span className="text-rose-500">*</span>
            </label>
            <input
              id="modal-due-day-input"
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

        {editingExpense && (
          <div>
            <label htmlFor="modal-status-select" className="block font-medium mb-1 text-slate-700 dark:text-slate-300">Stato</label>
            <select
              id="modal-status-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as FixedExpenseStatus)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm cursor-pointer"
            >
              <option value="active">Attiva</option>
              <option value="suspended">Sospesa</option>
              <option value="terminated">Terminata</option>
            </select>
          </div>
        )}

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
            onClick={onClose}
          >
            Annulla
          </Button>
          <Button
            type="submit"
            variant="primary"
          >
            {editingExpense ? 'Salva Modifiche' : 'Salva Spesa Fissa'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
