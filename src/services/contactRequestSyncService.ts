import {
  deserializeContactRequestExchangeEnvelope,
  ContactRequestValidator,
} from '@gestione-casa/shared-sdk';
import type { ContactRequestDocument } from '@gestione-casa/shared-sdk/contact-requests';
import {
  contactRequestRepository,
  type ApplyRemoteRecordResult,
} from '../repositories';

export interface ImportSyncResponseResult {
  success: boolean;
  status: ApplyRemoteRecordResult['status'] | 'invalid_format';
  requestId?: string;
  document?: ContactRequestDocument;
  message: string;
  issues?: string[];
}

export async function importContactRequestSyncResponse(
  jsonContent: string
): Promise<ImportSyncResponseResult> {
  if (!jsonContent || typeof jsonContent !== 'string' || jsonContent.trim() === '') {
    return {
      success: false,
      status: 'invalid_format',
      message: 'Il contenuto del file JSON è vuoto o non valido.',
    };
  }

  // 1. Deserialize envelope using SDK
  const envelopeRes = deserializeContactRequestExchangeEnvelope(jsonContent);
  if (!envelopeRes.isValid || !envelopeRes.value) {
    return {
      success: false,
      status: 'invalid_format',
      message: 'Formato o versione dell’inviluppo JSON non valido.',
      issues: envelopeRes.issues.map((i) => `${i.field}: ${i.message}`),
    };
  }

  const envelope = envelopeRes.value;

  if (
    envelope.format !== 'gestione-casa-contact-request' ||
    envelope.formatVersion !== 1
  ) {
    return {
      success: false,
      status: 'invalid_format',
      message: 'Inviluppo di scambio non riconosciuto (format o formatVersion errato).',
    };
  }

  const request = envelope.request;
  if (!request) {
    return {
      success: false,
      status: 'invalid_format',
      message: 'L’inviluppo non contiene un documento di richiesta di contatto.',
    };
  }

  // 2. Validate ContactRequestDocument using SDK Validator
  const docValidation = ContactRequestValidator.validate(request);
  if (!docValidation.isValid || !docValidation.value) {
    return {
      success: false,
      status: 'invalid_format',
      message: 'Documento della richiesta di contatto non valido secondo lo SDK.',
      issues: docValidation.issues.map((i) => `${i.field}: ${i.message}`),
    };
  }

  const validatedDoc = docValidation.value;

  // 3. Reconcile with local Dexie record via repository
  try {
    const applyResult = await contactRequestRepository.applyRemoteRecord(validatedDoc);
    return {
      success: applyResult.status !== 'conflict' && applyResult.status !== 'missing_local_record',
      status: applyResult.status,
      requestId: applyResult.requestId,
      document: applyResult.document,
      message: applyResult.message || 'Elaborazione completata.',
    };
  } catch (err: unknown) {
    return {
      success: false,
      status: 'invalid_format',
      message: (err as Error).message || 'Si è verificato un errore durante l’applicazione della risposta.',
    };
  }
}
