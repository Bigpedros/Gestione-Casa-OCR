/* global process */
export interface ActivationConfig {
  serviceUrl: string;
  productId: string;
  appVersion: string;
  timeoutMs: number;
  publicKey: string;
  publicKeysMap: Record<string, string>;
}

function getEnvVar(key: string, defaultValue: string): string {
  // 1. Tenta da import.meta.env (Vite client-side)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch {
    // Ignora errori se import.meta non è supportato
  }

  // 2. Tenta da process.env (Node / SSR / Vitest)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key]!;
  }

  return defaultValue;
}

export const ACTIVATION_CONFIG: ActivationConfig = {
  get serviceUrl(): string {
    return getEnvVar('VITE_ACTIVATION_SERVICE_URL', '');
  },

  get productId(): string {
    return getEnvVar('VITE_ACTIVATION_PRODUCT_ID', 'gestione-casa-ocr');
  },

  get appVersion(): string {
    return getEnvVar('VITE_APP_VERSION', '1.0.0');
  },

  get timeoutMs(): number {
    const val = getEnvVar('VITE_ACTIVATION_TIMEOUT_MS', '10000');
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 10000 : parsed;
  },

  get publicKey(): string {
    return getEnvVar('VITE_ACTIVATION_PUBLIC_KEY', '');
  },

  get publicKeysMap(): Record<string, string> {
    const rawMap = getEnvVar('VITE_ACTIVATION_PUBLIC_KEYS_MAP', '{}');
    try {
      return JSON.parse(rawMap);
    } catch {
      return {};
    }
  },
};
