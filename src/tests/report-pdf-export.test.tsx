import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { db } from '../database/db';
import { ReportsPage } from '../features/reports/ReportsPage';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import {
  contributorRepository,
  incomeRepository,
  expenseRepository,
} from '../repositories';
import * as reportPDFGenerator from '../features/reports/reportPDFGenerator';

describe('COLL-03 Regression: Esportazione PDF del Report Economico', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-26T10:00:00.000Z'));

    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();

    // Inseriamo dati realistici per Agosto 2026
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Pietro',
      label: 'Stipendio',
      active: true,
    });

    await incomeRepository.create({
      contributorId: contrib.id,
      type: 'salary',
      amount: 2800,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
    });

    const catId = 'cat-utenze';
    await db.categories.add({
      id: catId,
      name: 'Utenze',
      code: 'utenze',
      type: 'expense',
      level: 1,
      enabled: true,
      system: false,
      sortOrder: 1,
      metadata: { createdAt: '', updatedAt: '', version: 1 },
    });

    await expenseRepository.create({
      entryMode: 'manual',
      description: 'Luce e Gas Agosto',
      amount: 250,
      expenseDate: '2026-08-10',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: catId,
      subcategoryId: catId,
      paymentMethod: 'bankTransfer',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      recurring: false,
      frequency: 'monthly',
      priority: 'medium',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TEST 1 – Esporta PDF non richiama window.print e invoca downloadEconomicReportPDF', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const pdfSpy = vi.spyOn(reportPDFGenerator, 'downloadEconomicReportPDF').mockImplementation(() => {});

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Esporta in formato PDF/i })).toBeInTheDocument();
      expect(screen.getByText('Totale Entrate')).toBeInTheDocument();
    }, { timeout: 5000 });

    const exportBtn = screen.getByRole('button', { name: /Esporta in formato PDF/i });
    fireEvent.click(exportBtn);

    expect(printSpy).not.toHaveBeenCalled();
    expect(pdfSpy).toHaveBeenCalledTimes(1);

    const callArgs = pdfSpy.mock.calls[0][0];
    expect(callArgs.summary).toBeDefined();
    expect(callArgs.summary.totalIncome).toBe(2800);
    expect(callArgs.summary.paidExpenses).toBe(250);
    expect(callArgs.selectedRange.isSingleMonth).toBe(true);

    printSpy.mockRestore();
    pdfSpy.mockRestore();
  });

  it('TEST 2 – Stampa continua a richiamare esclusivamente window.print', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const pdfSpy = vi.spyOn(reportPDFGenerator, 'downloadEconomicReportPDF').mockImplementation(() => {});

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Stampa il report visualizzato/i })).toBeInTheDocument();
    });

    const printBtn = screen.getByRole('button', { name: /Stampa il report visualizzato/i });
    fireEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(pdfSpy).not.toHaveBeenCalled();

    printSpy.mockRestore();
    pdfSpy.mockRestore();
  });

  it('TEST 3 – Generazione PDF a 2 pagine: formato A4, 2 pagine, esclusione sezioni esterne e corrispondenza dati', () => {
    const contributorMap = new Map();
    contributorMap.set('c1', { id: 'c1', name: 'Pietro', order: 1, active: true });

    const categoryMap = new Map();
    categoryMap.set('cat-1', 'Utenze');

    const expenses = [
      {
        id: 'e1',
        entryMode: 'manual' as const,
        description: 'Luce e Gas Agosto',
        amount: 250,
        expenseDate: '2026-08-10',
        competenceMonth: 8,
        competenceYear: 2026,
        categoryId: 'cat-1',
        subcategoryId: 'cat-1',
        paymentMethod: 'bankTransfer' as const,
        status: 'paid' as const,
        classification: 'necessary' as const,
        notified: false,
        recurring: false,
        frequency: 'monthly' as const,
        priority: 'medium' as const,
        metadata: { createdAt: '', updatedAt: '', version: 1 },
      },
    ];

    const incomes = [
      {
        id: 'i1',
        contributorId: 'c1',
        type: 'salary' as const,
        amount: 2800,
        incomeDate: '2026-08-01',
        competenceMonth: 8,
        competenceYear: 2026,
        frequency: 'monthly' as const,
        recurring: true,
        status: 'received' as const,
        metadata: { createdAt: '', updatedAt: '', version: 1 },
      },
    ];

    const summary = {
      month: 8,
      year: 2026,
      startYear: 2026,
      startMonth: 8,
      endYear: 2026,
      endMonth: 8,
      isSingleMonth: true,
      totalMonths: 1,
      totalIncome: 2800,
      totalReceivedIncome: 2800,
      totalExpenses: 250,
      paidExpenses: 250,
      plannedExpenses: 0,
      notifiedPlannedExpenses: 0,
      savingPlanTotal: 0,
      projectQuotaTotal: 0,
      savings: 2550,
      prudentialBalance: 2550,
      surplus: 2550,
      deficit: 0,
      openingExtraBudget: 0,
      extraBudgetUsed: 0,
      closingExtraBudget: 0,
      uncoveredDeficit: 0,
      expensesByCategory: [{ categoryId: 'cat-1', categoryName: 'Utenze', amount: 250, percentage: 100 }],
      expensesTrend: [],
    };

    const selectedRange = {
      startYear: 2026,
      startMonth: 8,
      endYear: 2026,
      endMonth: 8,
      isSingleMonth: true,
    };

    const doc = reportPDFGenerator.generateEconomicReportPDF({
      summary,
      selectedRange,
      periodType: 'current_month',
      reportStatus: 'provisional',
      generationDateStr: '26 agosto 2026, ore 10:00',
      formattedAddress: 'Via Roma 10 - 00100',
      incomes,
      expenses,
      contributorMap,
      categoryMap,
      classificationSummaries: { necessary: 250, voluntary: 0, toEvaluate: 0 },
      isAllZeroPeriod: false,
      docTitle: 'Report Economico - Agosto 2026',
      printPeriodText: 'Periodo analizzato: 01/08/2026 - 31/08/2026',
    });

    // 1. PDF A4 verticale di esattamente 2 pagine
    expect(doc.getNumberOfPages()).toBe(2);

    // 2. Assenza di URL, barre browser e controlli applicativi
    const pdfOutput = doc.output();
    expect(pdfOutput).not.toContain('http://');
    expect(pdfOutput).not.toContain('https://');
    expect(pdfOutput).not.toContain('btn-preview');
    expect(pdfOutput).not.toContain('Esporta in formato PDF');
    expect(pdfOutput).not.toContain('Stampa il report');

    // 3. Tipografia corretta e assenza di parole saldate
    expect(pdfOutput).not.toContain('ReportEconom');
    expect(pdfOutput).not.toContain('Periodoanalizzato');
    expect(pdfOutput).toContain('Report Economico');
    expect(pdfOutput).toContain('Periodo analizzato');

    // 4. Presenza piè di pagina standard
    expect(pdfOutput).toContain('Pagina 1 di 2');
    expect(pdfOutput).toContain('Pagina 2 di 2');

    // Verifichiamo il nome del file generato
    const fileName = reportPDFGenerator.buildEconomicReportPDFFileName('Report Economico - Agosto 2026', selectedRange);
    expect(fileName).toBe('Gestione-Casa_Report-Economico_Agosto-2026.pdf');
  });

  it('TEST 5 – Segni negativi corretti (- 0,00 €) e assenza di virgolette o U+2212 corrotto (" 0,00 €)', () => {
    const contributorMap = new Map();
    const categoryMap = new Map();

    // Summary con spese pianificate, piani risparmio e progetti a zero o con valori per testare righe sottrattive
    const summary = {
      month: 8,
      year: 2026,
      startYear: 2026,
      startMonth: 8,
      endYear: 2026,
      endMonth: 8,
      isSingleMonth: true,
      totalMonths: 1,
      totalIncome: 0,
      totalReceivedIncome: 0,
      totalExpenses: 0,
      paidExpenses: 0,
      plannedExpenses: 0,
      notifiedPlannedExpenses: 0,
      savingPlanTotal: 0,
      projectQuotaTotal: 0,
      savings: 0,
      prudentialBalance: 0,
      surplus: 0,
      deficit: 0,
      openingExtraBudget: 0,
      extraBudgetUsed: 0,
      closingExtraBudget: 0,
      uncoveredDeficit: 0,
      expensesByCategory: [],
      expensesTrend: [],
    };

    const selectedRange = {
      startYear: 2026,
      startMonth: 8,
      endYear: 2026,
      endMonth: 8,
      isSingleMonth: true,
    };

    const doc = reportPDFGenerator.generateEconomicReportPDF({
      summary,
      selectedRange,
      periodType: 'current_month',
      reportStatus: 'provisional',
      generationDateStr: '26 agosto 2026, ore 10:00',
      formattedAddress: null,
      incomes: [],
      expenses: [],
      contributorMap,
      categoryMap,
      classificationSummaries: { necessary: 0, voluntary: 0, toEvaluate: 0 },
      isAllZeroPeriod: false,
      docTitle: 'Report Economico - Agosto 2026',
      printPeriodText: 'Periodo analizzato: 01/08/2026 - 31/08/2026',
    });

    const pdfOutput = doc.output();

    // 1. Deve contenere il prefisso sottrattivo corretto "- 0,00"
    expect(pdfOutput).toContain('- 0,00');

    // 2. NON deve contenere il carattere corrotto con virgoletta '" 0,00'
    expect(pdfOutput).not.toContain('" 0,00');

    // 3. Verifica sanitizzazione stringhe
    expect(reportPDFGenerator.formatPDFText('− 0,00 €')).toBe('- 0,00 €');
    expect(reportPDFGenerator.formatPDFCurrency(0)).toContain('0,00');
  });

  it('TEST 4 – Esportazione di entrambe le pagine indipendentemente dalla pagina attiva nell\'anteprima', async () => {
    const pdfSpy = vi.spyOn(reportPDFGenerator, 'downloadEconomicReportPDF').mockImplementation(() => {});

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText('Pagina 1: Sintesi Economica')).toBeInTheDocument();
    });

    // Ci spostiamo a Pagina 2 nell'anteprima web
    const page2Btn = screen.getByText('Pagina 2: Dettagli & Ripartizioni');
    fireEvent.click(page2Btn);

    await waitFor(() => {
      expect(screen.getByText('Pagina 2 di 2')).toBeInTheDocument();
    });

    // Clicchiamo su Esporta PDF mentre l'anteprima visualizza pagina 2
    const exportBtn = screen.getByRole('button', { name: /Esporta in formato PDF/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(pdfSpy).toHaveBeenCalledTimes(1);
    });
    const callArgs = pdfSpy.mock.calls[0][0];

    // Il generatore riceve l'intero dataset per produrre il PDF completo da 2 pagine
    expect(callArgs.summary).toBeDefined();
    expect(callArgs.incomes.length).toBeGreaterThan(0);
    expect(callArgs.expenses.length).toBeGreaterThan(0);

    pdfSpy.mockRestore();
  });
});
