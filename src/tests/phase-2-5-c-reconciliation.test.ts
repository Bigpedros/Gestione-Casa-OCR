import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { contactRequestRepository } from '../repositories';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { importContactRequestSyncResponse } from '../services/contactRequestSyncService';
import {
  createContactRequestExchangeEnvelope,
  serializeContactRequestExchangeEnvelope,
} from '@gestione-casa/shared-sdk';
import type { ContactRequestDocument } from '@gestione-casa/shared-sdk/contact-requests';

describe('FASE 2.5.C – Import Risposta License Manager e Riconciliazione Contact Request', () => {
  const sampleLocalDoc: ContactRequestDocument = {
    id: 'req_test_25c_001',
    requestType: 'support',
    status: 'new',
    displayName: 'Mario Rossi',
    firstName: 'Mario',
    lastName: 'Rossi',
    companyName: null,
    email: 'mario.rossi@example.com',
    phone: '+39 333 1234567',
    preferredContactChannel: 'email',
    subject: 'Richiesta di supporto OCR',
    message: 'Ho bisogno di aiuto con la scansione scontrini.',
    privacyAcceptedAt: '2026-08-08T10:00:00.000Z',
    source: 'gestione_casa_ocr',
    sourceDeviceId: 'DEV-12345678-1234-4321-abcd-123456789abc',
    sourceAppVersion: '1.0.0',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    syncStatus: 'pending',
    schemaVersion: 1,
    metadata: {},
    linkedCustomerId: null,
    linkedLicenseId: null,
    reviewedAt: null,
    closedAt: null,
  };

  beforeEach(async () => {
    await contactRequestRepository.clear();
    await seedInitialCategoriesAndSettings();
  });

  afterEach(async () => {
    await contactRequestRepository.clear();
  });

  it('1. converted_to_customer: applicazione stato terminale e collegamento cliente/licenza', async () => {
    await contactRequestRepository.create(sampleLocalDoc);

    const remoteDoc: ContactRequestDocument = {
      ...sampleLocalDoc,
      status: 'converted_to_customer',
      linkedCustomerId: 'cust_999',
      linkedLicenseId: 'lic_888',
      reviewedAt: '2026-08-08T11:00:00.000Z',
      closedAt: '2026-08-08T11:00:00.000Z',
      updatedAt: '2026-08-08T11:00:00.000Z',
    };

    const envelopeRes = createContactRequestExchangeEnvelope(remoteDoc);
    expect(envelopeRes.isValid).toBe(true);

    const jsonStr = serializeContactRequestExchangeEnvelope(envelopeRes.value!).value!;
    const res = await importContactRequestSyncResponse(jsonStr);

    expect(res.success).toBe(true);
    expect(res.status).toBe('applied');

    const updatedLocal = await contactRequestRepository.getById(sampleLocalDoc.id);
    expect(updatedLocal).toBeDefined();
    expect(updatedLocal?.status).toBe('converted_to_customer');
    expect(updatedLocal?.syncStatus).toBe('synced');
    expect(updatedLocal?.linkedCustomerId).toBe('cust_999');
    expect(updatedLocal?.linkedLicenseId).toBe('lic_888');
    expect(updatedLocal?.reviewedAt).toBe('2026-08-08T11:00:00.000Z');
    expect(updatedLocal?.closedAt).toBe('2026-08-08T11:00:00.000Z');
  });

  it('2. rejected: applicazione stato terminale rejected', async () => {
    await contactRequestRepository.create(sampleLocalDoc);

    const remoteDoc: ContactRequestDocument = {
      ...sampleLocalDoc,
      status: 'rejected',
      reviewedAt: '2026-08-08T11:30:00.000Z',
      closedAt: '2026-08-08T11:30:00.000Z',
      updatedAt: '2026-08-08T11:30:00.000Z',
    };

    const envelopeRes = createContactRequestExchangeEnvelope(remoteDoc);
    const jsonStr = serializeContactRequestExchangeEnvelope(envelopeRes.value!).value!;
    const res = await importContactRequestSyncResponse(jsonStr);

    expect(res.success).toBe(true);
    expect(res.status).toBe('applied');

    const updatedLocal = await contactRequestRepository.getById(sampleLocalDoc.id);
    expect(updatedLocal?.status).toBe('rejected');
    expect(updatedLocal?.syncStatus).toBe('synced');
    expect(updatedLocal?.closedAt).toBe('2026-08-08T11:30:00.000Z');
  });

  it('3. closed: applicazione stato terminale closed', async () => {
    await contactRequestRepository.create(sampleLocalDoc);

    const remoteDoc: ContactRequestDocument = {
      ...sampleLocalDoc,
      status: 'closed',
      reviewedAt: '2026-08-08T12:00:00.000Z',
      closedAt: '2026-08-08T12:00:00.000Z',
      updatedAt: '2026-08-08T12:00:00.000Z',
    };

    const envelopeRes = createContactRequestExchangeEnvelope(remoteDoc);
    const jsonStr = serializeContactRequestExchangeEnvelope(envelopeRes.value!).value!;
    const res = await importContactRequestSyncResponse(jsonStr);

    expect(res.success).toBe(true);
    expect(res.status).toBe('applied');

    const updatedLocal = await contactRequestRepository.getById(sampleLocalDoc.id);
    expect(updatedLocal?.status).toBe('closed');
    expect(updatedLocal?.syncStatus).toBe('synced');
  });

  it('4. in_review: applicazione stato non terminale in_review', async () => {
    await contactRequestRepository.create(sampleLocalDoc);

    const remoteDoc: ContactRequestDocument = {
      ...sampleLocalDoc,
      status: 'in_review',
      reviewedAt: '2026-08-08T10:30:00.000Z',
      updatedAt: '2026-08-08T10:30:00.000Z',
    };

    const envelopeRes = createContactRequestExchangeEnvelope(remoteDoc);
    const jsonStr = serializeContactRequestExchangeEnvelope(envelopeRes.value!).value!;
    const res = await importContactRequestSyncResponse(jsonStr);

    expect(res.success).toBe(true);
    expect(res.status).toBe('applied');

    const updatedLocal = await contactRequestRepository.getById(sampleLocalDoc.id);
    expect(updatedLocal?.status).toBe('in_review');
    expect(updatedLocal?.syncStatus).toBe('synced');
    expect(updatedLocal?.reviewedAt).toBe('2026-08-08T10:30:00.000Z');
  });

  it('5. equivalent: record remoto identico a quello locale imposta syncStatus = synced', async () => {
    await contactRequestRepository.create(sampleLocalDoc);

    const envelopeRes = createContactRequestExchangeEnvelope(sampleLocalDoc);
    const jsonStr = serializeContactRequestExchangeEnvelope(envelopeRes.value!).value!;
    const res = await importContactRequestSyncResponse(jsonStr);

    expect(res.success).toBe(true);
    expect(res.status).toBe('equivalent');

    const updatedLocal = await contactRequestRepository.getById(sampleLocalDoc.id);
    expect(updatedLocal?.syncStatus).toBe('synced');
  });

  it('6. conflict: risposta non terminale LM più vecchia delle modifiche locali pending', async () => {
    // Local record updated at 12:00:00
    const localNewerDoc: ContactRequestDocument = {
      ...sampleLocalDoc,
      message: 'Messaggio aggiornato in locale',
      updatedAt: '2026-08-08T12:00:00.000Z',
      syncStatus: 'pending',
    };
    await contactRequestRepository.create(localNewerDoc);

    // Remote response updated at 11:00:00 (older) with non-terminal status
    const remoteOlderDoc: ContactRequestDocument = {
      ...sampleLocalDoc,
      status: 'in_review',
      updatedAt: '2026-08-08T11:00:00.000Z',
    };

    const envelopeRes = createContactRequestExchangeEnvelope(remoteOlderDoc);
    const jsonStr = serializeContactRequestExchangeEnvelope(envelopeRes.value!).value!;
    const res = await importContactRequestSyncResponse(jsonStr);

    expect(res.success).toBe(false);
    expect(res.status).toBe('conflict');

    const updatedLocal = await contactRequestRepository.getById(sampleLocalDoc.id);
    expect(updatedLocal?.syncStatus).toBe('conflict');
  });

  it('7. missing_local_record: risposta remota per ID non presente localmente', async () => {
    const remoteDoc: ContactRequestDocument = {
      ...sampleLocalDoc,
      id: 'req_non_esistente_999',
    };

    const envelopeRes = createContactRequestExchangeEnvelope(remoteDoc);
    const jsonStr = serializeContactRequestExchangeEnvelope(envelopeRes.value!).value!;
    const res = await importContactRequestSyncResponse(jsonStr);

    expect(res.success).toBe(false);
    expect(res.status).toBe('missing_local_record');

    const checkLocal = await contactRequestRepository.getById('req_non_esistente_999');
    expect(checkLocal).toBeUndefined();
  });

  it('8. invalid_format: file JSON malformato o inviluppo errato', async () => {
    const resInvalidJson = await importContactRequestSyncResponse('{ json non valido ');
    expect(resInvalidJson.success).toBe(false);
    expect(resInvalidJson.status).toBe('invalid_format');

    const resEmpty = await importContactRequestSyncResponse('');
    expect(resEmpty.success).toBe(false);
    expect(resEmpty.status).toBe('invalid_format');

    const resWrongFormat = await importContactRequestSyncResponse(
      JSON.stringify({ format: 'wrong-format', formatVersion: 1, payload: {} })
    );
    expect(resWrongFormat.success).toBe(false);
    expect(resWrongFormat.status).toBe('invalid_format');
  });
});
