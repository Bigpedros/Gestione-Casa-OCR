import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  LicenseRecord,
  PublicLicenseInfo,
  LocalLicenseState,
  LicenseStatus,
} from '../types/license';
import { licenseService, DEFAULT_LICENSE_RECORD } from '../services/licenseService';
import {
  licenseActivationService,
  type ActivationOperationResult,
  type DeactivationOperationResult,
  type OfflineValidationResult,
  maskLicenseCode,
  localLicenseRepository,
} from '../services/licensing';

export function maskDeviceId(deviceId?: string | null): string {
  if (!deviceId) return '***';
  const clean = deviceId.trim();
  if (clean.length <= 12) return '****';
  return `${clean.substring(0, 8)}...${clean.substring(clean.length - 8)}`;
}

export interface LicenseContextType {
  // Stato Reattivo da Dexie
  localState: LocalLicenseState | null;
  licenseCode: string;
  maskedLicenseCode: string;
  deviceId: string | null;
  maskedDeviceId: string;
  status: string;
  activationStatus: string;
  validationStatus: string;
  isValid: boolean;
  isOfflineValid: boolean;
  offlineValidation: OfflineValidationResult | null;
  lastSuccessfulOnlineValidation: string | null;
  offlineValidUntil: string | null;
  licenseExpiresAt: string | null;
  effectiveUntil: string | null;
  deactivationStatus: 'DEACTIVATED' | 'DEACTIVATION_PENDING_CONFIRMATION' | null;
  schemaVersion: number | null;
  edition: string | null;
  term: string | null;
  owner: string | null;

  // Loading, operazione ed errore
  isLoading: boolean;
  isOperating: boolean;
  error: string | null;

  // Azioni
  activateLicense: (
    codeOrData: string | Partial<LicenseRecord>
  ) => Promise<ActivationOperationResult | { success: boolean; status: string; message: string }>;
  validateLicense: () => Promise<ActivationOperationResult>;
  deactivateLicense: () => Promise<DeactivationOperationResult>;
  refreshLicenseState: () => Promise<void>;

  // Retrocompatibilità Legacy
  licenseState: LicenseRecord;
  licenseInfo: PublicLicenseInfo;
}

const defaultInfo: PublicLicenseInfo = {
  licenseId: '',
  licenseType: 'annual',
  status: 'not_activated',
  remainingDays: null,
  expirationDate: null,
  owner: '',
  isActive: false,
};

export const LicenseContext = createContext<LicenseContextType>({
  localState: null,
  licenseCode: '',
  maskedLicenseCode: 'Non presente',
  deviceId: null,
  maskedDeviceId: 'Non associato',
  status: 'not_activated',
  activationStatus: 'not_activated',
  validationStatus: 'LICENSE_NOT_FOUND',
  isValid: false,
  isOfflineValid: false,
  offlineValidation: null,
  lastSuccessfulOnlineValidation: null,
  offlineValidUntil: null,
  licenseExpiresAt: null,
  effectiveUntil: null,
  deactivationStatus: null,
  schemaVersion: null,
  edition: null,
  term: null,
  owner: null,
  isLoading: true,
  isOperating: false,
  error: null,
  activateLicense: async () => ({ success: false, status: 'NOT_IMPLEMENTED', message: '' }),
  validateLicense: async () => ({ success: false, status: 'NOT_IMPLEMENTED', message: '' }),
  deactivateLicense: async () => ({
    success: false,
    status: 'NOT_IMPLEMENTED',
    confirmedOnServer: false,
    message: '',
  }),
  refreshLicenseState: async () => {},
  licenseState: DEFAULT_LICENSE_RECORD,
  licenseInfo: defaultInfo,
});

export const LicenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dbLicense = useLiveQuery(() => localLicenseRepository.get(), []);
  const [offlineResult, setOfflineResult] = useState<OfflineValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isOperating, setIsOperating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Esecuzione automatica e reattiva della validazione offline al variare di dbLicense
  useEffect(() => {
    let isMounted = true;

    async function evaluateState() {
      if (dbLicense === undefined) {
        try {
          const direct = await localLicenseRepository.get();
          if (!isMounted) return;
          if (direct) {
            const res = await licenseActivationService.validateOfflineLicense({ state: direct });
            if (isMounted) {
              setOfflineResult(res);
              setIsLoading(false);
            }
            return;
          }
        } catch {
          // fallback silently
        }
        if (isMounted) {
          setOfflineResult({
            isValid: false,
            status: 'LICENSE_NOT_FOUND',
            message: 'Nessuna licenza presente localmente.',
            localState: null,
          });
          setIsLoading(false);
        }
        return;
      }

      if (!dbLicense) {
        if (isMounted) {
          setOfflineResult({
            isValid: false,
            status: 'LICENSE_NOT_FOUND',
            message: 'Nessuna licenza presente localmente.',
            localState: null,
          });
          setIsLoading(false);
        }
        return;
      }

      const res = await licenseActivationService.validateOfflineLicense({ state: dbLicense });
      if (isMounted) {
        setOfflineResult(res);
        setIsLoading(false);
      }
    }

    evaluateState();

    return () => {
      isMounted = false;
    };
  }, [dbLicense]);

  // Gestione attivazione licenza
  const activateLicense = useCallback(
    async (codeOrData: string | Partial<LicenseRecord>) => {
      setIsOperating(true);
      setError(null);
      try {
        if (typeof codeOrData === 'string') {
          const result = await licenseActivationService.activateLicense(codeOrData);
          if (!result.success) {
            setError(result.message || 'Attivazione fallita');
          }
          return result;
        } else {
          // Compatibilità parametri legacy
          const code = (codeOrData as any).licenseCode || codeOrData.licenseId;
          if (code && typeof code === 'string' && code.includes('-')) {
            const result = await licenseActivationService.activateLicense(code);
            return result;
          }
          const updated = licenseService.activate(codeOrData);
          return { success: true, status: updated.status, message: 'Attivato (legacy)' };
        }
      } catch (err: any) {
        const msg = err?.message || "Errore durante l'attivazione della licenza";
        setError(msg);
        return { success: false, status: 'ERROR', message: msg };
      } finally {
        setIsOperating(false);
      }
    },
    []
  );

  // Gestione validazione online
  const validateLicense = useCallback(async () => {
    setIsOperating(true);
    setError(null);
    try {
      const result = await licenseActivationService.validateLicense();
      if (!result.success && !result.isNetworkError) {
        setError(result.message || 'Validazione fallita dal server');
      }
      return result;
    } catch (err: any) {
      const msg = err?.message || 'Errore durante la validazione della licenza';
      setError(msg);
      return { success: false, status: 'ERROR', message: msg, isNetworkError: true };
    } finally {
      setIsOperating(false);
    }
  }, []);

  // Gestione disattivazione licenza
  const deactivateLicense = useCallback(async () => {
    setIsOperating(true);
    setError(null);
    try {
      const result = await licenseActivationService.deactivateLicense();
      if (!result.success) {
        setError(result.message || 'Disattivazione non riuscita');
      }
      return result;
    } catch (err: any) {
      const msg = err?.message || 'Errore durante la disattivazione della licenza';
      setError(msg);
      return { success: false, status: 'ERROR', confirmedOnServer: false, message: msg };
    } finally {
      setIsOperating(false);
    }
  }, []);

  // Aggiornamento/refresh manuale dello stato
  const refreshLicenseState = useCallback(async () => {
    const current = await localLicenseRepository.get();
    const res = await licenseActivationService.validateOfflineLicense({ state: current || null });
    setOfflineResult(res);
  }, []);

  const currentLocalState = dbLicense !== undefined ? dbLicense : (offlineResult?.localState || null);
  const rawCode = currentLocalState?.licenseCode || '';
  const maskedCode = rawCode ? maskLicenseCode(rawCode) : 'Non presente';
  const currentDeviceId = currentLocalState?.deviceId || null;
  const maskedDevId = currentDeviceId ? maskDeviceId(currentDeviceId) : 'Non associato';

  const doc = currentLocalState?.signedLicenseDocument?.license;
  const edition = (doc as any)?.edition || currentLocalState?.licenseType || null;
  const term = (doc as any)?.term || null;
  const owner = doc?.owner || null;
  const schemaVer = doc?.schemaVersion || currentLocalState?.schemaVersion || null;
  const expiresAt =
    currentLocalState?.licenseExpiresAt ||
    currentLocalState?.expiresAt ||
    doc?.expiresAt ||
    null;
  const offlineValidUntil = currentLocalState?.offlineValidUntil || null;
  const lastOnline = currentLocalState?.lastSuccessfulOnlineValidation || null;
  const deactStatus = currentLocalState?.deactivationStatus || null;

  const isOfflineValid = Boolean(offlineResult?.isValid);
  const isValid = isOfflineValid;
  const status = currentLocalState?.status || 'not_activated';
  const activationStatus = currentLocalState?.status || 'not_activated';
  const validationStatus = offlineResult?.status || 'LICENSE_NOT_FOUND';
  const effectiveUntil = offlineResult?.effectiveUntil || null;

  // Retrocompatibilità legacy
  const legacyLicenseInfo: PublicLicenseInfo = useMemo(() => {
    let legacyStatus: LicenseStatus = 'not_activated';
    if (isValid) {
      legacyStatus =
        term === 'perpetual' || edition === 'perpetual' ? 'perpetual_active' : 'beta_active';
    } else if (status === 'LICENSE_EXPIRED' || validationStatus === 'LICENSE_EXPIRED') {
      legacyStatus = 'beta_expired';
    } else if (status === 'LICENSE_SUSPENDED' || validationStatus === 'LICENSE_SUSPENDED') {
      legacyStatus = 'suspended';
    } else if (
      status === 'LICENSE_REVOKED' ||
      validationStatus === 'LICENSE_REVOKED' ||
      status === 'DEVICE_MISMATCH' ||
      validationStatus === 'DEVICE_MISMATCH'
    ) {
      legacyStatus = 'invalid';
    }

    return {
      licenseId: rawCode,
      licenseType: (edition as any) || 'annual',
      status: legacyStatus,
      remainingDays: null,
      expirationDate: expiresAt,
      owner: owner || '',
      isActive: isValid,
    };
  }, [isValid, status, validationStatus, term, edition, rawCode, expiresAt, owner]);

  const legacyLicenseState: LicenseRecord = useMemo(() => {
    return {
      licenseId: rawCode,
      licenseType: (edition as any) || 'annual',
      activationDate: currentLocalState?.activatedAt || null,
      expirationDate: expiresAt,
      status: legacyLicenseInfo.status,
      remainingDays: null,
      version: String(schemaVer || '2.1'),
      owner: owner || '',
      notes: '',
      lastCheck: lastOnline,
    };
  }, [
    rawCode,
    edition,
    currentLocalState?.activatedAt,
    expiresAt,
    legacyLicenseInfo.status,
    schemaVer,
    owner,
    lastOnline,
  ]);

  return (
    <LicenseContext.Provider
      value={{
        localState: currentLocalState,
        licenseCode: rawCode,
        maskedLicenseCode: maskedCode,
        deviceId: currentDeviceId,
        maskedDeviceId: maskedDevId,
        status,
        activationStatus,
        validationStatus,
        isValid,
        isOfflineValid,
        offlineValidation: offlineResult,
        lastSuccessfulOnlineValidation: lastOnline,
        offlineValidUntil,
        licenseExpiresAt: expiresAt,
        effectiveUntil,
        deactivationStatus: deactStatus,
        schemaVersion: schemaVer,
        edition,
        term,
        owner,
        isLoading,
        isOperating,
        error,
        activateLicense,
        validateLicense,
        deactivateLicense,
        refreshLicenseState,
        licenseState: legacyLicenseState,
        licenseInfo: legacyLicenseInfo,
      }}
    >
      {children}
    </LicenseContext.Provider>
  );
};

export const useLicenseContext = () => useContext(LicenseContext);

