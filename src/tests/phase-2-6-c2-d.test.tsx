/* global Buffer */
import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import crypto from 'node:crypto';
import { db } from '../database/db';
import { ACTIVATION_CONFIG } from '../config/activation.config';
import {
  LicenseProvider,
  useLicenseContext,
  maskDeviceId,
} from '../context/LicenseContext';
import {
  localLicenseRepository,
  maskLicenseCode,
} from '../services/licensing';
import { getOrCreateDeviceId } from '../services/deviceService';
import {
  buildCanonicalLicensePayloadV2,
  buildCanonicalValidationReceiptV1,
  computeLicensePayloadHashV2,
  createActivationResponseEnvelope,
  serializeActivationResponseEnvelope,
  createLicenseValidationResponseEnvelope,
  serializeLicenseValidationResponseEnvelope,
  createLicenseDeactivationResponseEnvelope,
  serializeLicenseDeactivationResponseEnvelope,
  type SignedLicenseDocumentV2,
  type SignedValidationReceiptV1,
  type ValidationReceiptV1,
} from '@gestione-casa/shared-sdk/activation';
import type { LicenseDocumentV2 } from '@gestione-casa/shared-sdk/licensing';
import { LicenseSettingsCard } from '../features/settings/components/LicenseSettingsCard';

// Helper per generare chiavi Ed25519 per i test
function generateEd25519TestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { publicKey: spkiBase64, privateKey };
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
    owner: licenseDoc.owner || 'Mario Rossi',
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
  receipt: Partial<ValidationReceiptV1>,
  signedDoc: SignedLicenseDocumentV2,
  privateKey: crypto.KeyObject,
  keyId = 'test-key-1'
): SignedValidationReceiptV1 {
  const licensePayloadHash = computeLicensePayloadHashV2(signedDoc.license);
  const fullReceipt: ValidationReceiptV1 = {
    receiptVersion: 1,
    receiptId: receipt.receiptId || 'REC-V1-TEST',
    licenseId: receipt.licenseId || signedDoc.license.id,
    deviceId: receipt.deviceId || signedDoc.license.deviceId || 'DEV-12345678-1234-1234-1234-123456789012',
    licenseSchemaVersion: 2,
    validatedAt: receipt.validatedAt || '2026-08-15T00:00:00.000Z',
    offlineValidUntil: receipt.offlineValidUntil !== undefined ? receipt.offlineValidUntil : '2026-09-15T00:00:00.000Z',
    licenseExpiresAt:
      receipt.licenseExpiresAt !== undefined ? receipt.licenseExpiresAt : signedDoc.license.expiresAt,
    licensePayloadHash,
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

// Componente consumer di test per ispezionare il LicenseContext
const TestConsumer: React.FC<{
  onContext: (ctx: ReturnType<typeof useLicenseContext>) => void;
}> = ({ onContext }) => {
  const context = useLicenseContext();
  React.useEffect(() => {
    onContext(context);
  }, [context, onContext]);

  return (
    <div>
      <div data-testid="status">{context.status}</div>
      <div data-testid="maskedCode">{context.maskedLicenseCode}</div>
      <div data-testid="isValid">{String(context.isValid)}</div>
      <div data-testid="isOfflineValid">{String(context.isOfflineValid)}</div>
      <div data-testid="validationStatus">{context.validationStatus}</div>
      <div data-testid="deactivationStatus">{context.deactivationStatus || 'none'}</div>
      <button
        data-testid="btn-activate"
        onClick={() => context.activateLicense('ABCD-EFGH-JKMN-PQRQ')}
      >
        Attiva
      </button>
      <button data-testid="btn-validate" onClick={() => context.validateLicense()}>
        Valida
      </button>
      <button data-testid="btn-deactivate" onClick={() => context.deactivateLicense()}>
        Disattiva
      </button>
    </div>
  );
};

describe('FASE 2.6.C2-D: Integrazione License Context, Stato Reattivo e UI Licensing', () => {
  let keyPair: { publicKey: string; privateKey: crypto.KeyObject };

  beforeEach(async () => {
    keyPair = generateEd25519TestKeyPair();
    vi.spyOn(ACTIVATION_CONFIG, 'serviceUrl', 'get').mockReturnValue('https://activation.gestionecasa.test');
    vi.spyOn(ACTIVATION_CONFIG, 'publicKey', 'get').mockReturnValue(keyPair.publicKey);

    await db.localLicenses.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. LicenseContext inizializza con stato not_activated se Dexie è vuoto', async () => {
    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isLoading).toBe(false);
    });

    expect(capturedContext.status).toBe('not_activated');
    expect(capturedContext.isValid).toBe(false);
    expect(capturedContext.isOfflineValid).toBe(false);
    expect(capturedContext.maskedLicenseCode).toBe('Non presente');
    expect(capturedContext.validationStatus).toBe('LICENSE_NOT_FOUND');
  });

  it('2. LicenseContext riflette reattivamente la licenza valida memorizzata in Dexie', async () => {
    const signedDoc = createSignedTestDocumentV2(
      {
        licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
        deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
      },
      keyPair.privateKey
    );

    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        validatedAt: new Date(Date.now() - 1000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: 'ABCD-EFGH-JKMN-PQRQ',
      deviceId: 'DEV-12345678-1234-1234-1234-123456789012',
      status: 'VALID',
      licenseType: 'professional',
      activatedAt: new Date().toISOString(),
      lastSuccessfulOnlineValidation: new Date().toISOString(),
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
    });

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isValid).toBe(true);
    });

    expect(capturedContext.status).toBe('VALID');
    expect(capturedContext.isOfflineValid).toBe(true);
    expect(capturedContext.maskedLicenseCode).toBe('ABCD-****-****-PQRQ');
    expect(capturedContext.edition).toBe('professional');
    expect(capturedContext.owner).toBe('Mario Rossi');
    expect(capturedContext.schemaVersion).toBe(2);
  });

  it('3. activateLicense tramite Context invoca il flusso e aggiorna lo stato reattivo', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = await getOrCreateDeviceId();

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId },
      keyPair.privateKey
    );

    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        validatedAt: new Date().toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    const responseEnvelope = createActivationResponseEnvelope({
      status: 'ACTIVATED',
      activationId: 'ACT-999',
      signedLicense: signedDoc,
      receipt: signedReceipt,
      serverTime: new Date().toISOString(),
      requestId: 'req-act-1',
    });

    const serialized = serializeActivationResponseEnvelope(responseEnvelope.value!);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => serialized.value!,
    } as Response);

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isLoading).toBe(false);
    });

    await act(async () => {
      const res = await capturedContext.activateLicense(code);
      expect(res.success).toBe(true);
    });

    await waitFor(() => {
      expect(capturedContext?.isValid).toBe(true);
    });

    expect(capturedContext.maskedLicenseCode).toBe('ABCD-****-****-PQRQ');
    expect(capturedContext.status).toBe('ACTIVATED');
  });

  it('4. validateLicense tramite Context aggiorna stato e ricevuta se confermata dal server', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId },
      keyPair.privateKey
    );

    const oldReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 5 * 86400000).toISOString(),
        validatedAt: new Date(Date.now() - 86400000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: oldReceipt,
      offlineValidUntil: oldReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
    });

    const newOfflineUntil = new Date(Date.now() + 30 * 86400000).toISOString();
    const newReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: newOfflineUntil,
        validatedAt: new Date().toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    const responseEnvelope = createLicenseValidationResponseEnvelope({
      status: 'VALID',
      lastValidatedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      receipt: newReceipt,
      message: 'Validazione online confermata',
      requestId: 'req-val-1',
    });

    const serialized = serializeLicenseValidationResponseEnvelope(responseEnvelope.value!);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => serialized.value!,
    } as Response);

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isValid).toBe(true);
    });

    await act(async () => {
      const res = await capturedContext.validateLicense();
      expect(res.success).toBe(true);
    });

    await waitFor(() => {
      expect(capturedContext?.offlineValidUntil).toBe(newOfflineUntil);
    });
  });

  it('5. validateLicense con risposta di revoca dal server invalida lo stato', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId },
      keyPair.privateKey
    );

    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
    });

    const responseEnvelope = createLicenseValidationResponseEnvelope({
      status: 'LICENSE_REVOKED',
      lastValidatedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      message: 'Licenza revocata dal server.',
      requestId: 'req-rev-1',
    });

    const serialized = serializeLicenseValidationResponseEnvelope(responseEnvelope.value!);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => serialized.value!,
    } as Response);

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isValid).toBe(true);
    });

    await act(async () => {
      const res = await capturedContext.validateLicense();
      expect(res.success).toBe(false);
      expect(res.status).toBe('LICENSE_REVOKED');
    });

    await waitFor(() => {
      expect(capturedContext?.isValid).toBe(false);
      expect(capturedContext?.status).toBe('LICENSE_REVOKED');
    });
  });

  it('6. validateLicense su errore di rete preserva la validità offline', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId },
      keyPair.privateKey
    );

    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        validatedAt: new Date(Date.now() - 1000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
    });

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isValid).toBe(true);
    });

    await act(async () => {
      const res = await capturedContext.validateLicense();
      expect(res.isNetworkError).toBe(true);
    });

    // La licenza rimane valida grazie al fallback offline certificato
    expect(capturedContext.isValid).toBe(true);
    expect(capturedContext.isOfflineValid).toBe(true);
  });

  it('7. deactivateLicense disattiva la licenza e aggiorna lo stato', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId },
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      signedLicenseDocument: signedDoc,
    });

    const responseEnvelope = createLicenseDeactivationResponseEnvelope({
      status: 'DEACTIVATED',
      deactivatedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      message: 'Disattivata con successo',
      requestId: 'req-deact-1',
    });

    const serialized = serializeLicenseDeactivationResponseEnvelope(responseEnvelope.value!);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => serialized.value!,
    } as Response);

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isLoading).toBe(false);
    });

    await act(async () => {
      const res = await capturedContext.deactivateLicense();
      expect(res.confirmedOnServer).toBe(true);
    });

    await waitFor(() => {
      expect(capturedContext?.deactivationStatus).toBe('DEACTIVATED');
      expect(capturedContext?.isValid).toBe(false);
    });
  });

  it('8. deactivateLicense su errore di rete imposta DEACTIVATION_PENDING_CONFIRMATION', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId },
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      signedLicenseDocument: signedDoc,
    });

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isLoading).toBe(false);
    });

    await act(async () => {
      const res = await capturedContext.deactivateLicense();
      expect(res.confirmedOnServer).toBe(false);
    });

    await waitFor(() => {
      expect(capturedContext?.deactivationStatus).toBe('DEACTIVATION_PENDING_CONFIRMATION');
    });
  });

  it('9. Licenza con finestra offline scaduta viene considerata non valida', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId },
      keyPair.privateKey
    );

    // Finestra offline scaduta ieri
    const expiredReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() - 86400000).toISOString(),
        validatedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: expiredReceipt,
      offlineValidUntil: expiredReceipt.receipt.offlineValidUntil,
      lastSuccessfulOnlineValidation: expiredReceipt.receipt.validatedAt,
    });

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isLoading).toBe(false);
    });

    expect(capturedContext.isValid).toBe(false);
    expect(capturedContext.isOfflineValid).toBe(false);
    expect(capturedContext.validationStatus).toBe('OFFLINE_WINDOW_EXPIRED');
  });

  it('10. Licenza con Device Mismatch viene considerata non valida', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const otherDeviceId = 'DEV-99999999-9999-9999-9999-999999999999';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId: otherDeviceId },
      keyPair.privateKey
    );

    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        deviceId: otherDeviceId,
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId: 'DEV-CURRENT-DEVICE-LOCAL',
      status: 'DEVICE_MISMATCH',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
    });

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isLoading).toBe(false);
    });

    expect(capturedContext.isValid).toBe(false);
    expect(capturedContext.isOfflineValid).toBe(false);
    expect(capturedContext.status).toBe('DEVICE_MISMATCH');
  });

  it('11. LicenseSettingsCard mostra input form se nessuna licenza è attiva', async () => {
    render(
      <LicenseProvider>
        <LicenseSettingsCard />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Licenza Software')).toBeInTheDocument();
      expect(screen.getByText('Non attivata')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('Es. ABCD-EFGH-JKMN-PQRQ')).toBeInTheDocument();
    expect(screen.getByText('Attiva Licenza')).toBeInTheDocument();
  });

  it('12. LicenseSettingsCard mostra dettagli, badge e azioni quando licenza è attiva', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId, edition: 'professional' },
      keyPair.privateKey
    );

    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        validatedAt: new Date(Date.now() - 1000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      licenseType: 'professional',
      activatedAt: new Date().toISOString(),
      lastSuccessfulOnlineValidation: new Date().toISOString(),
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
      licenseExpiresAt: signedDoc.license.expiresAt,
      schemaVersion: 2,
    });

    render(
      <LicenseProvider>
        <LicenseSettingsCard />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Attiva e Valida')).toBeInTheDocument();
    });

    expect(screen.getByText('ABCD-****-****-PQRQ')).toBeInTheDocument();
    expect(screen.getByText(/Professional \(Schema V2\)/i)).toBeInTheDocument();
    expect(screen.getByText('Mario Rossi')).toBeInTheDocument();
    expect(screen.getByText('Verifica ora')).toBeInTheDocument();
    expect(screen.getByText('Disattiva Licenza')).toBeInTheDocument();
  });

  it('13. Mascheramento di sicurezza: maskLicenseCode e maskDeviceId funzionano correttamente', () => {
    expect(maskLicenseCode('ABCD-EFGH-JKMN-PQRQ')).toBe('ABCD-****-****-PQRQ');
    expect(maskLicenseCode('12345')).toBe('****');
    expect(maskLicenseCode('')).toBe('***');

    expect(maskDeviceId('DEV-12345678-1234-1234-1234-123456789012')).toBe('DEV-1234...56789012');
    expect(maskDeviceId('12345')).toBe('****');
    expect(maskDeviceId('')).toBe('***');
  });

  it('14. Retrocompatibilità: licenseState e licenseInfo legacy sono valorizzati dal context', async () => {
    const code = 'ABCD-EFGH-JKMN-PQRQ';
    const deviceId = 'DEV-12345678-1234-1234-1234-123456789012';

    const signedDoc = createSignedTestDocumentV2(
      { licenseCode: code, deviceId, term: 'perpetual' },
      keyPair.privateKey
    );

    const signedReceipt = createSignedTestReceiptV1(
      {
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        validatedAt: new Date(Date.now() - 1000).toISOString(),
      },
      signedDoc,
      keyPair.privateKey
    );

    await localLicenseRepository.save({
      licenseCode: code,
      deviceId,
      status: 'VALID',
      signedLicenseDocument: signedDoc,
      signedValidationReceipt: signedReceipt,
      offlineValidUntil: signedReceipt.receipt.offlineValidUntil,
    });

    let capturedContext: any = null;

    render(
      <LicenseProvider>
        <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
      </LicenseProvider>
    );

    await waitFor(() => {
      expect(capturedContext?.isValid).toBe(true);
    });

    expect(capturedContext.licenseInfo).toBeDefined();
    expect(capturedContext.licenseInfo.licenseId).toBe(code);
    expect(capturedContext.licenseInfo.isActive).toBe(true);
    expect(capturedContext.licenseState).toBeDefined();
    expect(capturedContext.licenseState.licenseId).toBe(code);
  });
});
