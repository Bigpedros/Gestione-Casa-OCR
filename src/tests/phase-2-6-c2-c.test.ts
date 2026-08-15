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
  createActivationResponseEnvelope,
  serializeActivationResponseEnvelope,
  createLicenseValidationResponseEnvelope,
  serializeLicenseValidationResponseEnvelope,
  createLicenseDeactivationResponseEnvelope,
  serializeLicenseDeactivationResponseEnvelope,
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

describe('Fase 2.6.C2-C - Consolidamento Flusso Online, Receipt e Persistenza Locale', () => {
  beforeEach(async () => {
    await db.localLicenses.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Flusso Attivazione Online Completo', () => {
    it('C2-C-01: Attivazione V2 con receipt valida -> persistenza atomica completa', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const signedReceipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      const serverTime = '2026-08-15T12:00:00.000Z';
      const mockEnvelope = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        activationId: 'ACT-C2C-001',
        signedLicense: signedLicenseV2,
        receipt: signedReceipt,
        serverTime,
        requestId: 'req-c2c-001',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeActivationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const result = await service.activateLicense('ABCD-EFGH-JKMN-PQRQ');

      expect(result.success).toBe(true);
      expect(result.status).toBe('ACTIVATED');

      const saved = await localLicenseRepository.get();
      expect(saved).toBeDefined();
      expect(saved?.id).toBe('current');
      expect(saved?.licenseCode).toBe('ABCD-EFGH-JKMN-PQRQ');
      expect(saved?.activationId).toBe('ACT-C2C-001');
      expect(saved?.status).toBe('ACTIVATED');
      expect(saved?.schemaVersion).toBe(2);
      expect(saved?.signedLicenseDocument).toBeDefined();
      expect(saved?.signedValidationReceipt).toBeDefined();
      expect(saved?.offlineValidUntil).toBe(signedReceipt.receipt.offlineValidUntil);
      expect(saved?.licenseExpiresAt).toBe(signedReceipt.receipt.licenseExpiresAt);
      expect(saved?.lastSuccessfulOnlineValidation).toBe(serverTime);
      expect(saved?.deactivationStatus).toBeNull();
    });

    it('C2-C-02: Attivazione V1 senza receipt -> retrocompatibilità V1 preservata', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV1 = createSignedTestDocumentV1({}, privateKey);

      const mockEnvelope = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        activationId: 'ACT-V1-002',
        signedLicense: signedLicenseV1,
        receipt: null,
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-v1-002',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeActivationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const result = await service.activateLicense('ABCD-EFGH-JKMN-PQRQ');

      expect(result.success).toBe(true);
      expect(result.status).toBe('ACTIVATED');

      const saved = await localLicenseRepository.get();
      expect(saved?.schemaVersion).toBe(1);
      expect(saved?.signedValidationReceipt).toBeNull();
      expect(saved?.offlineValidUntil).toBeNull();
    });
  });

  describe('2. Flusso di Rinnovo Receipt in Validazione Online', () => {
    it('C2-C-03: Validazione online con rinnovo receipt -> receipt aggiornata e timestamp aggiornati', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const initialReceipt = createSignedTestReceiptV1(
        { receiptId: 'RCP-INITIAL', offlineValidUntil: '2026-08-20T00:00:00.000Z' },
        signedLicenseV2.license,
        privateKey
      );

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'ACTIVATED',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: initialReceipt,
        offlineValidUntil: initialReceipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const renewedReceipt = createSignedTestReceiptV1(
        {
          receiptId: 'RCP-RENEWED',
          validatedAt: '2026-08-15T12:00:00.000Z',
          offlineValidUntil: '2026-09-14T12:00:00.000Z',
        },
        signedLicenseV2.license,
        privateKey
      );

      const mockEnvelope = createLicenseValidationResponseEnvelope({
        status: 'VALID',
        signedLicense: signedLicenseV2,
        receipt: renewedReceipt,
        lastValidatedAt: '2026-08-15T12:00:00.000Z',
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-renew-001',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeLicenseValidationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const result = await service.validateLicense();

      expect(result.success).toBe(true);
      expect(result.status).toBe('VALID');

      const saved = await localLicenseRepository.get();
      expect(saved?.signedValidationReceipt?.receipt.receiptId).toBe('RCP-RENEWED');
      expect(saved?.offlineValidUntil).toBe('2026-09-14T12:00:00.000Z');
      expect(saved?.lastSuccessfulOnlineValidation).toBe('2026-08-15T12:00:00.000Z');
    });
  });

  describe('3. Gestione Risposte Server Negative ed Errori', () => {
    it('C2-C-04: Server risponde LICENSE_REVOKED -> stato aggiornato, blocco offline fail-closed', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: receipt,
        offlineValidUntil: receipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const mockEnvelope = createLicenseValidationResponseEnvelope({
        status: 'LICENSE_REVOKED',
        lastValidatedAt: '2026-08-15T12:00:00.000Z',
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-revoked',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeLicenseValidationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const valResult = await service.validateLicense();

      expect(valResult.success).toBe(false);
      expect(valResult.status).toBe('LICENSE_REVOKED');
      expect((valResult as any).isNetworkError).toBeFalsy();

      const saved = await localLicenseRepository.get();
      expect(saved?.status).toBe('LICENSE_REVOKED');

      // Validazione offline successiva DEVE fallire
      const offlineResult = await service.validateOfflineLicense({
        now: '2026-08-16T00:00:00.000Z',
        publicKey,
      });
      expect(offlineResult.isValid).toBe(false);
      expect(offlineResult.status).toBe('LICENSE_REVOKED');
    });

    it('C2-C-05: Server risponde DEVICE_MISMATCH -> stato aggiornato, blocco offline fail-closed', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: receipt,
        offlineValidUntil: receipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const mockEnvelope = createLicenseValidationResponseEnvelope({
        status: 'DEVICE_MISMATCH',
        lastValidatedAt: '2026-08-15T12:00:00.000Z',
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-dev-mismatch',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeLicenseValidationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const valResult = await service.validateLicense();

      expect(valResult.success).toBe(false);
      expect(valResult.status).toBe('DEVICE_MISMATCH');
      expect((valResult as any).isNetworkError).toBeFalsy();

      const saved = await localLicenseRepository.get();
      expect(saved?.status).toBe('DEVICE_MISMATCH');

      // Validazione offline successiva DEVE fallire
      const offlineResult = await service.validateOfflineLicense({
        now: '2026-08-16T00:00:00.000Z',
        publicKey,
      });
      expect(offlineResult.isValid).toBe(false);
    });

    it('C2-C-05b: Licenza in stato SUSPENDED -> blocco offline fail-closed', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'LICENSE_SUSPENDED',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: receipt,
        offlineValidUntil: receipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const service = new LicenseActivationService();
      const offlineResult = await service.validateOfflineLicense({
        now: '2026-08-16T00:00:00.000Z',
        publicKey,
      });
      expect(offlineResult.isValid).toBe(false);
      expect(offlineResult.status).toBe('LICENSE_SUSPENDED');
    });

    it('C2-C-06: Server risponde LICENSE_EXPIRED -> stato aggiornato, blocco offline fail-closed', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: receipt,
        offlineValidUntil: receipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const mockEnvelope = createLicenseValidationResponseEnvelope({
        status: 'LICENSE_EXPIRED',
        lastValidatedAt: '2026-08-15T12:00:00.000Z',
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-expired',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeLicenseValidationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const valResult = await service.validateLicense();

      expect(valResult.success).toBe(false);
      expect(valResult.status).toBe('LICENSE_EXPIRED');

      const saved = await localLicenseRepository.get();
      expect(saved?.status).toBe('LICENSE_EXPIRED');

      const offlineResult = await service.validateOfflineLicense({
        now: '2026-08-16T00:00:00.000Z',
        publicKey,
      });
      expect(offlineResult.isValid).toBe(false);
      expect(offlineResult.status).toBe('LICENSE_EXPIRED');
    });

    it('C2-C-07: Errore di rete (fetch failure) -> preserva stato locale e abilita fallback offline', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1(
        {
          validatedAt: '2026-08-10T12:00:00.000Z',
          offlineValidUntil: '2026-09-10T12:00:00.000Z',
        },
        signedLicenseV2.license,
        privateKey
      );

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: receipt,
        offlineValidUntil: receipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z',
      });

      // Simulazione errore di connessione di rete
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error: ECONNREFUSED'));

      const service = new LicenseActivationService();
      const valResult = await service.validateLicense();

      expect(valResult.success).toBe(false);
      expect(valResult.isNetworkError).toBe(true);

      // Stato locale DEVE rimanere inalterato
      const saved = await localLicenseRepository.get();
      expect(saved?.status).toBe('VALID');
      expect(saved?.signedValidationReceipt?.receipt.receiptId).toBe(receipt.receipt.receiptId);

      // Fallback a validazione offline DEVE avere successo
      const offlineResult = await service.validateOfflineLicense({
        now: '2026-08-15T12:00:00.000Z',
        publicKey,
      });
      expect(offlineResult.isValid).toBe(true);
      expect(offlineResult.status).toBe('VALID_OFFLINE');
    });

    it('C2-C-08: Receipt ricevuta con firma non valida -> non corrompe stato locale', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const validReceipt = createSignedTestReceiptV1(
        { receiptId: 'RCP-LEGIT' },
        signedLicenseV2.license,
        privateKey
      );

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: validReceipt,
        offlineValidUntil: validReceipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const tamperedReceipt = createSignedTestReceiptV1(
        { receiptId: 'RCP-CORRUPTED' },
        signedLicenseV2.license,
        privateKey
      );
      tamperedReceipt.signature = Buffer.from('firma_falsa_e_corrotta').toString('base64');

      const mockEnvelope = createLicenseValidationResponseEnvelope({
        status: 'VALID',
        signedLicense: signedLicenseV2,
        receipt: tamperedReceipt,
        lastValidatedAt: '2026-08-15T12:00:00.000Z',
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-tamper-receipt',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeLicenseValidationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      await service.validateLicense();

      const saved = await localLicenseRepository.get();
      // La receipt valida originaria NON deve essere stata sovrascritta con la versione corrotta
      expect(saved?.signedValidationReceipt?.receipt.receiptId).toBe('RCP-LEGIT');
    });
  });

  describe('4. Flusso di Disattivazione', () => {
    it('C2-C-09: Disattivazione confermata dal server -> stato deactivated e blocco offline', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: receipt,
        offlineValidUntil: receipt.receipt.offlineValidUntil,
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const mockEnvelope = createLicenseDeactivationResponseEnvelope({
        status: 'DEACTIVATED',
        deactivatedAt: '2026-08-15T12:00:00.000Z',
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-deact-001',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeLicenseDeactivationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const deactResult = await service.deactivateLicense();

      expect(deactResult.success).toBe(true);
      expect(deactResult.status).toBe('DEACTIVATED');
      expect(deactResult.confirmedOnServer).toBe(true);

      const saved = await localLicenseRepository.get();
      expect(saved?.status).toBe('deactivated');
      expect(saved?.deactivationStatus).toBe('DEACTIVATED');

      // Validazione offline successiva DEVE fallire immediatamente
      const offlineResult = await service.validateOfflineLicense({
        now: '2026-08-16T00:00:00.000Z',
        publicKey,
      });
      expect(offlineResult.isValid).toBe(false);
      expect(offlineResult.status).toBe('LICENSE_DEACTIVATED');
    });

    it('C2-C-10: Disattivazione con errore di rete -> imposta DEACTIVATION_PENDING_CONFIRMATION', async () => {
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      const { privateKey } = generateEd25519TestKeyPair();
      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network timeout'));

      const service = new LicenseActivationService();
      const deactResult = await service.deactivateLicense();

      expect(deactResult.success).toBe(false);
      expect(deactResult.confirmedOnServer).toBe(false);

      const saved = await localLicenseRepository.get();
      expect(saved?.deactivationStatus).toBe('DEACTIVATION_PENDING_CONFIRMATION');
    });

    it('C2-C-11: Server risponde LICENSE_NOT_FOUND -> stato aggiornato, blocco offline fail-closed', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: signedLicenseV2.license.deviceId!,
        status: 'VALID',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: receipt,
        offlineValidUntil: receipt.receipt.offlineValidUntil,
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      });

      const mockEnvelope = createLicenseValidationResponseEnvelope({
        status: 'LICENSE_NOT_FOUND',
        lastValidatedAt: '2026-08-15T12:00:00.000Z',
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-not-found',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeLicenseValidationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const valResult = await service.validateLicense();

      expect(valResult.success).toBe(false);
      expect(valResult.status).toBe('LICENSE_NOT_FOUND');

      const saved = await localLicenseRepository.get();
      expect(saved?.status).toBe('LICENSE_NOT_FOUND');

      const offlineResult = await service.validateOfflineLicense({
        now: '2026-08-16T00:00:00.000Z',
        publicKey,
      });
      expect(offlineResult.isValid).toBe(false);
      expect(offlineResult.status).toBe('LICENSE_NOT_FOUND');
    });

    it('C2-C-12: Persistenza atomica dello stato locale (tutti i campi sincronizzati)', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const receipt = createSignedTestReceiptV1({}, signedLicenseV2.license, privateKey);

      const saveSpy = vi.spyOn(localLicenseRepository, 'save');

      const mockEnvelope = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        activationId: 'ACT-ATOMIC-1',
        signedLicense: signedLicenseV2,
        receipt,
        serverTime: '2026-08-15T12:00:00.000Z',
        requestId: 'req-atomic-1',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeActivationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      await service.activateLicense('ABCD-EFGH-JKMN-PQRQ');

      // Verifica che il salvataggio sia avvenuto con una singola chiamata atomica
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const savedPayload = saveSpy.mock.calls[0][0];
      expect(savedPayload.signedLicenseDocument).toBeDefined();
      expect(savedPayload.signedValidationReceipt).toBeDefined();
      expect(savedPayload.offlineValidUntil).toBe(receipt.receipt.offlineValidUntil);
      expect(savedPayload.lastSuccessfulOnlineValidation).toBe('2026-08-15T12:00:00.000Z');
      expect(savedPayload.schemaVersion).toBe(2);
    });
  });
});
