/* global Buffer */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { db } from '../database/db';
import { ACTIVATION_CONFIG } from '../config/activation.config';
import {
  LicenseActivationService,
  localLicenseRepository,
} from '../services/licensing';
import {
  buildCanonicalLicensePayloadV1,
  buildCanonicalLicensePayloadV2,
  buildCanonicalValidationReceiptV1,
  computeLicensePayloadHashV2,
  createLicenseValidationResponseEnvelope,
  serializeLicenseValidationResponseEnvelope,
  type SignedLicenseDocumentV1,
  type SignedLicenseDocumentV2,
  type SignedValidationReceiptV1,
  type ValidationReceiptV1,
} from '@gestione-casa/shared-sdk/activation';
import type { LicenseDocumentV1, LicenseDocumentV2 } from '@gestione-casa/shared-sdk/licensing';

// Helper per generare chiavi Ed25519 per i test
function generateEd25519TestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { publicKey: spkiBase64, privateKey };
}

function createSignedTestDocumentV1(
  licenseDoc: Partial<LicenseDocumentV1>,
  privateKey: crypto.KeyObject,
  keyId = 'test-key-1'
): SignedLicenseDocumentV1 {
  const fullDoc: LicenseDocumentV1 = {
    id: licenseDoc.id || 'LIC-V1-TEST',
    licenseCode: licenseDoc.licenseCode || 'ABCD-EFGH-JKMN-PQRQ',
    checksum: licenseDoc.checksum || 'Q',
    edition: licenseDoc.edition || 'standard',
    term: licenseDoc.term || 'annual',
    status: licenseDoc.status || 'activated',
    owner: licenseDoc.owner || 'Utente Test V1',
    customerId: licenseDoc.customerId ?? 'CUST-100',
    deviceId: licenseDoc.deviceId ?? 'DEV-12345678-1234-1234-1234-123456789012',
    generatedAt: licenseDoc.generatedAt || new Date().toISOString(),
    assignedAt: licenseDoc.assignedAt ?? null,
    sentAt: licenseDoc.sentAt ?? null,
    activatedAt: licenseDoc.activatedAt || new Date().toISOString(),
    suspendedAt: licenseDoc.suspendedAt ?? null,
    revokedAt: licenseDoc.revokedAt ?? null,
    expiresAt: licenseDoc.expiresAt || new Date(Date.now() + 365 * 86400000).toISOString(),
    engineVersion: '2.1',
    schemaVersion: 1,
    metadata: licenseDoc.metadata || {},
  };

  const canonicalPayload = buildCanonicalLicensePayloadV1(fullDoc);
  const signatureBuffer = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey);

  return {
    license: fullDoc,
    signature: signatureBuffer.toString('base64'),
    signatureAlgorithm: 'Ed25519',
    keyId,
    signatureVersion: 1,
    canonicalPayload,
  };
}

function createSignedTestDocumentV2(
  licenseDoc: Partial<LicenseDocumentV2>,
  privateKey: crypto.KeyObject,
  keyId = 'test-key-1'
): SignedLicenseDocumentV2 {
  const fullDoc: LicenseDocumentV2 = {
    id: licenseDoc.id || 'LIC-V2-TEST',
    licenseCode: licenseDoc.licenseCode || 'ABCD-EFGH-JKMN-PQRQ',
    checksum: licenseDoc.checksum || 'Q',
    edition: licenseDoc.edition || 'professional',
    term: licenseDoc.term || 'annual',
    status: licenseDoc.status || 'activated',
    owner: licenseDoc.owner || 'Utente Test V2',
    customerId: licenseDoc.customerId ?? 'CUST-200',
    deviceId: licenseDoc.deviceId ?? 'DEV-12345678-1234-1234-1234-123456789012',
    generatedAt: licenseDoc.generatedAt || '2026-08-01T00:00:00.000Z',
    assignedAt: licenseDoc.assignedAt ?? null,
    sentAt: licenseDoc.sentAt ?? null,
    activatedAt: licenseDoc.activatedAt || '2026-08-01T00:00:00.000Z',
    suspendedAt: licenseDoc.suspendedAt ?? null,
    revokedAt: licenseDoc.revokedAt ?? null,
    expiresAt: licenseDoc.expiresAt !== undefined ? licenseDoc.expiresAt : '2027-08-01T00:00:00.000Z',
    engineVersion: '2.1',
    schemaVersion: 2,
    offlinePolicy: licenseDoc.offlinePolicy || {
      allowed: true,
      maxDays: 30,
    },
    metadata: licenseDoc.metadata || {},
  };

  const canonicalPayload = buildCanonicalLicensePayloadV2(fullDoc);
  const signatureBuffer = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey);

  return {
    license: fullDoc,
    signature: signatureBuffer.toString('base64'),
    signatureAlgorithm: 'Ed25519',
    keyId,
    signatureVersion: 2,
    canonicalPayload,
  };
}

function createSignedTestReceiptV1(
  receiptData: Partial<ValidationReceiptV1>,
  licenseDoc: LicenseDocumentV2,
  privateKey: crypto.KeyObject,
  keyId = 'test-key-1'
): SignedValidationReceiptV1 {
  const payloadHash = computeLicensePayloadHashV2(licenseDoc);

  const fullReceipt: ValidationReceiptV1 = {
    receiptVersion: 1,
    receiptId: receiptData.receiptId || 'RCP-TEST-1',
    licenseId: receiptData.licenseId || licenseDoc.id,
    deviceId: receiptData.deviceId || licenseDoc.deviceId || 'DEV-12345678-1234-1234-1234-123456789012',
    licenseSchemaVersion: 2,
    validatedAt: receiptData.validatedAt || '2026-08-10T12:00:00.000Z',
    offlineValidUntil:
      receiptData.offlineValidUntil !== undefined
        ? receiptData.offlineValidUntil
        : '2026-09-09T12:00:00.000Z',
    licenseExpiresAt:
      receiptData.licenseExpiresAt !== undefined
        ? receiptData.licenseExpiresAt
        : licenseDoc.expiresAt,
    licensePayloadHash: receiptData.licensePayloadHash || payloadHash,
  };

  const canonicalPayload = buildCanonicalValidationReceiptV1(fullReceipt);
  const signatureBuffer = crypto.sign(null, Buffer.from(canonicalPayload, 'utf-8'), privateKey);

  return {
    receipt: fullReceipt,
    signature: signatureBuffer.toString('base64'),
    signatureAlgorithm: 'Ed25519',
    keyId,
    signatureVersion: 1,
    canonicalPayload,
  };
}

describe('Fase 2.6.C2-B - Binding Receipt/Licenza/Device + Validazione Offline', () => {
  let testPublicKey: string;
  let testPrivateKey: crypto.KeyObject;
  const standardDeviceId = 'DEV-12345678-1234-1234-1234-123456789012';

  beforeEach(async () => {
    await db.localLicenses.clear();
    await db.settings.clear();
    vi.restoreAllMocks();

    const keys = generateEd25519TestKeyPair();
    testPublicKey = keys.publicKey;
    testPrivateKey = keys.privateKey;

    vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(testPublicKey);
    vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('C2-B-01: receipt valida + binding valido + entro finestra -> PASS (VALID_OFFLINE)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-001', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(true);
    expect(result.status).toBe('VALID_OFFLINE');
    expect(result.effectiveUntil).toBe('2026-09-09T12:00:00.000Z');
  });

  it('C2-B-02: offlineValidUntil === null -> FAIL (OFFLINE_WINDOW_EXPIRED)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-002', deviceId: standardDeviceId, offlinePolicy: { allowed: false, maxDays: 0 } },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: null,
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: null,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('OFFLINE_WINDOW_EXPIRED');
  });

  it('C2-B-03: ora oltre offlineValidUntil -> FAIL (OFFLINE_WINDOW_EXPIRED)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-003', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-08-20T00:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    // Ora corrente: 2026-08-25 (dopo il 2026-08-20)
    const result = await service.validateOfflineLicense({
      now: '2026-08-25T00:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('OFFLINE_WINDOW_EXPIRED');
  });

  it('C2-B-04: licenza scaduta prima della finestra offline -> FAIL (LICENSE_EXPIRED)', async () => {
    // Licenza scade il 2026-08-18, ma finestra offline teorica fino al 2026-08-30
    const signedDoc = createSignedTestDocumentV2(
      {
        id: 'LIC-V2-004',
        deviceId: standardDeviceId,
        expiresAt: '2026-08-18T00:00:00.000Z',
      },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-08-30T00:00:00.000Z',
        licenseExpiresAt: '2026-08-18T00:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    // Ora corrente: 2026-08-20 (prima di offlineValidUntil 08-30, ma DOPO la scadenza licenza 08-18)
    const result = await service.validateOfflineLicense({
      now: '2026-08-20T00:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('LICENSE_EXPIRED');
  });

  it('C2-B-05: licenseId mismatch -> FAIL (INVALID_BINDING)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-005', deviceId: standardDeviceId },
      testPrivateKey
    );
    // Ricevuta emessa per LIC-V2-DIVERSO
    const signedReceipt = createSignedTestReceiptV1(
      {
        licenseId: 'LIC-V2-DIVERSO',
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('INVALID_BINDING');
  });

  it('C2-B-06: deviceId mismatch -> FAIL (DEVICE_MISMATCH)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-006', deviceId: standardDeviceId },
      testPrivateKey
    );
    // Ricevuta per altro deviceId
    const signedReceipt = createSignedTestReceiptV1(
      {
        deviceId: 'DEV-DIVERSO-8888-8888-8888-888888888888',
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('DEVICE_MISMATCH');
  });

  it('C2-B-07: licensePayloadHash mismatch -> FAIL (INVALID_BINDING)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-007', deviceId: standardDeviceId },
      testPrivateKey
    );
    // Hash errato nella receipt
    const signedReceipt = createSignedTestReceiptV1(
      {
        licensePayloadHash: '0000000000000000000000000000000000000000000000000000000000000000',
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('INVALID_BINDING');
  });

  it('C2-B-08: receipt con firma invalida -> FAIL (INVALID_RECEIPT_SIGNATURE)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-008', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    // Corruzione della firma della receipt
    signedReceipt.signature = Buffer.from('firma_receipt_corrotta').toString('base64');

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('INVALID_RECEIPT_SIGNATURE');
  });

  it('C2-B-09: signed license invalida -> FAIL (INVALID_LICENSE_SIGNATURE)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-009', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    // Corruzione della firma della licenza
    signedDoc.signature = Buffer.from('firma_licenza_corrotta').toString('base64');

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('INVALID_LICENSE_SIGNATURE');
  });

  it('C2-B-10: stato revocato -> FAIL (LICENSE_REVOKED)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-010', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'LICENSE_REVOKED',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('LICENSE_REVOKED');
  });

  it('C2-B-11: stato expired -> FAIL (LICENSE_EXPIRED)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-011', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'LICENSE_EXPIRED',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('LICENSE_EXPIRED');
  });

  it('C2-B-12: stato deactivated -> FAIL (LICENSE_DEACTIVATED)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-012', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'deactivated',
      deactivationStatus: 'DEACTIVATED',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('LICENSE_DEACTIVATED');
  });

  it('C2-B-13: network error + offline valido -> fallback autorizzato', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-013', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    // Simuliamo errore di rete globale su fetch
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error offline'));

    const service = new LicenseActivationService();
    const onlineResult = await service.validateLicense();

    expect(onlineResult.success).toBe(false);
    expect(onlineResult.isNetworkError).toBe(true);

    // A fronte di errore di rete reale, il fallback offline locale autorizza l'accesso
    const offlineResult = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(offlineResult.isValid).toBe(true);
    expect(offlineResult.status).toBe('VALID_OFFLINE');
  });

  it('C2-B-14: server response negativa + offline receipt valida -> NO fallback', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-014', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    // Risposta esplicita negativa dal server: LICENSE_REVOKED
    const valEnv = createLicenseValidationResponseEnvelope({
      status: 'LICENSE_REVOKED',
      message: 'Licenza revocata dal server di attivazione',
      lastValidatedAt: '2026-08-15T12:00:00.000Z',
      serverTime: '2026-08-15T12:00:00.000Z',
      requestId: 'req-rev-1',
    }).value!;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => serializeLicenseValidationResponseEnvelope(valEnv).value!,
    } as Response);

    const service = new LicenseActivationService();
    const onlineResult = await service.validateLicense();

    expect(onlineResult.success).toBe(false);
    expect(onlineResult.status).toBe('LICENSE_REVOKED');
    expect(onlineResult.isNetworkError).toBeFalsy();

    // Lo stato locale aggiornato a LICENSE_REVOKED impedisce qualunque fallback offline
    const offlineResult = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    expect(offlineResult.isValid).toBe(false);
    expect(offlineResult.status).toBe('LICENSE_REVOKED');
  });

  it('C2-B-15: clock rollback rispetto a lastSuccessfulOnlineValidation -> FAIL (CLOCK_TAMPERING_DETECTED)', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-015', deviceId: standardDeviceId },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    // Ora corrente impostata indietro nel tempo: 2026-08-01 (prima di lastSuccessfulOnlineValidation 08-10)
    const result = await service.validateOfflineLicense({
      now: '2026-08-01T00:00:00.000Z',
    });

    expect(result.isValid).toBe(false);
    expect(result.status).toBe('CLOCK_TAMPERING_DETECTED');
  });

  it('C2-B-16: licenza perpetua + receipt valida entro finestra -> PASS (VALID_OFFLINE)', async () => {
    // Licenza perpetua: expiresAt null
    const signedDoc = createSignedTestDocumentV2(
      {
        id: 'LIC-V2-016',
        deviceId: standardDeviceId,
        term: 'perpetual',
        expiresAt: null,
      },
      testPrivateKey
    );
    const signedReceipt = createSignedTestReceiptV1(
      {
        licenseExpiresAt: null,
        offlineValidUntil: '2026-09-09T12:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: null,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-20T12:00:00.000Z',
    });

    expect(result.isValid).toBe(true);
    expect(result.status).toBe('VALID_OFFLINE');
    expect(result.effectiveUntil).toBe('2026-09-09T12:00:00.000Z');
  });

  it('C2-B-17: V1 legacy non subisce regressioni (nessun receipt per V1 -> RECEIPT_MISSING)', async () => {
    const signedDocV1 = createSignedTestDocumentV1(
      { id: 'LIC-V1-017', deviceId: standardDeviceId },
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDocV1.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'ACTIVATED',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDocV1,
      signedValidationReceipt: null,
      offlineValidUntil: null,
      licenseExpiresAt: signedDocV1.license.expiresAt,
      schemaVersion: 1,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();
    const result = await service.validateOfflineLicense({
      now: '2026-08-15T12:00:00.000Z',
    });

    // Licenze V1 non hanno ricevuta di validazione firmata V1/V2
    expect(result.isValid).toBe(false);
    expect(result.status).toBe('RECEIPT_MISSING');
  });

  it('C2-B-18: receipt rinnovata dopo validate online aggiorna la finestra offline usata dal validator', async () => {
    const signedDoc = createSignedTestDocumentV2(
      { id: 'LIC-V2-018', deviceId: standardDeviceId },
      testPrivateKey
    );
    // Prima receipt con finestra offline fino al 2026-08-20
    const oldReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: '2026-08-20T00:00:00.000Z',
        validatedAt: '2026-08-10T12:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    await localLicenseRepository.save({
      id: 'current',
      licenseCode: signedDoc.license.licenseCode,
      deviceId: standardDeviceId,
      status: 'VALID',
      lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: oldReceipt,
      offlineValidUntil: oldReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    const service = new LicenseActivationService();

    // Al 2026-08-25 con vecchia receipt, offline è scaduto
    const beforeValidation = await service.validateOfflineLicense({
      now: '2026-08-25T00:00:00.000Z',
    });
    expect(beforeValidation.isValid).toBe(false);
    expect(beforeValidation.status).toBe('OFFLINE_WINDOW_EXPIRED');

    // Nuova receipt emessa online con finestra estesa fino al 2026-09-20
    const newReceipt = createSignedTestReceiptV1(
      {
        receiptId: 'RCP-RENEWED-18',
        offlineValidUntil: '2026-09-20T00:00:00.000Z',
        validatedAt: '2026-08-25T00:00:00.000Z',
      },
      signedDoc.license,
      testPrivateKey
    );

    const valEnv = createLicenseValidationResponseEnvelope({
      status: 'VALID',
      receipt: newReceipt,
      lastValidatedAt: '2026-08-25T00:00:00.000Z',
      serverTime: '2026-08-25T00:00:00.000Z',
      requestId: 'req-val-renewed',
    }).value!;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => serializeLicenseValidationResponseEnvelope(valEnv).value!,
    } as Response);

    const onlineRes = await service.validateLicense();
    expect(onlineRes.success).toBe(true);
    expect(onlineRes.status).toBe('VALID');

    // Ora al 2026-08-25 con la nuova receipt, offline è valido fino al 2026-09-20
    const afterValidation = await service.validateOfflineLicense({
      now: '2026-08-25T12:00:00.000Z',
    });
    expect(afterValidation.isValid).toBe(true);
    expect(afterValidation.status).toBe('VALID_OFFLINE');
    expect(afterValidation.effectiveUntil).toBe('2026-09-20T00:00:00.000Z');
  });
});
