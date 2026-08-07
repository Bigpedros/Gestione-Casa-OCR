import { describe, it, expect } from 'vitest';

// 1. Verify subpath imports
import * as rootSdk from '@gestione-casa/shared-sdk';
import * as commonSdk from '@gestione-casa/shared-sdk/common';
import * as licensingSdk from '@gestione-casa/shared-sdk/licensing';
import * as customersSdk from '@gestione-casa/shared-sdk/customers';
import {
  CONTACT_REQUEST_EXCHANGE_FORMAT,
  CONTACT_REQUEST_EXCHANGE_FORMAT_VERSION,
  ContactRequestValidator,
  createContactRequestExchangeEnvelope,
  validateContactRequestExchangeEnvelope,
  serializeContactRequestExchangeEnvelope,
  deserializeContactRequestExchangeEnvelope,
  buildContactRequestExchangeFileName,
} from '@gestione-casa/shared-sdk/contact-requests';

describe('Sottofase 2.3.B.1 - Shared SDK Integration Test Suite', () => {
  it('TEST 1: Verifica importazione da tutti i sottopercorsi dichiarati nello Shared SDK v0.3.0', () => {
    expect(rootSdk).toBeDefined();
    expect(commonSdk).toBeDefined();
    expect(licensingSdk).toBeDefined();
    expect(customersSdk).toBeDefined();
    expect(ContactRequestValidator).toBeDefined();

    expect(typeof commonSdk.isValidEmail).toBe('function');
    expect(typeof licensingSdk.LicenseValidator).toBe('function');
    expect(typeof customersSdk.CustomerValidator).toBe('function');
    expect(typeof ContactRequestValidator.validate).toBe('function');
  });

  it('TEST 2: Verifica costanti di formato ed envelope di scambio', () => {
    expect(CONTACT_REQUEST_EXCHANGE_FORMAT).toBe('gestione-casa-contact-request');
    expect(CONTACT_REQUEST_EXCHANGE_FORMAT_VERSION).toBe(1);
  });

  it('TEST 3: Esegue ciclo completo End-to-End su un ContactRequestDocument valido con envelope e serializzazione', () => {
    const validDocument = {
      id: 'req_20260806_test001',
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
      subject: 'Richiesta di supporto tecnico',
      message: 'Impossibile elaborare uno scontrino con immagini a bassa risoluzione',
      privacyAcceptedAt: '2026-08-06T12:00:00.000Z',
      linkedCustomerId: null,
      linkedLicenseId: null,
      createdAt: '2026-08-06T12:00:00.000Z',
      updatedAt: '2026-08-06T12:00:00.000Z',
      reviewedAt: null,
      closedAt: null,
      sourceDeviceId: 'device_mobile_android_01',
      sourceAppVersion: '1.0.0',
      syncStatus: 'pending',
      schemaVersion: 1,
      metadata: {},
    };

    // 1. Validazione documento canonico
    const docValidation = ContactRequestValidator.validate(validDocument);
    expect(docValidation.isValid).toBe(true);
    expect(docValidation.issues).toHaveLength(0);

    // 2. Creazione envelope
    const envelopeResult = createContactRequestExchangeEnvelope(validDocument);
    expect(envelopeResult.isValid).toBe(true);
    expect(envelopeResult.value).not.toBeNull();
    const envelope = envelopeResult.value!;
    expect(envelope.format).toBe('gestione-casa-contact-request');
    expect(envelope.formatVersion).toBe(1);
    expect(envelope.request.syncStatus).toBe('pending');

    // 3. Serializzazione JSON
    const serializeResult = serializeContactRequestExchangeEnvelope(envelope);
    expect(serializeResult.isValid).toBe(true);
    expect(typeof serializeResult.value).toBe('string');
    const jsonString = serializeResult.value!;

    // 4. Deserializzazione JSON
    const deserializeResult = deserializeContactRequestExchangeEnvelope(jsonString);
    expect(deserializeResult.isValid).toBe(true);
    expect(deserializeResult.value).not.toBeNull();
    const deserializedEnvelope = deserializeResult.value!;

    // 5. Validazione finale envelope deserializzato e conservazione syncStatus = pending
    const envelopeValidation = validateContactRequestExchangeEnvelope(deserializedEnvelope);
    expect(envelopeValidation.isValid).toBe(true);
    expect(deserializedEnvelope.request.syncStatus).toBe('pending');
    expect(deserializedEnvelope.request.linkedCustomerId).toBeNull();
    expect(deserializedEnvelope.request.linkedLicenseId).toBeNull();

    // 6. Generazione nome file per export
    const fileNameResult = buildContactRequestExchangeFileName(deserializedEnvelope);
    expect(fileNameResult.isValid).toBe(true);
    expect(fileNameResult.value).toBeDefined();
    expect(fileNameResult.value).toMatch(/^gestione-casa-contact-request_req_20260806_test001_\d{8}-\d{6}\.json$/);
  });
});
