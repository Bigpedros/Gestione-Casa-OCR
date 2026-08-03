import { getMonthName } from './formatters';

export const validateDurationMonths = (
  durationVal: number | '' | null | undefined
): string | null => {
  if (durationVal === '' || durationVal === null || durationVal === undefined) {
    return 'Indica la durata della spesa ricorrente.';
  }

  const num = Number(durationVal);
  if (isNaN(num)) {
    return 'Indica la durata della spesa ricorrente.';
  }

  if (!Number.isInteger(num)) {
    return 'La durata deve essere espressa con un numero intero di mesi.';
  }

  if (num <= 0) {
    return 'La durata deve essere maggiore di 0 mesi.';
  }

  return null;
};

export const calculateEndMonthYear = (
  startMonth: number,
  startYear: number,
  durationMonths: number
): { endMonth: number; endYear: number } => {
  const startTotal = startYear * 12 + (startMonth - 1);
  const endTotal = startTotal + durationMonths - 1;
  const endYear = Math.floor(endTotal / 12);
  const endMonth = (endTotal % 12) + 1;
  return { endMonth, endYear };
};

export const formatRecurringSummary = (
  startMonth: number,
  startYear: number,
  durationMonths: number
): string => {
  const { endMonth, endYear } = calculateEndMonthYear(startMonth, startYear, durationMonths);
  const monthLabel = durationMonths === 1 ? 'mese' : 'mesi';
  return `Questa spesa verrà conteggiata per ${durationMonths} ${monthLabel}, da ${getMonthName(startMonth)} ${startYear} a ${getMonthName(endMonth)} ${endYear}.`;
};
