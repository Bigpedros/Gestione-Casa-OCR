import { LicenseValidator } from '@gestione-casa/shared-sdk/licensing';
import { validateValidationReceiptBinding } from '@gestione-casa/shared-sdk/activation';
import type { LocalLicenseState } from '../../types/license';
import { localLicenseRepository } from '../../repositories';
import { getOrCreateDeviceId } from '../deviceService';
import { ACTIVATION_CONFIG } from '../../config/activation.config';
import { activationClient, maskLicenseCode } from './activationClient';
import { licenseSignatureVerifier } from './licenseSignatureVerifier';
import { licenseService } from '../licenseService';

export interface ActivationOperationResult {
  success: boolean;
  status: string;
  message?: string;
  localState?: LocalLicenseState | null;
  isNetworkError?: boolean;
}

export interface DeactivationOperationResult {
  success: boolean;
  status: string;
  confirmedOnServer: boolean;
  message?: string;
}

export type OfflineValidationStatus =
  | 'VALID_OFFLINE'
  | 'LICENSE_NOT_FOUND'
  | 'INVALID_LICENSE_SIGNATURE'
  | 'RECEIPT_MISSING'
  | 'INVALID_RECEIPT_SIGNATURE'
  | 'INVALID_BINDING'
  | 'DEVICE_MISMATCH'
  | 'OFFLINE_WINDOW_EXPIRED'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_REVOKED'
  | 'LICENSE_DEACTIVATED'
  | 'LICENSE_SUSPENDED'
  | 'CLOCK_TAMPERING_DETECTED'
  | 'INVALID_STATE';

export interface OfflineValidationResult {
  isValid: boolean;
  status: OfflineValidationStatus;
  message?: string;
  effectiveUntil?: string | null;
  issues?: string[];
  localState?: LocalLicenseState | null;
}

export interface OfflineValidationOptions {
  now?: Date | string;
  state?: LocalLicenseState | null;
  publicKey?: string;
}

export class LicenseActivationService {
  /**
   * Recupera lo stato corrente della licenza locale.
   */
  async getLicenseState(): Promise<LocalLicenseState | undefined> {
    return localLicenseRepository.get();
  }

  /**
   * Orchestra il flusso di attivazione della licenza.
   * 1. Validazione formato codice
   * 2. Recupero/generazione Device ID stasbile
   * 3. Chiamata Activation Client
   * 4. Verifica firma digitale Ed25519 sul SignedLicenseDocument
   * 5. Persistenza locale se valida (MAI persistere se firma non valida)
   */
  async activateLicense(licenseCodeInput: string): Promise<ActivationOperationResult> {
    if (!licenseCodeInput || typeof licenseCodeInput !== 'string') {
      return {
        success: false,
        status: 'INVALID_REQUEST',
        message: 'Codice licenza non fornito o formato non valido.',
      };
    }

    const normalizedCode = licenseCodeInput.trim().toUpperCase();

    // Validazione preventiva del formato codice tramite Shared SDK
    const formatResult = LicenseValidator.parse(normalizedCode);
    if (!formatResult.isValid) {
      return {
        success: false,
        status: 'INVALID_REQUEST',
        message: `Codice licenza ${maskLicenseCode(normalizedCode)} non valido: ${formatResult.error}`,
      };
    }

    const deviceId = await getOrCreateDeviceId();

    const response = await activationClient.activate({
      licenseCode: normalizedCode,
      deviceId,
      productId: ACTIVATION_CONFIG.productId,
      appVersion: ACTIVATION_CONFIG.appVersion,
    });

    if (response.status === 'ACTIVATED' || response.status === 'ALREADY_ACTIVE') {
      // Verifica firma digitale Ed25519 della licenza se presente
      if (response.signedLicense) {
        const signatureResult = await licenseSignatureVerifier.verifySignedLicense(
          response.signedLicense
        );

        if (!signatureResult.isValid) {
          return {
            success: false,
            status: 'INVALID_SIGNATURE',
            message: `Attivazione rifiutata: firma digitale della licenza non valida (${signatureResult.error})`,
          };
        }
      }

      // Verifica firma digitale Ed25519 della receipt se presente
      let validReceipt = null;
      if (response.receipt) {
        const receiptResult = await licenseSignatureVerifier.verifySignedValidationReceipt(
          response.receipt
        );
        if (receiptResult.isValid) {
          validReceipt = response.receipt;
        } else {
          console.warn(`Receipt firmata non valida durante attivazione: ${receiptResult.error}`);
        }
      }

      const nowISO = new Date().toISOString();
      const signedDoc = response.signedLicense;
      const licenseDoc = signedDoc?.license;

      const localState: LocalLicenseState = {
        id: 'current',
        licenseCode: normalizedCode,
        deviceId,
        activationId: response.activationId || null,
        status: response.status,
        licenseType: (licenseDoc as any)?.term || (licenseDoc as any)?.licenseType || 'beta_60_days',
        activatedAt: (licenseDoc as any)?.activatedAt || (licenseDoc as any)?.generatedAt || nowISO,
        expiresAt: licenseDoc?.expiresAt || null,
        lastSuccessfulOnlineValidation: response.serverTime || nowISO,
        signedLicenseDocument: signedDoc || null,
        signedValidationReceipt: validReceipt,
        offlineValidUntil: validReceipt?.receipt.offlineValidUntil || null,
        licenseExpiresAt: validReceipt?.receipt.licenseExpiresAt || licenseDoc?.expiresAt || null,
        schemaVersion: licenseDoc?.schemaVersion || (signedDoc?.signatureVersion as number) || 1,
        keyId: signedDoc?.keyId || validReceipt?.keyId || null,
        deactivationStatus: null,
        updatedAt: nowISO,
      };

      const savedState = await localLicenseRepository.save(localState);

      // Sincronizzazione con il legacy licenseService per compatibilità UI preesistente
      try {
        licenseService.activate({
          licenseId: licenseDoc?.id || `LIC-${normalizedCode}`,
          owner: (licenseDoc as any)?.owner || 'Utente Gestione Casa',
          expirationDate: licenseDoc?.expiresAt || undefined,
          status: response.status === 'ACTIVATED' ? 'beta_active' : 'beta_active',
        });
      } catch {
        // Ignora eventuali eccezioni del legacy service
      }

      return {
        success: true,
        status: response.status,
        message: response.message || 'Licenza attivata con successo.',
        localState: savedState,
      };
    }

    // Se il server restituisce uno stato di errore (non attivato), NON persistere
    return {
      success: false,
      status: response.status,
      message: response.message || `Attivazione licenza fallita con stato: ${response.status}`,
    };
  }

  /**
   * Orchestra il flusso di validazione della licenza locale.
   * 1. Recupero licenza salvata
   * 2. Chiamata Activation Client
   * 3. Aggiornamento timestamp ultimo successo se VALID
   * 4. Aggiornamento stato se REVOKED / EXPIRED
   * 5. In caso di errore di rete: NON invalidare, preservare stato locale
   */
  async validateLicense(): Promise<ActivationOperationResult> {
    const localState = await localLicenseRepository.get();
    if (!localState || !localState.licenseCode) {
      return {
        success: false,
        status: 'LICENSE_NOT_FOUND',
        message: 'Nessuna licenza attivata presente localmente.',
      };
    }

    const deviceId = await getOrCreateDeviceId();

    const response = await activationClient.validate({
      licenseCode: localState.licenseCode,
      deviceId,
      productId: ACTIVATION_CONFIG.productId,
      appVersion: ACTIVATION_CONFIG.appVersion,
    });

    const nowISO = new Date().toISOString();

    if (response.status === 'VALID') {
      // Se il server ha restituito un SignedLicenseDocument aggiornato, ne verifichiamo la firma
      let updatedSignedDoc = localState.signedLicenseDocument;
      if (response.signedLicense) {
        const sigCheck = await licenseSignatureVerifier.verifySignedLicense(
          response.signedLicense
        );
        if (sigCheck.isValid) {
          updatedSignedDoc = response.signedLicense;
        }
      }

      // Se il server ha restituito una nuova receipt, ne verifichiamo la firma
      let updatedReceipt = localState.signedValidationReceipt || null;
      if (response.receipt) {
        const receiptCheck = await licenseSignatureVerifier.verifySignedValidationReceipt(
          response.receipt
        );
        if (receiptCheck.isValid) {
          updatedReceipt = response.receipt;
        } else {
          console.warn(`Receipt firmata non valida durante validazione: ${receiptCheck.error}`);
        }
      }

      const licenseDoc = updatedSignedDoc?.license;

      const updatedState: LocalLicenseState = {
        ...localState,
        status: 'VALID',
        lastSuccessfulOnlineValidation: response.serverTime || response.lastValidatedAt || nowISO,
        signedLicenseDocument: updatedSignedDoc,
        signedValidationReceipt: updatedReceipt,
        offlineValidUntil: updatedReceipt?.receipt.offlineValidUntil || localState.offlineValidUntil || null,
        licenseExpiresAt: updatedReceipt?.receipt.licenseExpiresAt || licenseDoc?.expiresAt || localState.licenseExpiresAt || null,
        schemaVersion: licenseDoc?.schemaVersion || localState.schemaVersion || 1,
        updatedAt: nowISO,
      };

      const saved = await localLicenseRepository.save(updatedState);

      return {
        success: true,
        status: 'VALID',
        message: response.message || 'Validazione licenza online completata con successo.',
        localState: saved,
      };
    }

    // Gestione stati di revoca/scadenza restituiti dal server
    if (
      response.status === 'LICENSE_REVOKED' ||
      response.status === 'LICENSE_EXPIRED' ||
      response.status === 'DEVICE_MISMATCH' ||
      response.status === 'LICENSE_NOT_FOUND'
    ) {
      const updatedState: LocalLicenseState = {
        ...localState,
        status: response.status,
        updatedAt: nowISO,
      };

      const saved = await localLicenseRepository.save(updatedState);

      return {
        success: false,
        status: response.status,
        message: response.message || `Validazione fallita dal server: ${response.status}`,
        localState: saved,
      };
    }

    // Errore di rete / server error: preserva lo stato locale invariato e segnala errore di rete
    return {
      success: false,
      status: response.status || 'SERVER_ERROR',
      message: response.message || 'Impossibile contattare il server per la validazione online.',
      isNetworkError: true,
      localState,
    };
  }

  /**
   * Orchestra il flusso di disattivazione della licenza locale.
   * 1. Recupero licenza salvata
   * 2. Chiamata Activation Client
   * 3. Se confermata dal server (DEACTIVATED): aggiorna/pulisce stato locale
   * 4. Se errore di rete: NON dichiarare confermata, imposta stato 'DEACTIVATION_PENDING_CONFIRMATION'
   */
  async deactivateLicense(): Promise<DeactivationOperationResult> {
    const localState = await localLicenseRepository.get();
    if (!localState || !localState.licenseCode) {
      return {
        success: false,
        status: 'NOT_ACTIVE',
        confirmedOnServer: false,
        message: 'Nessuna licenza presente localmente da disattivare.',
      };
    }

    const deviceId = await getOrCreateDeviceId();

    const response = await activationClient.deactivate({
      licenseCode: localState.licenseCode,
      deviceId,
      productId: ACTIVATION_CONFIG.productId,
    });

    const nowISO = new Date().toISOString();

    if (response.status === 'DEACTIVATED') {
      const updatedState: LocalLicenseState = {
        ...localState,
        status: 'deactivated',
        deactivationStatus: 'DEACTIVATED',
        updatedAt: nowISO,
      };

      await localLicenseRepository.save(updatedState);

      try {
        licenseService.deactivate();
      } catch {
        // Ignora eccezioni del legacy service
      }

      return {
        success: true,
        status: 'DEACTIVATED',
        confirmedOnServer: true,
        message: response.message || 'Licenza disattivata con successo dal server.',
      };
    }

    // Se il server restituisce errore o fallimento di rete
    const updatedState: LocalLicenseState = {
      ...localState,
      deactivationStatus: 'DEACTIVATION_PENDING_CONFIRMATION',
      updatedAt: nowISO,
    };

    await localLicenseRepository.save(updatedState);

    return {
      success: false,
      status: response.status || 'SERVER_ERROR',
      confirmedOnServer: false,
      message: response.message || 'Disattivazione non confermata dal server.',
    };
  }

  /**
   * Esegue la validazione offline locale della licenza persistita.
   * Verifica crittografica rigorosa e fail-closed:
   * 1. Presenza licenza locale
   * 2. Documento SignedLicenseDocument presente e firma Ed25519 valida
   * 3. Ricevuta SignedValidationReceipt presente e firma Ed25519 valida
   * 4. Binding crittografico receipt ↔ licenza ↔ device (Shared SDK)
   * 5. Finestra offlineValidUntil firmata dal server non scaduta
   * 6. Scadenza licenza (licenseExpiresAt / expiresAt) non superata e calcolo effectiveUntil = min(offlineValidUntil, licenseExpiresAt)
   * 7. Nessun rollback temporale dell'orologio (now >= lastSuccessfulOnlineValidation e now >= receipt.validatedAt)
   * 8. Stato licenza non revocato/disattivato/scaduto/sospeso
   */
  async validateOfflineLicense(
    options?: OfflineValidationOptions
  ): Promise<OfflineValidationResult> {
    const localState =
      options?.state !== undefined ? options.state : await localLicenseRepository.get();

    if (!localState || !localState.licenseCode) {
      return {
        isValid: false,
        status: 'LICENSE_NOT_FOUND',
        message: 'Nessuna licenza presente localmente per la validazione offline.',
        localState: null,
      };
    }

    const normStatus = (localState.status || '').toLowerCase();

    // 1. Controllo preliminare sullo stato locale di disattivazione / revoca / scadenza esplicita
    if (
      localState.deactivationStatus === 'DEACTIVATED' ||
      normStatus === 'deactivated'
    ) {
      return {
        isValid: false,
        status: 'LICENSE_DEACTIVATED',
        message: 'La licenza risulta disattivata. Accesso offline non autorizzato.',
        localState,
      };
    }

    if (normStatus === 'license_revoked' || normStatus === 'revoked') {
      return {
        isValid: false,
        status: 'LICENSE_REVOKED',
        message: 'La licenza risulta revocata. Accesso offline non autorizzato.',
        localState,
      };
    }

    if (normStatus === 'license_suspended' || normStatus === 'suspended') {
      return {
        isValid: false,
        status: 'LICENSE_SUSPENDED',
        message: 'La licenza risulta sospesa. Accesso offline non autorizzato.',
        localState,
      };
    }

    if (normStatus === 'license_expired' || normStatus === 'expired') {
      return {
        isValid: false,
        status: 'LICENSE_EXPIRED',
        message: 'La licenza risulta scaduta. Accesso offline non autorizzato.',
        localState,
      };
    }

    // 2. Controllo presenza e firma digitale della licenza firmata (SignedLicenseDocument)
    const signedDoc = localState.signedLicenseDocument;
    if (!signedDoc || !signedDoc.license) {
      return {
        isValid: false,
        status: 'INVALID_LICENSE_SIGNATURE',
        message: 'Documento di licenza firmato assente o non valido.',
        localState,
      };
    }

    const licenseSigCheck = await licenseSignatureVerifier.verifySignedLicense(
      signedDoc,
      options?.publicKey
    );
    if (!licenseSigCheck.isValid) {
      return {
        isValid: false,
        status: 'INVALID_LICENSE_SIGNATURE',
        message: `Firma digitale della licenza non valida: ${licenseSigCheck.error}`,
        localState,
      };
    }

    // Controllo stato interno al LicenseDocument
    const licDocStatus = ((signedDoc.license as any).status || '').toLowerCase();
    if (licDocStatus === 'revoked') {
      return {
        isValid: false,
        status: 'LICENSE_REVOKED',
        message: 'La licenza firmata contiene uno stato revocato.',
        localState,
      };
    }
    if (licDocStatus === 'deactivated') {
      return {
        isValid: false,
        status: 'LICENSE_DEACTIVATED',
        message: 'La licenza firmata contiene uno stato disattivato.',
        localState,
      };
    }
    if (licDocStatus === 'suspended') {
      return {
        isValid: false,
        status: 'LICENSE_SUSPENDED',
        message: 'La licenza firmata contiene uno stato sospeso.',
        localState,
      };
    }
    if (licDocStatus === 'expired') {
      return {
        isValid: false,
        status: 'LICENSE_EXPIRED',
        message: 'La licenza firmata contiene uno stato scaduto.',
        localState,
      };
    }

    // 3. Controllo presenza e firma della ricevuta di validazione (SignedValidationReceipt)
    const signedReceipt = localState.signedValidationReceipt;
    if (!signedReceipt || !signedReceipt.receipt) {
      return {
        isValid: false,
        status: 'RECEIPT_MISSING',
        message: 'Ricevuta di validazione firmata assente. Accesso offline non autorizzato.',
        localState,
      };
    }

    const receiptSigCheck = await licenseSignatureVerifier.verifySignedValidationReceipt(
      signedReceipt,
      options?.publicKey
    );
    if (!receiptSigCheck.isValid) {
      return {
        isValid: false,
        status: 'INVALID_RECEIPT_SIGNATURE',
        message: `Firma digitale della ricevuta di validazione non valida: ${receiptSigCheck.error}`,
        localState,
      };
    }

    const receipt = signedReceipt.receipt;
    const license = signedDoc.license;

    // 4. Binding crittografico receipt ↔ licenza ↔ device tramite Shared SDK 0.5.1
    const bindingResult = validateValidationReceiptBinding(
      receipt,
      license,
      localState.deviceId
    );

    if (!bindingResult.isValid) {
      const isDeviceMismatch = (bindingResult.issues || []).some(
        (issue) => issue.field === 'deviceId' || issue.code === 'INVALID_DEVICE'
      );
      return {
        isValid: false,
        status: isDeviceMismatch ? 'DEVICE_MISMATCH' : 'INVALID_BINDING',
        message: `Binding crittografico fallito: ${bindingResult.issues?.map((i) => i.message).join('; ') || 'invalido'}`,
        issues: bindingResult.issues?.map((i) => `${i.field}: ${i.message}`),
        localState,
      };
    }

    // Verifica aggiuntiva corrispondenza deviceId locale se presente nella licenza
    if (license.deviceId && license.deviceId !== localState.deviceId) {
      return {
        isValid: false,
        status: 'DEVICE_MISMATCH',
        message: `Il Device ID della licenza (${license.deviceId}) non corrisponde al device locale (${localState.deviceId}).`,
        localState,
      };
    }

    // 5. Controllo temporale e anti-tampering (Clock rollback)
    const now = options?.now
      ? typeof options.now === 'string'
        ? new Date(options.now)
        : options.now
      : new Date();
    const nowMs = now.getTime();

    if (isNaN(nowMs)) {
      return {
        isValid: false,
        status: 'INVALID_STATE',
        message: 'Data corrente non valida per la verifica temporale.',
        localState,
      };
    }

    // Controllo rollback rispetto a lastSuccessfulOnlineValidation
    if (localState.lastSuccessfulOnlineValidation) {
      const lastOnlineMs = new Date(localState.lastSuccessfulOnlineValidation).getTime();
      if (!isNaN(lastOnlineMs) && nowMs < lastOnlineMs) {
        return {
          isValid: false,
          status: 'CLOCK_TAMPERING_DETECTED',
          message:
            'Rilevato arretramento dell\'orologio di sistema rispetto all\'ultima validazione online certificata.',
          localState,
        };
      }
    }

    // Controllo rollback rispetto a receipt.validatedAt
    if (receipt.validatedAt) {
      const validatedAtMs = new Date(receipt.validatedAt).getTime();
      if (!isNaN(validatedAtMs) && nowMs < validatedAtMs) {
        return {
          isValid: false,
          status: 'CLOCK_TAMPERING_DETECTED',
          message:
            'Rilevato arretramento dell\'orologio di sistema rispetto alla data di emissione della ricevuta.',
          localState,
        };
      }
    }

    // 6. Controllo finestra offline (offlineValidUntil firmato dal server)
    const offlineValidUntil = receipt.offlineValidUntil;
    if (!offlineValidUntil) {
      return {
        isValid: false,
        status: 'OFFLINE_WINDOW_EXPIRED',
        message: 'Nessuna finestra di validazione offline concessa (offlineValidUntil è null).',
        effectiveUntil: null,
        localState,
      };
    }

    const offlineValidMs = new Date(offlineValidUntil).getTime();
    if (isNaN(offlineValidMs)) {
      return {
        isValid: false,
        status: 'OFFLINE_WINDOW_EXPIRED',
        message: 'Data offlineValidUntil firmata non valida.',
        effectiveUntil: null,
        localState,
      };
    }

    // 7. Controllo scadenza licenza (licenseExpiresAt / expiresAt) e calcolo clamp effectiveUntil
    const rawLicExpiresAt =
      receipt.licenseExpiresAt ||
      (license as any).expiresAt ||
      localState.licenseExpiresAt ||
      localState.expiresAt;

    let licenseExpiresMs: number | null = null;
    if (rawLicExpiresAt) {
      const parsedLicExpMs = new Date(rawLicExpiresAt).getTime();
      if (!isNaN(parsedLicExpMs)) {
        licenseExpiresMs = parsedLicExpMs;
      }
    }

    // Calcolo limite effettivo: effectiveUntil = min(offlineValidUntil, licenseExpiresAt) se licenseExpiresAt esiste, altrimenti offlineValidUntil
    const effectiveUntilMs =
      licenseExpiresMs !== null
        ? Math.min(offlineValidMs, licenseExpiresMs)
        : offlineValidMs;
    const effectiveUntil = new Date(effectiveUntilMs).toISOString();

    // Se la licenza è scaduta prima della finestra offline
    if (licenseExpiresMs !== null && nowMs > licenseExpiresMs) {
      return {
        isValid: false,
        status: 'LICENSE_EXPIRED',
        message: `La licenza è scaduta il ${new Date(licenseExpiresMs).toISOString()}.`,
        effectiveUntil,
        localState,
      };
    }

    // Se l'ora corrente supera offlineValidUntil
    if (nowMs > offlineValidMs) {
      return {
        isValid: false,
        status: 'OFFLINE_WINDOW_EXPIRED',
        message: `La finestra di validazione offline è scaduta il ${offlineValidUntil}.`,
        effectiveUntil,
        localState,
      };
    }

    // Se l'ora corrente supera il limite effettivo clamped
    if (nowMs > effectiveUntilMs) {
      return {
        isValid: false,
        status: 'OFFLINE_WINDOW_EXPIRED',
        message: `La validità offline effettiva è scaduta il ${effectiveUntil}.`,
        effectiveUntil,
        localState,
      };
    }

    // 8. Tutti i requisiti soddisfatti con successo: autorizzazione offline
    return {
      isValid: true,
      status: 'VALID_OFFLINE',
      message: 'Validazione offline autorizzata con successo.',
      effectiveUntil,
      localState,
    };
  }
}

export const licenseActivationService = new LicenseActivationService();
