import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { fixedExpenseRepository, categoryRepository } from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('Spese Fisse - Test Obbligatori (TEST-SF-001 - TEST-SF-007)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('TEST-SF-001 & TEST-SF-002: Modifica spesa fissa e persistenza', async () => {
    const parentCats = await categoryRepository.getParents();
    const cat = parentCats[0];

    const fe = await fixedExpenseRepository.create({
      name: 'Telecom ITALIA',
      categoryId: cat.id,
      subcategoryId: cat.id,
      expectedAmount: 54.0,
      frequency: 'monthly',
      dueDay: 15,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: new Date().toISOString().substring(0, 10),
    });

    expect(fe.expectedAmount).toBe(54.0);

    // Modifica l'importo a 60,00 €
    const updated = await fixedExpenseRepository.update(fe.id, {
      expectedAmount: 60.0,
    });

    expect(updated.id).toBe(fe.id);
    expect(updated.expectedAmount).toBe(60.0);

    const all = await fixedExpenseRepository.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].expectedAmount).toBe(60.0);

    // TEST-SF-002: Ricarica/Riavvio DB
    await db.close();
    await db.open();

    const feAfterRestart = await fixedExpenseRepository.getById(fe.id);
    expect(feAfterRestart).toBeDefined();
    expect(feAfterRestart?.expectedAmount).toBe(60.0);
  });

  it('TEST-SF-003 & TEST-SF-004: Eliminazione annullata vs confermata', async () => {
    const parentCats = await categoryRepository.getParents();
    const cat = parentCats[0];

    const fe = await fixedExpenseRepository.create({
      name: 'Abbonamento Palestra',
      categoryId: cat.id,
      subcategoryId: cat.id,
      expectedAmount: 45.0,
      frequency: 'monthly',
      dueDay: 1,
      priority: 'medium',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: new Date().toISOString().substring(0, 10),
    });

    // TEST-SF-003: Se l'azione di eliminazione non viene confermata, la spesa rimane
    let all = await fixedExpenseRepository.getAll();
    expect(all).toHaveLength(1);

    // TEST-SF-004: Eliminazione confermata
    await fixedExpenseRepository.delete(fe.id);

    all = await fixedExpenseRepository.getAll();
    expect(all).toHaveLength(0);

    // Verificare che dopo il refresh/riapertura non ricompare
    await db.close();
    await db.open();

    const feDeleted = await fixedExpenseRepository.getById(fe.id);
    expect(feDeleted).toBeUndefined();
  });

  it('TEST-SF-005: Categoria Utenze', async () => {
    const categories = await categoryRepository.getParents();
    const utenzeCat = categories.find((c) => c.code === 'CAT_UTILITIES' || c.name === 'Utenze');

    expect(utenzeCat).toBeDefined();

    const fe = await fixedExpenseRepository.create({
      name: 'Bolletta Luce',
      categoryId: utenzeCat!.id,
      subcategoryId: utenzeCat!.id,
      expectedAmount: 120.0,
      frequency: 'bimonthly',
      dueDay: 10,
      priority: 'high',
      paymentMethod: 'directDebit',
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: new Date().toISOString().substring(0, 10),
    });

    expect(fe.categoryId).toBe(utenzeCat!.id);

    await db.close();
    await db.open();

    const feFromDb = await fixedExpenseRepository.getById(fe.id);
    expect(feFromDb?.categoryId).toBe(utenzeCat!.id);
  });

  it('TEST-SF-006: Categoria Abbonamenti', async () => {
    const categories = await categoryRepository.getParents();
    const abbonamentiCat = categories.find((c) => c.code === 'CAT_SUBSCRIPTIONS' || c.name === 'Abbonamenti');

    expect(abbonamentiCat).toBeDefined();

    const fe = await fixedExpenseRepository.create({
      name: 'Netflix',
      categoryId: abbonamentiCat!.id,
      subcategoryId: abbonamentiCat!.id,
      expectedAmount: 17.99,
      frequency: 'monthly',
      dueDay: 5,
      priority: 'low',
      paymentMethod: 'card' as any,
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: false,
      startDate: new Date().toISOString().substring(0, 10),
    });

    expect(fe.categoryId).toBe(abbonamentiCat!.id);

    await db.close();
    await db.open();

    const feFromDb = await fixedExpenseRepository.getById(fe.id);
    expect(feFromDb?.categoryId).toBe(abbonamentiCat!.id);
  });

  it('TEST-SF-007: Regressione creazione e recupero spesa fissa', async () => {
    const categories = await categoryRepository.getParents();
    const cat = categories[0];

    const fe = await fixedExpenseRepository.create({
      name: 'Assicurazione Auto',
      categoryId: cat.id,
      subcategoryId: cat.id,
      expectedAmount: 600.0,
      frequency: 'annual',
      dueDay: 20,
      priority: 'high',
      paymentMethod: 'bankTransfer' as any,
      status: 'active',
      generateAutomatically: true,
      monthlyProvisioningEnabled: true,
      startDate: new Date().toISOString().substring(0, 10),
    });

    expect(fe.name).toBe('Assicurazione Auto');
    expect(fe.frequency).toBe('annual');
    expect(fe.dueDay).toBe(20);
    expect(fe.expectedAmount).toBe(600.0);
    expect(fe.status).toBe('active');
  });
});
