import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { fixedExpenseRepository, categoryRepository } from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { validateDueDay } from '../utils/dueDayValidation';
import { budgetService } from '../services/budgetService';

describe('P-27: Giorno di scadenza obbligatorio e dinamico nelle Spese Fisse', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('TEST 1 & 2: Validazione giorno vuoto', () => {
    const err = validateDueDay('', 1, 2026);
    expect(err).toBe('Indica il giorno di scadenza.');

    const errNull = validateDueDay(null as any, 1, 2026);
    expect(errNull).toBe('Indica il giorno di scadenza.');
  });

  it('TEST 3: Validazione valore zero', () => {
    const err = validateDueDay(0, 1, 2026);
    expect(err).toBe('Il giorno di scadenza deve essere maggiore di 0.');
  });

  it('TEST 4: Validazione valore negativo', () => {
    const err = validateDueDay(-1, 1, 2026);
    expect(err).toBe('Il giorno di scadenza deve essere maggiore di 0.');
  });

  it('TEST 5: Validazione valore decimale', () => {
    const errFloat = validateDueDay(15.5, 1, 2026);
    expect(errFloat).toBe('Il giorno di scadenza deve essere un numero intero.');
  });

  it('TEST 6: Mese con 31 giorni (Gennaio)', () => {
    const err = validateDueDay(31, 1, 2026);
    expect(err).toBeNull();
  });

  it('TEST 7: Mese con 30 giorni (Aprile)', () => {
    const errValid = validateDueDay(30, 4, 2026);
    expect(errValid).toBeNull();

    const errInvalid = validateDueDay(31, 4, 2026);
    expect(errInvalid).toBe(
      'Aprile contiene 30 giorni. Inserisci un valore compreso tra 1 e 30.'
    );
  });

  it('TEST 8: Febbraio non bisestile (2026)', () => {
    const errValid = validateDueDay(28, 2, 2026);
    expect(errValid).toBeNull();

    const errInvalid = validateDueDay(29, 2, 2026);
    expect(errInvalid).toBe(
      'Febbraio 2026 contiene 28 giorni. Inserisci un valore compreso tra 1 e 28.'
    );
  });

  it('TEST 9: Febbraio bisestile (2028)', () => {
    const errValid = validateDueDay(29, 2, 2028);
    expect(errValid).toBeNull();

    const errInvalid = validateDueDay(30, 2, 2028);
    expect(errInvalid).toBe(
      'Febbraio 2028 contiene 29 giorni. Inserisci un valore compreso tra 1 e 29.'
    );
  });

  it('TEST 10 & 11: Creazione, Modifica e Persistenza Spesa Fissa', async () => {
    const parentCats = await categoryRepository.getParents();
    const cat = parentCats[0];

    const fe = await fixedExpenseRepository.create({
      name: 'Affitto Casa',
      categoryId: cat.id,
      subcategoryId: cat.id,
      expectedAmount: 800,
      frequency: 'monthly',
      dueDay: 15,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: '2026-01-01',
    });

    expect(fe.dueDay).toBe(15);

    // Update dueDay to 28
    await fixedExpenseRepository.update(fe.id, { dueDay: 28 });

    const updated = await fixedExpenseRepository.getById(fe.id);
    expect(updated?.dueDay).toBe(28);

    // Persistence test
    await db.close();
    await db.open();

    const reloaded = await fixedExpenseRepository.getById(fe.id);
    expect(reloaded?.dueDay).toBe(28);
  });

  it('TEST 12: Normalizzazione scadenze per mesi futuri più corti', async () => {
    const parentCats = await categoryRepository.getParents();
    const cat = parentCats[0];

    // Spesa fissa configurata con giorno di scadenza 31
    const fe = await fixedExpenseRepository.create({
      name: 'Assicurazione Capodanno',
      categoryId: cat.id,
      subcategoryId: cat.id,
      expectedAmount: 100,
      frequency: 'monthly',
      dueDay: 31,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: '2026-01-01',
    });

    // Genera spese per Febbraio 2026 (28 giorni)
    await budgetService.ensureMonthlyExpenseMovements(2026, 2);
    const febExpenses = await db.expenses.where({ competenceYear: 2026, competenceMonth: 2 }).toArray();
    const feFeb = febExpenses.find((e) => e.fixedExpenseId === fe.id);
    expect(feFeb).toBeDefined();
    expect(feFeb?.expenseDate).toBe('2026-02-28');

    // Genera spese per Febbraio 2028 (29 giorni - bisestile)
    await budgetService.ensureMonthlyExpenseMovements(2028, 2);
    const feb28Expenses = await db.expenses.where({ competenceYear: 2028, competenceMonth: 2 }).toArray();
    const feFeb28 = feb28Expenses.find((e) => e.fixedExpenseId === fe.id);
    expect(feFeb28).toBeDefined();
    expect(feFeb28?.expenseDate).toBe('2028-02-29');

    // Genera spese per Aprile 2026 (30 giorni)
    await budgetService.ensureMonthlyExpenseMovements(2026, 4);
    const aprExpenses = await db.expenses.where({ competenceYear: 2026, competenceMonth: 4 }).toArray();
    const feApr = aprExpenses.find((e) => e.fixedExpenseId === fe.id);
    expect(feApr).toBeDefined();
    expect(feApr?.expenseDate).toBe('2026-04-30');
  });
});
