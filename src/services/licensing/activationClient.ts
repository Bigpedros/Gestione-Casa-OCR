import {
  createActivationRequestEnvelope,
  serializeActivationRequestEnvelope,
  deserializeActivationResponseEnvelope,
  validateActivationResponseEnvelope,
  createLicenseValidationRequestEnvelope,
  serializeLicenseValidationRequestEnvelope,
  deserializeLicenseValidationResponseEnvelope,
  validateLicenseValidationResponseEnvelope,
  createLicenseDeactivationRequestEnvelope,
  serializeLicenseDeactivationRequestEnvelope,
  deserializeLicenseDeactivationResponseEnvelope,
  validateLicenseDeactivationResponseEnvelope,
  type ActivationRequest,
  type ActivationResponse,
  type LicenseValidationRequest,
  type LicenseValidationResponse,
  type LicenseDeactivationRequest,
  type LicenseDeactivationResponse,
} from '@gestione-casa/shared-sdk/activation';
import { ACTIVATION_CONFIG } from '../../config/activation.config';

/**
 * Utilità per mascherare il licenseCode per i log sicuri (NON loggare mai il licenseCode completo).
 */
export function maskLicenseCode(code?: string | null): string {
  if (!code) return '***';
  const clean = code.trim();
  if (clean.length <= 8) return '****';
  return `${clean.substring(0, 4)}-****-****-${clean.substring(clean.length - 4)}`;
}

export const activationClient = {
  /**
   * Richiede l'attivazione di una licenza presso l'Activation Service.
   * Endpoint: POST /api/licenses/activate
   */
  async activate(request: ActivationRequest): Promise<ActivationResponse> {
    const serviceUrl = ACTIVATION_CONFIG.serviceUrl;
    if (!serviceUrl) {
      return {
        status: 'SERVER_ERROR',
        message: 'URL Activation Service non configurato (VITE_ACTIVATION_SERVICE_URL mancante).',
        serverTime: new Date().toISOString(),
        requestId: `local-err-${Date.now()}`,
      };
    }

    // 1. Creazione busta di richiesta tramite Shared SDK
    const envelopeResult = createActivationRequestEnvelope(request);
    if (!envelopeResult.isValid || !envelopeResult.value) {
      const issueDetails = envelopeResult.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
      return {
        status: 'INVALID_REQUEST',
        message: `Validazione busta richiesta attivazione fallita: ${issueDetails}`,
        serverTime: new Date().toISOString(),
        requestId: `local-val-${Date.now()}`,
      };
    }

    // 2. Serializzazione JSON
    const serializedResult = serializeActivationRequestEnvelope(envelopeResult.value);
    if (!serializedResult.isValid || !serializedResult.value) {
      return {
        status: 'INVALID_REQUEST',
        message: 'Impossibile serializzare la busta di richiesta attivazione.',
        serverTime: new Date().toISOString(),
        requestId: envelopeResult.value.requestId,
      };
    }

    // 3. Invio HTTP POST con timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ACTIVATION_CONFIG.timeoutMs);
    const endpoint = `${serviceUrl}/api/licenses/activate`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: serializedResult.value,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const responseText = await response.text();

      // 4. Deserializzazione busta risposta tramite Shared SDK
      const deserializedResult = deserializeActivationResponseEnvelope(responseText);
      if (!deserializedResult.isValid || !deserializedResult.value) {
        return {
          status: 'SERVER_ERROR',
          message: `Formato busta risposta non valido da ${endpoint}: ${responseText.substring(0, 100)}`,
          serverTime: new Date().toISOString(),
          requestId: envelopeResult.value.requestId,
        };
      }

      // 5. Validazione busta risposta tramite Shared SDK
      const responseEnvelope = deserializedResult.value;
      const validationResult = validateActivationResponseEnvelope(responseEnvelope);
      if (!validationResult.isValid) {
        const issuesText = validationResult.issues
          .map((i: any) => `${i.field}: ${i.message}`)
          .join('; ');
        return {
          status: 'SERVER_ERROR',
          message: `Busta risposta non conforme allo schema SDK: ${issuesText}`,
          serverTime: responseEnvelope.createdAt || new Date().toISOString(),
          requestId: responseEnvelope.requestId,
        };
      }

      return responseEnvelope.response;
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === 'AbortError';
      return {
        status: 'SERVER_ERROR',
        message: isTimeout
          ? `Timeout di connessione all'Activation Service (${ACTIVATION_CONFIG.timeoutMs}ms)`
          : `Errore di rete durante la connessione a ${endpoint}: ${err?.message || err}`,
        serverTime: new Date().toISOString(),
        requestId: envelopeResult.value.requestId,
      };
    }
  },

  /**
   * Richiede la validazione online di una licenza attivata.
   * Endpoint: POST /api/licenses/validate
   */
  async validate(request: LicenseValidationRequest): Promise<LicenseValidationResponse> {
    const serviceUrl = ACTIVATION_CONFIG.serviceUrl;
    if (!serviceUrl) {
      return {
        status: 'SERVER_ERROR',
        message: 'URL Activation Service non configurato (VITE_ACTIVATION_SERVICE_URL mancante).',
        lastValidatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: `local-err-${Date.now()}`,
      };
    }

    const envelopeResult = createLicenseValidationRequestEnvelope(request);
    if (!envelopeResult.isValid || !envelopeResult.value) {
      const issueDetails = envelopeResult.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
      return {
        status: 'INVALID_REQUEST',
        message: `Validazione busta richiesta validazione fallita: ${issueDetails}`,
        lastValidatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: `local-val-${Date.now()}`,
      };
    }

    const serializedResult = serializeLicenseValidationRequestEnvelope(envelopeResult.value);
    if (!serializedResult.isValid || !serializedResult.value) {
      return {
        status: 'INVALID_REQUEST',
        message: 'Impossibile serializzare la busta di richiesta validazione.',
        lastValidatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: envelopeResult.value.requestId,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ACTIVATION_CONFIG.timeoutMs);
    const endpoint = `${serviceUrl}/api/licenses/validate`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: serializedResult.value,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const responseText = await response.text();

      const deserializedResult = deserializeLicenseValidationResponseEnvelope(responseText);
      if (!deserializedResult.isValid || !deserializedResult.value) {
        return {
          status: 'SERVER_ERROR',
          message: `Formato busta risposta non valido da ${endpoint}: ${responseText.substring(0, 100)}`,
          lastValidatedAt: new Date().toISOString(),
          serverTime: new Date().toISOString(),
          requestId: envelopeResult.value.requestId,
        };
      }

      const responseEnvelope = deserializedResult.value;
      const validationResult = validateLicenseValidationResponseEnvelope(responseEnvelope);
      if (!validationResult.isValid) {
        const issuesText = validationResult.issues
          .map((i: any) => `${i.field}: ${i.message}`)
          .join('; ');
        return {
          status: 'SERVER_ERROR',
          message: `Busta risposta validazione non conforme allo schema SDK: ${issuesText}`,
          lastValidatedAt: responseEnvelope.response?.lastValidatedAt || new Date().toISOString(),
          serverTime: responseEnvelope.createdAt || new Date().toISOString(),
          requestId: responseEnvelope.requestId,
        };
      }

      return responseEnvelope.response;
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === 'AbortError';
      return {
        status: 'SERVER_ERROR',
        message: isTimeout
          ? `Timeout di connessione all'Activation Service (${ACTIVATION_CONFIG.timeoutMs}ms)`
          : `Errore di rete durante la connessione a ${endpoint}: ${err?.message || err}`,
        lastValidatedAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
        requestId: envelopeResult.value.requestId,
      };
    }
  },

  /**
   * Richiede la disattivazione di una licenza attivata.
   * Endpoint: POST /api/licenses/deactivate
   */
  async deactivate(request: LicenseDeactivationRequest): Promise<LicenseDeactivationResponse> {
    const serviceUrl = ACTIVATION_CONFIG.serviceUrl;
    if (!serviceUrl) {
      return {
        status: 'SERVER_ERROR',
        message: 'URL Activation Service non configurato (VITE_ACTIVATION_SERVICE_URL mancante).',
        serverTime: new Date().toISOString(),
        requestId: `local-err-${Date.now()}`,
      };
    }

    const envelopeResult = createLicenseDeactivationRequestEnvelope(request);
    if (!envelopeResult.isValid || !envelopeResult.value) {
      const issueDetails = envelopeResult.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
      return {
        status: 'INVALID_REQUEST',
        message: `Validazione busta richiesta disattivazione fallita: ${issueDetails}`,
        serverTime: new Date().toISOString(),
        requestId: `local-val-${Date.now()}`,
      };
    }

    const serializedResult = serializeLicenseDeactivationRequestEnvelope(envelopeResult.value);
    if (!serializedResult.isValid || !serializedResult.value) {
      return {
        status: 'INVALID_REQUEST',
        message: 'Impossibile serializzare la busta di richiesta disattivazione.',
        serverTime: new Date().toISOString(),
        requestId: envelopeResult.value.requestId,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ACTIVATION_CONFIG.timeoutMs);
    const endpoint = `${serviceUrl}/api/licenses/deactivate`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: serializedResult.value,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const responseText = await response.text();

      const deserializedResult = deserializeLicenseDeactivationResponseEnvelope(responseText);
      if (!deserializedResult.isValid || !deserializedResult.value) {
        return {
          status: 'SERVER_ERROR',
          message: `Formato busta risposta non valido da ${endpoint}: ${responseText.substring(0, 100)}`,
          serverTime: new Date().toISOString(),
          requestId: envelopeResult.value.requestId,
        };
      }

      const responseEnvelope = deserializedResult.value;
      const validationResult = validateLicenseDeactivationResponseEnvelope(responseEnvelope);
      if (!validationResult.isValid) {
        const issuesText = validationResult.issues
          .map((i: any) => `${i.field}: ${i.message}`)
          .join('; ');
        return {
          status: 'SERVER_ERROR',
          message: `Busta risposta disattivazione non conforme allo schema SDK: ${issuesText}`,
          serverTime: responseEnvelope.createdAt || new Date().toISOString(),
          requestId: responseEnvelope.requestId,
        };
      }

      return responseEnvelope.response;
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === 'AbortError';
      return {
        status: 'SERVER_ERROR',
        message: isTimeout
          ? `Timeout di connessione all'Activation Service (${ACTIVATION_CONFIG.timeoutMs}ms)`
          : `Errore di rete durante la connessione a ${endpoint}: ${err?.message || err}`,
        serverTime: new Date().toISOString(),
        requestId: envelopeResult.value.requestId,
      };
    }
  },
};
