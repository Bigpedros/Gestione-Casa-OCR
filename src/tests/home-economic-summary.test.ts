import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { budgetService } from '../services/budgetService';
import { incomeRepository, expenseRepository } from '../repositories';

describe('P-15 – Test di Accettazione Riepiloghi Economici Home', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST 1 – Somma delle entrate per i contributori', async () => {
    // Inserire: Mario (€1.500), Anna (€1.200), Luca (€300)
    await incomeRepository.create({
      contributorId: 'c1',
      type: 'salary',
      amount: 1500,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
      description: 'Stipendio Mario',
    });

    await incomeRepository.create({
      contributorId: 'c2',
      type: 'salary',
      amount: 1200,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'planned',
      description: 'Stipendio Anna',
    });

    await incomeRepository.create({
      contributorId: 'c3',
      type: 'refund',
      amount: 300,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'once',
      recurring: false,
      status: 'received',
      description: 'Rimborso Luca',
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(3000);
  });

  it('TEST 2 & TEST 3 – Spesa non pagata e Invarianza su Cambio Stato', async () => {
    // TEST 2: Inserire una spesa di €800 con stato non ancora pagata ('planned')
    const exp = await expenseRepository.create({
      description: 'Affitto',
      amount: 800,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'bankTransfer',
      classification: 'necessary',
      status: 'planned',
      entryMode: 'manual',
      notified: false,
    });

    let summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(800);

    // TEST 3: Cambiare la stessa spesa da "non pagata" ('planned') a "pagata" ('paid')
    await expenseRepository.update(exp.id, { status: 'paid' });

    summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(800);
  });

  it('TEST 4 – Calcolo Risparmio con Entrate €3.000 e Spese €1.100', async () => {
    await incomeRepository.create({
      contributorId: 'c1',
      type: 'salary',
      amount: 3000,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
      description: 'Entrate Totali',
    });

    await expenseRepository.create({
      description: 'Bolletta',
      amount: 100,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'debitCard',
      classification: 'necessary',
      status: 'paid',
      entryMode: 'manual',
      notified: false,
    });

    await expenseRepository.create({
      description: 'Affitto',
      amount: 800,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'bankTransfer',
      classification: 'necessary',
      status: 'planned',
      entryMode: 'manual',
      notified: false,
    });

    await expenseRepository.create({
      description: 'Assicurazione',
      amount: 200,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'creditCard',
      classification: 'necessary',
      status: 'planned',
      entryMode: 'manual',
      notified: false,
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(3000);
    expect(summary.totalExpenses).toBe(1100);
    expect(summary.savings).toBe(1900);
  });

  it('TEST 5 & TEST 6 – Modifica ed Eliminazione di una Spesa', async () => {
    const exp = await expenseRepository.create({
      description: 'Spesa di prova',
      amount: 100,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'cash',
      classification: 'voluntary',
      status: 'planned',
      entryMode: 'manual',
      notified: false,
    });

    let summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(100);

    // TEST 5: Modificare una spesa da €100 a €150
    await expenseRepository.update(exp.id, { amount: 150 });
    summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(150);

    // TEST 6: Eliminare una spesa di €150
    await expenseRepository.delete(exp.id);
    summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalExpenses).toBe(0);
  });

  it('TEST 7 – Risparmio Negativo (Entrate €2.000, Spese €2.300)', async () => {
    await incomeRepository.create({
      contributorId: 'c1',
      type: 'salary',
      amount: 2000,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
      description: 'Entrate',
    });

    await expenseRepository.create({
      description: 'Spesa Grande',
      amount: 2300,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'debitCard',
      classification: 'necessary',
      status: 'planned',
      entryMode: 'manual',
      notified: false,
    });

    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(2000);
    expect(summary.totalExpenses).toBe(2300);
    expect(summary.savings).toBe(-300);
  });

  it('TEST 8 – Persistenza', async () => {
    await incomeRepository.create({
      contributorId: 'c1',
      type: 'salary',
      amount: 2000,
      incomeDate: '2026-08-01',
      competenceYear: 2026,
      competenceMonth: 8,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
      description: 'Entrate',
    });

    await expenseRepository.create({
      description: 'Spesa',
      amount: 1200,
      competenceYear: 2026,
      competenceMonth: 8,
      expenseDate: '2026-08-01',
      categoryId: 'cat1',
      subcategoryId: 'sub1',
      paymentMethod: 'debitCard',
      classification: 'necessary',
      status: 'planned',
      entryMode: 'manual',
      notified: false,
    });

    // Simulazione chiusura e riapertura DB
    await db.close();
    await db.open();

    const summary = await budgetService.calculateMonthlySummary(2026, 8);
    expect(summary.totalIncome).toBe(2000);
    expect(summary.totalExpenses).toBe(1200);
    expect(summary.savings).toBe(800);
  });
});
