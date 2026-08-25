import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { budgetService } from '../../services/budgetService';
import { reportService } from '../../services/reportService';
import {
  reportRepository,
  contributorRepository,
  incomeRepository,
  expenseRepository,
  categoryRepository,
  supplierRepository,
  settingsRepository,
  savingPlanRepository,
  projectRepository,
} from '../../repositories';
import { getMonthName, getCurrentYearMonth, formatCurrency } from '../../utils/formatters';
import {
  isCancelledStatus,
  formatHomeAddress,
  getUpcomingPayments,
} from './reportHelpers';
import {
  PeriodType,
  PERIOD_OPTIONS,
  calculateSelectedRange,
  getReportDocumentTitle,
  getPrintPeriodStr,
} from './periodUtils';
import {
  PageHeader,
  Button,
  Badge,
  DashboardCard,
  Modal,
} from '../../components/common';
import {
  Printer,
  PieChart,
  Download,
  Save,
  RotateCcw,
  CheckCircle2,
  FolderOpen,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Trash2,
  Info,
} from 'lucide-react';
import {
  EconomicReportDocument,
  type ReportInclusions,
  type ReportVisualMode,
  type ReportDetailLevel,
} from './EconomicReportDocument';
import type { MonthlyReport } from '../../types';
import { getClosingInfoText } from '../../services/monthClosingService';

export const ReportsPage: React.FC = () => {
  const currentDate = useMemo(() => getCurrentYearMonth(), []);

  // 1. Configuration State (Right Column)
  const [reportType, setReportType] = useState<string>('monthly');
  const [periodType, setPeriodType] = useState<PeriodType>('current_month');
  const [selectedCustomMonth, setSelectedCustomMonth] = useState<number | ''>('');
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.year);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [selectedContributor, setSelectedContributor] = useState<string>('all');
  const [comparisonMode, setComparisonMode] = useState<string>('none');

  const [inclusions, setInclusions] = useState<ReportInclusions>({
    summary: true,
    incomes: true,
    expenses: true,
    purchases: true,
    classification: true,
    budget: true,
    contributors: true,
  });

  const [visualMode, setVisualMode] = useState<ReportVisualMode>('chartsAndTables');
  const [detailLevel, setDetailLevel] = useState<ReportDetailLevel>('standard');

  // Preview Pagination State (Left Column)
  const [activePage, setActivePage] = useState<number>(1);
  const totalPages = 2;

  // Modals & Feedback
  const [isSavedReportsModalOpen, setIsSavedReportsModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Selected Range Calculation
  const selectedRange = useMemo(() => {
    return calculateSelectedRange(periodType, selectedCustomMonth, { year: selectedYear, month: currentDate.month });
  }, [periodType, selectedCustomMonth, selectedYear, currentDate.month]);

  // Live queries for READ-ONLY display
  const summary = useLiveQuery(
    async () => {
      if (!selectedRange) return null;
      return budgetService.calculatePeriodSummary(
        selectedRange.startYear,
        selectedRange.startMonth,
        selectedRange.endYear,
        selectedRange.endMonth
      );
    },
    [selectedRange?.startYear, selectedRange?.startMonth, selectedRange?.endYear, selectedRange?.endMonth]
  );

  const savedReport = useLiveQuery(
    async () => {
      if (!selectedRange || !selectedRange.isSingleMonth) return null;
      return reportRepository.getByMonthYear(selectedRange.endYear, selectedRange.endMonth);
    },
    [selectedRange?.endYear, selectedRange?.endMonth, selectedRange?.isSingleMonth]
  );

  const allSavedReports = useLiveQuery(() => reportRepository.getAll(), []) ?? [];

  const rawIncomes = useLiveQuery(
    async () => {
      if (!selectedRange) return [];
      return incomeRepository.getByRange(
        selectedRange.startYear,
        selectedRange.startMonth,
        selectedRange.endYear,
        selectedRange.endMonth
      );
    },
    [selectedRange?.startYear, selectedRange?.startMonth, selectedRange?.endYear, selectedRange?.endMonth]
  );

  const rawExpenses = useLiveQuery(
    async () => {
      if (!selectedRange) return [];
      return expenseRepository.getByRange(
        selectedRange.startYear,
        selectedRange.startMonth,
        selectedRange.endYear,
        selectedRange.endMonth
      );
    },
    [selectedRange?.startYear, selectedRange?.startMonth, selectedRange?.endYear, selectedRange?.endMonth]
  );

  const contributors = useLiveQuery(() => contributorRepository.getAll(), []);
  const categories = useLiveQuery(() => categoryRepository.getAll(), []);
  const suppliers = useLiveQuery(() => supplierRepository.getAll(), []);
  const settings = useLiveQuery(() => settingsRepository.get(), []);
  const savingPlans = useLiveQuery(() => savingPlanRepository.getActive(), []);
  const projects = useLiveQuery(() => projectRepository.getActive(), []);

  // Filtered Incomes and Expenses based on Contributor
  const incomes = useMemo(() => {
    if (!rawIncomes) return [];
    if (selectedContributor === 'all') return rawIncomes;
    return rawIncomes.filter((inc) => inc.contributorId === selectedContributor);
  }, [rawIncomes, selectedContributor]);

  const expenses = useMemo(() => {
    if (!rawExpenses) return [];
    return rawExpenses;
  }, [rawExpenses]);

  // Lookup maps
  const contributorMap = useMemo(() => {
    const map = new Map();
    (contributors || []).forEach((c) => map.set(c.id, c));
    return map;
  }, [contributors]);

  const categoryMap = useMemo(() => {
    const map = new Map();
    (categories || []).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const supplierMap = useMemo(() => {
    const map = new Map();
    (suppliers || []).forEach((s) => map.set(s.id, s.name));
    return map;
  }, [suppliers]);

  // Classification summaries
  const classificationSummaries = useMemo(() => {
    const res = { necessary: 0, voluntary: 0, toEvaluate: 0 };
    if (!expenses) return res;
    for (const e of expenses) {
      if (isCancelledStatus(e.status)) continue;
      if (e.classification === 'necessary') res.necessary += e.amount;
      else if (e.classification === 'voluntary') res.voluntary += e.amount;
      else if (e.classification === 'toEvaluate') res.toEvaluate += e.amount;
    }
    return res;
  }, [expenses]);

  // Upcoming payments
  const upcomingPaymentsList = useMemo(() => {
    return getUpcomingPayments(expenses || []);
  }, [expenses]);

  const upcomingPaymentsSum = useMemo(() => {
    return upcomingPaymentsList.reduce((sum, e) => sum + e.amount, 0);
  }, [upcomingPaymentsList]);

  // Title generation
  const defaultDocTitle = useMemo(() => {
    if (selectedRange) {
      return getReportDocumentTitle(periodType, selectedRange, currentDate);
    }
    return 'Report Economico';
  }, [periodType, selectedRange, currentDate]);

  const activeDocTitle = customTitle.trim() || defaultDocTitle;

  const printPeriodText = useMemo(() => {
    if (selectedRange) {
      return getPrintPeriodStr(selectedRange);
    }
    return '';
  }, [selectedRange]);

  const formattedAddress = formatHomeAddress(settings?.homeAddress);
  const now = new Date();
  const generationDateStr = `${now.getDate()} ${getMonthName(now.getMonth() + 1).toLowerCase()} ${now.getFullYear()}, ore ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const reportStatus: 'provisional' | 'final' = savedReport?.status === 'final' ? 'final' : 'provisional';

  const closingInfo = useMemo(() => {
    return getClosingInfoText(
      selectedRange?.endYear ?? currentDate.year,
      selectedRange?.endMonth ?? currentDate.month,
      !!selectedRange?.isSingleMonth,
      reportStatus
    );
  }, [selectedRange?.endYear, selectedRange?.endMonth, selectedRange?.isSingleMonth, reportStatus, currentDate]);

  const isAllZeroPeriod = useMemo(() => {
    if (!summary) return true;
    return summary.totalIncome === 0 && summary.totalExpenses === 0 && summary.savings === 0;
  }, [summary]);

  // Save report handler
  const handleSaveReport = async () => {
    if (!selectedRange) return;
    try {
      await reportService.generateMonthlyReport(selectedRange.endYear, selectedRange.endMonth);
      setToastMessage(`Report per ${getMonthName(selectedRange.endMonth)} ${selectedRange.endYear} salvato con successo!`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Reset settings
  const handleResetSettings = () => {
    setReportType('monthly');
    setPeriodType('current_month');
    setSelectedCustomMonth('');
    setSelectedYear(currentDate.year);
    setCustomTitle('');
    setSelectedContributor('all');
    setComparisonMode('none');
    setInclusions({
      summary: true,
      incomes: true,
      expenses: true,
      purchases: true,
      classification: true,
      budget: true,
      contributors: true,
    });
    setVisualMode('chartsAndTables');
    setDetailLevel('standard');
    setActivePage(1);
    setToastMessage('Impostazioni del report ripristinate ai valori predefiniti.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleLoadSavedReport = (rep: MonthlyReport) => {
    setSelectedYear(rep.year);
    setSelectedCustomMonth(rep.month);
    setPeriodType('choose_period');
    setIsSavedReportsModalOpen(false);
    setToastMessage(`Report di ${getMonthName(rep.month)} ${rep.year} caricato nell'anteprima.`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleDeleteSavedReport = async (repId: string) => {
    if (window.confirm('Sei sicuro di voler eliminare questo report salvato?')) {
      await reportRepository.delete(repId);
    }
  };

  return (
    <div id="reports-page-container" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-slate-900 text-white rounded-2xl shadow-xl border border-slate-700 text-xs font-semibold flex items-center gap-2.5 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Testata Globale della Pagina Report (SCR-PC-012) */}
      <PageHeader
        icon={<PieChart className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Report"
        subtitle="Crea, configura e richiama i report salvati."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Pulsante Secondario: Apri report salvato */}
            <Button
              id="btn-open-saved-reports-modal"
              variant="outline"
              aria-label="Apri report salvato"
              icon={<FolderOpen className="w-4 h-4" />}
              onClick={() => setIsSavedReportsModalOpen(true)}
            >
              Apri report salvato ({allSavedReports.length})
            </Button>

            {/* Pulsante Primario: Crea report */}
            <Button
              id="btn-create-save-report"
              variant="primary"
              aria-label="Crea report"
              icon={<PlusCircle className="w-4 h-4" />}
              onClick={handleSaveReport}
            >
              Crea report
            </Button>
          </div>
        }
      />

      {/* 2. Layout a Due Colonne (SCR-PC-012) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ==================== COLONNA SINISTRA: ANTEPRIMA REPORT (Span 7/8) ==================== */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          <DashboardCard
            title="Anteprima report"
            subtitle="Visualizzazione in tempo reale del documento economico generato"
            action={
              <div className="flex flex-wrap items-center gap-2">
                {/* Badge Stato Report */}
                {selectedRange?.isSingleMonth && (
                  <Badge variant={reportStatus === 'final' ? 'success' : 'warning'}>
                    {reportStatus === 'final' ? 'Definitivo' : 'Provvisorio'}
                  </Badge>
                )}

                {/* Azione: Chiudi Mese (Disabilitato - P-33R) */}
                <button
                  id="btn-close-month"
                  disabled
                  aria-disabled="true"
                  title={closingInfo.mainText}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed rounded-xl text-xs font-bold transition-colors opacity-60"
                >
                  Chiudi Mese
                </button>

                {/* Azione: Salva Report */}
                <button
                  id="btn-preview-save-report"
                  onClick={handleSaveReport}
                  title="Salva questo report"
                  aria-label="Salva questo report"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-xs font-bold transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  Salva
                </button>

                {/* Azione: Esporta PDF */}
                <button
                  id="btn-preview-export-pdf"
                  onClick={handlePrint}
                  title="Esporta o Stampa in PDF"
                  aria-label="Esporta o Stampa in PDF"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-xl text-xs font-bold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Esporta PDF
                </button>

                {/* Azione: Stampa */}
                <button
                  id="btn-preview-print"
                  onClick={handlePrint}
                  title="Stampa il report visualizzato"
                  aria-label="Stampa il report visualizzato"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-xs font-bold transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Stampa
                </button>
              </div>
            }
          >
            {/* Banner Informativo Chiusura Automatica (P-33R) */}
            <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 mb-4">
              <Info className="w-4 h-4 text-indigo-500 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{closingInfo.mainText}</span>{' '}
                <span>{closingInfo.subText}</span>
              </div>
            </div>

            {/* Controlli di Navigazione Pagine Anteprima */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 py-2.5 px-3 sm:px-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-800 text-xs mb-4">
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setActivePage(1)}
                  aria-label="Pagina 1: Sintesi Economica"
                  className={`px-2.5 py-1.5 rounded-lg font-bold transition-all text-center ${
                    activePage === 1
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 bg-white/60 dark:bg-slate-800/60 sm:bg-transparent'
                  }`}
                >
                  <span className="inline sm:hidden">1. Sintesi</span>
                  <span className="hidden sm:inline">Pagina 1: Sintesi Economica</span>
                </button>
                <button
                  onClick={() => setActivePage(2)}
                  aria-label="Pagina 2: Dettagli e Ripartizioni"
                  className={`px-2.5 py-1.5 rounded-lg font-bold transition-all text-center ${
                    activePage === 2
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 bg-white/60 dark:bg-slate-800/60 sm:bg-transparent'
                  }`}
                >
                  <span className="inline sm:hidden">2. Dettagli</span>
                  <span className="hidden sm:inline">Pagina 2: Dettagli & Ripartizioni</span>
                </button>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-1.5 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-200/60 dark:border-slate-700/60">
                <button
                  onClick={() => setActivePage(Math.max(1, activePage - 1))}
                  disabled={activePage === 1}
                  className="p-1.5 sm:p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white disabled:opacity-40"
                  title="Pagina precedente"
                  aria-label="Pagina precedente"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold text-slate-700 dark:text-slate-300 px-1">
                  Pagina {activePage} di {totalPages}
                </span>
                <button
                  onClick={() => setActivePage(Math.min(totalPages, activePage + 1))}
                  disabled={activePage === totalPages}
                  className="p-1.5 sm:p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white disabled:opacity-40"
                  title="Pagina successiva"
                  aria-label="Pagina successiva"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Document Content View */}
            {!selectedRange ? (
              <div className="p-12 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                Seleziona il mese per generare il report.
              </div>
            ) : summary ? (
              <div className="report-preview-sheet bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
                <EconomicReportDocument
                  summary={summary}
                  selectedRange={selectedRange}
                  periodType={periodType}
                  reportStatus={reportStatus}
                  generationDateStr={generationDateStr}
                  formattedAddress={formattedAddress}
                  incomes={incomes}
                  expenses={expenses}
                  contributorMap={contributorMap}
                  categoryMap={categoryMap}
                  supplierMap={supplierMap}
                  upcomingPaymentsList={upcomingPaymentsList}
                  upcomingPaymentsSum={upcomingPaymentsSum}
                  classificationSummaries={classificationSummaries}
                  savingPlans={savingPlans}
                  projects={projects}
                  hasExtraBudgetData={summary.openingExtraBudget > 0 || summary.extraBudgetUsed > 0}
                  hasSavingsOrProjects={(savingPlans?.length ?? 0) > 0 || (projects?.length ?? 0) > 0}
                  isAllZeroPeriod={isAllZeroPeriod}
                  docTitle={activeDocTitle}
                  printPeriodText={printPeriodText}
                  inclusions={inclusions}
                  visualMode={visualMode}
                  detailLevel={detailLevel}
                  activePage={activePage}
                  totalPages={totalPages}
                />
              </div>
            ) : (
              <div className="p-12 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <span>Generazione report economico in corso...</span>
                </div>
              </div>
            )}
          </DashboardCard>
        </div>

        {/* ==================== COLONNA DESTRA: CONFIGURA REPORT (Span 5/4) ==================== */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-4">
          <DashboardCard
            title="Configura report"
            subtitle="Personalizza i parametri e i contenuti del report"
          >
            <div className="space-y-5 text-xs">
              {/* 1. Tipo di report */}
              <div>
                <label htmlFor="config-report-type" className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider text-[11px]">
                  1. Tipo di report
                </label>
                <select
                  id="config-report-type"
                  aria-label="Tipo di report"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="monthly">Report Mensile</option>
                  <option value="quarterly">Report Trimestrale</option>
                  <option value="semester">Report Semestrale</option>
                  <option value="annual">Report Annuale</option>
                  <option value="custom">Report Personalizzato</option>
                </select>
              </div>

              {/* 2. Periodo */}
              <div>
                <label htmlFor="config-report-period" className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider text-[11px]">
                  2. Periodo di riferimento
                </label>
                <select
                  id="config-report-period"
                  aria-label="Periodo del report"
                  value={periodType}
                  onChange={(e) => {
                    setPeriodType(e.target.value as PeriodType);
                    setSelectedCustomMonth('');
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  {PERIOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {/* Selettori specifici Anno e Mese */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <span className="text-[10px] text-slate-400 block mb-0.5 font-semibold">Anno:</span>
                    <select
                      id="config-report-year"
                      aria-label="Anno da analizzare"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-900 dark:text-white focus:outline-none font-medium"
                    >
                      {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>

                  {periodType === 'choose_period' && (
                    <div>
                      <span className="text-[10px] text-slate-400 block mb-0.5 font-semibold">Mese:</span>
                      <select
                        id="config-report-custom-month"
                        aria-label="Mese da analizzare"
                        value={selectedCustomMonth}
                        onChange={(e) => setSelectedCustomMonth(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-900 dark:text-white focus:outline-none font-medium"
                      >
                        <option value="" disabled>
                          Seleziona mese
                        </option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                          <option key={m} value={m}>
                            {getMonthName(m)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Titolo del report */}
              <div>
                <label htmlFor="config-report-title" className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider text-[11px]">
                  3. Titolo del report
                </label>
                <input
                  id="config-report-title"
                  aria-label="Titolo del report"
                  type="text"
                  value={customTitle}
                  placeholder={defaultDocTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>

              {/* 4. Contributori */}
              <div>
                <label htmlFor="config-report-contributor" className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider text-[11px]">
                  4. Contributori inclusi
                </label>
                <select
                  id="config-report-contributor"
                  aria-label="Contributori inclusi"
                  value={selectedContributor}
                  onChange={(e) => setSelectedContributor(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="all">Tutti i componenti della casa</option>
                  {(contributors || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. Confronta con */}
              <div>
                <label htmlFor="config-report-comparison" className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider text-[11px]">
                  5. Confronta con
                </label>
                <select
                  id="config-report-comparison"
                  aria-label="Confronta con"
                  value={comparisonMode}
                  onChange={(e) => setComparisonMode(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="none">Nessun confronto</option>
                  <option value="previous_month">Mese precedente</option>
                  <option value="previous_year">Stesso periodo anno precedente</option>
                </select>
              </div>

              {/* 6. Cosa includere nel report */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider text-[11px]">
                  6. Cosa includere nel report
                </label>
                <div className="space-y-2 bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-700">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inclusions.summary}
                      onChange={(e) => setInclusions({ ...inclusions, summary: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Riepilogo generale</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inclusions.incomes}
                      onChange={(e) => setInclusions({ ...inclusions, incomes: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Entrate</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inclusions.expenses}
                      onChange={(e) => setInclusions({ ...inclusions, expenses: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Uscite</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inclusions.purchases}
                      onChange={(e) => setInclusions({ ...inclusions, purchases: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Analisi acquisti</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inclusions.classification}
                      onChange={(e) => setInclusions({ ...inclusions, classification: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Classificazione spese</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inclusions.budget}
                      onChange={(e) => setInclusions({ ...inclusions, budget: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Budget</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inclusions.contributors}
                      onChange={(e) => setInclusions({ ...inclusions, contributors: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Contributori</span>
                  </label>
                </div>
              </div>

              {/* 7. Visualizzazioni */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider text-[11px]">
                  7. Visualizzazioni
                </label>
                <div className="space-y-1.5 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="visualMode"
                      checked={visualMode === 'chartsAndTables'}
                      onChange={() => setVisualMode('chartsAndTables')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Grafici e tabelle</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="visualMode"
                      checked={visualMode === 'onlyCharts'}
                      onChange={() => setVisualMode('onlyCharts')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Solo grafici</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="visualMode"
                      checked={visualMode === 'onlyTables'}
                      onChange={() => setVisualMode('onlyTables')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Solo tabelle</span>
                  </label>
                </div>
              </div>

              {/* 8. Livello di dettaglio */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider text-[11px]">
                  8. Livello di dettaglio
                </label>
                <div className="space-y-1.5 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="detailLevel"
                      checked={detailLevel === 'synthetic'}
                      onChange={() => setDetailLevel('synthetic')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Sintetico</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="detailLevel"
                      checked={detailLevel === 'standard'}
                      onChange={() => setDetailLevel('standard')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Standard</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="detailLevel"
                      checked={detailLevel === 'detailed'}
                      onChange={() => setDetailLevel('detailed')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Dettagliato</span>
                  </label>
                </div>
              </div>

              {/* Azioni in fondo al pannello di configurazione */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
                <Button
                  id="btn-update-preview"
                  variant="primary"
                  className="w-full justify-center"
                  icon={<Sparkles className="w-4 h-4" />}
                  onClick={() => {
                    setToastMessage('Anteprima report aggiornata.');
                    setTimeout(() => setToastMessage(null), 2500);
                  }}
                >
                  Aggiorna anteprima
                </Button>
                <Button
                  id="btn-reset-report-settings"
                  variant="secondary"
                  className="w-full justify-center"
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={handleResetSettings}
                >
                  Ripristina impostazioni
                </Button>
              </div>
            </div>
          </DashboardCard>
        </div>
      </div>

      {/* MODAL: Elenco Report Salvati (SCR-PC-012) */}
      <Modal
        isOpen={isSavedReportsModalOpen}
        onClose={() => setIsSavedReportsModalOpen(false)}
        title="Report Economici Salvati"
        subtitle={`Archivio storico dei report generati (${allSavedReports.length} presenti)`}
      >
        <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
          {allSavedReports.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs italic">
              Nessun report salvato in archivio. Clicca su &quot;Crea report&quot; per archiviare il primo report.
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 sticky top-0">
                  <th className="py-2.5 px-3">Periodo</th>
                  <th className="py-2.5 px-3">Stato</th>
                  <th className="py-2.5 px-3 text-right">Entrate</th>
                  <th className="py-2.5 px-3 text-right">Uscite</th>
                  <th className="py-2.5 px-3 text-right">Saldo</th>
                  <th className="py-2.5 px-3 text-center">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {allSavedReports.map((rep) => {
                  const totalExp = rep.paidExpenses + rep.plannedNotifiedExpenses;
                  const netBal = rep.totalIncome - totalExp;
                  return (
                    <tr key={rep.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                        {getMonthName(rep.month)} {rep.year}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge variant={rep.status === 'final' ? 'success' : 'warning'}>
                          {rep.status === 'final' ? 'Definitivo' : 'Provvisorio'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(rep.totalIncome)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-rose-600 dark:text-rose-400">
                        {formatCurrency(totalExp)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          netBal < 0 ? 'text-rose-600' : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        {formatCurrency(netBal)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleLoadSavedReport(rep)}
                            className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-lg font-bold text-[11px]"
                          >
                            Carica
                          </button>
                          <button
                            onClick={() => handleDeleteSavedReport(rep.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            title="Elimina report salvato"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
          <Button variant="secondary" onClick={() => setIsSavedReportsModalOpen(false)}>
            Chiudi
          </Button>
        </div>
      </Modal>
    </div>
  );
};
