import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../database/db';
import { monthlySavingsGoalRepository, incomeRepository, expenseRepository } from '../repositories';
import { HomePage } from '../features/home/HomePage';
import { HomeSavingsBox } from '../features/home/HomeSavingsBox';

describe('P-35 – Nuovo box Risparmio nella Home', () => {
  beforeEach(async () => {
    await db.monthlySavingsGoals.clear();
    await db.incomeEntries.clear();
    await db.expenses.clear();
  });

  it('TEST 1 & 2 – Struttura del box e stato senza obiettivo', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Obiettivo risparmio mese')).toBeInTheDocument();
      expect(screen.getByText('Risparmio da inizio anno')).toBeInTheDocument();
    });

    expect(screen.getByText('Nessun obiettivo impostato per questo mese.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Imposta o modifica l'obiettivo di risparmio/i })
    ).toBeInTheDocument();
  });

  it('TEST 3, 4 & 5 – Impostazione, salvataggio e modifica dell\'obiettivo', async () => {
    render(
      <MemoryRouter>
        <HomeSavingsBox selectedYear={2026} selectedMonth={8} currentMonthSavings={220} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Nessun obiettivo impostato per questo mese.')).toBeInTheDocument();
    });

    // Open modal
    const openBtn = screen.getByRole('button', { name: /Imposta o modifica l'obiettivo/i });
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Imposta obiettivo di risparmio')).toBeInTheDocument();
    });

    // Input target amount 300
    const input = screen.getByLabelText(/Importo obiettivo/i);
    fireEvent.change(input, { target: { value: '300,00' } });

    const saveBtn = screen.getByRole('button', { name: /Salva obiettivo/i });
    fireEvent.click(saveBtn);

    await waitFor(async () => {
      const savedGoal = await monthlySavingsGoalRepository.getByMonthYear(2026, 8);
      expect(savedGoal).toBeDefined();
      expect(savedGoal?.targetAmount).toBe(300);
    });

    // Verify UI updated
    await waitFor(() => {
      expect(screen.getByText('Obiettivo')).toBeInTheDocument();
      expect(screen.getByText('300,00 €')).toBeInTheDocument();
      expect(screen.getByText('Modifica obiettivo')).toBeInTheDocument();
    });

    // Edit goal to 400
    fireEvent.click(screen.getByRole('button', { name: /Imposta o modifica l'obiettivo/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const editInput = screen.getByLabelText(/Importo obiettivo/i);
    fireEvent.change(editInput, { target: { value: '400,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Salva obiettivo/i }));

    await waitFor(async () => {
      const updatedGoal = await monthlySavingsGoalRepository.getByMonthYear(2026, 8);
      expect(updatedGoal?.targetAmount).toBe(400);

      // Verify no duplicates
      const allGoals = await db.monthlySavingsGoals.toArray();
      expect(allGoals.length).toBe(1);
    });
  });

  it('TEST 6 & 7 – Calcolo risparmio mensile e scostamento negativo', async () => {
    // Seed goal
    await monthlySavingsGoalRepository.setGoal(2026, 8, 300);

    render(
      <MemoryRouter>
        <HomeSavingsBox selectedYear={2026} selectedMonth={8} currentMonthSavings={220} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Obiettivo')).toBeInTheDocument();
      expect(screen.getByText('300,00 €')).toBeInTheDocument();
    });

    expect(screen.getByText('220,00 €')).toBeInTheDocument();
    expect(screen.getByText(/Mancano/i)).toBeInTheDocument();
    expect(screen.getByText(/80,00 €/i)).toBeInTheDocument();
  });

  it('TEST 8 – Obiettivo superato e percentuale > 100%', async () => {
    await monthlySavingsGoalRepository.setGoal(2026, 8, 300);

    render(
      <MemoryRouter>
        <HomeSavingsBox selectedYear={2026} selectedMonth={8} currentMonthSavings={350} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('117%')).toBeInTheDocument();
    });

    expect(screen.getByText(/oltre l'obiettivo/i)).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
  });

  it('TEST 9 – Disavanzo mensile (risparmio negativo)', async () => {
    await monthlySavingsGoalRepository.setGoal(2026, 8, 300);

    render(
      <MemoryRouter>
        <HomeSavingsBox selectedYear={2026} selectedMonth={8} currentMonthSavings={-100} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    expect(screen.getByText('-100,00 €')).toBeInTheDocument();
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
  });

  it('TEST 10 & 11 – Risparmio da inizio anno e navigazione al report annuale', async () => {
    // Add income and expense entries for Jan and Aug 2026
    await incomeRepository.create({
      contributorId: 'c1',
      incomeDate: '2026-01-15',
      type: 'Stipendio',
      status: 'received',
      competenceYear: 2026,
      competenceMonth: 1,
      amount: 10000,
      recurring: false,
      frequency: 'monthly',
    });

    await expenseRepository.create({
      entryMode: 'manual',
      description: 'Spese Gennaio',
      amount: 8000,
      expenseDate: '2026-01-20',
      status: 'paid',
      competenceYear: 2026,
      competenceMonth: 1,
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'creditCard',
      classification: 'necessary',
      notified: false,
    });

    render(
      <MemoryRouter>
        <HomeSavingsBox selectedYear={2026} selectedMonth={8} currentMonthSavings={200} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/10\.?000,00/)).toBeInTheDocument();
      expect(screen.getByText(/8\.?000,00/)).toBeInTheDocument();
      expect(screen.getByText(/2\.?000,00/)).toBeInTheDocument();
    });

    const reportLink = screen.getByRole('button', { name: /Apri il report del risparmio da inizio anno/i });
    expect(reportLink).toBeInTheDocument();
  });

  it('TEST 11 – Disavanzo da inizio anno (risparmio annuale negativo)', async () => {
    await expenseRepository.create({
      entryMode: 'manual',
      description: 'Spese elevate',
      amount: 12000,
      expenseDate: '2026-01-20',
      status: 'paid',
      competenceYear: 2026,
      competenceMonth: 1,
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'creditCard',
      classification: 'necessary',
      notified: false,
    });

    render(
      <MemoryRouter>
        <HomeSavingsBox selectedYear={2026} selectedMonth={8} currentMonthSavings={-2000} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Disavanzo da inizio anno')).toBeInTheDocument();
      expect(screen.getByText(/-12\.?000,00/)).toBeInTheDocument();
    });
  });
});
