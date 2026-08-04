import {
  LicenseRecord,
  LicenseStatus,
  LicenseType,
  LicenseValidationResult,
  PublicLicenseInfo,
} from '../types/license';

const STORAGE_KEY = 'gestione_casa_license_v1';

export const DEFAULT_LICENSE_RECORD: LicenseRecord = {
  licenseId: '',
  licenseType: 'beta_60_days',
  activationDate: null,
  expirationDate: null,
  status: 'not_activated',
  remainingDays: null,
  version: '1.0.0',
  owner: '',
  notes: '',
  lastCheck: null,
};

class LicenseService {
  private memoryCache: LicenseRecord | null = null;

  /**
   * Inizializzazione dello stato licenza dal layer di persistenza
   */
  public async initialize(): Promise<LicenseRecord> {
    try {
      const stored = this.readFromStorage();
      if (stored) {
        this.memoryCache = stored;
        return stored;
      }
    } catch {
      // Fallback in memory se storage non disponibile
    }

    this.memoryCache = { ...DEFAULT_LICENSE_RECORD };
    return this.memoryCache;
  }

  /**
   * Lettura dello stato corrente della licenza
   */
  public getState(): LicenseRecord {
    if (!this.memoryCache) {
      const stored = this.readFromStorage();
      this.memoryCache = stored || { ...DEFAULT_LICENSE_RECORD };
    }
    return { ...this.memoryCache };
  }

  /**
   * Salvataggio dello stato licenza nel layer di persistenza
   */
  public save(state: LicenseRecord): void {
    const updatedState: LicenseRecord = {
      ...state,
      lastCheck: new Date().toISOString(),
    };
    this.memoryCache = updatedState;
    this.writeToStorage(updatedState);
  }

  /**
   * Validazione di un'istanza o dello stato corrente di licenza
   */
  public validate(state?: LicenseRecord): LicenseValidationResult {
    const target = state || this.getState();

    if (!target.licenseId || target.status === 'not_activated') {
      return {
        isValid: false,
        status: 'not_activated',
        remainingDays: null,
        reason: 'Licenza non attivata',
      };
    }

    if (target.status === 'beta_expired') {
      return {
        isValid: false,
        status: 'beta_expired',
        remainingDays: 0,
        reason: 'Licenza beta scaduta',
      };
    }

    if (target.status === 'suspended') {
      return {
        isValid: false,
        status: 'suspended',
        remainingDays: target.remainingDays,
        reason: 'Licenza sospesa',
      };
    }

    if (target.status === 'invalid') {
      return {
        isValid: false,
        status: 'invalid',
        remainingDays: null,
        reason: 'Licenza non valida',
      };
    }

    const expCheck = this.checkExpiration(target);
    if (expCheck.isExpired) {
      const expiredStatus: LicenseStatus =
        target.licenseType === 'beta_60_days' ? 'beta_expired' : 'invalid';
      return {
        isValid: false,
        status: expiredStatus,
        remainingDays: 0,
        reason: 'Licenza scaduta',
      };
    }

    return {
      isValid: true,
      status: target.status,
      remainingDays: expCheck.remainingDays,
    };
  }

  /**
   * Verifica scadenza basata sulle date
   */
  public checkExpiration(state?: LicenseRecord): {
    isExpired: boolean;
    remainingDays: number | null;
  } {
    const target = state || this.getState();
    if (!target.expirationDate) {
      // Se non c'è data di scadenza (es. licenza definitiva), non è mai scaduta
      if (target.licenseType === 'lifetime_perpetual') {
        return { isExpired: false, remainingDays: null };
      }
      return { isExpired: false, remainingDays: target.remainingDays };
    }

    const now = new Date();
    const exp = new Date(target.expirationDate);
    const diffMs = exp.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs <= 0) {
      return { isExpired: true, remainingDays: 0 };
    }

    return { isExpired: false, remainingDays: diffDays };
  }

  /**
   * Attivazione licenza
   */
  public activate(licenseData: Partial<LicenseRecord>): LicenseRecord {
    const current = this.getState();
    const type: LicenseType = licenseData.licenseType || 'beta_60_days';
    const nowISO = new Date().toISOString();

    let initialStatus: LicenseStatus = 'beta_active';
    if (type === 'lifetime_perpetual') {
      initialStatus = 'perpetual_active';
    } else if (type === 'annual' || type === 'enterprise') {
      initialStatus = 'beta_active'; // Sarà gestito in dettaglio nei punti successivi
    }

    const newRecord: LicenseRecord = {
      ...current,
      ...licenseData,
      licenseId: licenseData.licenseId || `LIC-${Date.now()}`,
      licenseType: type,
      activationDate: licenseData.activationDate || nowISO,
      status: licenseData.status || initialStatus,
      lastCheck: nowISO,
    };

    const exp = this.checkExpiration(newRecord);
    newRecord.remainingDays = exp.remainingDays;

    this.save(newRecord);
    return newRecord;
  }

  /**
   * Disattivazione licenza
   */
  public deactivate(): LicenseRecord {
    const deactivated: LicenseRecord = {
      ...DEFAULT_LICENSE_RECORD,
      status: 'not_activated',
      lastCheck: new Date().toISOString(),
    };
    this.save(deactivated);
    return deactivated;
  }

  /**
   * Recupero informazioni pubbliche licenza
   */
  public getInfo(): PublicLicenseInfo {
    const state = this.getState();
    const val = this.validate(state);

    return {
      licenseId: state.licenseId,
      licenseType: state.licenseType,
      status: state.status,
      remainingDays: val.remainingDays,
      expirationDate: state.expirationDate,
      owner: state.owner,
      isActive: val.isValid,
    };
  }

  /**
   * Serializzazione stato per backup/export
   */
  public serialize(state?: LicenseRecord): string {
    const target = state || this.getState();
    return JSON.stringify(target);
  }

  /**
   * Deserializzazione stato da stringa
   */
  public deserialize(jsonString: string): LicenseRecord {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object' || !parsed.licenseType) {
      throw new Error('Formato stringa licenza non valido');
    }
    return parsed as LicenseRecord;
  }

  // --- Helpers per localStorage ---
  private readFromStorage(): LicenseRecord | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return this.deserialize(raw);
  }

  private writeToStorage(record: LicenseRecord): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    localStorage.setItem(STORAGE_KEY, this.serialize(record));
  }
}

export const licenseService = new LicenseService();
