import { jsPDF } from 'jspdf';
import { budgetService } from './budgetService';
import { reportRepository, contributorRepository, expenseRepository, projectRepository, incomeRepository } from '../repositories';
import type { MonthlyReport } from '../types';

export const reportService = {
  generateMonthlyReport: async (year: number, month: number, isFinal = false): Promise<MonthlyReport> => {
    const summary = await budgetService.calculateMonthlySummary(year, month);
    const contributors = await contributorRepository.getActive();
    const isCancelledStatus = (s?: string | null) => {
      if (!s) return false;
      const lower = s.toLowerCase();
      return lower === 'cancelled' || lower === 'canceled' || lower === 'annullata' || lower === 'annullato' || lower === 'deleted' || lower === 'inactive';
    };
    const rawIncomes = await incomeRepository.getByMonthYear(year, month);
    const incomes = rawIncomes.filter((i) => !isCancelledStatus(i.status));
    const rawExpenses = await expenseRepository.getByMonthYear(year, month);
    const expenses = rawExpenses.filter((e) => !isCancelledStatus(e.status));
    const projects = await projectRepository.getActive();

    const receivedIncomes = incomes.filter((i) => i.status === 'received');
    const contributorSummaries = contributors.map((c) => {
      const amount = receivedIncomes
        .filter((inc) => inc.contributorId === c.id)
        .reduce((sum, inc) => sum + inc.amount, 0);
      const percentage = summary.totalReceivedIncome > 0
        ? Math.round((amount / summary.totalReceivedIncome) * 10000) / 100
        : 0;
      return {
        contributorId: c.id,
        amount,
        percentage,
      };
    });

    const classificationSummaries = {
      necessary: expenses.filter((e) => e.classification === 'necessary').reduce((s, e) => s + e.amount, 0),
      voluntary: expenses.filter((e) => e.classification === 'voluntary').reduce((s, e) => s + e.amount, 0),
      toEvaluate: expenses.filter((e) => e.classification === 'toEvaluate').reduce((s, e) => s + e.amount, 0),
    };

    const projectSummaries = projects.map((p) => ({
      projectId: p.id,
      targetAmount: p.targetAmount,
      savedAmount: p.savedAmount,
      monthlyQuota: p.monthlyQuota,
      progressPercentage: p.progressPercentage,
      status: p.status,
    }));

    const report = await reportRepository.save({
      month,
      year,
      status: isFinal ? 'final' : 'provisional',
      totalIncome: summary.totalIncome,
      paidExpenses: summary.paidExpenses,
      plannedNotifiedExpenses: summary.notifiedPlannedExpenses,
      savingPlanTotal: summary.savingPlanTotal,
      projectQuotaTotal: summary.projectQuotaTotal,
      prudentialBalance: summary.prudentialBalance,
      extraBudgetOpening: summary.openingExtraBudget,
      extraBudgetUsed: summary.extraBudgetUsed,
      extraBudgetClosing: summary.closingExtraBudget,
      uncoveredDeficit: summary.uncoveredDeficit,
      contributorSummaries,
      categorySummaries: [],
      classificationSummaries,
      projectSummaries,
      generatedAt: new Date().toISOString(),
      closedAt: isFinal ? new Date().toISOString() : null,
    });

    return report;
  },

  exportToPDF: async (report: MonthlyReport): Promise<void> => {
    const doc = new jsPDF();
    const monthNames = [
      'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
      'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
    ];
    const monthName = monthNames[report.month - 1] || `${report.month}`;

    doc.setFontSize(20);
    doc.text('GESTIONE CASA', 20, 20);

    doc.setFontSize(14);
    doc.text(`Report Mensile Economico - ${monthName} ${report.year}`, 20, 32);
    doc.text(`Stato: ${report.status === 'final' ? 'Definitivo' : 'Provvisorio'}`, 20, 40);

    doc.setFontSize(12);
    let y = 55;
    doc.text(`Totale Entrate: € ${report.totalIncome.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Spese Pagate: € ${report.paidExpenses.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Spese Pianificate Notificate: € ${report.plannedNotifiedExpenses.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Quote Risparmi: € ${report.savingPlanTotal.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Quote Progetti: € ${report.projectQuotaTotal.toFixed(2)}`, 20, y); y += 12;

    doc.setFontSize(14);
    doc.text(`Bilancio Prudenziale: € ${report.prudentialBalance.toFixed(2)}`, 20, y); y += 12;

    doc.setFontSize(12);
    doc.text(`Extra Budget Iniziale: € ${report.extraBudgetOpening.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Extra Budget Utilizzato: € ${report.extraBudgetUsed.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Extra Budget Finale: € ${report.extraBudgetClosing.toFixed(2)}`, 20, y); y += 8;
    if (report.uncoveredDeficit > 0) {
      doc.text(`Deficit Non Coperto: € ${report.uncoveredDeficit.toFixed(2)}`, 20, y); y += 8;
    }

    y += 10;
    doc.text('Classificazione Spese:', 20, y); y += 8;
    doc.text(`- Necessarie: € ${report.classificationSummaries.necessary.toFixed(2)}`, 25, y); y += 6;
    doc.text(`- Volontarie: € ${report.classificationSummaries.voluntary.toFixed(2)}`, 25, y); y += 6;
    doc.text(`- Da Valutare: € ${report.classificationSummaries.toEvaluate.toFixed(2)}`, 25, y);

    doc.save(`GestioneCasa_Report_${report.year}_${String(report.month).padStart(2, '0')}.pdf`);
  },
};
