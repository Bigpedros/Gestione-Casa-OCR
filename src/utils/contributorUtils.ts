import type { Contributor } from '../types';

/**
 * Verifica se un record contributore è un placeholder tecnico inutilizzato.
 * Un contributore è considerato placeholder disponibile (e NON deve essere mostrato inizialmente)
 * se e solo se sono verificate TUTTE le seguenti condizioni:
 * 1. order > 1 (il primo contributore è sempre visibile e principale)
 * 2. active === false (non è stato attivato)
 * 3. non è referenziato da alcuna entrata, spesa o movimento applicativo
 * 4. il nome è vuoto o corrisponde a un placeholder generico (es. "Contributore 2", "Contributore", "Secondo Contributore")
 * 5. l'email è vuota o corrisponde a un placeholder di esempio (es. "nome@esempio.com", "esempio@...", "@example.com")
 * 6. non ha preferenze di notifica attive
 */
export function isUnusedPlaceholderContributor(
  c: Contributor,
  referencedIds?: Set<string>
): boolean {
  // Il primo contributore non è mai trattato come placeholder inutilizzato
  if (c.order === 1) return false;

  // Se è attivo, è un contributore configurato
  if (c.active) return false;

  // Se è referenziato da dati applicativi (es. entrate), è un contributore reale
  if (referencedIds && referencedIds.has(c.id)) return false;

  // Controllo del nome
  const rawName = (c.name || '').trim();
  const isDefaultOrEmptyName =
    !rawName ||
    /^contributore(\s*\d*)?$/i.test(rawName) ||
    /^(primo|secondo|terzo)\s+contributore$/i.test(rawName);

  if (!isDefaultOrEmptyName) {
    // Contiene un nome reale personalizzato (es. "Maria Rossi", "Pietro", "Fabiola")
    return false;
  }

  // Controllo dell'email
  const rawEmail = (c.email || '').trim().toLowerCase();
  const isDefaultOrEmptyEmail =
    !rawEmail ||
    rawEmail === 'nome@esempio.com' ||
    rawEmail === 'esempio@esempio.com' ||
    rawEmail === 'user@example.com' ||
    rawEmail.endsWith('@esempio.com') ||
    rawEmail.endsWith('@esempio.it') ||
    rawEmail.endsWith('@example.com');

  if (!isDefaultOrEmptyEmail) {
    // Contiene un'email reale personalizzata
    return false;
  }

  // Controllo delle preferenze di notifica
  const hasActiveNotificationPrefs = Boolean(
    c.receiveDeadlineEmails || c.receive48HourReminder || c.receive24HourReminder
  );
  if (hasActiveNotificationPrefs) {
    return false;
  }

  return true;
}

/**
 * Filtra la lista dei contributori restituendo solo quelli che devono essere
 * visualizzati nella scheda di configurazione delle Impostazioni.
 */
export function filterVisibleContributors(
  contributors: Contributor[],
  referencedIds?: Set<string>
): Contributor[] {
  if (!contributors || contributors.length === 0) return [];
  const visible = contributors.filter((c) => !isUnusedPlaceholderContributor(c, referencedIds));
  // Assicura che almeno il primo contributore sia presente se la lista era non vuota
  return visible.length > 0 ? visible : [contributors[0]];
}
