import { describe, it, expect } from 'vitest';
import { isUnusedPlaceholderContributor, filterVisibleContributors } from '../utils/contributorUtils';
import type { Contributor } from '../types';

describe('contributorUtils - Riconoscimento placeholder e filtro contributori visibili', () => {
  const now = new Date().toISOString();

  const baseContrib1: Contributor = {
    id: 'contrib-1',
    order: 1,
    name: 'Contributore 1',
    label: 'Stipendio 1',
    active: true,
    metadata: { createdAt: now, updatedAt: now, version: 1 },
  };

  it('1. Contributore 1 con order === 1 non è MAI un placeholder inutilizzato', () => {
    const c1: Contributor = { ...baseContrib1, active: false, name: '', email: '' };
    expect(isUnusedPlaceholderContributor(c1)).toBe(false);
  });

  it('2. Contributore 2 attivo (active === true) non è un placeholder inutilizzato', () => {
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Contributore 2',
      email: 'nome@esempio.com',
      label: 'Stipendio',
      active: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    expect(isUnusedPlaceholderContributor(c2)).toBe(false);
  });

  it('3. Contributore 2 inattivo con valori default/placeholder (nome@esempio.com, Contributore 2) È un placeholder inutilizzato', () => {
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Contributore 2',
      email: 'nome@esempio.com',
      label: 'Stipendio',
      active: false,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    expect(isUnusedPlaceholderContributor(c2)).toBe(true);
  });

  it('4. Contributore 2 inattivo con nome generico "Secondo Contributore" ed email vuota È un placeholder inutilizzato', () => {
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Secondo Contributore',
      email: '',
      label: 'Stipendio',
      active: false,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    expect(isUnusedPlaceholderContributor(c2)).toBe(true);
  });

  it('5. Contributore 2 inattivo con nome personalizzato ("Maria Rossi") NON è un placeholder', () => {
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Maria Rossi',
      email: '',
      label: 'Stipendio',
      active: false,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    expect(isUnusedPlaceholderContributor(c2)).toBe(false);
  });

  it('6. Contributore 2 inattivo con email reale ("maria@gmail.com") NON è un placeholder', () => {
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Contributore 2',
      email: 'maria@gmail.com',
      label: 'Stipendio',
      active: false,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    expect(isUnusedPlaceholderContributor(c2)).toBe(false);
  });

  it('7. Contributore 2 inattivo con preferenze notifiche attive NON è un placeholder', () => {
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Contributore 2',
      email: 'nome@esempio.com',
      label: 'Stipendio',
      active: false,
      receiveDeadlineEmails: true,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    expect(isUnusedPlaceholderContributor(c2)).toBe(false);
  });

  it('8. Contributore 2 inattivo ma presente in referencedIds (ha movimenti/entrate) NON è un placeholder', () => {
    const c2: Contributor = {
      id: 'contrib-2',
      order: 2,
      name: 'Contributore 2',
      email: 'nome@esempio.com',
      label: 'Stipendio',
      active: false,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };
    const referenced = new Set(['contrib-2']);
    expect(isUnusedPlaceholderContributor(c2, referenced)).toBe(false);
  });

  it('9. filterVisibleContributors filtra correttamente i placeholder inattivi', () => {
    const list: Contributor[] = [
      baseContrib1,
      {
        id: 'contrib-2',
        order: 2,
        name: 'Contributore 2',
        email: 'nome@esempio.com',
        label: 'Stipendio',
        active: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
      {
        id: 'contrib-3',
        order: 3,
        name: 'Contributore 3',
        email: '',
        label: 'Stipendio',
        active: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
    ];

    const visible = filterVisibleContributors(list);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('contrib-1');
  });

  it('10. filterVisibleContributors preserva contributori reali inattivi assieme a quelli attivi', () => {
    const list: Contributor[] = [
      baseContrib1,
      {
        id: 'contrib-2',
        order: 2,
        name: 'Maria Rossi',
        email: 'maria@rossi.it',
        label: 'Stipendio',
        active: false,
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      },
    ];

    const visible = filterVisibleContributors(list);
    expect(visible).toHaveLength(2);
    expect(visible[0].id).toBe('contrib-1');
    expect(visible[1].id).toBe('contrib-2');
  });
});
