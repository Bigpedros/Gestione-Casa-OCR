import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { contributorRepository } from '../repositories';
import type { Contributor } from '../types';

describe('Gestione Contributori - Test Obbligatori (TEST-001 - TEST-005)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('TEST-001: Inserire Pietro Bellotti, salvare e verificare presenza', async () => {
    const now = new Date().toISOString();
    const c1: Contributor = {
      id: 'contrib-1',
      order: 1,
      name: 'Pietro Bellotti',
      label: 'Stipendio Pietro',
      active: true,
      colorToken: '#4F46E5',
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await contributorRepository.saveAll([c1]);

    const activeContributors = await contributorRepository.getActive();
    expect(activeContributors).toHaveLength(1);
    expect(activeContributors[0].name).toBe('Pietro Bellotti');
  });

  it('TEST-002: Inserire secondo contribuente, salvare e verificare', async () => {
    const now = new Date().toISOString();
    const c1: Contributor = {
      id: 'contrib-1',
      order: 1,
      name: 'Pietro Bellotti',
      label: 'Stipendio Pietro',
      active: true,
      colorToken: '#4F46E5',
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Maria Rossi',
      label: 'Stipendio Maria',
      active: true,
      colorToken: '#0EA5E9',
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await contributorRepository.saveAll([c1, c2]);

    const activeContributors = await contributorRepository.getActive();
    expect(activeContributors).toHaveLength(2);
    expect(activeContributors.map((c) => c.name)).toEqual(['Pietro Bellotti', 'Maria Rossi']);
  });

  it('TEST-003: Aggiungere terzo contribuente e verificare', async () => {
    const now = new Date().toISOString();
    const c1: Contributor = {
      id: 'contrib-1',
      order: 1,
      name: 'Pietro Bellotti',
      label: 'Stipendio Pietro',
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Maria Rossi',
      label: 'Stipendio Maria',
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    const c3: Contributor = {
      id: 'contrib-3',
      order: 3,
      name: 'Giuseppe Verde',
      label: 'Stipendio Giuseppe',
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await contributorRepository.saveAll([c1, c2, c3]);

    const activeContributors = await contributorRepository.getActive();
    expect(activeContributors).toHaveLength(3);
    expect(activeContributors.map((c) => c.name)).toEqual([
      'Pietro Bellotti',
      'Maria Rossi',
      'Giuseppe Verde',
    ]);
  });

  it('TEST-004: Tentare di aggiungere un quarto contribuente -> Massimo tre contribuenti consentiti', async () => {
    const now = new Date().toISOString();
    const contributors = [1, 2, 3, 4].map((n) => ({
      id: `contrib-${n}`,
      order: n,
      name: `Contributore ${n}`,
      label: `Stipendio ${n}`,
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    }));

    await expect(contributorRepository.saveAll(contributors)).rejects.toThrow(
      'Massimo tre contribuenti consentiti',
    );

    // Verificare anche tramite contributorRepository.create
    await db.contributors.clear();
    await contributorRepository.create({
      order: 1,
      name: 'C1',
      label: 'S1',
      active: true,
    });
    await contributorRepository.create({
      order: 2,
      name: 'C2',
      label: 'S2',
      active: true,
    });
    await contributorRepository.create({
      order: 3,
      name: 'C3',
      label: 'S3',
      active: true,
    });

    await expect(
      contributorRepository.create({
        order: 4,
        name: 'C4',
        label: 'S4',
        active: true,
      }),
    ).rejects.toThrow('Massimo tre contribuenti consentiti');
  });

  it('TEST-005: Verificare la persistenza dei dati (riapertura/refresh)', async () => {
    const now = new Date().toISOString();
    const c1: Contributor = {
      id: 'contrib-1',
      order: 1,
      name: 'Pietro Bellotti',
      label: 'Stipendio Pietro',
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Maria Rossi',
      label: 'Stipendio Maria',
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await contributorRepository.saveAll([c1, c2]);

    // Simula riavvio o riapertura riconnettendo la DB
    await db.close();
    await db.open();

    const contributorsAfterRestart = await contributorRepository.getAll();
    expect(contributorsAfterRestart).toHaveLength(2);
    expect(contributorsAfterRestart[0].name).toBe('Pietro Bellotti');
    expect(contributorsAfterRestart[1].name).toBe('Maria Rossi');
  });
});
