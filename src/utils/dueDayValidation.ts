import { getMonthName } from './formatters';

export const validateDueDay = (
  dayVal: number | '' | null | undefined,
  month: number,
  year: number
): string | null => {
  if (dayVal === '' || dayVal === null || dayVal === undefined) {
    return 'Indica il giorno di scadenza.';
  }

  const numDay = Number(dayVal);
  if (isNaN(numDay)) {
    return 'Indica il giorno di scadenza.';
  }

  if (!Number.isInteger(numDay)) {
    return 'Il giorno di scadenza deve essere un numero intero.';
  }

  if (numDay <= 0) {
    return 'Il giorno di scadenza deve essere maggiore di 0.';
  }

  const maxDays = new Date(year, month, 0).getDate();
  if (numDay > maxDays) {
    const monthStr = month === 2 ? `${getMonthName(month)} ${year}` : getMonthName(month);
    return `${monthStr} contiene ${maxDays} giorni. Inserisci un valore compreso tra 1 e ${maxDays}.`;
  }

  return null;
};
