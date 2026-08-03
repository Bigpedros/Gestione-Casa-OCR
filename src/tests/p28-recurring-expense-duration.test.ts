import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { fixedExpenseRepository, categoryRepository } from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import {
  validateDurationMonths,
  calculateEndMonthYear,
  formatRecurringSummary,
} from '../utils/recurringExpenseUtils';
import { budgetService } from '../services/budgetService';

describe('P-28: Durata in mesi per le Spese Ricorrenti', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('TEST CASE 1: Validazione durata vuota / null / undefined', () => {
    expect(validateDurationMonths('')).toBe('Indica la durata della spesa ricorrente.');
    expect(validateDurationMonths(null)).toBe('Indica la durata della spesa ricorrente.');
    expect(validateDurationMonths(undefined)).toBe('Indica la durata della spesa ricorrente.');
  });

  it('TEST CASE 2: Validazione durata pari a 0', () => {
    expect(validateDurationMonths(0)).toBe('La durata deve essere maggiore di 0 mesi.');
  });

  it('TEST CASE 3: Validazione durata negativa', () => {
    expect(validateDurationMonths(-3)).toBe('La durata deve essere maggiore di 0 mesi.');
  });

  it('TEST CASE 4: Validazione durata decimale', () => {
    expect(validateDurationMonths(6.5)).toBe(
      'La durata deve essere espressa con un numero intero di mesi.'
    );
  });

  it('TEST CASE 5: Calcolo fine periodo nello stesso anno (es. 1 mese / 3 mesi)', () => {
    // Inizio Maggio 2026, durata 3 mesi -> Maggio, Giugno, Luglio 2026
    const res = calculateEndMonthYear(5, 2026, 3);
    expect(res).toEqual({ endMonth: 7, endYear: 2026 });

    const summary = formatRecurringSummary(5, 2026, 3);
    expect(summary).toContain('3 mesi');
    expect(summary).toContain('Maggio 2026');
    expect(summary).toContain('Luglio 2026');
  });

  it('TEST CASE 6: Calcolo fine periodo a cavallo d\'anno (Agosto 2026, 6 mesi -> Gennaio 2027)', () => {
    const res = calculateEndMonthYear(8, 2026, 6);
    expect(res).toEqual({ endMonth: 1, endYear: 2027 });

    const summary = formatRecurringSummary(8, 2026, 6);
    expect(summary).toContain('6 mesi');
    expect(summary).toContain('Agosto 2026');
    expect(summary).toContain('Gennaio 2027');
  });

  it('TEST CASE 7, 8 & 9: Generazione movimenti per 6 mesi consecutivi, visibilità in Home e nessun movimento oltre', async () => {
    const categories = await categoryRepository.getParents();
    const catId = categories[0].id;
    const subCats = await categoryRepository.getSubcategories(catId);
    const subId = subCats[0]?.id || catId;

    const { endMonth, endYear } = calculateEndMonthYear(8, 2026, 6);

    const createdFe = await fixedExpenseRepository.create({
      name: 'Prestito Auto',
      categoryId: catId,
      subcategoryId: subId,
      expectedAmount: 250,
      frequency: 'monthly',
      dueDay: 15,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startMonth: 8,
      startYear: 2026,
      durationMonths: 6,
      endMonth,
      endYear,
      startDate: '2026-08-01',
      endDate: '2027-01-31',
    });

    await budgetService.ensureRecurringExpenseMovements(createdFe.id);

    // Verifichiamo i movimenti da Agosto 2026 a Gennaio 2027
    const monthsToTest = [
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ];

    for (const { year, month } of monthsToTest) {
      const expenses = await db.expenses
        .where('[competenceYear+competenceMonth]')
        .equals([year, month])
        .toArray();

      const feMovements = expenses.filter((e) => e.fixedExpenseId === createdFe.id);
      expect(feMovements.length).toBe(1);
      expect(feMovements[0].amount).toBe(250);
      expect(feMovements[0].status).toBe('planned');
    }

    // Febbraio 2027 (mese successivo la fine) NON deve avere movimenti per questa spesa
    const feb2027Expenses = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([2027, 2])
      .toArray();

    const febMovements = feb2027Expenses.filter((e) => e.fixedExpenseId === createdFe.id);
    expect(febMovements.length).toBe(0);
  });

  it('TEST CASE 10: Modifica durata con aumento mesi (da 6 a 8 mesi)', async () => {
    const categories = await categoryRepository.getParents();
    const catId = categories[0].id;
    const subCats = await categoryRepository.getSubcategories(catId);
    const subId = subCats[0]?.id || catId;

    let { endMonth, endYear } = calculateEndMonthYear(8, 2026, 6);

    const fe = await fixedExpenseRepository.create({
      name: 'Corso di Formazione',
      categoryId: catId,
      subcategoryId: subId,
      expectedAmount: 100,
      frequency: 'monthly',
      dueDay: 10,
      priority: 'medium',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startMonth: 8,
      startYear: 2026,
      durationMonths: 6,
      endMonth,
      endYear,
      startDate: '2026-08-01',
      endDate: '2027-01-31',
    });

    await budgetService.ensureRecurringExpenseMovements(fe.id);

    // Aumento durata a 8 mesi (Gennaio -> Marzo 2027)
    const newEnd = calculateEndMonthYear(8, 2026, 8);
    await fixedExpenseRepository.update(fe.id, {
      durationMonths: 8,
      endMonth: newEnd.endMonth,
      endYear: newEnd.endYear,
    });

    await budgetService.ensureRecurringExpenseMovements(fe.id);

    // Ora anche Febbraio e Marzo 2027 devono avere il movimento
    const feb2027 = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([2027, 2])
      .toArray();
    expect(feb2027.filter((e) => e.fixedExpenseId === fe.id).length).toBe(1);

    const mar2027 = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([2027, 3])
      .toArray();
    expect(mar2027.filter((e) => e.fixedExpenseId === fe.id).length).toBe(1);
  });

  it('TEST CASE 11: Modifica durata con riduzione mesi (da 6 a 4 mesi)', async () => {
    const categories = await categoryRepository.getParents();
    const catId = categories[0].id;
    const subCats = await categoryRepository.getSubcategories(catId);
    const subId = subCats[0]?.id || catId;

    let { endMonth, endYear } = calculateEndMonthYear(8, 2026, 6);

    const fe = await fixedExpenseRepository.create({
      name: 'Abbonamento Palestra',
      categoryId: catId,
      subcategoryId: subId,
      expectedAmount: 50,
      frequency: 'monthly',
      dueDay: 5,
      priority: 'low',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startMonth: 8,
      startYear: 2026,
      durationMonths: 6,
      endMonth,
      endYear,
      startDate: '2026-08-01',
      endDate: '2027-01-31',
    });

    await budgetService.ensureRecurringExpenseMovements(fe.id);

    // Riduciamo durata a 4 mesi (Agosto, Settembre, Ottobre, Novembre 2026)
    const newEnd = calculateEndMonthYear(8, 2026, 4);
    await fixedExpenseRepository.update(fe.id, {
      durationMonths: 4,
      endMonth: newEnd.endMonth,
      endYear: newEnd.endYear,
    });

    await budgetService.ensureRecurringExpenseMovements(fe.id);

    // Dicembre 2026 e Gennaio 2027 devono essere stati rimossi
    const dec2026 = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([2026, 12])
      .toArray();
    expect(dec2026.filter((e) => e.fixedExpenseId === fe.id).length).toBe(0);

    const jan2027 = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([2027, 1])
      .toArray();
    expect(jan2027.filter((e) => e.fixedExpenseId === fe.id).length).toBe(0);
  });

  it('TEST CASE 12: Interruzione e cancellazione spesa con pulizia movimenti futuri', async () => {
    const categories = await categoryRepository.getParents();
    const catId = categories[0].id;
    const subCats = await categoryRepository.getSubcategories(catId);
    const subId = subCats[0]?.id || catId;

    const { endMonth, endYear } = calculateEndMonthYear(8, 2026, 6);

    const fe = await fixedExpenseRepository.create({
      name: 'Noleggio Attrezzatura',
      categoryId: catId,
      subcategoryId: subId,
      expectedAmount: 120,
      frequency: 'monthly',
      dueDay: 20,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startMonth: 8,
      startYear: 2026,
      durationMonths: 6,
      endMonth,
      endYear,
      startDate: '2026-08-01',
      endDate: '2027-01-31',
    });

    await budgetService.ensureRecurringExpenseMovements(fe.id);

    // Cancellazione con command
    await budgetService.deleteFixedExpenseAndFutureMovements(fe.id);

    // La spesa fissa non deve più esistere
    const deletedFe = await db.fixedExpenses.get(fe.id);
    expect(deletedFe).toBeUndefined();

    // I movimenti pianificati devono essere stati rimossi
    const allExpenses = await db.expenses.where('fixedExpenseId').equals(fe.id).toArray();
    expect(allExpenses.length).toBe(0);
  });

  it('TEST CASE 13: Gestione del giorno di scadenza per mesi più corti (giorno 31 in Febbraio)', async () => {
    const categories = await categoryRepository.getParents();
    const catId = categories[0].id;
    const subCats = await categoryRepository.getSubcategories(catId);
    const subId = subCats[0]?.id || catId;

    // Inizio Gennaio 2026, giorno di scadenza 31, durata 2 mesi (Gennaio e Febbraio)
    const { endMonth, endYear } = calculateEndMonthYear(1, 2026, 2);

    const fe = await fixedExpenseRepository.create({
      name: 'Assicurazione Veloce',
      categoryId: catId,
      subcategoryId: subId,
      expectedAmount: 80,
      frequency: 'monthly',
      dueDay: 31,
      priority: 'medium',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startMonth: 1,
      startYear: 2026,
      durationMonths: 2,
      endMonth,
      endYear,
      startDate: '2026-01-01',
      endDate: '2026-02-28',
    });

    await budgetService.ensureRecurringExpenseMovements(fe.id);

    // Per Gennaio 2026, la data della spesa deve essere 2026-01-31
    const janExp = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([2026, 1])
      .toArray();
    const janFe = janExp.find((e) => e.fixedExpenseId === fe.id);
    expect(janFe?.expenseDate).toBe('2026-01-31');

    // Per Febbraio 2026 (non bisestile), la data deve essere clampata a 2026-02-28
    const febExp = await db.expenses
      .where('[competenceYear+competenceMonth]')
      .equals([2026, 2])
      .toArray();
    const febFe = febExp.find((e) => e.fixedExpenseId === fe.id);
    expect(febFe?.expenseDate).toBe('2026-02-28');
  });

  it('TEST CASE 14: Idempotenza e assenza di duplicati', async () => {
    const categories = await categoryRepository.getParents();
    const catId = categories[0].id;
    const subCats = await categoryRepository.getSubcategories(catId);
    const subId = subCats[0]?.id || catId;

    const { endMonth, endYear } = calculateEndMonthYear(8, 2026, 3);

    const fe = await fixedExpenseRepository.create({
      name: 'Riscaldamento',
      categoryId: catId,
      subcategoryId: subId,
      expectedAmount: 150,
      frequency: 'monthly',
      dueDay: 1,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startMonth: 8,
      startYear: 2026,
      durationMonths: 3,
      endMonth,
      endYear,
      startDate: '2026-08-01',
      endDate: '2026-10-31',
    });

    // Chiamiamo 3 volte di seguito la sync
    await budgetService.ensureRecurringExpenseMovements(fe.id);
    await budgetService.ensureRecurringExpenseMovements(fe.id);
    await budgetService.ensureRecurringExpenseMovements(fe.id);

    // Ogni mese deve contenere esattamente 1 movimento
    for (const m of [8, 9, 10]) {
      const expenses = await db.expenses
        .where('[competenceYear+competenceMonth]')
        .equals([2026, m])
        .toArray();
      const match = expenses.filter((e) => e.fixedExpenseId === fe.id);
      expect(match.length).toBe(1);
    }
  });

  it('TEST CASE 15: Persistenza su IndexedDB dei campi startMonth, startYear, durationMonths, endMonth, endYear', async () => {
    const categories = await categoryRepository.getParents();
    const catId = categories[0].id;
    const subCats = await categoryRepository.getSubcategories(catId);
    const subId = subCats[0]?.id || catId;

    const fe = await fixedExpenseRepository.create({
      name: 'Streaming Premium',
      categoryId: catId,
      subcategoryId: subId,
      expectedAmount: 15,
      frequency: 'monthly',
      dueDay: 12,
      priority: 'low',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startMonth: 9,
      startYear: 2026,
      durationMonths: 12,
      endMonth: 8,
      endYear: 2027,
      startDate: '2026-09-01',
      endDate: '2027-08-31',
    });

    const loaded = await db.fixedExpenses.get(fe.id);
    expect(loaded?.startMonth).toBe(9);
    expect(loaded?.startYear).toBe(2026);
    expect(loaded?.durationMonths).toBe(12);
    expect(loaded?.endMonth).toBe(8);
    expect(loaded?.endYear).toBe(2027);
  });
});
