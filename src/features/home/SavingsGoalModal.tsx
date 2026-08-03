import React, { useState, useEffect, useRef } from 'react';
import { getMonthName } from '../../utils/formatters';
import { Button } from '../../components/common/Button';
import { X, Target } from 'lucide-react';

interface SavingsGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (amount: number) => Promise<void>;
  year: number;
  month: number;
  initialAmount?: number;
}

export const SavingsGoalModal: React.FC<SavingsGoalModalProps> = ({
  isOpen,
  onClose,
  onSave,
  year,
  month,
  initialAmount,
}) => {
  const [inputValue, setInputValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialAmount && initialAmount > 0) {
        setInputValue(initialAmount.toString().replace('.', ','));
      } else {
        setInputValue('');
      }
      setError(null);
      setIsSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialAmount]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalizedStr = inputValue.trim().replace(',', '.');
    if (!normalizedStr) {
      setError('L\'importo dell\'obiettivo è obbligatorio.');
      return;
    }

    const parsedNumber = Number(normalizedStr);

    if (
      isNaN(parsedNumber) ||
      !isFinite(parsedNumber) ||
      parsedNumber <= 0
    ) {
      setError('Inserisci un importo valido maggiore di zero.');
      return;
    }

    // Check decimal places max 2
    const decimalParts = normalizedStr.split('.');
    if (decimalParts.length > 1 && decimalParts[1].length > 2) {
      setError('L\'importo non può avere più di due cifre decimali.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSave(Math.round(parsedNumber * 100) / 100);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Errore durante il salvataggio dell\'obiettivo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="savings-goal-title"
    >
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xl max-w-md w-full space-y-5 animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 id="savings-goal-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Imposta obiettivo di risparmio
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                {getMonthName(month)} {year}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Chiudi finestra"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="target-amount-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Importo obiettivo (€)
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="target-amount-input"
                type="text"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="es. 300,00"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="absolute right-3.5 top-2.5 text-sm font-bold text-slate-400">€</span>
            </div>
            {error && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400 mt-1.5">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Salvataggio...' : 'Salva obiettivo'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
