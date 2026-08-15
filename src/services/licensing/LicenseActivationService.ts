import { LicenseValidator } from '@gestione-casa/shared-sdk/licensing';
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
}

export const licenseActivationService = new LicenseActivationService();
