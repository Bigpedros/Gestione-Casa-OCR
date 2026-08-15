import type {
  SignedLicenseDocument,
  SignedValidationReceiptV1,
} from '@gestione-casa/shared-sdk/activation';

/**
 * Modello Dati e Tipi del Sistema Licenze (Punto 1 Architettura Licenze)
 */

export type LicenseType =
  | 'beta_60_days'
  | 'lifetime_perpetual'
  | 'annual'
  | 'enterprise';

export type LicenseStatus =
  | 'not_activated'
  | 'beta_active'
  | 'beta_expired'
  | 'perpetual_active'
  | 'suspended'
  | 'invalid';

export interface LicenseRecord {
  licenseId: string;
  licenseType: LicenseType;
  activationDate: string | null;
  expirationDate: string | null;
  status: LicenseStatus;
  remainingDays: number | null;
  version: string;
  owner: string;
  notes: string;
  lastCheck: string | null;
}

export interface LocalLicenseState {
  id: string; // ID identificativo, tipicamente 'current'
  licenseCode: string;
  deviceId: string;
  activationId?: string | null;
  status: string; // ActivationStatus | LicenseValidationStatus | LicenseStatus
  licenseType?: string | null;
  activatedAt?: string | null;
  expiresAt?: string | null;
  lastSuccessfulOnlineValidation?: string | null;
  signedLicenseDocument?: SignedLicenseDocument | null;
  signedValidationReceipt?: SignedValidationReceiptV1 | null;
  offlineValidUntil?: string | null;
  licenseExpiresAt?: string | null;
  schemaVersion?: number | null;
  keyId?: string | null;
  deactivationStatus?: 'DEACTIVATED' | 'DEACTIVATION_PENDING_CONFIRMATION' | null;
  updatedAt: string;
}

export interface LicenseValidationResult {
  isValid: boolean;
  status: LicenseStatus;
  remainingDays: number | null;
  reason?: string;
}

export interface PublicLicenseInfo {
  licenseId: string;
  licenseType: LicenseType;
  status: LicenseStatus;
  remainingDays: number | null;
  expirationDate: string | null;
  owner: string;
  isActive: boolean;
}

