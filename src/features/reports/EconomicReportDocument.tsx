import React from 'react';
import {
  Home as HomeIcon,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Clock,
  PiggyBank as SavingIcon,
  FolderKanban,
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
import {
  getExpenseStatusInfo,
  getIncomeStatusInfo,
} from './reportHelpers';

export interface ClassificationSummaries {
  necessary: number;
  voluntary: number;
  toEvaluate: number;
}

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
  supplierMap: Map<string, string>;
  upcomingPaymentsList: Expense[];
  upcomingPaymentsSum: number;
  classificationSummaries: ClassificationSummaries;
  savingPlans?: SavingPlan[];
  projects?: Project[];
  hasExtraBudgetData: boolean;
  hasSavingsOrProjects: boolean;
  isAllZeroPeriod: boolean;
  docTitle: string;
  printPeriodText: string;
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
  supplierMap,
  upcomingPaymentsList,
  upcomingPaymentsSum,
  classificationSummaries,
  savingPlans,
  projects,
  hasExtraBudgetData,
  hasSavingsOrProjects,
  isAllZeroPeriod,
  docTitle,
  printPeriodText,
}) => {
  const nonZeroCategories = (summary.expensesByCategory || []).filter((c: CategorySummary) => c.amount > 0);

  const hasClassificationData =
    classificationSummaries.necessary > 0 ||
    classificationSummaries.voluntary > 0 ||
    classificationSummaries.toEvaluate > 0;

  return (
    <div className="report-document space-y-6 text-slate-900 dark:text-slate-100">
      {/* 2. Document Header Block */}
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

      {/* 3. Indicatori Principali (4 KPI Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print-avoid-break">
        {/* Entrate Totali */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
              Entrate Totali
            </span>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {formatCurrency(summary.totalIncome)}
            </p>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              {selectedRange.isSingleMonth ? 'Totale mensile registrato' : 'Totale registrato nel periodo'}
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>

        {/* Uscite Totali */}
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
              Uscite Totali
            </span>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {formatCurrency(summary.totalExpenses)}
            </p>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Pagate, pianificate e fisse</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center shrink-0">
            <TrendingDown className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          </div>
        </div>

        {/* Risparmio Netto */}
        <div className={`bg-white dark:bg-slate-900 border ${summary.savings < 0 ? 'border-rose-300 dark:border-rose-800 bg-rose-50/20' : 'border-indigo-200 dark:border-indigo-900/50'} rounded-2xl p-4 shadow-xs flex items-center justify-between`}>
          <div>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              Risparmio Netto
            </span>
            <p className={`text-2xl font-extrabold mt-1 ${summary.savings < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
              {formatCurrency(summary.savings)}
            </p>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Entrate − Uscite</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0">
            <PiggyBank className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
        </div>

        {/* Pagamenti Imminenti */}
        <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              Pagamenti Imminenti
            </span>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {formatCurrency(upcomingPaymentsSum)}
            </p>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Spese da saldare ({upcomingPaymentsList.length})</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
      </div>

      {/* 4. Grafico di Riepilogo & Bilancio Prudenziale */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print-avoid-break">
        {/* Visual Chart Comparison */}
        <div className="lg:col-span-7">
          <DashboardCard
            title={selectedRange.isSingleMonth ? "Grafico di Riepilogo Economico" : "Andamento Economico per Mese"}
            subtitle={
              selectedRange.isSingleMonth
                ? `Confronto entrate, uscite e margine netto per ${getMonthName(selectedRange.endMonth)} ${selectedRange.endYear}`
                : `Analisi mensile di entrate, uscite e risparmio nel periodo`
            }
          >
            {isAllZeroPeriod ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                Nessun dato economico disponibile per il periodo selezionato.
              </div>
            ) : selectedRange.isSingleMonth ? (
              /* Single Month Bar Chart */
              <div className="space-y-4 pt-2">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                  <div className="space-y-3.5">
                    {/* Entrate Bar */}
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

                    {/* Uscite Bar */}
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

                    {/* Risparmio Bar */}
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

                <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                  <div className="p-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                    <span className="text-slate-500 block text-[10px]">Copertura Uscite</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      {summary.totalIncome > 0
                        ? `${Math.round(((summary.totalIncome - summary.totalExpenses) / summary.totalIncome) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30">
                    <span className="text-slate-500 block text-[10px]">Incidenza Spese</span>
                    <span className="font-bold text-rose-700 dark:text-rose-400">
                      {summary.totalIncome > 0
                        ? `${Math.round((summary.totalExpenses / summary.totalIncome) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                  <div className="p-2 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30">
                    <span className="text-slate-500 block text-[10px]">Tasso di Risparmio</span>
                    <span className="font-bold text-indigo-700 dark:text-indigo-400">
                      {summary.totalIncome > 0
                        ? `${Math.round((summary.savings / summary.totalIncome) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              /* Multi-Month Table / Chart View */
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
                          <td className={`py-2 text-right font-bold ${(m.savingsAmount || 0) < 0 ? 'text-rose-600' : 'text-indigo-600 dark:text-indigo-400'}`}>
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
                        <td className={`pt-2.5 text-right ${summary.savings < 0 ? 'text-rose-600' : 'text-indigo-600 dark:text-indigo-400'}`}>
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

        {/* Bilancio Prudenziale Card */}
        <div className="lg:col-span-5">
          <DashboardCard
            title="Bilancio Prudenziale"
            subtitle="Margine economico al netto di quote riservate e accantonamenti"
          >
            <div className="space-y-3 pt-1 text-xs">
              <div className="flex justify-between items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Risparmio Netto grezzo:</span>
                <span className={`font-bold ${summary.savings < 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
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
                <div className={`p-4 rounded-2xl ${summary.prudentialBalance < 0 ? 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60' : 'bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50'}`}>
                  <span className="text-[11px] font-bold uppercase tracking-wider block text-slate-500 dark:text-slate-400">
                    Margine Prudenziale Disponibile
                  </span>
                  <p className={`text-2xl font-extrabold mt-1 ${summary.prudentialBalance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-700 dark:text-indigo-300'}`}>
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
      </div>

      {/* 5. Tabella Entrate Totali */}
      <div className="print-avoid-break">
        <DashboardCard
          title="Entrate Registrate nel Periodo"
          subtitle={`Dettaglio analitico delle entrate (${incomes.length} movimenti)`}
        >
          {incomes.length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
              Nessuna entrata registrata nel periodo.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-2 px-3">Descrizione</th>
                    <th className="py-2 px-3">Contribuente</th>
                    <th className="py-2 px-3">Data</th>
                    <th className="py-2 px-3">Stato</th>
                    <th className="py-2 px-3 text-right">Importo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {incomes.map((inc) => {
                    const contributor = inc.contributorId ? contributorMap.get(inc.contributorId) : null;
                    const statusInfo = getIncomeStatusInfo(inc.status);
                    return (
                      <tr key={inc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                          {inc.description}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                          {contributor ? contributor.name : 'Generale'}
                        </td>
                        <td className="py-2.5 px-3">{formatDate(inc.incomeDate)}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant={statusInfo.badgeVariant}>{statusInfo.label}</Badge>
                        </td>
                        <td className="py-2.5 px-3 font-extrabold text-right text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(inc.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>
      </div>

      {/* 6. Tabella Uscite Totali */}
      <div className="print-avoid-break">
        <DashboardCard
          title="Uscite Registrate nel Periodo"
          subtitle={`Dettaglio analitico delle spese (${expenses.length} movimenti)`}
        >
          {expenses.length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
              Nessuna uscita registrata nel periodo.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-2 px-3">Descrizione</th>
                    <th className="py-2 px-3">Categoria</th>
                    <th className="py-2 px-3">Fornitore</th>
                    <th className="py-2 px-3">Data</th>
                    <th className="py-2 px-3">Stato</th>
                    <th className="py-2 px-3 text-right">Importo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {expenses.map((exp) => {
                    const catName = exp.categoryId ? categoryMap.get(exp.categoryId) : null;
                    const suppName = exp.supplierId ? supplierMap.get(exp.supplierId) : null;
                    const statusInfo = getExpenseStatusInfo(exp);
                    return (
                      <tr key={exp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                          {exp.description}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{catName || 'Non categorizzata'}</td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{suppName || '—'}</td>
                        <td className="py-2.5 px-3">{formatDate(exp.expenseDate)}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant={statusInfo.badgeVariant}>{statusInfo.label}</Badge>
                        </td>
                        <td className="py-2.5 px-3 font-extrabold text-right text-rose-600 dark:text-rose-400">
                          {formatCurrency(exp.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>
      </div>

      {/* 7. Ripartizione Uscite per Categoria & Classificazione Spese */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print-avoid-break">
        {/* Category breakdown */}
        <DashboardCard
          title="Ripartizione per Categoria"
          subtitle="Distribuzione delle spese per ambito di costo"
        >
          {nonZeroCategories.length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-xs">
              Nessuna spesa categorizzata nel periodo.
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              {nonZeroCategories.map((c) => {
                const percentage = summary.totalExpenses > 0 ? Math.round((c.amount / summary.totalExpenses) * 100) : 0;
                return (
                  <div key={c.categoryId} className="space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span className="text-slate-800 dark:text-slate-200">{c.categoryName}</span>
                      <span className="text-slate-900 dark:text-white font-bold">
                        {formatCurrency(c.amount)} ({percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full"
                        style={{ width: `${Math.min(100, percentage)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>

        {/* Expense Classification */}
        <DashboardCard
          title="Classificazione delle Spese"
          subtitle="Spese necessarie, volontarie e da valutare"
        >
          {!hasClassificationData ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-xs">
              Nessuna classificazione spesa disponibile nel periodo.
            </div>
          ) : (
            <div className="space-y-3 text-xs pt-1">
              {/* Necessarie */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-1.5">
                <div className="flex justify-between font-bold text-slate-900 dark:text-white">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                    Spese Necessarie
                  </span>
                  <span>{formatCurrency(classificationSummaries.necessary)}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full"
                    style={{
                      width: summary.totalExpenses > 0
                        ? `${Math.min(100, (classificationSummaries.necessary / summary.totalExpenses) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
              </div>

              {/* Volontarie */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-1.5">
                <div className="flex justify-between font-bold text-slate-900 dark:text-white">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
                    Spese Volontarie
                  </span>
                  <span>{formatCurrency(classificationSummaries.voluntary)}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-sky-500 h-full rounded-full"
                    style={{
                      width: summary.totalExpenses > 0
                        ? `${Math.min(100, (classificationSummaries.voluntary / summary.totalExpenses) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
              </div>

              {/* Da Valutare */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-1.5">
                <div className="flex justify-between font-bold text-slate-900 dark:text-white">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                    Spese da Valutare
                  </span>
                  <span>{formatCurrency(classificationSummaries.toEvaluate)}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-500 h-full rounded-full"
                    style={{
                      width: summary.totalExpenses > 0
                        ? `${Math.min(100, (classificationSummaries.toEvaluate / summary.totalExpenses) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </DashboardCard>
      </div>

      {/* 8. Prossime Scadenze */}
      <div className="print-avoid-break">
        <DashboardCard
          title="Prossime Scadenze (Pagamenti Imminenti)"
          subtitle="Spese pianificate e fisse ancora da saldare nel periodo"
        >
          {upcomingPaymentsList.length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-xs">
              Nessuna scadenza imminente presente nel periodo.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-2 px-3">Descrizione</th>
                    <th className="py-2 px-3">Fornitore</th>
                    <th className="py-2 px-3">Scadenza</th>
                    <th className="py-2 px-3">Stato</th>
                    <th className="py-2 px-3 text-right">Importo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {upcomingPaymentsList.map((exp) => {
                    const suppName = exp.supplierId ? supplierMap.get(exp.supplierId) : null;
                    const statusInfo = getExpenseStatusInfo(exp);
                    return (
                      <tr key={exp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                          {exp.description}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{suppName || '—'}</td>
                        <td className="py-2.5 px-3">{formatDate(exp.expenseDate)}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant={statusInfo.badgeVariant}>{statusInfo.label}</Badge>
                        </td>
                        <td className="py-2.5 px-3 font-extrabold text-right text-rose-600 dark:text-rose-400">
                          {formatCurrency(exp.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCard>
      </div>

      {/* 9. Risparmi e Progetti */}
      <div className="print-avoid-break">
        <DashboardCard
          title="Risparmi e Progetti"
          subtitle="Quote mensili ed accantonamenti destinati a risparmi e progetti"
        >
          {!hasSavingsOrProjects ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-xs">
              Nessun accantonamento destinato a risparmi o progetti nel periodo.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Piani Risparmio */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <PiggyBank className="w-4 h-4 text-indigo-600" />
                  <span className="font-bold text-slate-900 dark:text-white">Piani di Risparmio Attivi</span>
                </div>
                {(savingPlans || []).length === 0 ? (
                  <p className="text-slate-500">Nessun piano di risparmio attivo.</p>
                ) : (
                  (savingPlans || []).map((sp) => (
                    <div key={sp.id} className="flex justify-between items-center py-1 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{sp.name}</span>
                      <span className="font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(sp.monthlyQuota)}/mese</span>
                    </div>
                  ))
                )}
                <div className="pt-2 flex justify-between font-extrabold text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-700">
                  <span>Totale Quota Risparmi ({summary.totalMonths} {summary.totalMonths === 1 ? 'mese' : 'mesi'}):</span>
                  <span>{formatCurrency(summary.savingPlanTotal)}</span>
                </div>
              </div>

              {/* Progetti Attivi */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <FolderKanban className="w-4 h-4 text-sky-600" />
                  <span className="font-bold text-slate-900 dark:text-white">Progetti di Spesa Attivi</span>
                </div>
                {(projects || []).length === 0 ? (
                  <p className="text-slate-500">Nessun progetto attivo.</p>
                ) : (
                  (projects || []).map((p) => (
                    <div key={p.id} className="flex justify-between items-center py-1 border-b border-slate-200/50 dark:border-slate-700/50 last:border-0">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{p.name}</span>
                      <span className="font-bold text-sky-600 dark:text-sky-400">{formatCurrency(p.monthlyQuota)}/mese</span>
                    </div>
                  ))
                )}
                <div className="pt-2 flex justify-between font-extrabold text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-700">
                  <span>Totale Quota Progetti ({summary.totalMonths} {summary.totalMonths === 1 ? 'mese' : 'mesi'}):</span>
                  <span>{formatCurrency(summary.projectQuotaTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </DashboardCard>
      </div>

      {/* 10. Storico Extra Budget (Mostrato soltanto se non tutto zero) */}
      {hasExtraBudgetData && (
        <div className="print-avoid-break">
          <DashboardCard
            title="Storico Extra Budget"
            subtitle="Movimenti della riserva di sicurezza per copertura deficit"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span className="font-medium text-slate-600 dark:text-slate-400">Saldo Iniziale</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {formatCurrency(summary.openingExtraBudget)}
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span className="font-medium text-slate-600 dark:text-slate-400">Utilizzato per Copertura</span>
                <span className="font-bold text-rose-600 dark:text-rose-400 text-sm">
                  {formatCurrency(summary.extraBudgetUsed)}
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span className="font-medium text-slate-600 dark:text-slate-400">Saldo Finale Disponibile</span>
                <span className="font-bold text-sky-600 dark:text-sky-400 text-sm">
                  {formatCurrency(summary.closingExtraBudget)}
                </span>
              </div>
            </div>
          </DashboardCard>
        </div>
      )}

      {/* 11. Footer Documento */}
      <div className="pt-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1 print-avoid-break">
        <p className="font-bold text-slate-700 dark:text-slate-300">
          Gestione Casa – {docTitle}
        </p>
        <p>Documento generato automaticamente sulla base dei dati registrati nell’applicazione.</p>
        <p className="text-[11px] text-slate-400">Generato il {generationDateStr}</p>
      </div>
    </div>
  );
};
