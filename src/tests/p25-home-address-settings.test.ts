import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { settingsRepository } from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('P-25: Sezione Abitazione nelle Impostazioni', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('1. Should save and retrieve home address in settings persistently', async () => {
    const initialSettings = await settingsRepository.get();
    expect(initialSettings.id).toBe('default-settings');

    const updated = await settingsRepository.update({
      homeAddress: {
        address: 'Via Roma',
        streetNumber: '25/A',
        postalCode: '00100',
      },
    });

    expect(updated.homeAddress?.address).toBe('Via Roma');
    expect(updated.homeAddress?.streetNumber).toBe('25/A');
    expect(updated.homeAddress?.postalCode).toBe('00100');

    // Reload from db
    const reloaded = await settingsRepository.get();
    expect(reloaded.homeAddress?.address).toBe('Via Roma');
    expect(reloaded.homeAddress?.streetNumber).toBe('25/A');
    expect(reloaded.homeAddress?.postalCode).toBe('00100');
  });

  it('2. Should preserve leading zero in postalCode string (e.g., "00100")', async () => {
    await settingsRepository.update({
      homeAddress: {
        address: 'Piazza Navona',
        streetNumber: '12',
        postalCode: '00186',
      },
    });

    const settings = await settingsRepository.get();
    expect(typeof settings.homeAddress?.postalCode).toBe('string');
    expect(settings.homeAddress?.postalCode).toBe('00186');
    expect(settings.homeAddress?.postalCode.startsWith('00')).toBe(true);
  });

  it('3. Should validate CAP strictly (5 numeric digits rule)', () => {
    const capRegex = /^\d{5}$/;

    expect(capRegex.test('00100')).toBe(true);
    expect(capRegex.test('20121')).toBe(true);

    // Invalid CAPs
    expect(capRegex.test('0100')).toBe(false); // 4 digits
    expect(capRegex.test('001000')).toBe(false); // 6 digits
    expect(capRegex.test('00A00')).toBe(false); // contains letter
    expect(capRegex.test('12 34')).toBe(false); // contains space
  });

  it('4. Should update existing address record without creating duplicates or clearing other settings', async () => {
    const beforeSettings = await settingsRepository.get();
    const themeBefore = beforeSettings.theme;

    // First save
    await settingsRepository.update({
      homeAddress: {
        address: 'Via Roma',
        streetNumber: '25/A',
        postalCode: '00100',
      },
    });

    // Second save (update street number to 27)
    await settingsRepository.update({
      homeAddress: {
        address: 'Via Roma',
        streetNumber: '27',
        postalCode: '00100',
      },
    });

    const allSettingsRecords = await db.settings.toArray();
    expect(allSettingsRecords.length).toBe(1); // Only 1 settings record!

    const current = await settingsRepository.get();
    expect(current.homeAddress?.streetNumber).toBe('27');
    expect(current.theme).toBe(themeBefore);
  });
});
