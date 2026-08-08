import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { settingsRepository, contactRequestRepository } from '../repositories';
import { getOrCreateDeviceId } from '../services/deviceService';
import { APP_CONFIG } from '../config/app.config';
import type { ContactRequestDocument } from '@gestione-casa/shared-sdk/contact-requests';

describe('Sottofase 2.5.A - Fondamenta di Sincronizzazione (Device ID & Repository Sync Primitives)', () => {
  beforeEach(async () => {
    await db.settings.clear();
    await db.contactRequests.clear();
  });

  describe('1. Device ID Persistente', () => {
    it('genera un nuovo Device ID con formato DEV-UUID se assente nelle impostazioni', async () => {
      const settingsBefore = await settingsRepository.get();
      expect(settingsBefore.deviceId).toBeUndefined();

      const deviceId = await getOrCreateDeviceId();
      expect(deviceId).toBeDefined();
      expect(deviceId.startsWith('DEV-')).toBe(true);
      expect(deviceId.length).toBeGreaterThan(10);

      const settingsAfter = await settingsRepository.get();
      expect(settingsAfter.deviceId).toBe(deviceId);
    });

    it('restituisce lo stesso Device ID senza rigenerarlo nelle chiamate successive', async () => {
      const firstDeviceId = await getOrCreateDeviceId();
      const secondDeviceId = await getOrCreateDeviceId();
      const thirdDeviceId = await getOrCreateDeviceId();

      expect(firstDeviceId).toBe(secondDeviceId);
      expect(secondDeviceId).toBe(thirdDeviceId);
    });

    it('riutilizza un deviceId preesistente memorizzato nelle impostazioni', async () => {
      const customDeviceId = 'DEV-custom-test-device-12345';
      await settingsRepository.update({ deviceId: customDeviceId });

      const deviceId = await getOrCreateDeviceId();
      expect(deviceId).toBe(customDeviceId);
    });
  });

  describe('2. Repository ContactRequest - Primitive di Sync', () => {
    const createSampleDoc = (id: string, syncStatus: 'pending' | 'synced' | 'conflict' = 'pending'): ContactRequestDocument => ({
      id,
      requestType: 'support',
      status: 'new',
      source: 'gestione_casa_ocr',
      displayName: 'Mario Rossi',
      firstName: 'Mario',
      lastName: 'Rossi',
      companyName: null,
      email: 'mario.rossi@example.com',
      phone: null,
      preferredContactChannel: 'email',
      subject: 'Richiesta di supporto',
      message: 'Messaggio di prova',
      privacyAcceptedAt: '2026-08-08T10:00:00.000Z',
      linkedCustomerId: null,
      linkedLicenseId: null,
      createdAt: '2026-08-08T10:00:00.000Z',
      updatedAt: '2026-08-08T10:00:00.000Z',
      reviewedAt: null,
      closedAt: null,
      sourceDeviceId: 'DEV-test-device-1',
      sourceAppVersion: APP_CONFIG.version,
      syncStatus,
      schemaVersion: 1,
      metadata: {},
    });

    it('getBySyncStatus, getPending e getConflicts filtrano correttamente i record per syncStatus', async () => {
      await contactRequestRepository.create(createSampleDoc('req_1', 'pending'));
      await contactRequestRepository.create(createSampleDoc('req_2', 'synced'));
      await contactRequestRepository.create(createSampleDoc('req_3', 'conflict'));
      await contactRequestRepository.create(createSampleDoc('req_4', 'pending'));

      const pendingList = await contactRequestRepository.getPending();
      expect(pendingList).toHaveLength(2);
      expect(pendingList.map((doc) => doc.id).sort()).toEqual(['req_1', 'req_4']);

      const syncedList = await contactRequestRepository.getBySyncStatus('synced');
      expect(syncedList).toHaveLength(1);
      expect(syncedList[0].id).toBe('req_2');

      const conflictList = await contactRequestRepository.getConflicts();
      expect(conflictList).toHaveLength(1);
      expect(conflictList[0].id).toBe('req_3');
    });

    it('markSynced imposta syncStatus a "synced" senza alterare i dati di business o updatedAt', async () => {
      const originalDoc = createSampleDoc('req_sync_test', 'pending');
      originalDoc.status = 'in_review';
      originalDoc.linkedCustomerId = 'cust_999';
      originalDoc.linkedLicenseId = 'lic_888';
      originalDoc.reviewedAt = '2026-08-08T11:00:00.000Z';

      await contactRequestRepository.create(originalDoc);

      const updated = await contactRequestRepository.markSynced('req_sync_test');

      expect(updated.syncStatus).toBe('synced');
      expect(updated.status).toBe('in_review');
      expect(updated.linkedCustomerId).toBe('cust_999');
      expect(updated.linkedLicenseId).toBe('lic_888');
      expect(updated.reviewedAt).toBe('2026-08-08T11:00:00.000Z');
      expect(updated.subject).toBe('Richiesta di supporto');
      expect(updated.updatedAt).toBe('2026-08-08T10:00:00.000Z'); // updatedAt invariato!
    });

    it('markConflict imposta syncStatus a "conflict" preservando tutti gli altri campi e updatedAt', async () => {
      const originalDoc = createSampleDoc('req_conflict_test', 'pending');
      await contactRequestRepository.create(originalDoc);

      const updated = await contactRequestRepository.markConflict('req_conflict_test');

      expect(updated.syncStatus).toBe('conflict');
      expect(updated.status).toBe('new');
      expect(updated.updatedAt).toBe('2026-08-08T10:00:00.000Z'); // updatedAt invariato!
    });

    it('una modifica di business locale tramite update riporta syncStatus a "pending"', async () => {
      const syncedDoc = createSampleDoc('req_business_edit', 'synced');
      await contactRequestRepository.create(syncedDoc);

      const updated = await contactRequestRepository.update('req_business_edit', {
        subject: 'Oggetto modificato dall’utente',
      });

      expect(updated.syncStatus).toBe('pending');
      expect(updated.subject).toBe('Oggetto modificato dall’utente');
    });
  });
});
