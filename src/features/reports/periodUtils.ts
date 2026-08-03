import { getMonthName } from '../../utils/formatters';

export type PeriodType =
  | 'current_month'
  | 'last_two_months'
  | 'last_three_months'
  | 'last_four_months'
  | 'last_six_months'
  | 'current_year'
  | 'choose_period';

export const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'current_month', label: 'Mese corrente' },
  { value: 'last_two_months', label: 'Ultimo bimestre' },
  { value: 'last_three_months', label: 'Ultimo trimestre' },
  { value: 'last_four_months', label: 'Ultimo quadrimestre' },
  { value: 'last_six_months', label: 'Ultimo semestre' },
  { value: 'current_year', label: 'Annuale' },
  { value: 'choose_period', label: 'Scegli periodo' },
];

export interface SelectedPeriodRange {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  isSingleMonth: boolean;
}

export function getPreviousYearMonth(year: number, month: number, monthsBack: number) {
  const ym = year * 12 + (month - 1) - monthsBack;
  const y = Math.floor(ym / 12);
  const m = (ym % 12) + 1;
  return { year: y, month: m };
}

export function calculateSelectedRange(
  periodType: PeriodType,
  selectedCustomMonth: number | '',
  currentDate: { year: number; month: number }
): SelectedPeriodRange | null {
  const nowYear = currentDate.year;
  const nowMonth = currentDate.month;

  switch (periodType) {
    case 'current_month':
      return {
        startYear: nowYear,
        startMonth: nowMonth,
        endYear: nowYear,
        endMonth: nowMonth,
        isSingleMonth: true,
      };

    case 'last_two_months': {
      const start = getPreviousYearMonth(nowYear, nowMonth, 1);
      return {
        startYear: start.year,
        startMonth: start.month,
        endYear: nowYear,
        endMonth: nowMonth,
        isSingleMonth: false,
      };
    }

    case 'last_three_months': {
      const start = getPreviousYearMonth(nowYear, nowMonth, 2);
      return {
        startYear: start.year,
        startMonth: start.month,
        endYear: nowYear,
        endMonth: nowMonth,
        isSingleMonth: false,
      };
    }

    case 'last_four_months': {
      const start = getPreviousYearMonth(nowYear, nowMonth, 3);
      return {
        startYear: start.year,
        startMonth: start.month,
        endYear: nowYear,
        endMonth: nowMonth,
        isSingleMonth: false,
      };
    }

    case 'last_six_months': {
      const start = getPreviousYearMonth(nowYear, nowMonth, 5);
      return {
        startYear: start.year,
        startMonth: start.month,
        endYear: nowYear,
        endMonth: nowMonth,
        isSingleMonth: false,
      };
    }

    case 'current_year':
      return {
        startYear: nowYear,
        startMonth: 1,
        endYear: nowYear,
        endMonth: 12,
        isSingleMonth: false,
      };

    case 'choose_period':
      if (typeof selectedCustomMonth === 'number' && selectedCustomMonth >= 1 && selectedCustomMonth <= 12) {
        return {
          startYear: nowYear,
          startMonth: selectedCustomMonth,
          endYear: nowYear,
          endMonth: selectedCustomMonth,
          isSingleMonth: true,
        };
      }
      return null;

    default:
      return {
        startYear: nowYear,
        startMonth: nowMonth,
        endYear: nowYear,
        endMonth: nowMonth,
        isSingleMonth: true,
      };
  }
}

export function getPeriodSubtitle(
  periodType: PeriodType,
  _selectedCustomMonth: number | '',
  range: SelectedPeriodRange | null,
  _currentDate: { year: number; month: number }
): string {
  if (periodType === 'choose_period' && !range) {
    return 'Seleziona il mese per generare il report.';
  }

  if (!range) return '';

  const { startYear, startMonth, endYear, endMonth } = range;

  if (periodType === 'current_month' || periodType === 'choose_period') {
    return `Analisi economica relativa a ${getMonthName(endMonth).toLowerCase()} ${endYear}.`;
  }

  if (periodType === 'current_year') {
    return `Analisi economica dell’anno ${endYear}.`;
  }

  const lastDay = new Date(endYear, endMonth, 0).getDate();
  const startMonthName = getMonthName(startMonth).toLowerCase();
  const endMonthName = getMonthName(endMonth).toLowerCase();

  if (startYear === endYear) {
    return `Analisi economica dal 1° ${startMonthName} al ${lastDay} ${endMonthName} ${endYear}.`;
  }

  return `Analisi economica dal 1° ${startMonthName} ${startYear} al ${lastDay} ${endMonthName} ${endYear}.`;
}

export function getReportDocumentTitle(
  periodType: PeriodType,
  range: SelectedPeriodRange | null,
  _currentDate: { year: number; month: number }
): string {
  if (!range) return 'Report Economico';

  const { startYear, startMonth, endYear, endMonth } = range;

  if (periodType === 'current_year') {
    return `Report Economico Annuale – ${endYear}`;
  }

  if (range.isSingleMonth) {
    return `Report Economico – ${getMonthName(endMonth)} ${endYear}`;
  }

  const startM = getMonthName(startMonth);
  const endM = getMonthName(endMonth);

  if (startYear === endYear) {
    return `Report Economico – ${startM}–${endM} ${endYear}`;
  }

  return `Report Economico – ${startM} ${startYear}–${endM} ${endYear}`;
}

export function getPrintPeriodStr(range: SelectedPeriodRange | null): string {
  if (!range) return '';
  const { startYear, startMonth, endYear, endMonth } = range;
  const lastDay = new Date(endYear, endMonth, 0).getDate();

  const sm = String(startMonth).padStart(2, '0');
  const em = String(endMonth).padStart(2, '0');
  const ld = String(lastDay).padStart(2, '0');

  return `Periodo analizzato: 01/${sm}/${startYear} – ${ld}/${em}/${endYear}`;
}
