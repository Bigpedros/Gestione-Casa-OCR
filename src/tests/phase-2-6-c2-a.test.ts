/* global Buffer */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { db } from '../database/db';
import { ACTIVATION_CONFIG } from '../config/activation.config';
import {
  licenseSignatureVerifier,
  LicenseActivationService,
  localLicenseRepository,
} from '../services/licensing';
import {
  buildCanonicalLicensePayloadV1,
  buildCanonicalLicensePayloadV2,
  buildCanonicalValidationReceiptV1,
  computeLicensePayloadHashV2,
  createActivationResponseEnvelope,
  createLicenseValidationResponseEnvelope,
  serializeActivationResponseEnvelope,
  serializeLicenseValidationResponseEnvelope,
  type SignedLicenseDocumentV1,
  type SignedLicenseDocumentV2,
  type SignedValidationReceiptV1,
  type ValidationReceiptV1,
} from '@gestione-casa/shared-sdk/activation';
import type { LicenseDocumentV1, LicenseDocumentV2 } from '@gestione-casa/shared-sdk/licensing';

// Helper per generare chiavi Ed25519
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
    generatedAt: licenseDoc.generatedAt || new Date().toISOString(),
    assignedAt: licenseDoc.assignedAt ?? null,
    sentAt: licenseDoc.sentAt ?? null,
    activatedAt: licenseDoc.activatedAt || new Date().toISOString(),
    suspendedAt: licenseDoc.suspendedAt ?? null,
    revokedAt: licenseDoc.revokedAt ?? null,
    expiresAt: licenseDoc.expiresAt || new Date(Date.now() + 365 * 86400000).toISOString(),
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
  privateKey: crypto.KeyObject,
  keyId = 'test-key-1'
): SignedValidationReceiptV1 {
  const fullReceipt: ValidationReceiptV1 = {
    receiptVersion: 1,
    receiptId: receiptData.receiptId || 'RCP-TEST-1',
    licenseId: receiptData.licenseId || 'LIC-V2-TEST',
    deviceId: receiptData.deviceId || 'DEV-12345678-1234-1234-1234-123456789012',
    licenseSchemaVersion: 2,
    validatedAt: receiptData.validatedAt || new Date().toISOString(),
    offlineValidUntil: receiptData.offlineValidUntil || new Date(Date.now() + 30 * 86400000).toISOString(),
    licenseExpiresAt: receiptData.licenseExpiresAt || new Date(Date.now() + 365 * 86400000).toISOString(),
    licensePayloadHash: receiptData.licensePayloadHash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
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

describe('Fase 2.6.C2-A - Supporto Licenza V2 + Receipt Types/Verification', () => {
  beforeEach(async () => {
    await db.localLicenses.clear();
    await db.settings.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Supporto SignedLicenseDocument V1 e V2 (licenseSignatureVerifier)', () => {
    it('C2-A-01: SignedLicenseDocument V1 valido -> PASS', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDocV1 = createSignedTestDocumentV1({}, privateKey);

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDocV1, publicKey);
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('VALID');
      expect(result.canonicalPayload).toBeDefined();
    });

    it('C2-A-02: SignedLicenseDocument V2 valido -> PASS', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDocV2 = createSignedTestDocumentV2({}, privateKey);

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDocV2, publicKey);
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('VALID');
      expect(result.canonicalPayload).toBeDefined();
    });

    it('C2-A-03: SignedLicenseDocument V2 con firma alterata -> FAIL', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDocV2 = createSignedTestDocumentV2({}, privateKey);

      signedDocV2.signature = Buffer.from('firma_alterata_non_valida').toString('base64');

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDocV2, publicKey);
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('INVALID_SIGNATURE');
    });

    it('C2-A-04: Versione firma/schema non supportata -> FAIL', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocumentV1({}, privateKey);

      // Versione firma non supportata (es. 99)
      (signedDoc as any).signatureVersion = 99;

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDoc, publicKey);
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('UNSUPPORTED_VERSION');
    });
  });

  describe('2. Verifica SignedValidationReceiptV1 (licenseSignatureVerifier)', () => {
    it('C2-A-05: SignedValidationReceiptV1 valida -> PASS', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedReceipt = createSignedTestReceiptV1({}, privateKey);

      const result = await licenseSignatureVerifier.verifySignedValidationReceipt(signedReceipt, publicKey);
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('VALID');
      expect(result.canonicalPayload).toBeDefined();
    });

    it('C2-A-06: Receipt con signature alterata -> FAIL', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedReceipt = createSignedTestReceiptV1({}, privateKey);

      signedReceipt.signature = Buffer.from('firma_receipt_manomessa').toString('base64');

      const result = await licenseSignatureVerifier.verifySignedValidationReceipt(signedReceipt, publicKey);
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('INVALID_SIGNATURE');
    });

    it('C2-A-07: Receipt con payload alterato dopo firma -> FAIL', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedReceipt = createSignedTestReceiptV1({}, privateKey);

      // Manomissione payload: estensione arbitraria di offlineValidUntil
      signedReceipt.receipt.offlineValidUntil = new Date(Date.now() + 1000 * 86400000).toISOString();

      const result = await licenseSignatureVerifier.verifySignedValidationReceipt(signedReceipt, publicKey);
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('INVALID_SIGNATURE');
    });

    it('C2-A-08: KeyId sconosciuto e nessun fallback -> FAIL', async () => {
      const { privateKey } = generateEd25519TestKeyPair();
      const signedReceipt = createSignedTestReceiptV1({}, privateKey, 'unknown-key-999');

      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue('');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKeysMap', 'get').mockReturnValue({});

      const result = await licenseSignatureVerifier.verifySignedValidationReceipt(signedReceipt);
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('UNKNOWN_KEY');
    });
  });

  describe('3. Flussi Activation Service con Receipt e Persistenza', () => {
    it('C2-A-09: Activation con receipt valida -> receipt persistita in LocalLicenseState', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const licensePayloadHash = computeLicensePayloadHashV2(signedLicenseV2.license);
      const signedReceipt = createSignedTestReceiptV1(
        {
          licenseId: signedLicenseV2.license.id,
          licensePayloadHash,
        },
        privateKey
      );

      const mockEnvelope = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        activationId: 'ACT-C2A-1',
        signedLicense: signedLicenseV2,
        receipt: signedReceipt,
        serverTime: new Date().toISOString(),
        requestId: 'req-c2a-1',
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
      expect(saved?.signedValidationReceipt).toBeDefined();
      expect(saved?.signedValidationReceipt?.receipt.receiptId).toBe('RCP-TEST-1');
      expect(saved?.offlineValidUntil).toBe(signedReceipt.receipt.offlineValidUntil);
      expect(saved?.licenseExpiresAt).toBe(signedReceipt.receipt.licenseExpiresAt);
      expect(saved?.schemaVersion).toBe(2);
    });

    it('C2-A-10: Validate con nuova receipt valida -> receipt sostituita/aggiornata', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const initialReceipt = createSignedTestReceiptV1(
        { receiptId: 'RCP-OLD', offlineValidUntil: '2026-09-01T00:00:00.000Z' },
        privateKey
      );

      // Pre-salvataggio stato locale
      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        status: 'ACTIVATED',
        signedLicenseDocument: signedLicenseV2,
        signedValidationReceipt: initialReceipt,
        offlineValidUntil: initialReceipt.receipt.offlineValidUntil,
        updatedAt: new Date().toISOString(),
      });

      const newReceipt = createSignedTestReceiptV1(
        { receiptId: 'RCP-NEW-UPDATED', offlineValidUntil: '2026-10-01T00:00:00.000Z' },
        privateKey
      );

      const mockEnvelope = createLicenseValidationResponseEnvelope({
        status: 'VALID',
        signedLicense: signedLicenseV2,
        receipt: newReceipt,
        lastValidatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: 'req-c2a-val',
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
      expect(saved?.signedValidationReceipt?.receipt.receiptId).toBe('RCP-NEW-UPDATED');
      expect(saved?.offlineValidUntil).toBe('2026-10-01T00:00:00.000Z');
    });

    it('C2-A-11: Receipt invalida -> non viene persistita', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV2 = createSignedTestDocumentV2({}, privateKey);
      const tamperedReceipt = createSignedTestReceiptV1({}, privateKey);
      tamperedReceipt.signature = Buffer.from('firma_falsa').toString('base64');

      const mockEnvelope = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        activationId: 'ACT-C2A-TAMPER',
        signedLicense: signedLicenseV2,
        receipt: tamperedReceipt,
        serverTime: new Date().toISOString(),
        requestId: 'req-c2a-tamper',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => serializeActivationResponseEnvelope(mockEnvelope.value!).value!,
      } as any);

      const service = new LicenseActivationService();
      const result = await service.activateLicense('ABCD-EFGH-JKMN-PQRQ');

      expect(result.success).toBe(true);
      const saved = await localLicenseRepository.get();
      // La licenza è salvata ma la receipt non valida NON è stata persistita
      expect(saved?.signedValidationReceipt).toBeNull();
      expect(saved?.offlineValidUntil).toBeNull();
    });

    it('C2-A-12: Licenza V1 continua a funzionare senza receipt', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const signedLicenseV1 = createSignedTestDocumentV1({}, privateKey);

      const mockEnvelope = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        activationId: 'ACT-V1-COMPAT',
        signedLicense: signedLicenseV1,
        receipt: null,
        serverTime: new Date().toISOString(),
        requestId: 'req-v1-compat',
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
      expect(saved?.signedLicenseDocument?.signatureVersion).toBe(1);
      expect(saved?.schemaVersion).toBe(1);
      expect(saved?.signedValidationReceipt).toBeNull();
    });
  });
});
