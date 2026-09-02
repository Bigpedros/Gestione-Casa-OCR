import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ReportsPage } from '../features/reports/ReportsPage';
import { db } from '../database/db';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { contributorRepository, incomeRepository, expenseRepository } from '../repositories';

describe('P-31F: Verification of React Hooks order in ReportsPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const hookErrorMessages: string[] = [];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-26T10:00:00.000Z'));

    hookErrorMessages.length = 0;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      if (
        msg.includes('Rendered more hooks') ||
        msg.includes('Rendered fewer hooks') ||
        msg.includes('change in the order of Hooks') ||
        msg.includes('invalid hook call')
      ) {
        hookErrorMessages.push(msg);
      }
    });

    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('mounts ReportsPage and handles data loading and month changes without React Hook order violations', async () => {
    // 1. Initial Mount - data not yet loaded
    render(<ReportsPage />);

    // Check loading text initially shown
    expect(screen.getByText(/Generazione report economico/i)).toBeInTheDocument();

    // 2. Populate DB with income and expenses for competence month 2026-08
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

      await expenseRepository.create({
        entryMode: 'manual',
        description: 'Affitto Agosto',
        amount: 800,
        expenseDate: '2026-08-05',
        competenceMonth: 8,
        competenceYear: 2026,
        categoryId: 'cat-utenze',
        subcategoryId: 'cat-utenze',
        paymentMethod: 'bankTransfer',
        status: 'paid',
        classification: 'necessary',
        notified: false,
        recurring: true,
        frequency: 'monthly',
        priority: 'high',
      });
    });

    // 3. Wait for component to re-render with loaded data
    await waitFor(() => {
      expect(screen.queryByText(/Generazione report economico/i)).not.toBeInTheDocument();
    });

    // Verify report title and content rendered
    expect(screen.getAllByText(/Report Economico/i).length).toBeGreaterThan(0);

    // 4. Change period using dropdown
    const periodSelect = screen.getByLabelText('Periodo del report');
    expect(periodSelect).toBeInTheDocument();

    // Change to 'Scegli periodo' and select month 1 (Gennaio - empty month)
    await act(async () => {
      fireEvent.change(periodSelect, { target: { value: 'choose_period' } });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Mese da analizzare')).toBeInTheDocument();
    });

    const monthSelect = screen.getByLabelText('Mese da analizzare');
    await act(async () => {
      fireEvent.change(monthSelect, { target: { value: '1' } });
    });

    await waitFor(() => {
      expect(screen.getByText(/Nessun dato economico disponibile per il periodo selezionato/i)).toBeInTheDocument();
    });

    // Change back to 'Mese corrente' (Agosto - with data)
    await act(async () => {
      fireEvent.change(periodSelect, { target: { value: 'current_month' } });
    });

    await waitFor(() => {
      expect(screen.queryByText(/Nessun dato economico disponibile per il periodo selezionato/i)).not.toBeInTheDocument();
    });

    // 5. Assert NO hook errors occurred during the entire lifecycle
    expect(hookErrorMessages).toHaveLength(0);
  });
});
