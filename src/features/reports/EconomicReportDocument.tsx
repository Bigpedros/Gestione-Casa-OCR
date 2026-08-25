import React from 'react';
import {
  Home as HomeIcon,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  PiggyBank as SavingIcon,
  FolderKanban,
  FileText,
} from 'lucide-react';
import { DashboardCard } from '../../components/common/DashboardCard';
import { Badge } from '../../components/common/Badge';
import { formatCurrency, formatDate, getMonthName } from '../../utils/formatters';
import type {
  IncomeEntry,
  Expense,
  Contributor,
  SavingPlan,
  Project,
} from '../../types';
import type { SelectedPeriodRange, PeriodType } from './periodUtils';
import type { PeriodBudgetSummary, CategorySummary, MonthTrendSummary } from '../../services/budgetService';

export interface ClassificationSummaries {
  necessary: number;
  voluntary: number;
  toEvaluate: number;
}

export interface ReportInclusions {
  summary: boolean;
  incomes: boolean;
  expenses: boolean;
  purchases: boolean;
  classification: boolean;
  budget: boolean;
  contributors: boolean;
}

export type ReportVisualMode = 'chartsAndTables' | 'onlyCharts' | 'onlyTables';
export type ReportDetailLevel = 'synthetic' | 'standard' | 'detailed';

export interface EconomicReportDocumentProps {
  summary: PeriodBudgetSummary;
  selectedRange: SelectedPeriodRange;
  periodType: PeriodType;
  reportStatus: 'provisional' | 'final';
  generationDateStr: string;
  formattedAddress: string | null;
  incomes: IncomeEntry[];
  expenses: Expense[];
  contributorMap: Map<string, Contributor>;
  categoryMap: Map<string, string>;
  supplierMap?: Map<string, string>;
  upcomingPaymentsList?: Expense[];
  upcomingPaymentsSum?: number;
  classificationSummaries: ClassificationSummaries;
  savingPlans?: SavingPlan[];
  projects?: Project[];
  hasExtraBudgetData?: boolean;
  hasSavingsOrProjects?: boolean;
  isAllZeroPeriod: boolean;
  docTitle: string;
  printPeriodText: string;
  // SCR-PC-012 Configurable props:
  inclusions?: ReportInclusions;
  visualMode?: ReportVisualMode;
  detailLevel?: ReportDetailLevel;
  activePage?: number;
  totalPages?: number;
}

export const EconomicReportDocument: React.FC<EconomicReportDocumentProps> = ({
  summary,
  selectedRange,
  periodType: _periodType,
  reportStatus,
  generationDateStr,
  formattedAddress,
  incomes,
  expenses,
  contributorMap,
  categoryMap,
  supplierMap: _supplierMap,
  upcomingPaymentsList: _upcomingPaymentsList,
  upcomingPaymentsSum: _upcomingPaymentsSum,
  classificationSummaries,
  savingPlans: _savingPlans,
  projects: _projects,
  hasExtraBudgetData: _hasExtraBudgetData,
  hasSavingsOrProjects: _hasSavingsOrProjects,
  isAllZeroPeriod,
  docTitle,
  printPeriodText,
  inclusions = {
    summary: true,
    incomes: true,
    expenses: true,
    purchases: true,
    classification: true,
    budget: true,
    contributors: true,
  },
  visualMode = 'chartsAndTables',
  detailLevel = 'standard',
  activePage = 1,
  totalPages = 2,
}) => {
  const nonZeroCategories = (summary.expensesByCategory || []).filter((c: CategorySummary) => c.amount > 0);

  const hasClassificationData =
    classificationSummaries.necessary > 0 ||
    classificationSummaries.voluntary > 0 ||
    classificationSummaries.toEvaluate > 0;

  const showPage1 = activePage === 1;
  const showPage2 = activePage === 2;

  return (
    <div className="report-document space-y-6 text-slate-900 dark:text-slate-100">
      {/* ======================= PAGE 1 CONTENT ======================= */}
      {showPage1 && (
        <div className="space-y-6 animate-fadeIn">
          {/* Header Block */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs print-avoid-break">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-extrabold text-sm">
                    GC
                  </div>
                  <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white uppercase">
                    GESTIONE CASA
                  </h1>
                </div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">
                  {docTitle}
                </h2>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                  {printPeriodText}
                </p>
              </div>

              <div className="text-left md:text-right space-y-1 text-xs text-slate-500 dark:text-slate-400">
                {formattedAddress && (
                  <p className="flex items-center md:justify-end gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                    <HomeIcon className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Abitazione: {formattedAddress}</span>
                  </p>
                )}
                {selectedRange.isSingleMonth && (
                  <div className="flex items-center md:justify-end gap-2">
                    <span>Stato Report:</span>
                    <Badge variant={reportStatus === 'final' ? 'success' : 'warning'}>
                      {reportStatus === 'final' ? 'Definitivo' : 'Provvisorio'}
                    </Badge>
                  </div>
                )}
                <p>Generato il: {generationDateStr}</p>
              </div>
            </div>
          </div>

          {/* 3 KPI Contabili Chiave (SCR-PC-012) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 print-avoid-break">
            {/* KPI 1: Totale Entrate */}
            <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-4 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  Totale Entrate
                </span>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  {formatCurrency(summary.totalIncome)}
                </p>
                <span className="text-[11px] text-slate-400 mt-0.5 block">
                  {selectedRange.isSingleMonth ? 'Totale mensile' : 'Totale periodo'}
                </span>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>

            {/* KPI 2: Totale Uscite */}
            <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                  Totale Uscite
                </span>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  {formatCurrency(summary.totalExpenses)}
                </p>
                <span className="text-[11px] text-slate-400 mt-0.5 block">Spese sostenute e pianificate</span>
              </div>
              <div className="w-11 h-11 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center shrink-0">
                <TrendingDown className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
            </div>

            {/* KPI 3: Saldo del Periodo */}
            <div
              className={`bg-white dark:bg-slate-900 border ${
                summary.savings < 0
                  ? 'border-rose-300 dark:border-rose-800 bg-rose-50/20'
                  : 'border-indigo-200 dark:border-indigo-900/50'
              } rounded-2xl p-4 shadow-xs flex items-center justify-between`}
            >
              <div>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  Saldo del Periodo
                </span>
                <p
                  className={`text-2xl font-extrabold mt-1 ${
                    summary.savings < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {formatCurrency(summary.savings)}
                </p>
                <span className="text-[11px] text-slate-400 mt-0.5 block">
                  {summary.savings >= 0 ? 'Surplus economico netto' : 'Disavanzo registrato'}
                </span>
              </div>
              <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0">
                <PiggyBank className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
            </div>
          </div>

          {/* Riepilogo Generale Contabile & Bilancio Prudenziale */}
          {(inclusions.summary || inclusions.budget) && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print-avoid-break">
              {/* Grafico Andamento Economico */}
              {inclusions.summary && (
                <div className={inclusions.budget ? 'lg:col-span-7' : 'lg:col-span-12'}>
                  <DashboardCard
                    title={selectedRange.isSingleMonth ? 'Riepilogo Generale' : 'Andamento Economico per Mese'}
                    subtitle={
                      selectedRange.isSingleMonth
                        ? `Confronto entrate, uscite e margine per ${getMonthName(selectedRange.endMonth)} ${selectedRange.endYear}`
                        : 'Analisi mensile di entrate, uscite e risparmio nel periodo'
                    }
                  >
                    {isAllZeroPeriod ? (
                      <div className="p-8 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                        Nessun dato economico disponibile per il periodo selezionato.
                      </div>
                    ) : selectedRange.isSingleMonth ? (
                      <div className="space-y-4 pt-2">
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                          <div className="space-y-3.5">
                            {/* Entrate */}
                            <div>
                              <div className="flex justify-between text-xs font-semibold mb-1">
                                <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                                  Entrate ({formatCurrency(summary.totalIncome)})
                                </span>
                                <span className="text-slate-700 dark:text-slate-300">
                                  {summary.totalIncome > 0 ? '100%' : '0%'}
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 h-3 rounded-full overflow-hidden">
                                <div
                                  className="bg-emerald-500 h-full rounded-full transition-all"
                                  style={{ width: summary.totalIncome > 0 ? '100%' : '0%' }}
                                />
                              </div>
                            </div>

                            {/* Uscite */}
                            <div>
                              <div className="flex justify-between text-xs font-semibold mb-1">
                                <span className="text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                                  Uscite ({formatCurrency(summary.totalExpenses)})
                                </span>
                                <span className="text-slate-700 dark:text-slate-300">
                                  {summary.totalIncome > 0
                                    ? `${Math.min(100, Math.round((summary.totalExpenses / summary.totalIncome) * 100))}%`
                                    : '0%'}
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 h-3 rounded-full overflow-hidden">
                                <div
                                  className="bg-rose-500 h-full rounded-full transition-all"
                                  style={{
                                    width: summary.totalIncome > 0
                                      ? `${Math.min(100, (summary.totalExpenses / summary.totalIncome) * 100)}%`
                                      : '0%',
                                  }}
                                />
                              </div>
                            </div>

                            {/* Risparmio */}
                            <div>
                              <div className="flex justify-between text-xs font-semibold mb-1">
                                <span className="text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                                  Risparmio Netto ({formatCurrency(summary.savings)})
                                </span>
                                <span className="text-slate-700 dark:text-slate-300">
                                  {summary.totalIncome > 0
                                    ? `${Math.round((summary.savings / summary.totalIncome) * 100)}%`
                                    : '0%'}
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 h-3 rounded-full overflow-hidden">
                                <div
                                  className={`${summary.savings < 0 ? 'bg-rose-600' : 'bg-indigo-500'} h-full rounded-full transition-all`}
                                  style={{
                                    width: summary.totalIncome > 0
                                      ? `${Math.max(0, Math.min(100, (summary.savings / summary.totalIncome) * 100))}%`
                                      : '0%',
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-xs pt-1">
                          <div className="p-2.5 sm:p-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 flex sm:block items-center justify-between sm:justify-center">
                            <span className="text-slate-500 block text-xs sm:text-[10px]">Copertura Uscite</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm sm:text-xs">
                              {summary.totalIncome > 0
                                ? `${Math.round(((summary.totalIncome - summary.totalExpenses) / summary.totalIncome) * 100)}%`
                                : '0%'}
                            </span>
                          </div>
                          <div className="p-2.5 sm:p-2 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 flex sm:block items-center justify-between sm:justify-center">
                            <span className="text-slate-500 block text-xs sm:text-[10px]">Incidenza Spese</span>
                            <span className="font-bold text-rose-700 dark:text-rose-400 text-sm sm:text-xs">
                              {summary.totalIncome > 0
                                ? `${Math.round((summary.totalExpenses / summary.totalIncome) * 100)}%`
                                : '0%'}
                            </span>
                          </div>
                          <div className="p-2.5 sm:p-2 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 flex sm:block items-center justify-between sm:justify-center">
                            <span className="text-slate-500 block text-xs sm:text-[10px]">Tasso di Risparmio</span>
                            <span className="font-bold text-indigo-700 dark:text-indigo-400 text-sm sm:text-xs">
                              {summary.totalIncome > 0
                                ? `${Math.round((summary.savings / summary.totalIncome) * 100)}%`
                                : '0%'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 pt-1">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider">
                                <th className="pb-2">Mese</th>
                                <th className="pb-2 text-right">Entrate</th>
                                <th className="pb-2 text-right">Uscite</th>
                                <th className="pb-2 text-right">Risparmio Netto</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {(summary.expensesTrend || []).map((m: MonthTrendSummary) => (
                                <tr key={`${m.year}-${m.month}`}>
                                  <td className="py-2 font-bold text-slate-800 dark:text-slate-200">
                                    {m.monthLabel} {m.year}
                                  </td>
                                  <td className="py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                    {formatCurrency(m.incomeAmount || 0)}
                                  </td>
                                  <td className="py-2 text-right font-semibold text-rose-600 dark:text-rose-400">
                                    {formatCurrency(m.amount)}
                                  </td>
                                  <td
                                    className={`py-2 text-right font-bold ${
                                      (m.savingsAmount || 0) < 0 ? 'text-rose-600' : 'text-indigo-600 dark:text-indigo-400'
                                    }`}
                                  >
                                    {formatCurrency(m.savingsAmount || 0)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 border-slate-300 dark:border-slate-700 font-extrabold text-slate-900 dark:text-white">
                                <td className="pt-2.5">Totale Periodo</td>
                                <td className="pt-2.5 text-right text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(summary.totalIncome)}
                                </td>
                                <td className="pt-2.5 text-right text-rose-600 dark:text-rose-400">
                                  {formatCurrency(summary.totalExpenses)}
                                </td>
                                <td
                                  className={`pt-2.5 text-right ${
                                    summary.savings < 0 ? 'text-rose-600' : 'text-indigo-600 dark:text-indigo-400'
                                  }`}
                                >
                                  {formatCurrency(summary.savings)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </DashboardCard>
                </div>
              )}

              {/* Bilancio Prudenziale */}
              {inclusions.budget && (
                <div className={inclusions.summary ? 'lg:col-span-5' : 'lg:col-span-12'}>
                  <DashboardCard
                    title="Bilancio Prudenziale"
                    subtitle="Margine economico al netto di quote riservate e accantonamenti"
                  >
                    <div className="space-y-3 pt-1 text-xs">
                      <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Risparmio Netto grezzo:</span>
                        <span
                          className={`font-bold ${summary.savings < 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}
                        >
                          {formatCurrency(summary.savings)}
                        </span>
                      </div>

                      <div className="space-y-2 pl-2">
                        <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                          <span className="flex items-center gap-1.5">
                            <SavingIcon className="w-3.5 h-3.5 text-indigo-500" />
                            Quota Piani Risparmio:
                          </span>
                          <span className="font-semibold text-rose-600 dark:text-rose-400">
                            − {formatCurrency(summary.savingPlanTotal)}
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                          <span className="flex items-center gap-1.5">
                            <FolderKanban className="w-3.5 h-3.5 text-sky-500" />
                            Quota Progetti Attivi:
                          </span>
                          <span className="font-semibold text-rose-600 dark:text-rose-400">
                            − {formatCurrency(summary.projectQuotaTotal)}
                          </span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                        <div
                          className={`p-4 rounded-2xl ${
                            summary.prudentialBalance < 0
                              ? 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60'
                              : 'bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50'
                          }`}
                        >
                          <span className="text-[11px] font-bold uppercase tracking-wider block text-slate-500 dark:text-slate-400">
                            Margine Prudenziale Disponibile
                          </span>
                          <p
                            className={`text-2xl font-extrabold mt-1 ${
                              summary.prudentialBalance < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-indigo-700 dark:text-indigo-300'
                            }`}
                          >
                            {formatCurrency(summary.prudentialBalance)}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            {summary.prudentialBalance >= 0
                              ? 'Capacità residua utilizzabile senza intaccare gli accantonamenti.'
                              : 'Attenzione: le uscite e le quote superano il risparmio netto.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </DashboardCard>
                </div>
              )}
            </div>
          )}

          {/* Classificazione Spese */}
          {inclusions.classification && (
            <div className="print-avoid-break">
              <DashboardCard
                title="Classificazione Spese"
                subtitle="Ripartizione delle uscite per livello di necessità"
              >
                {!hasClassificationData ? (
                  <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    Nessuna classificazione registrata per le spese del periodo.
                  </div>
                ) : (
                  <div className="space-y-4 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {/* Spese Necessarie */}
                      <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-emerald-800 dark:text-emerald-300">
                            Spese Necessarie
                          </span>
                          <span className="text-[11px] font-bold text-emerald-600">
                            {summary.totalExpenses > 0
                              ? `${Math.round((classificationSummaries.necessary / summary.totalExpenses) * 100)}%`
                              : '0%'}
                          </span>
                        </div>
                        <p className="text-xl font-extrabold text-slate-900 dark:text-white">
                          {formatCurrency(classificationSummaries.necessary)}
                        </p>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                          Utenze, affitto, alimentari base
                        </span>
                      </div>

                      {/* Spese Volontarie */}
                      <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-indigo-800 dark:text-indigo-300">
                            Spese Volontarie
                          </span>
                          <span className="text-[11px] font-bold text-indigo-600">
                            {summary.totalExpenses > 0
                              ? `${Math.round((classificationSummaries.voluntary / summary.totalExpenses) * 100)}%`
                              : '0%'}
                          </span>
                        </div>
                        <p className="text-xl font-extrabold text-slate-900 dark:text-white">
                          {formatCurrency(classificationSummaries.voluntary)}
                        </p>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                          Svago, abbonamenti, comfort
                        </span>
                      </div>

                      {/* Spese Da Valutare */}
                      <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-amber-800 dark:text-amber-300">
                            Da Valutare
                          </span>
                          <span className="text-[11px] font-bold text-amber-600">
                            {summary.totalExpenses > 0
                              ? `${Math.round((classificationSummaries.toEvaluate / summary.totalExpenses) * 100)}%`
                              : '0%'}
                          </span>
                        </div>
                        <p className="text-xl font-extrabold text-slate-900 dark:text-white">
                          {formatCurrency(classificationSummaries.toEvaluate)}
                        </p>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                          Spese straordinarie o da ottimizzare
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </DashboardCard>
            </div>
          )}

          {/* Sezione Sintesi ed Osservazioni */}
          <div className="p-5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60 text-xs text-slate-700 dark:text-slate-300 space-y-2">
            <h4 className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-indigo-600" />
              Sintesi ed Osservazioni Economiche
            </h4>
            <p className="leading-relaxed">
              {summary.totalIncome === 0 && summary.totalExpenses === 0
                ? 'Nel periodo esaminato non risultano registrati movimenti contabili attivi.'
                : summary.savings >= 0
                ? `Nel periodo esaminato le entrate (€${summary.totalIncome.toFixed(
                    2
                  )}) superano le uscite complessive (€${summary.totalExpenses.toFixed(
                    2
                  )}), generando un saldo positivo di ${formatCurrency(
                    summary.savings
                  )}. La copertura delle spese si attesta al ${
                    summary.totalIncome > 0
                      ? Math.round(((summary.totalIncome - summary.totalExpenses) / summary.totalIncome) * 100)
                      : 0
                  }%.`
                : `Nel periodo esaminato le uscite (€${summary.totalExpenses.toFixed(
                    2
                  )}) superano le entrate (€${summary.totalIncome.toFixed(
                    2
                  )}), evidenziando un disavanzo di ${formatCurrency(
                    Math.abs(summary.savings)
                  )}. Si raccomanda di valutare l'impiego della riserva di sicurezza o la riduzione delle spese non essenziali.`}
            </p>
          </div>

          {/* Footer Pagina 1 */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-400">
            <span>Gestione Casa – {docTitle}</span>
            <span className="font-semibold">Pagina 1 di {totalPages}</span>
          </div>
        </div>
      )}

      {/* ======================= PAGE 2 CONTENT ======================= */}
      {showPage2 && (
        <div className="space-y-6 animate-fadeIn">
          {/* Header Mini Pagina 2 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-xs flex justify-between items-center">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {docTitle} – Dettagli e Ripartizioni
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">{printPeriodText}</span>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
              Pagina 2 di {totalPages}
            </span>
          </div>

          {/* Uscite per Categoria */}
          {inclusions.expenses && (
            <div className="print-avoid-break">
              <DashboardCard
                title="Ripartizione Uscite per Categoria"
                subtitle={`Distribuzione delle spese tra le categorie registrate (${nonZeroCategories.length} attive)`}
              >
                {nonZeroCategories.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    Nessuna uscita registrata per categoria nel periodo.
                  </div>
                ) : (
                  <div className="space-y-4 pt-1">
                    {/* Visual Charts (if visualMode allows) */}
                    {(visualMode === 'chartsAndTables' || visualMode === 'onlyCharts') && (
                      <div className="space-y-3 pb-2">
                        {nonZeroCategories.map((cat) => (
                          <div key={cat.categoryId} className="space-y-1">
                            <div className="flex justify-between text-xs font-semibold">
                              <span className="text-slate-700 dark:text-slate-300">{cat.categoryName}</span>
                              <span className="text-slate-900 dark:text-white font-bold">
                                {formatCurrency(cat.amount)} ({cat.percentage}%)
                              </span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                              <div
                                className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all"
                                style={{ width: `${Math.min(100, cat.percentage)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Table View (if visualMode allows) */}
                    {(visualMode === 'chartsAndTables' || visualMode === 'onlyTables') && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider">
                              <th className="py-2">Categoria</th>
                              <th className="py-2 text-center">Incidenza</th>
                              <th className="py-2 text-right">Totale</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {nonZeroCategories.map((cat) => (
                              <tr key={cat.categoryId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="py-2 font-semibold text-slate-800 dark:text-slate-200">
                                  {cat.categoryName}
                                </td>
                                <td className="py-2 text-center text-slate-500">{cat.percentage}%</td>
                                <td className="py-2 text-right font-bold text-slate-900 dark:text-white">
                                  {formatCurrency(cat.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </DashboardCard>
            </div>
          )}

          {/* Analisi Acquisti e Scontrini */}
          {inclusions.purchases && (
            <div className="print-avoid-break">
              <DashboardCard
                title="Analisi Acquisti Ordinari e Scontrini"
                subtitle={`Riepilogo delle spese di consumo registrate (${expenses.length} movimenti)`}
              >
                {expenses.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    Nessun acquisto registrato nel periodo.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider sticky top-0 bg-white dark:bg-slate-900">
                          <th className="py-2 px-2">Descrizione</th>
                          <th className="py-2 px-2">Data</th>
                          <th className="py-2 px-2">Categoria</th>
                          <th className="py-2 px-2 text-right">Importo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {expenses.slice(0, detailLevel === 'detailed' ? 50 : 10).map((exp) => (
                          <tr key={exp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="py-2 px-2 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                              {exp.description}
                            </td>
                            <td className="py-2 px-2 text-slate-500 whitespace-nowrap">
                              {formatDate(exp.expenseDate)}
                            </td>
                            <td className="py-2 px-2 text-slate-500">
                              {categoryMap.get(exp.categoryId) || 'Generale'}
                            </td>
                            <td className="py-2 px-2 text-right font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                              {formatCurrency(exp.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DashboardCard>
            </div>
          )}

          {/* Ripartizione Contributori */}
          {inclusions.contributors && (
            <div className="print-avoid-break">
              <DashboardCard
                title="Ripartizione Contributori"
                subtitle="Quote di partecipazione economica dei componenti della casa"
              >
                {incomes.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    Nessun dato di contribuzione disponibile.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-1">
                    {Array.from(contributorMap.values()).map((contrib) => {
                      const contribIncomes = incomes.filter((inc) => inc.contributorId === contrib.id);
                      const totalContrib = contribIncomes.reduce((s, inc) => s + inc.amount, 0);
                      const pct =
                        summary.totalIncome > 0
                          ? Math.round((totalContrib / summary.totalIncome) * 100)
                          : 0;

                      return (
                        <div
                          key={contrib.id}
                          className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">
                              {contrib.name}
                            </span>
                            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                              {pct}%
                            </span>
                          </div>
                          <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(totalContrib)}
                          </p>
                          <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </DashboardCard>
            </div>
          )}

          {/* Note di Chiusura e Certificazione */}
          <div className="pt-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1 print-avoid-break">
            <p className="font-bold text-slate-700 dark:text-slate-300">
              Gestione Casa – {docTitle}
            </p>
            <p>Documento generato automaticamente sulla base dei dati registrati nell’applicazione.</p>
            <p className="text-[11px] text-slate-400">Generato il {generationDateStr}</p>
          </div>

          {/* Footer Pagina 2 */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-400">
            <span>Gestione Casa – {docTitle}</span>
            <span className="font-semibold">Pagina 2 di {totalPages}</span>
          </div>
        </div>
      )}
    </div>
  );
};
