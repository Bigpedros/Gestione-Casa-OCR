import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import {
  contributorRepository,
  incomeRepository,
  expenseRepository,
} from '../repositories';
import { budgetService } from '../services/budgetService';
import {
  formatCurrency,
  formatDate,
} from '../utils/formatters';
import {
  formatHomeAddress,
  getExpenseStatusInfo,
} from '../features/reports/reportHelpers';

describe('P-31: Ridisegno professionale del Report Economico Mensile', () => {
  beforeEach(async () => {
    await db.incomeEntries.clear();
    await db.expenses.clear();
    await db.categories.clear();
    await db.contributors.clear();
    await db.projects.clear();
    await db.monthlyReports.clear();
    await db.settings.clear();
  });

  it('TEST 1 – Coerenza dei calcoli con la Home', async () => {
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Fabiola',
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
      description: 'Luce',
      amount: 150,
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

    await expenseRepository.create({
      entryMode: 'manual',
      description: 'Gas',
      amount: 100,
      expenseDate: '2026-08-15',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: catId,
      subcategoryId: catId,
      paymentMethod: 'bankTransfer',
      status: 'planned',
      classification: 'necessary',
      notified: false,
      recurring: false,
      frequency: 'monthly',
      priority: 'medium',
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 8);

    expect(summary.totalIncome).toBe(2500);
    expect(summary.totalExpenses).toBe(250);
    expect(summary.paidExpenses).toBe(150);
    expect(summary.savings).toBe(2250);
  });

  it('TEST 2 & 4 & 5 & 6 – Somma Entrate, Uscite, Pagate e Non Pagate', async () => {
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Pietro',
      label: 'Stipendio',
      active: true,
    });

    const inc1 = await incomeRepository.create({
      contributorId: contrib.id,
      type: 'salary',
      amount: 1800,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
    });

    const inc2 = await incomeRepository.create({
      contributorId: contrib.id,
      type: 'pension',
      amount: 650,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
    });

    const exp1 = await expenseRepository.create({
      entryMode: 'manual',
      description: 'Affitto',
      amount: 800,
      expenseDate: '2026-08-05',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: 'cat-home',
      subcategoryId: 'cat-home',
      paymentMethod: 'bankTransfer',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      recurring: true,
      frequency: 'monthly',
      priority: 'high',
    });

    const exp2 = await expenseRepository.create({
      entryMode: 'manual',
      description: 'Internet',
      amount: 50,
      expenseDate: '2026-08-20',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: 'cat-home',
      subcategoryId: 'cat-home',
      paymentMethod: 'directDebit',
      status: 'planned',
      classification: 'necessary',
      notified: false,
      recurring: true,
      frequency: 'monthly',
      priority: 'medium',
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 8);

    const totalIncomesFromRows = [inc1, inc2].reduce((sum, i) => sum + i.amount, 0);
    expect(totalIncomesFromRows).toBe(summary.totalIncome);
    expect(summary.totalIncome).toBe(2450);

    const totalExpensesFromRows = [exp1, exp2].reduce((sum, e) => sum + e.amount, 0);
    expect(totalExpensesFromRows).toBe(summary.totalExpenses);
    expect(summary.totalExpenses).toBe(850);

    const paidSum = exp1.amount;
    const unpaidSum = exp2.amount;
    expect(paidSum + unpaidSum).toBe(summary.totalExpenses);
  });

  it('TEST 3 – Gestione Mese Vuoto (Valori a Zero)', async () => {
    const summary = await budgetService.calculateMonthlySummary(2028, 1);

    expect(summary.totalIncome).toBe(0);
    expect(summary.totalExpenses).toBe(0);
    expect(summary.savings).toBe(0);
    expect(summary.expensesByCategory).toHaveLength(0);
  });

  it('TEST 7 – Ripartizione per Categoria totalizza il Totale Uscite', async () => {
    const cat1Id = 'cat-food';
    const cat2Id = 'cat-trans';

    await db.categories.add({
      id: cat1Id,
      name: 'Alimentari',
      code: 'food',
      type: 'expense',
      level: 1,
      enabled: true,
      system: false,
      sortOrder: 1,
      metadata: { createdAt: '', updatedAt: '', version: 1 },
    });

    await db.categories.add({
      id: cat2Id,
      name: 'Trasporti',
      code: 'transport',
      type: 'expense',
      level: 1,
      enabled: true,
      system: false,
      sortOrder: 2,
      metadata: { createdAt: '', updatedAt: '', version: 1 },
    });

    await expenseRepository.create({
      entryMode: 'manual',
      description: 'Supermercato',
      amount: 300,
      expenseDate: '2026-08-02',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: cat1Id,
      subcategoryId: cat1Id,
      paymentMethod: 'creditCard',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      recurring: false,
      frequency: 'monthly',
      priority: 'high',
    });

    await expenseRepository.create({
      entryMode: 'manual',
      description: 'Benzina',
      amount: 100,
      expenseDate: '2026-08-05',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: cat2Id,
      subcategoryId: cat2Id,
      paymentMethod: 'creditCard',
      status: 'paid',
      classification: 'necessary',
      notified: false,
      recurring: false,
      frequency: 'monthly',
      priority: 'medium',
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    const categorySum = summary.expensesByCategory.reduce((sum, c) => sum + c.amount, 0);

    expect(categorySum).toBe(summary.totalExpenses);
    expect(summary.totalExpenses).toBe(400);

    const foodCat = summary.expensesByCategory.find((c) => c.categoryName === 'Alimentari');
    expect(foodCat?.percentage).toBe(75);

    const transportCat = summary.expensesByCategory.find((c) => c.categoryName === 'Trasporti');
    expect(transportCat?.percentage).toBe(25);
  });

  it('TEST 8 – Stato delle Uscite con etichette italiane', () => {
    const now = new Date('2026-08-10');

    const paidExp = {
      id: 'e1',
      entryMode: 'manual' as const,
      description: 'Test',
      amount: 50,
      expenseDate: '2026-08-10',
      competenceMonth: 8,
      competenceYear: 2026,
      categoryId: 'c1',
      subcategoryId: 'c1',
      paymentMethod: 'creditCard' as const,
      status: 'paid' as const,
      classification: 'necessary' as const,
      notified: false,
      recurring: false,
      frequency: 'monthly' as const,
      priority: 'medium' as const,
      metadata: { createdAt: '', updatedAt: '', version: 1 },
    };

    const overdueExp = {
      ...paidExp,
      id: 'e2',
      status: 'planned' as const,
      expenseDate: '2026-08-01',
    };

    const dueTodayExp = {
      ...paidExp,
      id: 'e3',
      status: 'planned' as const,
      expenseDate: '2026-08-10',
    };

    expect(getExpenseStatusInfo(paidExp, now).label).toBe('Pagata');
    expect(getExpenseStatusInfo(overdueExp, now).label).toBe('Scaduta');
    expect(getExpenseStatusInfo(dueTodayExp, now).label).toBe('In scadenza');
  });

  it('TEST 9 – Formattazione Monetaria e Date in italiano', () => {
    expect(formatCurrency(0)).toContain('0,00');
    expect(formatCurrency(1250.5)).toContain('1250,50');
    expect(formatCurrency(-300)).toContain('-300,00');

    expect(formatDate('2026-08-01')).toBe('01/08/2026');
  });

  it('TEST 10 – Gestione dati Abitazione nell’intestazione', () => {
    const homeWithData = {
      address: 'Via Roma',
      streetNumber: '25/A',
      postalCode: '00100',
    };

    expect(formatHomeAddress(homeWithData)).toBe('Via Roma 25/A – 00100');
    expect(formatHomeAddress(null)).toBeNull();
    expect(formatHomeAddress({ address: '', streetNumber: '', postalCode: '' })).toBeNull();
  });

  it('TEST 15 – Natura READ-ONLY del Report', async () => {
    const initialIncomes = await incomeRepository.getAll();
    const initialExpenses = await expenseRepository.getAll();

    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary).toBeDefined();

    const currentIncomes = await incomeRepository.getAll();
    const currentExpenses = await expenseRepository.getAll();

    expect(currentIncomes).toHaveLength(initialIncomes.length);
    expect(currentExpenses).toHaveLength(initialExpenses.length);
  });
});
