import type { Expense, HomeAddress } from '../../types';

export function isCancelledStatus(s?: string | null): boolean {
  if (!s) return false;
  const lower = s.toLowerCase();
  return (
    lower === 'cancelled' ||
    lower === 'canceled' ||
    lower === 'annullata' ||
    lower === 'annullato' ||
    lower === 'deleted' ||
    lower === 'inactive'
  );
}

export function formatHomeAddress(homeAddress?: HomeAddress | null): string | null {
  if (!homeAddress) return null;
  const { address, streetNumber, postalCode } = homeAddress;
  const streetPart = [address, streetNumber]
    .filter(Boolean)
    .map((s) => (s || '').trim())
    .join(' ');
  const parts = [streetPart, postalCode]
    .filter(Boolean)
    .map((s) => (s || '').trim());
  if (parts.length === 0) return null;
  return parts.join(' – ');
}

export interface ExpenseStatusInfo {
  label: string;
  badgeVariant: 'success' | 'danger' | 'warning' | 'info' | 'neutral';
  dueAlert: 'overdue' | 'within24h' | 'within48h' | 'normal';
  daysDiff: number | null;
}

export function getExpenseStatusInfo(expense: Expense, now: Date = new Date()): ExpenseStatusInfo {
  if (expense.status === 'paid') {
    return { label: 'Pagata', badgeVariant: 'success', dueAlert: 'normal', daysDiff: null };
  }
  if (isCancelledStatus(expense.status)) {
    return { label: 'Annullata', badgeVariant: 'neutral', dueAlert: 'normal', daysDiff: null };
  }

  const todayStr = now.toISOString().substring(0, 10);
  const expDateStr = expense.expenseDate || '';

  if (expDateStr) {
    if (expDateStr < todayStr) {
      return { label: 'Scaduta', badgeVariant: 'danger', dueAlert: 'overdue', daysDiff: -1 };
    }

    const todayDate = new Date(todayStr);
    const expDate = new Date(expDateStr);
    const diffMs = expDate.getTime() - todayDate.getTime();
    const daysDiff = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysDiff === 0 || daysDiff === 1) {
      return { label: 'In scadenza', badgeVariant: 'warning', dueAlert: 'within24h', daysDiff };
    }
    if (daysDiff === 2) {
      return { label: 'In scadenza', badgeVariant: 'warning', dueAlert: 'within48h', daysDiff };
    }
    if (daysDiff > 2 && daysDiff <= 30) {
      return { label: 'In scadenza', badgeVariant: 'warning', dueAlert: 'normal', daysDiff };
    }
  }

  if (expense.status === 'planned') {
    return { label: 'Pianificata', badgeVariant: 'info', dueAlert: 'normal', daysDiff: null };
  }

  return { label: 'Da pagare', badgeVariant: 'warning', dueAlert: 'normal', daysDiff: null };
}

export function getUpcomingPayments(expenses: Expense[]): Expense[] {
  const valid = expenses.filter((e) => !isCancelledStatus(e.status) && e.status !== 'paid');
  return [...valid].sort((a, b) => (a.expenseDate || '').localeCompare(b.expenseDate || ''));
}

export interface IncomeStatusInfo {
  label: string;
  badgeVariant: 'success' | 'danger' | 'warning' | 'info' | 'neutral';
}

export function getIncomeStatusInfo(status?: string | null): IncomeStatusInfo {
  if (status === 'received') {
    return { label: 'Incassata', badgeVariant: 'success' };
  }
  if (isCancelledStatus(status)) {
    return { label: 'Annullata', badgeVariant: 'neutral' };
  }
  if (status === 'skipped') {
    return { label: 'Saltata', badgeVariant: 'warning' };
  }
  return { label: 'Pianificata', badgeVariant: 'info' };
}
