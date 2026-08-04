import { describe, it, expect, beforeEach } from 'vitest';
import { licenseService, DEFAULT_LICENSE_RECORD } from '../services/licenseService';
import { LicenseRecord, LicenseStatus, LicenseType } from '../types/license';

describe('Architettura del Sistema Licenze - Punto 1', () => {
  beforeEach(() => {
    licenseService.deactivate();
  });

  it('L1-01: Creazione modello di default e inizializzazione', async () => {
    const initialState = await licenseService.initialize();
    expect(initialState).toBeDefined();
    expect(initialState.status).toBe('not_activated');
    expect(initialState.licenseType).toBe('beta_60_days');
    expect(initialState.licenseId).toBe('');
    expect(initialState.owner).toBe('');
  });

  it('L1-02: Lettura, scrittura e aggiornamento dello stato licenza', () => {
    const record: LicenseRecord = {
      licenseId: 'LIC-BETA-2026',
      licenseType: 'beta_60_days',
      activationDate: new Date().toISOString(),
      expirationDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'beta_active',
      remainingDays: 60,
      version: '1.0.0',
      owner: 'Mario Rossi',
      notes: 'Test attivazione beta 60 giorni',
      lastCheck: new Date().toISOString(),
    };

    licenseService.save(record);
    const retrieved = licenseService.getState();

    expect(retrieved.licenseId).toBe('LIC-BETA-2026');
    expect(retrieved.status).toBe('beta_active');
    expect(retrieved.owner).toBe('Mario Rossi');
    expect(retrieved.remainingDays).toBe(60);
  });

  it('L1-03: Serializzazione e deserializzazione JSON', () => {
    const record: LicenseRecord = {
      ...DEFAULT_LICENSE_RECORD,
      licenseId: 'LIC-SER-999',
      licenseType: 'lifetime_perpetual',
      status: 'perpetual_active',
      owner: 'Azienda SRL',
    };

    const serialized = licenseService.serialize(record);
    expect(typeof serialized).toBe('string');
    expect(serialized).toContain('LIC-SER-999');

    const deserialized = licenseService.deserialize(serialized);
    expect(deserialized.licenseId).toBe('LIC-SER-999');
    expect(deserialized.licenseType).toBe('lifetime_perpetual');
    expect(deserialized.status).toBe('perpetual_active');
  });

  it('L1-04: Supporto per tutti i tipi di licenza (Beta 60, Definitiva, Annuale, Enterprise)', () => {
    const types: LicenseType[] = [
      'beta_60_days',
      'lifetime_perpetual',
      'annual',
      'enterprise',
    ];

    types.forEach((type) => {
      const activated = licenseService.activate({
        licenseId: `LIC-${type.toUpperCase()}`,
        licenseType: type,
        owner: 'Utente Test',
      });

      expect(activated.licenseType).toBe(type);
      if (type === 'lifetime_perpetual') {
        expect(activated.status).toBe('perpetual_active');
      } else {
        expect(activated.status).toBe('beta_active');
      }
    });
  });

  it('L1-05: Gestione corretta degli stati della licenza', () => {
    const statuses: LicenseStatus[] = [
      'not_activated',
      'beta_active',
      'beta_expired',
      'perpetual_active',
      'suspended',
      'invalid',
    ];

    statuses.forEach((status) => {
      const record: LicenseRecord = {
        ...DEFAULT_LICENSE_RECORD,
        licenseId: `LIC-${status}`,
        status,
      };

      licenseService.save(record);
      const validation = licenseService.validate(record);

      if (status === 'beta_active' || status === 'perpetual_active') {
        expect(validation.isValid).toBe(true);
      } else {
        expect(validation.isValid).toBe(false);
      }
      expect(validation.status).toBe(status);
    });
  });

  it('L1-06: Calcolo giorni rimanenti e rilevamento scadenza', () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const activeLicense = licenseService.activate({
      licenseId: 'LIC-EXP-TEST',
      licenseType: 'beta_60_days',
      expirationDate: futureDate,
    });

    const checkResult = licenseService.checkExpiration(activeLicense);
    expect(checkResult.isExpired).toBe(false);
    expect(checkResult.remainingDays).toBeGreaterThanOrEqual(9);

    // Test licenza scaduta nel passato
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const expiredLicense: LicenseRecord = {
      ...activeLicense,
      expirationDate: pastDate,
    };

    const expResult = licenseService.checkExpiration(expiredLicense);
    expect(expResult.isExpired).toBe(true);
    expect(expResult.remainingDays).toBe(0);

    const validation = licenseService.validate(expiredLicense);
    expect(validation.isValid).toBe(false);
    expect(validation.status).toBe('beta_expired');
  });

  it('L1-07: Estrazione informazioni pubbliche tramite getInfo', () => {
    licenseService.activate({
      licenseId: 'LIC-PUBLIC-INFO',
      licenseType: 'lifetime_perpetual',
      owner: 'Giuseppe Verdi',
    });

    const info = licenseService.getInfo();
    expect(info.licenseId).toBe('LIC-PUBLIC-INFO');
    expect(info.licenseType).toBe('lifetime_perpetual');
    expect(info.owner).toBe('Giuseppe Verdi');
    expect(info.isActive).toBe(true);
  });
});
