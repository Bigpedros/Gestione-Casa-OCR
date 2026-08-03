import { db } from '../database/db';
import {
  incomeRepository,
  expenseRepository,
  savingPlanRepository,
  projectRepository,
  extraBudgetRepository,
  categoryRepository,
} from '../repositories';
import { calculateEndMonthYear } from '../utils/recurringExpenseUtils';

export interface CategorySummary {
  categoryId: string;
  categoryName: string;
  amount: number;
  percentage: number;
}

export interface MonthTrendSummary {
  year: number;
  month: number;
  monthLabel: string;
  amount: number;
  incomeAmount?: number;
  savingsAmount?: number;
}

export interface MonthlyBudgetSummary {
  year: number;
  month: number;
  totalIncome: number;
  totalReceivedIncome: number;
  totalExpenses: number;
  paidExpenses: number;
  savings: number;
  notifiedPlannedExpenses: number;
  savingPlanTotal: number;
  projectQuotaTotal: number;
  prudentialBalance: number;
  surplus: number;
  deficit: number;
  openingExtraBudget: number;
  extraBudgetUsed: number;
  uncoveredDeficit: number;
  closingExtraBudget: number;
  expensesByCategory: CategorySummary[];
  expensesTrend: MonthTrendSummary[];
}

export interface PeriodBudgetSummary extends MonthlyBudgetSummary {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  isSingleMonth: boolean;
  totalMonths: number;
}

const getFrequencyMonths = (freq: string): number => {
  switch (freq) {
    case 'monthly':
      return 1;
    case 'bimonthly':
      return 2;
    case 'quarterly':
      return 3;
    case 'fourMonthly':
      return 4;
    case 'semiannual':
      return 6;
    case 'annual':
      return 12;
    default:
      return 1;
  }
};

export const budgetService = {
  ensureRecurringExpenseMovements: async (fixedExpenseId: string): Promise<void> => {
    const fe = await db.fixedExpenses.get(fixedExpenseId);
    if (!fe || fe.status !== 'active') return;

    if (!fe.startMonth || !fe.startYear || !fe.durationMonths) {
      return;
    }

    const { endMonth, endYear } = calculateEndMonthYear(
      fe.startMonth,
      fe.startYear,
      fe.durationMonths
    );

    const startYM = fe.startYear * 12 + fe.startMonth;
    const endYM = endYear * 12 + endMonth;

    // Genera o aggiorna i movimenti per ciascun mese compreso tra inizio e fine
    for (let ym = startYM; ym <= endYM; ym++) {
      const year = Math.floor((ym - 1) / 12);
      const month = ((ym - 1) % 12) + 1;

      const daysInTargetMonth = new Date(year, month, 0).getDate();
      const dueDay = Math.min(fe.dueDay || 1, daysInTargetMonth);
      const dueDateStr = `${year}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;

      const existing = await db.expenses
        .where('[competenceYear+competenceMonth]')
        .equals([year, month])
        .toArray();

      const existingForFe = existing.find((e) => e.fixedExpenseId === fe.id);

      if (!existingForFe) {
        await expenseRepository.create({
          entryMode: 'fixedExpense',
          fixedExpenseId: fe.id,
          description: fe.name,
          amount: fe.expectedAmount,
          expenseDate: dueDateStr,
          competenceYear: year,
          competenceMonth: month,
          categoryId: fe.categoryId,
          subcategoryId: fe.subcategoryId,
          paymentMethod: fe.paymentMethod || 'directDebit',
          status: 'planned',
          classification: 'necessary',
          notified: false,
          recurring: true,
          frequency: fe.frequency,
          priority: fe.priority,
        });
      } else if (existingForFe.status === 'planned') {
        if (
          existingForFe.amount !== fe.expectedAmount ||
          existingForFe.description !== fe.name ||
          existingForFe.categoryId !== fe.categoryId ||
          existingForFe.subcategoryId !== fe.subcategoryId ||
          existingForFe.expenseDate !== dueDateStr
        ) {
          await expenseRepository.update(existingForFe.id, {
            amount: fe.expectedAmount,
            description: fe.name,
            categoryId: fe.categoryId,
            subcategoryId: fe.subcategoryId,
            expenseDate: dueDateStr,
          });
        }
      }
    }

    // Rimuove soltanto i movimenti futuri non ancora pagati che superano il nuovo mese finale
    const allFeExpenses = await db.expenses.where('fixedExpenseId').equals(fe.id).toArray();
    for (const exp of allFeExpenses) {
      const expYM = exp.competenceYear * 12 + exp.competenceMonth;
      if ((expYM < startYM || expYM > endYM) && exp.status === 'planned') {
        await expenseRepository.delete(exp.id);
      }
    }
  },

  deleteFixedExpenseAndFutureMovements: async (fixedExpenseId: string): Promise<void> => {
    const allFeExpenses = await db.expenses.where('fixedExpenseId').equals(fixedExpenseId).toArray();
    for (const exp of allFeExpenses) {
      if (exp.status === 'planned') {
        await expenseRepository.delete(exp.id);
      }
    }
    await db.fixedExpenses.delete(fixedExpenseId);
  },

  ensureMonthlyExpenseMovements: async (year: number, month: number): Promise<void> => {
    await budgetService.syncFixedExpensesForMonth(year, month);
    for (let i = 1; i <= 4; i++) {
      let tMonth = month - i;
      let tYear = year;
      while (tMonth <= 0) {
        tMonth += 12;
        tYear -= 1;
      }
      await budgetService.syncFixedExpensesForMonth(tYear, tMonth);
    }
  },

  syncFixedExpensesForMonth: async (year: number, month: number): Promise<void> => {
    const activeFixedExpenses = await db.fixedExpenses.where('status').equals('active').toArray();
    if (activeFixedExpenses.length === 0) return;

    const currentExpenses = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([year, month])
      .toArray();

    const selectedYM = year * 12 + month;

    for (const fe of activeFixedExpenses) {
      if (fe.startYear && fe.startMonth) {
        const startYM = fe.startYear * 12 + fe.startMonth;
        if (selectedYM < startYM) continue;
      } else if (fe.startDate) {
        const parts = fe.startDate.split('-');
        if (parts.length >= 2) {
          const startYM = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10);
          if (selectedYM < startYM) continue;
        }
      }

      if (fe.endYear && fe.endMonth) {
        const endYM = fe.endYear * 12 + fe.endMonth;
        if (selectedYM > endYM) continue;
      } else if (fe.endDate) {
        const parts = fe.endDate.split('-');
        if (parts.length >= 2) {
          const endYM = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10);
          if (selectedYM > endYM) continue;
        }
      }

      const freqMonths = getFrequencyMonths(fe.frequency);
      if (fe.startDate) {
        const parts = fe.startDate.split('-');
        const startYM = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10);
        if ((selectedYM - startYM) % freqMonths !== 0) continue;
      } else {
        if ((month - 1) % freqMonths !== 0) continue;
      }

      const existing = currentExpenses.find((e) => e.fixedExpenseId === fe.id);

      const daysInTargetMonth = new Date(year, month, 0).getDate();
      const dueDay = Math.min(fe.dueDay || 1, daysInTargetMonth);
      const dueDateStr = `${year}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;

      if (!existing) {
        await expenseRepository.create({
          entryMode: 'fixedExpense',
          fixedExpenseId: fe.id,
          description: fe.name,
          amount: fe.expectedAmount,
          expenseDate: dueDateStr,
          competenceYear: year,
          competenceMonth: month,
          categoryId: fe.categoryId,
          subcategoryId: fe.subcategoryId,
          paymentMethod: fe.paymentMethod || 'directDebit',
          status: 'planned',
          classification: 'necessary',
          notified: false,
          recurring: true,
          frequency: fe.frequency,
          priority: fe.priority,
        });
      } else {
        if (
          existing.status === 'planned' &&
          (existing.amount !== fe.expectedAmount || existing.description !== fe.name)
        ) {
          await expenseRepository.update(existing.id, {
            amount: fe.expectedAmount,
            description: fe.name,
            categoryId: fe.categoryId,
            subcategoryId: fe.subcategoryId,
          });
        }
      }
    }
  },

  calculatePeriodSummary: async (
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number
  ): Promise<PeriodBudgetSummary> => {
    const isCancelledStatus = (s?: string | null) => {
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
    };

    const startYM = startYear * 12 + startMonth;
    const endYM = endYear * 12 + endMonth;
    const isSingleMonth = startYear === endYear && startMonth === endMonth;

    const monthsInRange: { year: number; month: number }[] = [];
    for (let ym = startYM; ym <= endYM; ym++) {
      const y = Math.floor((ym - 1) / 12);
      const m = ((ym - 1) % 12) + 1;
      monthsInRange.push({ year: y, month: m });
    }
    const totalMonths = monthsInRange.length;

    const incomes = await incomeRepository.getByRange(startYear, startMonth, endYear, endMonth);
    const validIncomes = incomes.filter((i) => !isCancelledStatus(i.status));
    const totalIncome = validIncomes.reduce((sum, i) => sum + Number(i.amount || 0), 0);
    const totalReceivedIncome = validIncomes
      .filter((i) => i.status === 'received')
      .reduce((sum, i) => sum + Number(i.amount || 0), 0);

    const allExpenses = await expenseRepository.getByRange(startYear, startMonth, endYear, endMonth);
    const validExpenses = allExpenses.filter((e) => !isCancelledStatus(e.status));

    const totalExpenses = validExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const paidExpenses = validExpenses
      .filter((e) => e.status === 'paid')
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const savings = Math.round((totalIncome - totalExpenses) * 100) / 100;

    const notifiedPlannedExpenses = validExpenses
      .filter((e) => e.status === 'planned' && e.notified)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const activeSavings = await savingPlanRepository.getActive();
    const savingPlanTotal = activeSavings.reduce((sum, s) => sum + Number(s.monthlyQuota || 0), 0) * totalMonths;

    const activeProjects = await projectRepository.getActive();
    const projectQuotaTotal = activeProjects.reduce((sum, p) => sum + Number(p.monthlyQuota || 0), 0) * totalMonths;

    const prudentialBalance = Math.round(
      (totalReceivedIncome - paidExpenses - notifiedPlannedExpenses - savingPlanTotal - projectQuotaTotal) * 100,
    ) / 100;

    const surplus = Math.max(0, prudentialBalance);
    const deficit = Math.max(0, -prudentialBalance);

    const openingExtraBudget = await extraBudgetRepository.getCurrentBalance();
    const extraBudgetUsed = deficit > 0 ? Math.min(openingExtraBudget, deficit) : 0;
    const uncoveredDeficit = deficit > 0 ? Math.max(0, deficit - extraBudgetUsed) : 0;
    const closingExtraBudget = Math.round((openingExtraBudget + surplus - extraBudgetUsed) * 100) / 100;

    const categories = await categoryRepository.getAll();
    const categoryMap = new Map<string, { id: string; name: string; amount: number }>();

    for (const exp of validExpenses) {
      let parentCat = categories.find((c) => c.id === exp.categoryId);
      if (parentCat?.parentId) {
        const top = categories.find((c) => c.id === parentCat!.parentId);
        if (top) parentCat = top;
      }
      const catId = parentCat ? parentCat.id : exp.categoryId || 'other';
      const catName = parentCat ? parentCat.name : 'Altro';

      const current = categoryMap.get(catId) || { id: catId, name: catName, amount: 0 };
      current.amount += Number(exp.amount || 0);
      categoryMap.set(catId, current);
    }

    const expensesByCategory: CategorySummary[] = Array.from(categoryMap.values())
      .map((cat) => ({
        categoryId: cat.id,
        categoryName: cat.name,
        amount: Math.round(cat.amount * 100) / 100,
        percentage: totalExpenses > 0 ? Math.round((cat.amount / totalExpenses) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const monthNamesShort = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const expensesTrend: MonthTrendSummary[] = [];

    if (isSingleMonth) {
      for (let i = 4; i >= 0; i--) {
        let tMonth = endMonth - i;
        let tYear = endYear;
        while (tMonth <= 0) {
          tMonth += 12;
          tYear -= 1;
        }

        const mExpenses = await expenseRepository.getByMonthYear(tYear, tMonth);
        const mValid = mExpenses.filter((e) => !isCancelledStatus(e.status));
        const mTotal = mValid.reduce((sum, e) => sum + Number(e.amount || 0), 0);

        const mIncomes = await incomeRepository.getByMonthYear(tYear, tMonth);
        const mValidInc = mIncomes.filter((i) => !isCancelledStatus(i.status));
        const mIncTotal = mValidInc.reduce((sum, i) => sum + Number(i.amount || 0), 0);

        expensesTrend.push({
          year: tYear,
          month: tMonth,
          monthLabel: monthNamesShort[tMonth - 1] || `${tMonth}`,
          amount: Math.round(mTotal * 100) / 100,
          incomeAmount: Math.round(mIncTotal * 100) / 100,
          savingsAmount: Math.round((mIncTotal - mTotal) * 100) / 100,
        });
      }
    } else {
      for (const { year: y, month: m } of monthsInRange) {
        const mExpenses = await expenseRepository.getByMonthYear(y, m);
        const mValidExp = mExpenses.filter((e) => !isCancelledStatus(e.status));
        const mExpTotal = mValidExp.reduce((sum, e) => sum + Number(e.amount || 0), 0);

        const mIncomes = await incomeRepository.getByMonthYear(y, m);
        const mValidInc = mIncomes.filter((i) => !isCancelledStatus(i.status));
        const mIncTotal = mValidInc.reduce((sum, i) => sum + Number(i.amount || 0), 0);

        const mSavings = Math.round((mIncTotal - mExpTotal) * 100) / 100;

        const isMultiYear = startYear !== endYear;
        const monthLabel = isMultiYear
          ? `${monthNamesShort[m - 1]} '${String(y).slice(-2)}`
          : monthNamesShort[m - 1];

        expensesTrend.push({
          year: y,
          month: m,
          monthLabel,
          amount: Math.round(mExpTotal * 100) / 100,
          incomeAmount: Math.round(mIncTotal * 100) / 100,
          savingsAmount: mSavings,
        });
      }
    }

    return {
      year: endYear,
      month: endMonth,
      startYear,
      startMonth,
      endYear,
      endMonth,
      isSingleMonth,
      totalMonths,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalReceivedIncome: Math.round(totalReceivedIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      paidExpenses: Math.round(paidExpenses * 100) / 100,
      savings,
      notifiedPlannedExpenses: Math.round(notifiedPlannedExpenses * 100) / 100,
      savingPlanTotal: Math.round(savingPlanTotal * 100) / 100,
      projectQuotaTotal: Math.round(projectQuotaTotal * 100) / 100,
      prudentialBalance,
      surplus,
      deficit,
      openingExtraBudget,
      extraBudgetUsed: Math.round(extraBudgetUsed * 100) / 100,
      uncoveredDeficit: Math.round(uncoveredDeficit * 100) / 100,
      closingExtraBudget,
      expensesByCategory,
      expensesTrend,
    };
  },

  calculateMonthlySummary: async (year: number, month: number): Promise<MonthlyBudgetSummary> => {
    return budgetService.calculatePeriodSummary(year, month, year, month);
  },
};

