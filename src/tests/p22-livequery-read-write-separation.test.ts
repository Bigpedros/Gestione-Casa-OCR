import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { budgetService } from '../services/budgetService';
import {
  fixedExpenseRepository,
  categoryRepository,
  incomeRepository,
  expenseRepository,
} from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('P-22: LiveQuery Read/Write Separation & Budget Summary', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('1. calculateMonthlySummary should be strictly READ-ONLY and not add expenses', async () => {
    const parents = await categoryRepository.getParents();
    const cat = parents[0];

    // Create an active fixed expense
    await fixedExpenseRepository.create({
      name: 'Affitto Mensile',
      categoryId: cat.id,
      subcategoryId: cat.id,
      expectedAmount: 800.0,
      frequency: 'monthly',
      dueDay: 1,
      priority: 'high',
      paymentMethod: 'bankTransfer' as any,
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: '2026-01-01',
    });

    const year = 2026;
    const month = 5;

    // Count expenses before calling calculateMonthlySummary
    const initialExpensesCount = await db.expenses.count();
    expect(initialExpensesCount).toBe(0);

    // Call calculateMonthlySummary directly (pure query)
    const summary = await budgetService.calculateMonthlySummary(year, month);
    expect(summary).toBeDefined();
    expect(summary.totalIncome).toBe(0);
    expect(summary.totalExpenses).toBe(0);

    // Verify calculateMonthlySummary DID NOT write any expenses
    const countAfter = await db.expenses.count();
    expect(countAfter).toBe(0);
  });

  it('2. calculateMonthlySummary inside a Dexie read-only transaction should NOT throw Readwrite transaction error', async () => {
    const year = 2026;
    const month = 5;

    // Execute calculateMonthlySummary inside a read-only transaction (simulating liveQuery context)
    const resultPromise = db.transaction('r', [db.expenses, db.incomeEntries, db.categories, db.fixedExpenses, db.savingPlans, db.projects, db.extraBudgetMovements], async () => {
      return await budgetService.calculateMonthlySummary(year, month);
    });

    await expect(resultPromise).resolves.toBeDefined();
  });

  it('3. ensureMonthlyExpenseMovements should generate movements idempotently without duplicating', async () => {
    const parents = await categoryRepository.getParents();
    const cat = parents[0];

    await fixedExpenseRepository.create({
      name: 'Utenza Elettrica',
      categoryId: cat.id,
      subcategoryId: cat.id,
      expectedAmount: 120.0,
      frequency: 'monthly',
      dueDay: 10,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: '2026-01-01',
    });

    const year = 2026;
    const month = 5;

    // Run command once (syncs month 5 and the 4 preceding months: Jan, Feb, Mar, Apr, May)
    await budgetService.ensureMonthlyExpenseMovements(year, month);
    const count1 = await db.expenses.count();
    expect(count1).toBe(5);

    // Run command a second time (idempotency check)
    await budgetService.ensureMonthlyExpenseMovements(year, month);
    const count2 = await db.expenses.count();
    expect(count2).toBe(5); // No duplicates created!

    // Verify summary reads generated expense
    const summary = await budgetService.calculateMonthlySummary(year, month);
    expect(summary.totalExpenses).toBe(120.0);
  });

  it('4. Income and Expense updates should reflect correctly in calculateMonthlySummary', async () => {
    const parents = await categoryRepository.getParents();
    const cat = parents[0];

    const year = 2026;
    const month = 5;

    // Add Income
    const income = await incomeRepository.create({
      contributorId: 'contrib-1',
      type: 'salary',
      description: 'Stipendio Maggio',
      amount: 2500.0,
      incomeDate: '2026-05-01',
      competenceYear: year,
      competenceMonth: month,
      status: 'received',
      recurring: false,
      frequency: 'monthly',
    });

    // Add Expense
    const expense = await expenseRepository.create({
      entryMode: 'manual',
      description: 'Spesa Supermercato',
      amount: 150.0,
      expenseDate: '2026-05-02',
      competenceYear: year,
      competenceMonth: month,
      categoryId: cat.id,
      subcategoryId: cat.id,
      paymentMethod: 'card' as any,
      status: 'paid',
      classification: 'necessary',
      notified: false,
    });

    let summary = await budgetService.calculateMonthlySummary(year, month);
    expect(summary.totalIncome).toBe(2500.0);
    expect(summary.totalExpenses).toBe(150.0);
    expect(summary.savings).toBe(2350.0);

    // Update income amount
    await incomeRepository.update(income.id, { amount: 2800.0 });

    // Mark expense as cancelled
    await expenseRepository.update(expense.id, { status: 'cancelled' });

    summary = await budgetService.calculateMonthlySummary(year, month);
    expect(summary.totalIncome).toBe(2800.0);
    expect(summary.totalExpenses).toBe(0); // Cancelled expense ignored
    expect(summary.savings).toBe(2800.0);
  });
});
