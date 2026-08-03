import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { monthlySavingsGoalRepository } from '../../repositories';
import { budgetService } from '../../services/budgetService';
import { formatCurrency, getMonthName } from '../../utils/formatters';
import { Target, TrendingUp, ArrowRight, Edit3, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { SavingsGoalModal } from './SavingsGoalModal';

interface HomeSavingsBoxProps {
  selectedYear: number;
  selectedMonth: number;
  currentMonthSavings: number;
}

export const HomeSavingsBox: React.FC<HomeSavingsBoxProps> = ({
  selectedYear,
  selectedMonth,
  currentMonthSavings,
}) => {
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Live queries - called unconditionally at top level
  const goal = useLiveQuery(
    () => monthlySavingsGoalRepository.getByMonthYear(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const ytdSummary = useLiveQuery(
    () => budgetService.calculatePeriodSummary(selectedYear, 1, selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const handleSaveGoal = async (targetAmount: number) => {
    await monthlySavingsGoalRepository.setGoal(selectedYear, selectedMonth, targetAmount);
  };

  const periodMonthLabel =
    selectedMonth === 1
      ? `Gennaio ${selectedYear}`
      : `Gennaio–${getMonthName(selectedMonth)} ${selectedYear}`;

  const hasGoal = goal && goal.targetAmount > 0;
  const targetAmount = hasGoal ? goal.targetAmount : 0;
  const variance = currentMonthSavings - targetAmount;

  // Percentage & bar calculations
  let percentageText = '0%';
  let progressWidthPct = 0;

  if (hasGoal && targetAmount > 0) {
    if (currentMonthSavings < 0) {
      percentageText = '0%';
      progressWidthPct = 0;
    } else {
      const rawPct = Math.round((currentMonthSavings / targetAmount) * 100);
      percentageText = `${rawPct}%`;
      progressWidthPct = Math.min(100, Math.max(0, rawPct));
    }
  }

  const ytdSavings = ytdSummary ? ytdSummary.savings : 0;
  const ytdIncome = ytdSummary ? ytdSummary.totalIncome : 0;
  const ytdExpenses = ytdSummary ? ytdSummary.totalExpenses : 0;
  const isYtdDeficit = ytdSavings < 0;

  return (
    <>
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs relative overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-slate-800">
          
          {/* AREA SINISTRA: Obiettivo risparmio mese */}
          <div className="space-y-4 pr-0 md:pr-6 pt-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 flex items-center justify-center shrink-0">
                  <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">
                    Obiettivo risparmio mese
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium capitalize">
                    {getMonthName(selectedMonth)} {selectedYear}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsModalOpen(true)}
                aria-label="Imposta o modifica l'obiettivo di risparmio del mese corrente"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
              >
                {hasGoal ? (
                  <>
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Modifica obiettivo</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Imposta obiettivo</span>
                  </>
                )}
              </button>
            </div>

            {!hasGoal ? (
              <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 space-y-2">
                <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                  Nessun obiettivo impostato per questo mese.
                </p>
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-500 dark:text-slate-400">Risparmio attuale:</span>
                  <span className={`font-bold ${currentMonthSavings >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {formatCurrency(currentMonthSavings)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Metric Summary Grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-slate-50/80 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium block">Obiettivo</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {formatCurrency(targetAmount)}
                    </span>
                  </div>

                  <div className="bg-slate-50/80 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium block">Risparmio attuale</span>
                    <span className={`text-sm font-bold ${currentMonthSavings >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {formatCurrency(currentMonthSavings)}
                    </span>
                  </div>
                </div>

                {/* Progress Bar & Status Text */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Avanzamento
                    </span>
                    <span className="font-extrabold text-indigo-600 dark:text-indigo-400">
                      {percentageText}
                    </span>
                  </div>

                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progressWidthPct}
                      className={`h-full rounded-full transition-all duration-300 ${
                        variance >= 0 ? 'bg-emerald-500' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${progressWidthPct}%` }}
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs pt-1">
                    {variance < 0 ? (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-400">
                          Mancano <strong className="text-slate-800 dark:text-slate-200">{formatCurrency(Math.abs(variance))}</strong> all&apos;obiettivo.
                        </span>
                      </>
                    ) : variance === 0 ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          Obiettivo raggiunto.
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          <strong>{formatCurrency(variance)}</strong> oltre l&apos;obiettivo.
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AREA DESTRA: Risparmio da inizio anno */}
          <div className="space-y-4 pt-6 md:pt-0 pl-0 md:pl-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800/50 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">
                    Risparmio da inizio anno
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {periodMonthLabel}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Entrate accumulate:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(ytdIncome)}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Uscite accumulate:</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">
                  {formatCurrency(ytdExpenses)}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {isYtdDeficit ? 'Disavanzo da inizio anno' : 'Risparmio accumulato'}
                </span>
                <span className={`text-sm font-extrabold ${isYtdDeficit ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {formatCurrency(ytdSavings)}
                </span>
              </div>
            </div>

            <button
              onClick={() => navigate('/reports?period=current_year')}
              aria-label="Apri il report del risparmio da inizio anno"
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <span>Vedi report annuale</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>

        </div>
      </div>

      <SavingsGoalModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveGoal}
        year={selectedYear}
        month={selectedMonth}
        initialAmount={goal?.targetAmount}
      />
    </>
  );
};
