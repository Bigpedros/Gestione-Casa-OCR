import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { incomeRepository, contributorRepository } from '../repositories';
import {
  INCOME_TYPE_OPTIONS,
  normalizeIncomeType,
  mapContributorLabelToIncomeType,
  getIncomeTypeLabel,
} from '../utils/incomeTypeUtils';

describe('P-29: Menu Tipologia di Entrata nel form Nuova Entrata Contributore', () => {
  beforeEach(async () => {
    await db.incomeEntries.clear();
    await db.contributors.clear();
  });

  it('TEST 2 – Le opzioni disponibili sono esattamente 6 ed in italiano', () => {
    expect(INCOME_TYPE_OPTIONS).toHaveLength(6);
    const labels = INCOME_TYPE_OPTIONS.map((o) => o.label);
    expect(labels).toEqual([
      'Stipendio',
      'Pensione',
      'Reddito',
      'Rimborso',
      'Contributo straordinario',
      'Altro',
    ]);
  });

  it('TEST 3 – Preseleziona Pensione se il contributore ha Tipologia Contributo "Pensione"', () => {
    const defaultType = mapContributorLabelToIncomeType('Pensione');
    expect(defaultType).toBe('pension');
    expect(getIncomeTypeLabel(defaultType)).toBe('Pensione');
  });

  it('TEST 4 – Preseleziona Reddito se il contributore ha Tipologia Contributo "Rendita"', () => {
    const defaultType = mapContributorLabelToIncomeType('Rendita');
    expect(defaultType).toBe('income');
    expect(getIncomeTypeLabel(defaultType)).toBe('Reddito');
  });

  it('TEST 5 – Selezione manuale e salvataggio "Contributo straordinario"', async () => {
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Mario Rossi',
      label: 'Stipendio',
      active: true,
    });

    const entry = await incomeRepository.create({
      contributorId: contrib.id,
      type: 'extraordinary_contribution',
      amount: 500,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: false,
      status: 'received',
    });

    expect(entry.type).toBe('extraordinary_contribution');
    expect(getIncomeTypeLabel(entry.type)).toBe('Contributo straordinario');

    const saved = await incomeRepository.getById(entry.id);
    expect(saved?.type).toBe('extraordinary_contribution');
  });

  it('TEST 6 – Modifica tipologia da "Stipendio" a "Rimborso" senza creare duplicati o cambiare importo', async () => {
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Luigi Verdi',
      label: 'Stipendio',
      active: true,
    });

    const entry = await incomeRepository.create({
      contributorId: contrib.id,
      type: 'salary',
      amount: 1200,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
    });

    await incomeRepository.update(entry.id, {
      type: 'refund',
    });

    const updated = await incomeRepository.getById(entry.id);
    expect(updated?.id).toBe(entry.id);
    expect(updated?.type).toBe('refund');
    expect(updated?.amount).toBe(1200);
    expect(getIncomeTypeLabel(updated?.type)).toBe('Rimborso');

    const allIncomes = await incomeRepository.getAll();
    expect(allIncomes).toHaveLength(1);
  });

  it('TEST 8 – Normalizzazione sicura di dati storici/legacy', () => {
    expect(normalizeIncomeType('stipendio')).toBe('salary');
    expect(normalizeIncomeType('Stipendio 1')).toBe('salary');
    expect(normalizeIncomeType('Stipendio 2')).toBe('salary');
    expect(normalizeIncomeType('salary')).toBe('salary');

    expect(normalizeIncomeType('pensione')).toBe('pension');
    expect(normalizeIncomeType('pension')).toBe('pension');

    expect(normalizeIncomeType('reddito')).toBe('income');
    expect(normalizeIncomeType('rendita')).toBe('income');
    expect(normalizeIncomeType('annuity')).toBe('income');
    expect(normalizeIncomeType('rentalIncome')).toBe('income');

    expect(normalizeIncomeType('rimborso')).toBe('refund');
    expect(normalizeIncomeType('refund')).toBe('refund');

    expect(normalizeIncomeType('contributo straordinario')).toBe('extraordinary_contribution');
    expect(normalizeIncomeType('extraordinary_contribution')).toBe('extraordinary_contribution');
    expect(normalizeIncomeType('bonus')).toBe('extraordinary_contribution');

    expect(normalizeIncomeType('valore_sconosciuto')).toBe('other');
    expect(normalizeIncomeType('')).toBe('salary');
    expect(normalizeIncomeType('', 'Pensione')).toBe('pension');
  });

  it('TEST 9 – Calcoli totali: tutte le tipologie vengono sommate nel totale entrate', async () => {
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Test Contrib',
      active: true,
    });

    const types = ['salary', 'pension', 'income', 'refund', 'extraordinary_contribution', 'other'];
    let expectedTotal = 0;

    for (let i = 0; i < types.length; i++) {
      const amount = (i + 1) * 100;
      expectedTotal += amount;
      await incomeRepository.create({
        contributorId: contrib.id,
        type: types[i],
        amount,
        incomeDate: '2026-08-01',
        competenceMonth: 8,
        competenceYear: 2026,
        frequency: 'monthly',
        recurring: false,
        status: 'received',
      });
    }

    const monthIncomes = await incomeRepository.getByMonthYear(2026, 8);
    expect(monthIncomes).toHaveLength(6);

    const total = monthIncomes
      .filter((inc) => inc.status === 'received')
      .reduce((sum, inc) => sum + inc.amount, 0);

    expect(total).toBe(expectedTotal);
    expect(total).toBe(2100);
  });
});
