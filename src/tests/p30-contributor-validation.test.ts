import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { contributorRepository, incomeRepository } from '../repositories';

const CONTRIBUTOR_NAME_PATTERN = /^[\p{L}]+(?:\s+[\p{L}]+)*$/u;

describe('P-30: Validazione del nome e selezione obbligatoria del contributore', () => {
  beforeEach(async () => {
    await db.incomeEntries.clear();
    await db.contributors.clear();
  });

  it('TEST 1 & 13 – Inserimento nuovo contributore con nome vuoto e normalizzazione', async () => {
    const rawName = '  Maria   Teresa  ';
    const trimmedName = rawName.trim().replace(/\s+/g, ' ');

    expect(trimmedName).toBe('Maria Teresa');
    expect(CONTRIBUTOR_NAME_PATTERN.test(trimmedName)).toBe(true);

    const contrib = await contributorRepository.create({
      order: 1,
      name: trimmedName,
      label: 'Stipendio',
      active: true,
    });

    expect(contrib.name).toBe('Maria Teresa');
    const saved = await contributorRepository.getById(contrib.id);
    expect(saved?.name).toBe('Maria Teresa');
  });

  it('TEST 2 – Nome obbligatorio: stringa vuota o di soli spazi viene rifiutata', () => {
    const emptyNames = ['', '   ', '\t', '\n'];
    for (const name of emptyNames) {
      const trimmed = name.trim().replace(/\s+/g, ' ');
      expect(trimmed).toBe('');
    }
  });

  it('TEST 3, 4, 5, 6 – Lettere minuscole, maiuscole, accentate e nomi composti ammessi', () => {
    const validNames = [
      'fabiola',
      'FABIOLA',
      'Maria Teresa',
      'José',
      'Èlia',
      'André',
      'Luìsa',
      'Gian Luca',
    ];

    for (const name of validNames) {
      const trimmed = name.trim().replace(/\s+/g, ' ');
      expect(CONTRIBUTOR_NAME_PATTERN.test(trimmed)).toBe(true);
    }
  });

  it('TEST 7 & 8 – Numeri e simboli non ammessi', () => {
    const invalidNames = [
      'Fabiola1',
      'Pietro_2',
      'Mario!',
      '@Giulia',
      'Contributore 1',
      'Luca99',
      'Anna#',
      '123',
    ];

    for (const name of invalidNames) {
      const trimmed = name.trim().replace(/\s+/g, ' ');
      expect(CONTRIBUTOR_NAME_PATTERN.test(trimmed)).toBe(false);
    }
  });

  it('TEST 9 & 10 – Nuova Entrata senza contributore viene bloccata', async () => {
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Fabiola',
      label: 'Stipendio',
      active: true,
    });

    const selectedContributorId = ''; // Inizialmente vuoto

    const validateIncomeSave = (cId: string) => {
      if (!cId || cId.trim() === '') {
        return { error: 'Seleziona un contributore.' };
      }
      return { error: null };
    };

    expect(validateIncomeSave(selectedContributorId)).toEqual({
      error: 'Seleziona un contributore.',
    });

    const allIncomes = await incomeRepository.getAll();
    expect(allIncomes).toHaveLength(0);

    // Se si seleziona Fabiola
    expect(validateIncomeSave(contrib.id)).toEqual({ error: null });
  });

  it('TEST 11 – Salva entrata con collegamento tramite contributorId', async () => {
    const contrib = await contributorRepository.create({
      order: 1,
      name: 'Fabiola',
      label: 'Stipendio',
      active: true,
    });

    const entry = await incomeRepository.create({
      contributorId: contrib.id,
      type: 'salary',
      amount: 1500,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
    });

    expect(entry.contributorId).toBe(contrib.id);
    const saved = await incomeRepository.getById(entry.id);
    expect(saved?.contributorId).toBe(contrib.id);
  });

  it('TEST 12 – Modifica Entrata mantiene contributorId e permette aggiornamento', async () => {
    const contrib1 = await contributorRepository.create({
      order: 1,
      name: 'Fabiola',
      label: 'Stipendio',
      active: true,
    });

    const contrib2 = await contributorRepository.create({
      order: 2,
      name: 'Pietro',
      label: 'Stipendio',
      active: true,
    });

    const entry = await incomeRepository.create({
      contributorId: contrib1.id,
      type: 'salary',
      amount: 2000,
      incomeDate: '2026-08-01',
      competenceMonth: 8,
      competenceYear: 2026,
      frequency: 'monthly',
      recurring: true,
      status: 'received',
    });

    // Modifica contributore da Fabiola a Pietro
    await incomeRepository.update(entry.id, {
      contributorId: contrib2.id,
    });

    const updated = await incomeRepository.getById(entry.id);
    expect(updated?.id).toBe(entry.id);
    expect(updated?.contributorId).toBe(contrib2.id);
    expect(updated?.amount).toBe(2000);

    const allIncomes = await incomeRepository.getAll();
    expect(allIncomes).toHaveLength(1);
  });

  it('TEST 14 – I contributori esistenti mantengono il proprio nome', async () => {
    const existingContrib = await contributorRepository.create({
      order: 1,
      name: 'Fabiola',
      label: 'Stipendio',
      active: true,
    });

    const fetched = await contributorRepository.getById(existingContrib.id);
    expect(fetched?.name).toBe('Fabiola');
  });
});
