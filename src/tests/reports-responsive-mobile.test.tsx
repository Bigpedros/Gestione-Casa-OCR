import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ReportsPage } from '../features/reports/ReportsPage';
import { DashboardCard } from '../components/common/DashboardCard';
import { EconomicReportDocument } from '../features/reports/EconomicReportDocument';
import { db } from '../database/db';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { contributorRepository, incomeRepository } from '../repositories';
import { PeriodBudgetSummary } from '../services/budgetService';
import { SelectedPeriodRange } from '../features/reports/periodUtils';

describe('Reports Page & DashboardCard Mobile Responsive Verification (Regression Guard)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  afterEach(async () => {
    await db.delete();
  });

  it('TEST-RESP-001: DashboardCard uses responsive header layout (flex-col on mobile, sm:flex-row) and wrapping action', () => {
    const { container } = render(
      <DashboardCard
        title="Test Card"
        subtitle="Subtitle text"
        action={<button id="test-btn">Action Button</button>}
      >
        <div>Content</div>
      </DashboardCard>
    );

    const header = container.querySelector('.flex.flex-col.sm\\:flex-row');
    expect(header).toBeInTheDocument();

    const actionWrapper = container.querySelector('.w-full.sm\\:w-auto.shrink-0.flex.flex-wrap');
    expect(actionWrapper).toBeInTheDocument();
  });

  it('TEST-RESP-002: ReportsPage preview actions contain all 5 controls without missing commands or truncation', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.queryByText(/Generazione report economico/i)).not.toBeInTheDocument();
    });

    // Check that Provvisorio badge and all 4 preview buttons are present
    expect(screen.getAllByText(/Provvisorio/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Chiudi Mese/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salva questo report/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Esporta o Stampa in PDF/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stampa il report visualizzato/i })).toBeInTheDocument();
  });

  it('TEST-RESP-003: Preview paginator has responsive 2-column mobile grid and adaptive labels with full aria-labels', async () => {
    // Populate DB so that document renders with totalPages
    await act(async () => {
      const contrib = await contributorRepository.create({
        order: 1,
        name: 'Marco',
        label: 'Stipendio',
        active: true,
      });

      await incomeRepository.create({
        contributorId: contrib.id,
        type: 'salary',
        amount: 2500,
        incomeDate: '2026-08-01',
        competenceMonth: 8,
        competenceYear: 2026,
        frequency: 'monthly',
        recurring: true,
        status: 'received',
      });
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.queryByText(/Generazione report economico/i)).not.toBeInTheDocument();
    });

    // Both buttons exist with proper aria-labels
    const page1Btn = screen.getByRole('button', { name: /Pagina 1: Sintesi Economica/i });
    const page2Btn = screen.getByRole('button', { name: /Pagina 2: Dettagli e Ripartizioni/i });

    expect(page1Btn).toBeInTheDocument();
    expect(page2Btn).toBeInTheDocument();

    // Contains short label for mobile and full label for sm+
    expect(page1Btn.querySelector('.inline.sm\\:hidden')?.textContent).toBe('1. Sintesi');
    expect(page1Btn.querySelector('.hidden.sm\\:inline')?.textContent).toBe('Pagina 1: Sintesi Economica');

    expect(page2Btn.querySelector('.inline.sm\\:hidden')?.textContent).toBe('2. Dettagli');
    expect(page2Btn.querySelector('.hidden.sm\\:inline')?.textContent).toBe('Pagina 2: Dettagli & Ripartizioni');

    // Navigation arrows
    expect(screen.getByRole('button', { name: /Pagina precedente/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pagina successiva/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Pagina 1 di 2/i).length).toBeGreaterThanOrEqual(1);
  });

  it('TEST-RESP-004: EconomicReportDocument secondary metrics grid uses grid-cols-1 sm:grid-cols-3', () => {
    const dummySummary: PeriodBudgetSummary = {
      year: 2026,
      month: 8,
      totalIncome: 3000,
      totalReceivedIncome: 3000,
      totalExpenses: 1500,
      paidExpenses: 1500,
      savings: 1500,
      notifiedPlannedExpenses: 0,
      savingPlanTotal: 0,
      projectQuotaTotal: 0,
      prudentialBalance: 1500,
      surplus: 1500,
      deficit: 0,
      openingExtraBudget: 0,
      extraBudgetUsed: 0,
      uncoveredDeficit: 0,
      closingExtraBudget: 0,
      expensesByCategory: [],
      expensesTrend: [],
      startYear: 2026,
      startMonth: 8,
      endYear: 2026,
      endMonth: 8,
      isSingleMonth: true,
      totalMonths: 1,
    };

    const dummyRange: SelectedPeriodRange = {
      startMonth: 8,
      startYear: 2026,
      endMonth: 8,
      endYear: 2026,
      isSingleMonth: true,
    };

    const dummyClassification = {
      necessary: 1000,
      voluntary: 500,
      toEvaluate: 0,
    };

    const { container } = render(
      <EconomicReportDocument
        summary={dummySummary}
        selectedRange={dummyRange}
        periodType="current_month"
        reportStatus="provisional"
        generationDateStr="25/08/2026"
        formattedAddress="Via Roma 1, Milano"
        incomes={[]}
        expenses={[]}
        contributorMap={new Map()}
        categoryMap={new Map()}
        supplierMap={new Map()}
        upcomingPaymentsList={[]}
        upcomingPaymentsSum={0}
        classificationSummaries={dummyClassification}
        isAllZeroPeriod={false}
        docTitle="Report Economico - Agosto 2026"
        printPeriodText="Agosto 2026"
        activePage={1}
      />
    );

    // Look for secondary metrics grid
    const secondaryMetricsGrid = container.querySelector('.grid.grid-cols-1.sm\\:grid-cols-3');
    expect(secondaryMetricsGrid).toBeInTheDocument();
    expect(screen.getByText(/Copertura Uscite/i)).toBeInTheDocument();
    expect(screen.getByText(/Incidenza Spese/i)).toBeInTheDocument();
    expect(screen.getByText(/Tasso di Risparmio/i)).toBeInTheDocument();
  });

  it.each([320, 360, 375, 390, 412, 432])(
    'TEST-RESP-005: Renders ReportsPage seamlessly at %ipx viewport width',
    async (width) => {
      // Simulate viewport width
      window.innerWidth = width;
      window.dispatchEvent(new Event('resize'));

      const { container } = render(<ReportsPage />);

      await waitFor(() => {
        expect(screen.queryByText(/Generazione report economico/i)).not.toBeInTheDocument();
      });

      // Confirm main container and preview card are present
      const reportsContainer = container.querySelector('#reports-page-container');
      expect(reportsContainer).toBeInTheDocument();

      // Ensure no elements have rigid fixed-width inline style that exceeds container
      const wideElements = Array.from(container.querySelectorAll('*')).filter((el) => {
        const style = (el as HTMLElement).style;
        if (style && style.minWidth && parseInt(style.minWidth, 10) > width) {
          return true;
        }
        return false;
      });
      expect(wideElements).toHaveLength(0);
    }
  );
});

