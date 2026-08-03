import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { db } from '../database/db';
import { budgetService } from '../services/budgetService';
import {
  contributorRepository,
  incomeRepository,
  expenseRepository,
} from '../repositories';
import {
  calculateSelectedRange,
  getPeriodSubtitle,
  getReportDocumentTitle,
  getPrintPeriodStr,
} from '../features/reports/periodUtils';
import { ReportsPage } from '../features/reports/ReportsPage';

describe('P-32 – Selettore del periodo nel Report Economico', () => {
  const currentDate = { year: 2026, month: 8 }; // Agosto 2026

  beforeEach(async () => {
    await db.incomeEntries.clear();
    await db.expenses.clear();
    await db.categories.clear();
    await db.contributors.clear();
    await db.monthlyReports.clear();
    await db.settings.clear();
    await db.savingPlans.clear();
    await db.projects.clear();

    const now = new Date().toISOString();
    await db.settings.put({
      id: 'default-settings',
      userMode: 'single',
      contributorsCount: 1,
      currency: 'EUR',
      language: 'it-IT',
      budgetMode: 'prudential',
      monthlyBudgetSource: 'manualContributorIncome',
      includePaidExpensesInBudget: true,
      includeNotifiedPlannedExpensesInBudget: true,
      includeSavingPlansInBudget: true,
      includeProjectQuotasInBudget: true,
      extraBudgetUsage: 'coverDeficitOnly',
      reportClosingMode: 'automaticEndOfMonth',
      reportClosingTime: '23:59',
      attachmentRetentionMonths: 12,
      theme: 'light',
      notificationsEnabled: true,
      notificationAdvanceDays: 3,
      homeAddress: { address: 'Via Roma', streetNumber: '10', postalCode: '20100' },
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    });
  });

  describe('Unità: periodUtils (Calcolo intervalli e titoli)', () => {
    it('TEST 1 – Mese corrente', () => {
      const range = calculateSelectedRange('current_month', '', currentDate);
      expect(range).toEqual({
        startYear: 2026,
        startMonth: 8,
        endYear: 2026,
        endMonth: 8,
        isSingleMonth: true,
      });
      expect(getReportDocumentTitle('current_month', range, currentDate)).toBe('Report Economico – Agosto 2026');
      expect(getPeriodSubtitle('current_month', '', range, currentDate)).toBe('Analisi economica relativa a agosto 2026.');
      expect(getPrintPeriodStr(range)).toBe('Periodo analizzato: 01/08/2026 – 31/08/2026');
    });

    it('TEST 2 – Ultimo bimestre (2 mesi: Luglio-Agosto 2026)', () => {
      const range = calculateSelectedRange('last_two_months', '', currentDate);
      expect(range).toEqual({
        startYear: 2026,
        startMonth: 7,
        endYear: 2026,
        endMonth: 8,
        isSingleMonth: false,
      });
      expect(getReportDocumentTitle('last_two_months', range, currentDate)).toContain('Luglio');
      expect(getReportDocumentTitle('last_two_months', range, currentDate)).toContain('Agosto 2026');
      expect(getPeriodSubtitle('last_two_months', '', range, currentDate)).toBe('Analisi economica dal 1° luglio al 31 agosto 2026.');
      expect(getPrintPeriodStr(range)).toBe('Periodo analizzato: 01/07/2026 – 31/08/2026');
    });

    it('TEST 3 – Ultimo trimestre (3 mesi: Giugno-Agosto 2026)', () => {
      const range = calculateSelectedRange('last_three_months', '', currentDate);
      expect(range).toEqual({
        startYear: 2026,
        startMonth: 6,
        endYear: 2026,
        endMonth: 8,
        isSingleMonth: false,
      });
      expect(getReportDocumentTitle('last_three_months', range, currentDate)).toContain('Giugno');
      expect(getReportDocumentTitle('last_three_months', range, currentDate)).toContain('Agosto 2026');
      expect(getPeriodSubtitle('last_three_months', '', range, currentDate)).toBe('Analisi economica dal 1° giugno al 31 agosto 2026.');
      expect(getPrintPeriodStr(range)).toBe('Periodo analizzato: 01/06/2026 – 31/08/2026');
    });

    it('TEST 4 – Ultimo quadrimestre (4 mesi: Maggio-Agosto 2026)', () => {
      const range = calculateSelectedRange('last_four_months', '', currentDate);
      expect(range).toEqual({
        startYear: 2026,
        startMonth: 5,
        endYear: 2026,
        endMonth: 8,
        isSingleMonth: false,
      });
      expect(getReportDocumentTitle('last_four_months', range, currentDate)).toContain('Maggio');
      expect(getReportDocumentTitle('last_four_months', range, currentDate)).toContain('Agosto 2026');
    });

    it('TEST 5 – Ultimo semestre (6 mesi: Marzo-Agosto 2026)', () => {
      const range = calculateSelectedRange('last_six_months', '', currentDate);
      expect(range).toEqual({
        startYear: 2026,
        startMonth: 3,
        endYear: 2026,
        endMonth: 8,
        isSingleMonth: false,
      });
      expect(getReportDocumentTitle('last_six_months', range, currentDate)).toContain('Marzo');
      expect(getReportDocumentTitle('last_six_months', range, currentDate)).toContain('Agosto 2026');
    });

    it('TEST 6 – Annuale (12 mesi: Gennaio-Dicembre 2026)', () => {
      const range = calculateSelectedRange('current_year', '', currentDate);
      expect(range).toEqual({
        startYear: 2026,
        startMonth: 1,
        endYear: 2026,
        endMonth: 12,
        isSingleMonth: false,
      });
      expect(getReportDocumentTitle('current_year', range, currentDate)).toBe('Report Economico Annuale – 2026');
      expect(getPeriodSubtitle('current_year', '', range, currentDate)).toBe('Analisi economica dell’anno 2026.');
      expect(getPrintPeriodStr(range)).toBe('Periodo analizzato: 01/01/2026 – 31/12/2026');
    });

    it('TEST 7 – Scegli periodo (senza mese)', () => {
      const range = calculateSelectedRange('choose_period', '', currentDate);
      expect(range).toBeNull();
      expect(getReportDocumentTitle('choose_period', range, currentDate)).toBe('Report Economico');
      expect(getPeriodSubtitle('choose_period', '', range, currentDate)).toBe('Seleziona il mese per generare il report.');
    });

    it('TEST 8 – Scegli periodo (con mese specifico, es. Marzo)', () => {
      const range = calculateSelectedRange('choose_period', 3, currentDate);
      expect(range).toEqual({
        startYear: 2026,
        startMonth: 3,
        endYear: 2026,
        endMonth: 3,
        isSingleMonth: true,
      });
      expect(getReportDocumentTitle('choose_period', range, currentDate)).toBe('Report Economico – Marzo 2026');
      expect(getPeriodSubtitle('choose_period', 3, range, currentDate)).toBe('Analisi economica relativa a marzo 2026.');
    });

    it('TEST 9 – Periodo a cavallo d’anno (es. data corrente Gennaio 2026, ultimo trimestre = Nov 2025 - Gen 2026)', () => {
      const jan2026 = { year: 2026, month: 1 };
      const range = calculateSelectedRange('last_three_months', '', jan2026);
      expect(range).toEqual({
        startYear: 2025,
        startMonth: 11,
        endYear: 2026,
        endMonth: 1,
        isSingleMonth: false,
      });
      expect(getReportDocumentTitle('last_three_months', range, jan2026)).toContain('Novembre 2025');
      expect(getReportDocumentTitle('last_three_months', range, jan2026)).toContain('Gennaio 2026');
      expect(getPeriodSubtitle('last_three_months', '', range, jan2026)).toBe('Analisi economica dal 1° novembre 2025 al 31 gennaio 2026.');
      expect(getPrintPeriodStr(range)).toBe('Periodo analizzato: 01/11/2025 – 31/01/2026');
    });
  });

  describe('Servizio: Calcoli su intervalli temporali', () => {
    it('TEST 10 – Nessun doppio conteggio nei periodi pluri-mensili', async () => {
      const contrib = await contributorRepository.create({
        order: 1,
        name: 'Fabiola',
        label: 'Stipendio',
        active: true,
      });

      // Income in June 2026
      await incomeRepository.create({
        contributorId: contrib.id,
        type: 'salary',
        amount: 2000,
        incomeDate: '2026-06-10',
        competenceMonth: 6,
        competenceYear: 2026,
        frequency: 'monthly',
        recurring: true,
        status: 'received',
      });

      // Income in July 2026
      await incomeRepository.create({
        contributorId: contrib.id,
        type: 'salary',
        amount: 2000,
        incomeDate: '2026-07-10',
        competenceMonth: 7,
        competenceYear: 2026,
        frequency: 'monthly',
        recurring: true,
        status: 'received',
      });

      // Income in August 2026
      await incomeRepository.create({
        contributorId: contrib.id,
        type: 'salary',
        amount: 2000,
        incomeDate: '2026-08-10',
        competenceMonth: 8,
        competenceYear: 2026,
        frequency: 'monthly',
        recurring: true,
        status: 'received',
      });

      // Expense in June
      await expenseRepository.create({
        description: 'Bolletta Giugno',
        amount: 150,
        expenseDate: '2026-06-15',
        competenceMonth: 6,
        competenceYear: 2026,
        frequency: 'monthly',
        status: 'paid',
        entryMode: 'manual',
        categoryId: 'cat-1',
        subcategoryId: 'sub-1',
        paymentMethod: 'bankTransfer',
        classification: 'necessary',
        notified: false,
      });

      // Expense in August
      await expenseRepository.create({
        description: 'Bolletta Agosto',
        amount: 200,
        expenseDate: '2026-08-15',
        competenceMonth: 8,
        competenceYear: 2026,
        frequency: 'monthly',
        status: 'paid',
        entryMode: 'manual',
        categoryId: 'cat-1',
        subcategoryId: 'sub-1',
        paymentMethod: 'bankTransfer',
        classification: 'necessary',
        notified: false,
      });

      // Query last three months (Jun, Jul, Aug 2026)
      const summary = await budgetService.calculatePeriodSummary(2026, 6, 2026, 8);

      expect(summary.totalIncome).toBe(6000);
      expect(summary.totalExpenses).toBe(350);
      expect(summary.savings).toBe(5650);
      expect(summary.expensesTrend.length).toBe(3);
      expect(summary.expensesTrend[0]).toMatchObject({ year: 2026, month: 6, amount: 150, incomeAmount: 2000 });
      expect(summary.expensesTrend[1]).toMatchObject({ year: 2026, month: 7, amount: 0, incomeAmount: 2000 });
      expect(summary.expensesTrend[2]).toMatchObject({ year: 2026, month: 8, amount: 200, incomeAmount: 2000 });
    });
  });

  describe('Interfaccia React: ReportsPage e cambi di stato', () => {
    it('TEST 11 – Rendering iniziale con "Report Economico" e selettore unico "Periodo del report"', async () => {
      render(<ReportsPage />);

      await waitFor(() => {
        expect(screen.getAllByText(/Report Economico/i).length).toBeGreaterThan(0);
      });

      // Check dropdown exists
      const periodSelect = screen.getByLabelText('Periodo del report') as HTMLSelectElement;
      expect(periodSelect).toBeInTheDocument();
      expect(periodSelect.value).toBe('current_month');

      // Check options
      expect(screen.getByRole('option', { name: 'Mese corrente' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Ultimo bimestre' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Ultimo trimestre' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Ultimo quadrimestre' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Ultimo semestre' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Annuale' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Scegli periodo' })).toBeInTheDocument();
    });

    it('TEST 12 – Selezione "Scegli periodo" mostra il menu subordinato dei mesi e messaggio di supporto', async () => {
      render(<ReportsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText('Periodo del report')).toBeInTheDocument();
      });

      const periodSelect = screen.getByLabelText('Periodo del report');
      fireEvent.change(periodSelect, { target: { value: 'choose_period' } });

      await waitFor(() => {
        expect(screen.getByLabelText('Mese da analizzare')).toBeInTheDocument();
      });

      const monthSelect = screen.getByLabelText('Mese da analizzare') as HTMLSelectElement;
      expect(monthSelect.value).toBe('');

      // Check initial disabled placeholder
      const placeholderOpt = monthSelect.querySelector('option[value=""]') as HTMLOptionElement;
      expect(placeholderOpt).toBeInTheDocument();
      expect(placeholderOpt.disabled).toBe(true);

      // Check prompt message
      expect(screen.getAllByText('Seleziona il mese per generare il report.').length).toBeGreaterThan(0);
    });

    it('TEST 13 – Stabilità degli Hook durante il cambio di periodo senza crash', async () => {
      render(<ReportsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText('Periodo del report')).toBeInTheDocument();
      });

      const periodSelect = screen.getByLabelText('Periodo del report');

      // 1. Switch to Ultimo trimestre
      fireEvent.change(periodSelect, { target: { value: 'last_three_months' } });
      await waitFor(() => {
        expect(screen.getAllByText((content) => content.includes('Giugno') && content.includes('Agosto')).length).toBeGreaterThan(0);
      });

      // 2. Switch to Annuale
      fireEvent.change(periodSelect, { target: { value: 'current_year' } });
      await waitFor(() => {
        expect(screen.getAllByText((content) => content.includes('Report Economico Annuale')).length).toBeGreaterThan(0);
      });

      // 3. Switch to Scegli periodo
      fireEvent.change(periodSelect, { target: { value: 'choose_period' } });
      await waitFor(() => {
        expect(screen.getAllByText('Seleziona il mese per generare il report.').length).toBeGreaterThan(0);
      });

      // 4. Select month 3 (Marzo)
      await waitFor(() => {
        expect(screen.getByLabelText('Mese da analizzare')).toBeInTheDocument();
      });
      const monthSelect = screen.getByLabelText('Mese da analizzare');
      fireEvent.change(monthSelect, { target: { value: '3' } });

      await waitFor(() => {
        expect(screen.getAllByText((content) => content.includes('Marzo 2026')).length).toBeGreaterThan(0);
      });

      // 5. Back to Mese corrente
      fireEvent.change(periodSelect, { target: { value: 'current_month' } });
      await waitFor(() => {
        expect(screen.getAllByText((content) => content.includes('Agosto 2026')).length).toBeGreaterThan(0);
      });
    });

    it('TEST 14 – Presenza costante e stato disabilitato del pulsante "Chiudi Mese" (P-33R)', async () => {
      render(<ReportsPage />);

      await waitFor(() => {
        expect(screen.getByLabelText('Periodo del report')).toBeInTheDocument();
      });

      // "Chiudi Mese" SHOULD be present and disabled for current_month
      const closeBtn = screen.getByRole('button', { name: /Chiudi Mese/i });
      expect(closeBtn).toBeInTheDocument();
      expect(closeBtn).toBeDisabled();

      const periodSelect = screen.getByLabelText('Periodo del report');

      // Switch to Ultimo trimestre (multi-month) -> button remains present and disabled
      fireEvent.change(periodSelect, { target: { value: 'last_three_months' } });
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /Chiudi Mese/i });
        expect(btn).toBeInTheDocument();
        expect(btn).toBeDisabled();
      });

      // Switch to Annuale (multi-month) -> button remains present and disabled
      fireEvent.change(periodSelect, { target: { value: 'current_year' } });
      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /Chiudi Mese/i });
        expect(btn).toBeInTheDocument();
        expect(btn).toBeDisabled();
      });

      // Switch to Scegli periodo and select Marzo
      fireEvent.change(periodSelect, { target: { value: 'choose_period' } });
      await waitFor(() => {
        expect(screen.getByLabelText('Mese da analizzare')).toBeInTheDocument();
      });

      const monthSelect = screen.getByLabelText('Mese da analizzare');
      fireEvent.change(monthSelect, { target: { value: '3' } });

      await waitFor(() => {
        const btn = screen.getByRole('button', { name: /Chiudi Mese/i });
        expect(btn).toBeInTheDocument();
        expect(btn).toBeDisabled();
      });
    });
  });
});
