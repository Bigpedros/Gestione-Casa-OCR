import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { budgetService } from '../services/budgetService';
import { incomeRepository, expenseRepository } from '../repositories';

describe('P-20 – Test di Accettazione Modifica ed Eliminazione Entrate/Uscite', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST 1 – Modifica Entrata', async () => {
    // Creare un’entrata di €100,00.
    const inc = await incomeRepository.create({
      contributorId: 'c1',
      type: 'salary',
      amount: 100,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
      description: 'Stipendio Iniziale',
    });

    let summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(100);

    // Modificarla in €150,00.
    await incomeRepository.update(inc.id, { amount: 150 });

    const allIncomes = await incomeRepository.getByMonthYear(2026, 8);
    expect(allIncomes.length).toBe(1);

    summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(150);
  });

  it('TEST 2 – Eliminazione Entrata', async () => {
    const inc = await incomeRepository.create({
      contributorId: 'c1',
      type: 'salary',
      amount: 150,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
      description: 'Stipendio da eliminare',
    });

    let summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(150);

    // Eliminazione
    await incomeRepository.delete(inc.id);

    const allIncomes = await incomeRepository.getByMonthYear(2026, 8);
    expect(allIncomes.length).toBe(0);

    summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(0);
  });

  it('TEST 3 – Modifica Uscita', async () => {
    const exp = await expenseRepository.create({
      description: 'Spesa iniziale',
      amount: 40,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'debitCard',
      classification: 'necessary',
      status: 'paid',
      entryMode: 'manual',
      notified: true,
    });

    let summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(40);

    // Modificarla in €60,00
    await expenseRepository.update(exp.id, { amount: 60 });

    const allExpenses = await expenseRepository.getByMonthYear(2026, 8);
    expect(allExpenses.length).toBe(1);

    summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(60);
  });

  it('TEST 4 – Eliminazione Uscita', async () => {
    const exp = await expenseRepository.create({
      description: 'Spesa da eliminare',
      amount: 60,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'debitCard',
      classification: 'necessary',
      status: 'paid',
      entryMode: 'manual',
      notified: true,
    });

    let summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(60);

    // Eliminazione
    await expenseRepository.delete(exp.id);

    const allExpenses = await expenseRepository.getByMonthYear(2026, 8);
    expect(allExpenses.length).toBe(0);

    summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(0);
  });

  it('TEST 7 – Record cancelled escluso dai totali', async () => {
    await incomeRepository.create({
      contributorId: 'c1',
      type: 'salary',
      amount: 500,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'cancelled',
      description: 'Entrata Annullata',
    });

    await expenseRepository.create({
      description: 'Spesa Annullata',
      amount: 200,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'debitCard',
      classification: 'necessary',
      status: 'cancelled',
      entryMode: 'manual',
      notified: true,
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(0);
    expect(summary.totalExpenses).toBe(0);
  });
});
