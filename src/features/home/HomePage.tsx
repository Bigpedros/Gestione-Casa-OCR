import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { budgetService } from '../../services/budgetService';
import { formatCurrency, getMonthName, getCurrentYearMonth } from '../../utils/formatters';
import {
  ArrowRight,
  Home as HomeIcon,
  ShoppingBag,
  Wallet,
  Receipt,
  Tag,
  Settings,
} from 'lucide-react';
import { HomeSavingsBox } from './HomeSavingsBox';
import { colors } from '../../design/colors';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { year, month } = getCurrentYearMonth();
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);

  useEffect(() => {
    let isActive = true;
    async function prepareSelectedMonth() {
      try {
        await budgetService.ensureMonthlyExpenseMovements(selectedYear, selectedMonth);
      } catch (error) {
        if (isActive) {
          console.error('Errore nella preparazione del mese:', error);
        }
      }
    }

    prepareSelectedMonth();

    return () => {
      isActive = false;
    };
  }, [selectedYear, selectedMonth]);

  const summary = useLiveQuery(
    () => budgetService.calculateMonthlySummary(selectedYear, selectedMonth),
    [selectedYear, selectedMonth],
  );

  if (!summary) {
    return <div className="p-6 text-center text-slate-500">Caricamento riepilogo mensile...</div>;
  }

  const totalIncome = summary.totalIncome;
  const totalExpenses = summary.totalExpenses;
  const savings = summary.savings;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Main Riepilogo Mensile Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Riepilogo mensile</h2>
            <div className="flex items-center gap-1 mt-0.5">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="text-sm font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
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
                className="text-sm font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
              >
                {[2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Left Values */}
          <div className="md:col-span-5 space-y-3.5">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/80">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.semantic.income }} />
                <span className="text-sm font-medium text-slate-700">Entrate totali</span>
              </div>
              <span className="text-sm font-bold text-emerald-600">
                {formatCurrency(totalIncome)}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/80">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.semantic.expense }} />
                <span className="text-sm font-medium text-slate-700">Uscite totali</span>
              </div>
              <span className="text-sm font-bold text-rose-600">
                {formatCurrency(totalExpenses)}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/80">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.semantic.savings }} />
                <span className="text-sm font-medium text-slate-700">Risparmio</span>
              </div>
              <span className="text-sm font-bold text-blue-600">
                {formatCurrency(savings)}
              </span>
            </div>
          </div>

          {/* Donut Chart Center */}
          <div className="md:col-span-4 flex flex-col items-center justify-center relative py-2">
            <div className="relative w-40 h-40 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                {/* Background Ring */}
                <circle cx="50" cy="50" r="38" stroke="#E2E8F0" strokeWidth="12" fill="transparent" />

                {totalIncome > 0 || totalExpenses > 0 ? (
                  <>
                    {/* Income Segment */}
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke={colors.semantic.income}
                      strokeWidth="12"
                      strokeDasharray="238.76"
                      strokeDashoffset="0"
                      fill="transparent"
                      strokeLinecap="round"
                    />
                    {/* Expense Segment */}
                    {totalExpenses > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r="38"
                        stroke={colors.semantic.expense}
                        strokeWidth="12"
                        strokeDasharray="238.76"
                        strokeDashoffset={
                          totalIncome > 0
                            ? String(238.76 * (1 - Math.min(1, totalExpenses / totalIncome)))
                            : "0"
                        }
                        fill="transparent"
                        strokeLinecap="round"
                      />
                    )}
                  </>
                ) : null}
              </svg>
              <div className="absolute text-center">
                <span className="text-xs text-slate-500 font-medium block">Risparmio</span>
                <span className="text-base font-extrabold text-blue-600">
                  {formatCurrency(savings)}
                </span>
              </div>
            </div>
          </div>

          {/* Right 3D House Illustration */}
          <div className="md:col-span-3 hidden md:flex items-center justify-center">
            <div className="relative w-36 h-36 bg-gradient-to-tr from-sky-100 to-indigo-50 rounded-3xl border border-sky-200/60 p-3 flex items-center justify-center shadow-xs">
              <svg viewBox="0 0 100 100" className="w-28 h-28 drop-shadow-md">
                <path d="M50 12 L10 42 L20 42 L20 85 L80 85 L80 42 L90 42 Z" fill="#2563EB" />
                <path d="M25 45 L50 20 L75 45 L68 45 L50 28 L32 45 Z" fill="#60A5FA" />
                <rect x="30" y="50" width="40" height="35" fill="#FFFFFF" rx="4" />
                <rect x="42" y="60" width="16" height="25" fill="#3B82F6" rx="2" />
                <rect x="35" y="55" width="10" height="10" fill="#FEF08A" rx="2" />
                <rect x="55" y="55" width="10" height="10" fill="#FEF08A" rx="2" />
                <ellipse cx="80" cy="82" rx="12" ry="4" fill="#F59E0B" />
                <ellipse cx="80" cy="78" rx="12" ry="4" fill="#FBBF24" />
                <ellipse cx="80" cy="74" rx="12" ry="4" fill="#FEF08A" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* 2. "Cosa vuoi fare?" Section with 6 Action Cards */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Cosa vuoi fare?</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {/* Card 1: Inserisci Stipendio */}
          <button
            onClick={() => navigate('/income')}
            className="flex flex-col text-left p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200 hover:bg-emerald-100/50 transition-all shadow-xs group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 border border-emerald-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Wallet className="w-6 h-6 text-emerald-600" />
            </div>
            <span className="font-bold text-sm text-emerald-800 leading-tight">Inserisci Stipendio</span>
            <span className="text-xs text-slate-500 mt-1">Aggiungi le tue entrate mensili</span>
          </button>

          {/* Card 2: Spese Fisse */}
          <button
            onClick={() => navigate('/fixed-expenses')}
            className="flex flex-col text-left p-4 rounded-2xl bg-blue-50/60 border border-blue-200 hover:bg-blue-100/50 transition-all shadow-xs group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-100 border border-blue-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Receipt className="w-6 h-6 text-blue-600" />
            </div>
            <span className="font-bold text-sm text-blue-800 leading-tight">Spese Fisse</span>
            <span className="text-xs text-slate-500 mt-1">Gestisci le spese fisse mensili</span>
          </button>

          {/* Card 3: Spese Alimentari */}
          <button
            onClick={() => navigate('/expenses')}
            className="flex flex-col text-left p-4 rounded-2xl bg-amber-50/60 border border-amber-200 hover:bg-amber-100/50 transition-all shadow-xs group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <ShoppingBag className="w-6 h-6 text-amber-600" />
            </div>
            <span className="font-bold text-sm text-amber-800 leading-tight">Spese Alimentari</span>
            <span className="text-xs text-slate-500 mt-1">Registra le spese alimentari</span>
          </button>

          {/* Card 4: Gestione Casa */}
          <button
            onClick={() => navigate('/expenses')}
            className="flex flex-col text-left p-4 rounded-2xl bg-purple-50/60 border border-purple-200 hover:bg-purple-100/50 transition-all shadow-xs group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-purple-100 border border-purple-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <HomeIcon className="w-6 h-6 text-purple-600" />
            </div>
            <span className="font-bold text-sm text-purple-800 leading-tight">Gestione Casa</span>
            <span className="text-xs text-slate-500 mt-1">Utenze, bollette e spese di casa</span>
          </button>

          {/* Card 5: Spese Varie */}
          <button
            onClick={() => navigate('/expenses')}
            className="flex flex-col text-left p-4 rounded-2xl bg-rose-50/60 border border-rose-200 hover:bg-rose-100/50 transition-all shadow-xs group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-rose-100 border border-rose-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Tag className="w-6 h-6 text-rose-600" />
            </div>
            <span className="font-bold text-sm text-rose-800 leading-tight">Spese Varie</span>
            <span className="text-xs text-slate-500 mt-1">Altre spese e acquisti</span>
          </button>

          {/* Card 6: Impostazioni */}
          <button
            onClick={() => navigate('/settings')}
            aria-label="Apri Impostazioni"
            className="flex flex-col text-left p-4 rounded-2xl bg-indigo-50/60 border border-indigo-200 hover:bg-indigo-100/50 transition-all shadow-xs group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 border border-indigo-300 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Settings className="w-6 h-6 text-indigo-600" />
            </div>
            <span className="font-bold text-sm text-indigo-800 leading-tight">Impostazioni</span>
            <span className="text-xs text-slate-500 mt-1">Configura contributori, notifiche e preferenze</span>
          </button>
        </div>
      </div>

      {/* 3. Grid for "Andamento spese" and "Categorie spese" */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Andamento spese */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900">Andamento spese</h3>
            <span className="text-xs text-slate-500 font-medium">
              {getMonthName(selectedMonth)} {selectedYear}
            </span>
          </div>

          <div className="h-44 flex items-end justify-between gap-2 pt-6 px-2 border-b border-slate-100">
            {summary.expensesTrend.map((item) => {
              const maxVal = Math.max(1, ...summary.expensesTrend.map((t) => t.amount));
              const hPct = maxVal > 0 ? Math.min(100, Math.round((item.amount / maxVal) * 100)) : 0;
              const isSelectedMonth = item.month === selectedMonth && item.year === selectedYear;

              return (
                <div key={`${item.year}-${item.month}`} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group relative">
                  {item.amount > 0 && (
                    <span className="text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5">
                      {formatCurrency(item.amount)}
                    </span>
                  )}
                  <div
                    className={`w-full rounded-t-lg transition-all duration-300 ${
                      isSelectedMonth ? 'bg-blue-600' : 'bg-blue-200'
                    }`}
                    style={{ height: item.amount > 0 ? `${Math.max(10, hPct)}%` : '4px' }}
                  />
                  <span className={`text-[11px] font-medium ${isSelectedMonth ? 'text-blue-700 font-bold' : 'text-slate-500'}`}>
                    {item.monthLabel}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => navigate('/reports')}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-50 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Vedi storico completo
            <ArrowRight className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Categorie spese */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900">Categorie spese</h3>
            <span className="text-xs text-slate-500 font-medium">
              {getMonthName(selectedMonth)} {selectedYear}
            </span>
          </div>

          {summary.expensesByCategory.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 font-medium">
              Nessuna spesa registrata per {getMonthName(selectedMonth)} {selectedYear}.
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              {summary.expensesByCategory.map((cat) => (
                <div key={cat.categoryId} className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50">
                  <div className="flex items-center gap-2.5">
                    <Tag className="w-4 h-4 text-blue-600" />
                    <span className="font-semibold text-slate-800">{cat.categoryName}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-500">{cat.percentage}%</span>
                    <span className="font-bold text-slate-900">{formatCurrency(cat.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => navigate('/expenses')}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-50 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Vedi dettaglio spese
            <ArrowRight className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </div>

      {/* 4. "Obiettivo risparmio mese" & "Risparmio da inizio anno" Box */}
      <HomeSavingsBox
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        currentMonthSavings={savings}
      />
    </div>
  );
};


