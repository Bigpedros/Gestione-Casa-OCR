import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { budgetService } from '../../services/budgetService';
import { runMonthClosingCheck, getClosingInfoText } from '../../services/monthClosingService';
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
import { getMonthName, getCurrentYearMonth } from '../../utils/formatters';
import {
  isCancelledStatus,
  formatHomeAddress,
  getUpcomingPayments,
} from './reportHelpers';
import {
  PeriodType,
  PERIOD_OPTIONS,
  calculateSelectedRange,
  getPeriodSubtitle,
  getReportDocumentTitle,
  getPrintPeriodStr,
} from './periodUtils';
import {
  PageHeader,
  Button,
  Badge,
} from '../../components/common';
import {
  Printer,
  CheckCircle2,
  Calendar,
  PieChart,
  Clock,
  Home as HomeIcon,
  Eye,
} from 'lucide-react';
import { EconomicReportDocument } from './EconomicReportDocument';
import { ReportPreviewModal } from './ReportPreviewModal';

export const ReportsPage: React.FC = () => {
  const initialPeriod = useMemo(() => {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const p = params.get('period');
        if (p && PERIOD_OPTIONS.some((opt) => opt.value === p)) {
          return p as PeriodType;
        }
      }
    } catch {
      // Ignore fallback
    }
    return 'current_month';
  }, []);

  const currentDate = useMemo(() => getCurrentYearMonth(), []);
  const [periodType, setPeriodType] = useState<PeriodType>(initialPeriod);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const p = params.get('period');
        if (p && PERIOD_OPTIONS.some((opt) => opt.value === p)) {
          setPeriodType(p as PeriodType);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const [selectedCustomMonth, setSelectedCustomMonth] = useState<number | ''>('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    runMonthClosingCheck();
    const handleFocus = () => {
      runMonthClosingCheck();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const selectedRange = useMemo(() => {
    return calculateSelectedRange(periodType, selectedCustomMonth, currentDate);
  }, [periodType, selectedCustomMonth, currentDate]);

  // Live queries for READ-ONLY display – called unconditionally at top level
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

  // Classification summaries - MUST be declared unconditionally before any early return
  const classificationSummaries = useMemo(() => {
    const res = { necessary: 0, voluntary: 0, toEvaluate: 0 };
    if (!rawExpenses) return res;
    for (const e of rawExpenses) {
      if (isCancelledStatus(e.status)) continue;
      if (e.classification === 'necessary') res.necessary += e.amount;
      else if (e.classification === 'voluntary') res.voluntary += e.amount;
      else if (e.classification === 'toEvaluate') res.toEvaluate += e.amount;
    }
    return res;
  }, [rawExpenses]);

  const handlePrintOrPDF = () => {
    window.print();
  };

  // Home Address & Formatting
  const formattedAddress = formatHomeAddress(settings?.homeAddress);
  const now = new Date();
  const generationDateStr = `${now.getDate()} ${getMonthName(now.getMonth() + 1).toLowerCase()} ${now.getFullYear()}, ore ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const reportStatus: 'provisional' | 'final' = savedReport?.status === 'final' ? 'final' : 'provisional';

  const closingInfo = useMemo(() => {
    if (!selectedRange) {
      return { mainText: 'Il mese viene chiuso automaticamente alla sua scadenza.', subText: '' };
    }
    return getClosingInfoText(selectedRange.endYear, selectedRange.endMonth, selectedRange.isSingleMonth, reportStatus);
  }, [selectedRange, reportStatus]);

  const isChoosePeriodWithoutMonth = periodType === 'choose_period' && !selectedCustomMonth;

  // Render top bar header controls shared across all views
  // Order required by P-34: 1. Periodo, 2. Mese da analizzare, 3. Anteprima Report, 4. Stampa / PDF, 5. Chiudi Mese (disabled)
  const renderHeaderActions = () => (
    <div className="flex flex-wrap items-center gap-3">
      {/* 1. Periodo del report */}
      <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5">
        <Calendar className="w-4 h-4 text-slate-400" />
        <select
          value={periodType}
          aria-label="Periodo del report"
          onChange={(e) => {
            const newType = e.target.value as PeriodType;
            setPeriodType(newType);
            setSelectedCustomMonth('');
          }}
          className="text-xs font-semibold text-slate-700 dark:text-slate-200 bg-transparent focus:outline-none cursor-pointer"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Mese da analizzare */}
      {periodType === 'choose_period' && (
        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 animate-fadeIn" aria-live="polite">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Mese:</span>
          <select
            value={selectedCustomMonth}
            aria-label="Mese da analizzare"
            onChange={(e) => setSelectedCustomMonth(e.target.value ? Number(e.target.value) : '')}
            className="text-xs font-semibold text-slate-700 dark:text-slate-200 bg-transparent focus:outline-none cursor-pointer"
          >
            <option value="" disabled hidden>
              Seleziona un mese
            </option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {getMonthName(m)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 3. Anteprima Report Button */}
      <Button
        ref={previewButtonRef}
        variant="outline"
        size="sm"
        icon={<Eye className="w-4 h-4" />}
        disabled={isChoosePeriodWithoutMonth || !summary}
        onClick={() => setIsPreviewOpen(true)}
        aria-label="Apri anteprima del report"
        title={
          isChoosePeriodWithoutMonth
            ? "Seleziona un mese prima di aprire l'anteprima."
            : 'Apri anteprima del report'
        }
      >
        Anteprima Report
      </Button>

      {/* 4. Stampa / PDF Button */}
      <Button
        variant="primary"
        size="sm"
        icon={<Printer className="w-4 h-4" />}
        disabled={isChoosePeriodWithoutMonth}
        onClick={handlePrintOrPDF}
        aria-label="Stampa il report visualizzato"
        title="Stampa / PDF"
      >
        Stampa / PDF
      </Button>

      {/* 5. Chiudi Mese Button – ALWAYS VISIBLE, ALWAYS TRULY DISABLED (no click handlers) according to P-33R */}
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-700 opacity-80"
        title="La chiusura del mese avviene esclusivamente in modo automatico alla sua scadenza."
      >
        <CheckCircle2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        <span>Chiudi Mese</span>
      </button>
    </div>
  );

  // If choose_period is selected without a month, show prompt view
  if (isChoosePeriodWithoutMonth) {
    return (
      <div className="report-page-container space-y-6 max-w-7xl mx-auto pb-12">
        <div className="no-print space-y-3">
          <PageHeader
            icon={<PieChart className="w-6 h-6 text-indigo-600" />}
            title="Report Economico"
            subtitle="Seleziona il mese per generare il report."
            actions={renderHeaderActions()}
          />
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-indigo-500 shrink-0" />
              <div>
                <span className="font-bold">{closingInfo.mainText}</span>
                {closingInfo.subText && (
                  <span className="block sm:inline sm:ml-2 text-slate-500 dark:text-slate-400 font-medium">
                    {closingInfo.subText}
                  </span>
                )}
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-200/60 dark:bg-slate-700/60 px-2.5 py-1 rounded-lg shrink-0 w-fit">
              Chiusura automatica
            </span>
          </div>
        </div>

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
                Report Economico
              </h2>
            </div>
            {formattedAddress && (
              <div className="text-left md:text-right space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <p className="flex items-center md:justify-end gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                  <HomeIcon className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Abitazione: {formattedAddress}</span>
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="p-12 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          Seleziona il mese per generare il report.
        </div>
      </div>
    );
  }

  if (!summary || !selectedRange) {
    return (
      <div className="report-page-container space-y-6 max-w-7xl mx-auto pb-12">
        <div className="no-print">
          <PageHeader
            icon={<PieChart className="w-6 h-6 text-indigo-600" />}
            title="Report Economico"
            subtitle={getPeriodSubtitle(periodType, selectedCustomMonth, selectedRange, currentDate)}
            actions={renderHeaderActions()}
          />
        </div>
        <div className="p-12 text-center text-slate-500 font-medium bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          Generazione report economico in corso...
        </div>
      </div>
    );
  }

  // Filter valid entries (excluding cancelled)
  const incomes = (rawIncomes || [])
    .filter((i) => !isCancelledStatus(i.status))
    .sort((a, b) => (b.incomeDate || '').localeCompare(a.incomeDate || ''));

  const expenses = (rawExpenses || [])
    .filter((e) => !isCancelledStatus(e.status))
    .sort((a, b) => (b.expenseDate || '').localeCompare(a.expenseDate || ''));

  // Lookups
  const contributorMap = new Map((contributors || []).map((c) => [c.id, c]));
  const categoryMap = new Map((categories || []).map((cat) => [cat.id, cat.name]));
  const supplierMap = new Map((suppliers || []).map((s) => [s.id, s.name]));

  // Calculated totals
  const upcomingPaymentsList = getUpcomingPayments(expenses);
  const upcomingPaymentsSum = upcomingPaymentsList.reduce((sum, e) => sum + e.amount, 0);

  // Zero check flags
  const isAllZeroPeriod = summary.totalIncome === 0 && summary.totalExpenses === 0 && summary.savings === 0;

  const hasExtraBudgetData =
    summary.openingExtraBudget > 0 ||
    summary.extraBudgetUsed > 0 ||
    summary.closingExtraBudget > 0;

  const activeSavingsTotal = (savingPlans || []).reduce((sum, s) => sum + (s.monthlyQuota || 0), 0);
  const activeProjectsTotal = (projects || []).reduce((sum, p) => sum + (p.monthlyQuota || 0), 0);
  const hasSavingsOrProjects = (savingPlans && savingPlans.length > 0) || (projects && projects.length > 0) || activeSavingsTotal > 0 || activeProjectsTotal > 0;

  const docTitle = getReportDocumentTitle(periodType, selectedRange, currentDate);
  const printPeriodText = getPrintPeriodStr(selectedRange);

  const documentProps = {
    summary,
    selectedRange,
    periodType,
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
  };

  return (
    <div className="report-page-container space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header Bar with Actions (Hidden in Print) */}
      <div className="no-print space-y-3">
        <PageHeader
          icon={<PieChart className="w-6 h-6 text-indigo-600" />}
          title="Report Economico"
          badge={
            selectedRange.isSingleMonth ? (
              <Badge variant={reportStatus === 'final' ? 'success' : 'warning'}>
                {reportStatus === 'final' ? 'Definitivo' : 'Provvisorio'}
              </Badge>
            ) : undefined
          }
          subtitle={getPeriodSubtitle(periodType, selectedCustomMonth, selectedRange, currentDate)}
          actions={renderHeaderActions()}
        />

        {/* Informative banner on automatic month closing */}
        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-indigo-500 shrink-0" />
            <div>
              <span className="font-bold">{closingInfo.mainText}</span>
              {closingInfo.subText && (
                <span className="block sm:inline sm:ml-2 text-slate-500 dark:text-slate-400 font-medium">
                  {closingInfo.subText}
                </span>
              )}
            </div>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-200/60 dark:bg-slate-700/60 px-2.5 py-1 rounded-lg shrink-0 w-fit">
            Chiusura automatica
          </span>
        </div>
      </div>

      {/* 2. Single Source of Truth: Economic Report Document */}
      <EconomicReportDocument {...documentProps} />

      {/* 3. Preview Modal */}
      <ReportPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        onPrint={handlePrintOrPDF}
        documentProps={documentProps}
        triggerButtonRef={previewButtonRef}
      />
    </div>
  );
};
