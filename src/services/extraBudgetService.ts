import { extraBudgetRepository } from '../repositories';
import { budgetService } from './budgetService';

export const extraBudgetService = {
  processMonthEndExtraBudget: async (year: number, month: number) => {
    const summary = await budgetService.calculateMonthlySummary(year, month);
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    if (summary.surplus > 0) {
      await extraBudgetRepository.addMovement({
        movementDate: new Date().toISOString().substring(0, 10),
        month,
        year,
        type: 'monthlySurplusDeposit',
        amount: summary.surplus,
        notes: `Surplus mensile accantonato per ${monthStr}`,
      });
    } else if (summary.deficit > 0 && summary.extraBudgetUsed > 0) {
      await extraBudgetRepository.addMovement({
        movementDate: new Date().toISOString().substring(0, 10),
        month,
        year,
        type: 'deficitCoverage',
        amount: summary.extraBudgetUsed,
        notes: `Copertura deficit mensile per ${monthStr}`,
      });
    }

    return extraBudgetRepository.getCurrentBalance();
  },

  validateExtraBudgetUsageForProject: (_projectId: string, _amount: number): boolean => {
    // REGOLA DI BUSINESS VINCOLANTE #4: L'Extra Budget non finanzia mai progetti.
    return false;
  },

  validateExtraBudgetUsageForVoluntaryExpense: (_expenseId: string, _amount: number): boolean => {
    // REGOLA DI BUSINESS VINCOLANTE #4: L'Extra Budget non finanzia mai spese volontarie.
    return false;
  },
};
