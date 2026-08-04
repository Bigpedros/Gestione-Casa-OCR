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
