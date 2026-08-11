/* global Buffer */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { db } from '../database/db';
import { getOrCreateDeviceId } from '../services/deviceService';
import { ACTIVATION_CONFIG } from '../config/activation.config';
import {
  activationClient,
  maskLicenseCode,
  licenseSignatureVerifier,
  LicenseActivationService,
  localLicenseRepository,
} from '../services/licensing';
import {
  buildCanonicalLicensePayloadV1,
  createActivationResponseEnvelope,
  createLicenseValidationResponseEnvelope,
  createLicenseDeactivationResponseEnvelope,
  serializeActivationResponseEnvelope,
  serializeLicenseValidationResponseEnvelope,
  serializeLicenseDeactivationResponseEnvelope,
  type SignedLicenseDocument,
} from '@gestione-casa/shared-sdk/activation';

type LicenseDocument = SignedLicenseDocument['license'];

// Generatore di chiavi Ed25519 per i test
function generateEd25519TestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { publicKey: spkiBase64, privateKey };
}

function createSignedTestDocument(
  licenseDoc: Partial<LicenseDocument>,
  privateKey: crypto.KeyObject,
  keyId = 'test-key-1'
): SignedLicenseDocument {
  const fullDoc: LicenseDocument = {
    id: licenseDoc.id || 'LIC-TEST-1',
    licenseCode: licenseDoc.licenseCode || 'ABCD-EFGH-JKMN-PQRQ',
    checksum: licenseDoc.checksum || 'Q',
    edition: licenseDoc.edition || 'standard',
    term: licenseDoc.term || 'annual',
    status: licenseDoc.status || 'activated',
    owner: licenseDoc.owner || 'Utente Test',
    customerId: licenseDoc.customerId ?? 'CUST-100',
    deviceId: licenseDoc.deviceId ?? 'DEV-12345678-1234-1234-1234-123456789012',
    generatedAt: licenseDoc.generatedAt || new Date().toISOString(),
    assignedAt: licenseDoc.assignedAt ?? null,
    sentAt: licenseDoc.sentAt ?? null,
    activatedAt: licenseDoc.activatedAt || new Date().toISOString(),
    suspendedAt: licenseDoc.suspendedAt ?? null,
    revokedAt: licenseDoc.revokedAt ?? null,
    expiresAt: licenseDoc.expiresAt || new Date(Date.now() + 365 * 86400000).toISOString(),
    engineVersion: (licenseDoc.engineVersion as any) || '1.0',
    schemaVersion: (licenseDoc.schemaVersion as any) || 1,
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

describe('Fase 2.6.C1 - Client Attivazione, Device ID, Persistenza Locale e Firma Ed25519', () => {
  beforeEach(async () => {
    // Pulisce il database IndexedDB prima di ogni test
    await db.localLicenses.clear();
    await db.settings.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Device ID Service (getOrCreateDeviceId)', () => {
    it('C1-01: Genera un Device ID stabile in formato DEV-uuid se assente nelle impostazioni', async () => {
      const deviceId = await getOrCreateDeviceId();
      expect(deviceId).toMatch(/^DEV-[0-9a-fA-F-]+$/);

      // Verifica che sia salvato nelle impostazioni
      const savedSettings = await db.settings.get('default-settings');
      expect(savedSettings?.deviceId).toBe(deviceId);
    });

    it('C1-02: Mantiene lo stesso Device ID ad accessi e chiamate successive', async () => {
      const firstId = await getOrCreateDeviceId();
      const secondId = await getOrCreateDeviceId();
      expect(secondId).toBe(firstId);
    });
  });

  describe('2. Mascheramento License Code (maskLicenseCode)', () => {
    it('C1-03: Maschera in modo sicuro i codici licenza nei log senza mostrare la stringa completa', () => {
      expect(maskLicenseCode('ABCD-EFGH-JKMN-PQRQ')).toBe('ABCD-****-****-PQRQ');
      expect(maskLicenseCode('SHORT')).toBe('****');
      expect(maskLicenseCode('')).toBe('***');
    });
  });

  describe('3. Verificatore di Firma Ed25519 (licenseSignatureVerifier)', () => {
    it('C1-04: Verifica con successo una firma Ed25519 valida su canonical payload', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocument({}, privateKey);

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDoc, publicKey);
      expect(result.isValid).toBe(true);
      expect(result.status).toBe('VALID');
      expect(result.canonicalPayload).toBeDefined();
    });

    it('C1-05: Rifiuta un documento firmato se il payload della licenza è stato manomesso', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocument({}, privateKey);

      // Tampering: modifica della data di scadenza
      signedDoc.license.expiresAt = new Date(Date.now() + 1000 * 86400000).toISOString();

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDoc, publicKey);
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('INVALID_SIGNATURE');
    });

    it('C1-06: Rifiuta un documento se la stringa di firma è alterata', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocument({}, privateKey);

      signedDoc.signature = Buffer.from('firma_falsa_e_alterata').toString('base64');

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDoc, publicKey);
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('INVALID_SIGNATURE');
    });

    it('C1-07: Segnala UNKNOWN_KEY se nessuna chiave pubblica è disponibile per la verifica', async () => {
      const { privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocument({}, privateKey, 'key-inesistente');

      const result = await licenseSignatureVerifier.verifySignedLicense(signedDoc, '');
      expect(result.isValid).toBe(false);
      expect(result.status).toBe('UNKNOWN_KEY');
    });
  });

  describe('4. Activation Client (activationClient)', () => {
    it('C1-08: Invia richiesta di attivazione al corretto endpoint /api/licenses/activate', async () => {
      const { privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocument({}, privateKey);

      // Configura URL temporaneo
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      const responseEnvelope = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        signedLicense: signedDoc,
        activationId: 'act-12345',
        serverTime: new Date().toISOString(),
        requestId: 'req-111',
      }).value!;

      const serializedResponse = serializeActivationResponseEnvelope(responseEnvelope).value!;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializedResponse,
      } as Response);

      const resp = await activationClient.activate({
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        productId: 'gestione-casa-ocr',
        appVersion: '1.0.0',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://activation.gestione-casa.test/api/licenses/activate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );

      expect(resp.status).toBe('ACTIVATED');
      expect(resp.activationId).toBe('act-12345');
      expect(resp.signedLicense?.signature).toBe(signedDoc.signature);
    });

    it('C1-09: Gestisce errori di rete o assenza di configurazione URL restituendo errore controllato SERVER_ERROR', async () => {
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('');

      const resp = await activationClient.activate({
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        productId: 'gestione-casa-ocr',
        appVersion: '1.0.0',
      });

      expect(resp.status).toBe('SERVER_ERROR');
      expect(resp.message).toContain('URL Activation Service non configurato');
    });

    it('C1-10: Invia richiesta di validazione all\'endpoint /api/licenses/validate', async () => {
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      const valEnv = createLicenseValidationResponseEnvelope({
        status: 'VALID',
        lastValidatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: 'req-222',
      }).value!;

      const serializedVal = serializeLicenseValidationResponseEnvelope(valEnv).value!;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializedVal,
      } as Response);

      const resp = await activationClient.validate({
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        productId: 'gestione-casa-ocr',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://activation.gestione-casa.test/api/licenses/validate',
        expect.anything()
      );
      expect(resp.status).toBe('VALID');
    });

    it('C1-11: Invia richiesta di disattivazione all\'endpoint /api/licenses/deactivate', async () => {
      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      const deactEnv = createLicenseDeactivationResponseEnvelope({
        status: 'DEACTIVATED',
        deactivatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: 'req-333',
      }).value!;

      const serializedDeact = serializeLicenseDeactivationResponseEnvelope(deactEnv).value!;

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializedDeact,
      } as Response);

      const resp = await activationClient.deactivate({
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        productId: 'gestione-casa-ocr',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://activation.gestione-casa.test/api/licenses/deactivate',
        expect.anything()
      );
      expect(resp.status).toBe('DEACTIVATED');
    });
  });

  describe('5. Orchestratore Licenza (LicenseActivationService)', () => {
    it('C1-12: Rifiuta l\'attivazione se il formato del codice licenza non è valido', async () => {
      const service = new LicenseActivationService();
      const result = await service.activateLicense('CODICE-INVALIDO-123');
      expect(result.success).toBe(false);
      expect(result.status).toBe('INVALID_REQUEST');
      expect(result.message).toContain('non valido');
    });

    it('C1-13: Attiva con successo e persiste lo stato locale se il server e la firma Ed25519 sono validi', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocument({}, privateKey);

      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const respEnv = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        signedLicense: signedDoc,
        activationId: 'act-999',
        serverTime: '2026-08-10T12:00:00.000Z',
        requestId: 'req-999',
      }).value!;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializeActivationResponseEnvelope(respEnv).value!,
      } as Response);

      const service = new LicenseActivationService();
      const result = await service.activateLicense('ABCD-EFGH-JKMN-PQRQ');

      expect(result.success).toBe(true);
      expect(result.status).toBe('ACTIVATED');
      expect(result.localState?.licenseCode).toBe('ABCD-EFGH-JKMN-PQRQ');

      // Verifica persistenza in Dexie versione 9
      const persisted = await localLicenseRepository.get();
      expect(persisted).toBeDefined();
      expect(persisted?.status).toBe('ACTIVATED');
      expect(persisted?.lastSuccessfulOnlineValidation).toBe('2026-08-10T12:00:00.000Z');
      expect(persisted?.signedLicenseDocument?.signature).toBe(signedDoc.signature);
    });

    it('C1-14: NON persiste la licenza se la firma Ed25519 non è valida (manomissione)', async () => {
      const { publicKey, privateKey } = generateEd25519TestKeyPair();
      const signedDoc = createSignedTestDocument({}, privateKey);

      // Manomissione del documento (modifica data di scadenza)
      signedDoc.license.expiresAt = '2099-12-31T23:59:59.000Z';

      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(publicKey);

      const respEnv = createActivationResponseEnvelope({
        status: 'ACTIVATED',
        signedLicense: signedDoc,
        activationId: 'act-999',
        serverTime: '2026-08-10T12:00:00.000Z',
        requestId: 'req-999',
      }).value!;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializeActivationResponseEnvelope(respEnv).value!,
      } as Response);

      const service = new LicenseActivationService();
      const result = await service.activateLicense('ABCD-EFGH-JKMN-PQRQ');

      expect(result.success).toBe(false);
      expect(result.status).toBe('INVALID_SIGNATURE');

      // Verifica che in Dexie NON sia stato salvato nulla
      const persisted = await localLicenseRepository.get();
      expect(persisted).toBeUndefined();
    });

    it('C1-15: Validazione online aggiorna il timestamp lastSuccessfulOnlineValidation in caso di risposta VALID', async () => {
      // Pre-popola una licenza locale
      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        status: 'ACTIVATED',
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: new Date().toISOString(),
      });

      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      const valEnv = createLicenseValidationResponseEnvelope({
        status: 'VALID',
        lastValidatedAt: '2026-08-10T15:30:00.000Z',
        serverTime: '2026-08-10T15:30:00.000Z',
        requestId: 'req-val-1',
      }).value!;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializeLicenseValidationResponseEnvelope(valEnv).value!,
      } as Response);

      const service = new LicenseActivationService();
      const result = await service.validateLicense();

      expect(result.success).toBe(true);
      expect(result.status).toBe('VALID');

      const updated = await localLicenseRepository.get();
      expect(updated?.lastSuccessfulOnlineValidation).toBe('2026-08-10T15:30:00.000Z');
      expect(updated?.status).toBe('VALID');
    });

    it('C1-16: Validazione online aggiorna lo stato locale se la licenza viene revocata (LICENSE_REVOKED)', async () => {
      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        status: 'ACTIVATED',
        lastSuccessfulOnlineValidation: '2026-08-01T00:00:00.000Z',
        updatedAt: new Date().toISOString(),
      });

      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      const valEnv = createLicenseValidationResponseEnvelope({
        status: 'LICENSE_REVOKED',
        message: 'Licenza revocata dall\'amministratore',
        lastValidatedAt: '2026-08-10T15:30:00.000Z',
        serverTime: '2026-08-10T15:30:00.000Z',
        requestId: 'req-val-rev',
      }).value!;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializeLicenseValidationResponseEnvelope(valEnv).value!,
      } as Response);

      const service = new LicenseActivationService();
      const result = await service.validateLicense();

      expect(result.success).toBe(false);
      expect(result.status).toBe('LICENSE_REVOKED');

      const updated = await localLicenseRepository.get();
      expect(updated?.status).toBe('LICENSE_REVOKED');
    });

    it('C1-17: In caso di errore di rete durante la validazione: PRESERVA lo stato locale senza invalidarlo', async () => {
      const initialTimestamp = '2026-08-01T00:00:00.000Z';
      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        status: 'ACTIVATED',
        lastSuccessfulOnlineValidation: initialTimestamp,
        updatedAt: new Date().toISOString(),
      });

      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error / Offline'));

      const service = new LicenseActivationService();
      const result = await service.validateLicense();

      expect(result.success).toBe(false);
      expect(result.isNetworkError).toBe(true);

      const preserved = await localLicenseRepository.get();
      expect(preserved?.status).toBe('ACTIVATED');
      expect(preserved?.lastSuccessfulOnlineValidation).toBe(initialTimestamp);
    });

    it('C1-18: Disattivazione confermata dal server imposta lo stato a deactivated', async () => {
      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        status: 'ACTIVATED',
        updatedAt: new Date().toISOString(),
      });

      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');

      const deactEnv = createLicenseDeactivationResponseEnvelope({
        status: 'DEACTIVATED',
        deactivatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: 'req-deact-ok',
      }).value!;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => serializeLicenseDeactivationResponseEnvelope(deactEnv).value!,
      } as Response);

      const service = new LicenseActivationService();
      const result = await service.deactivateLicense();

      expect(result.success).toBe(true);
      expect(result.confirmedOnServer).toBe(true);
      expect(result.status).toBe('DEACTIVATED');

      const updated = await localLicenseRepository.get();
      expect(updated?.deactivationStatus).toBe('DEACTIVATED');
    });

    it('C1-19: Errore durante la disattivazione imposta DEACTIVATION_PENDING_CONFIRMATION senza dichiarare la disattivazione confermata', async () => {
      await localLicenseRepository.save({
        id: 'current',
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
        status: 'ACTIVATED',
        updatedAt: new Date().toISOString(),
      });

      vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestione-casa.test');
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Server indisponibile'));

      const service = new LicenseActivationService();
      const result = await service.deactivateLicense();

      expect(result.success).toBe(false);
      expect(result.confirmedOnServer).toBe(false);

      const updated = await localLicenseRepository.get();
      expect(updated?.deactivationStatus).toBe('DEACTIVATION_PENDING_CONFIRMATION');
    });
  });
});
