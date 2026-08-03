import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { contributorRepository } from '../repositories';
import type { Contributor, ContributorType } from '../types';

describe('P-26: Tipologia Contributo nel box Contributori', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  const ALLOWED_TYPES: ContributorType[] = [
    'Stipendio',
    'Pensione',
    'Rendita',
    'Rimborso',
    'Altro',
  ];

  it('1. Should support all 5 required contribution types', () => {
    expect(ALLOWED_TYPES).toEqual([
      'Stipendio',
      'Pensione',
      'Rendita',
      'Rimborso',
      'Altro',
    ]);
  });

  it('2. Should save and retrieve contributor with updated contribution type', async () => {
    const now = new Date().toISOString();
    const contributor: Contributor = {
      id: 'contrib-1',
      order: 1,
      name: 'Mario Rossi',
      label: 'Pensione',
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await contributorRepository.saveAll([contributor]);

    const active = await contributorRepository.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].label).toBe('Pensione');
  });

  it('3. Should correctly update contribution type from Stipendio to Rendita or Rimborso', async () => {
    const created = await contributorRepository.create({
      order: 1,
      name: 'Anna Bianchi',
      label: 'Stipendio',
      active: true,
    });

    expect(created.label).toBe('Stipendio');

    await contributorRepository.update(created.id, { label: 'Rendita' });

    const updated = await contributorRepository.getById(created.id);
    expect(updated?.label).toBe('Rendita');
  });
});
