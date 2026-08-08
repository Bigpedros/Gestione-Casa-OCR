import { settingsRepository } from '../repositories';

/**
 * Gestione del Device ID unico e persistente di Gestione Casa OCR.
 *
 * Sottofase 2.5.A:
 * 1. Legge il deviceId esistente da AppSettings.
 * 2. Se presente e valido, lo restituisce invariato.
 * 3. Se assente, genera un UUID con prefisso "DEV-".
 * 4. Salva il valore nelle impostazioni locali (AppSettings).
 * 5. Garantisce la persistenza e stabilità del deviceId tra riavvii.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const settings = await settingsRepository.get();
  if (settings.deviceId && typeof settings.deviceId === 'string' && settings.deviceId.trim() !== '') {
    return settings.deviceId;
  }

  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const newDeviceId = `DEV-${uuid}`;
  await settingsRepository.update({ deviceId: newDeviceId });
  return newDeviceId;
}
