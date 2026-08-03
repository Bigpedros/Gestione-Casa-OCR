export type IncomeEntryTypeKey =
  | 'salary'
  | 'pension'
  | 'income'
  | 'refund'
  | 'extraordinary_contribution'
  | 'other';

export const INCOME_TYPE_OPTIONS: { key: IncomeEntryTypeKey; label: string }[] = [
  { key: 'salary', label: 'Stipendio' },
  { key: 'pension', label: 'Pensione' },
  { key: 'income', label: 'Reddito' },
  { key: 'refund', label: 'Rimborso' },
  { key: 'extraordinary_contribution', label: 'Contributo straordinario' },
  { key: 'other', label: 'Altro' },
];

/**
  Mappa la "Tipologia Contributo" configurata nelle Impostazioni per il contributore
  nella corrispondente "Tipologia di Entrata".
 */
export const mapContributorLabelToIncomeType = (
  contribLabel?: string | null
): IncomeEntryTypeKey => {
  if (!contribLabel) return 'salary';
  const clean = contribLabel.trim().toLowerCase();
  if (clean === 'stipendio') return 'salary';
  if (clean === 'pensione') return 'pension';
  if (clean === 'rendita' || clean === 'reddito') return 'income';
  if (clean === 'rimborso') return 'refund';
  if (clean === 'altro') return 'other';
  return 'salary';
};

/**
 * Normalizza qualsiasi valore di tipologia entrata (inclusi dati legacy/storici o etichette libere)
 * nella chiave interna corrispondente ad una delle 6 opzioni ammesse.
 */
export const normalizeIncomeType = (
  rawType: string | undefined | null,
  contributorLabel?: string | null
): IncomeEntryTypeKey => {
  if (!rawType || rawType.trim() === '') {
    return mapContributorLabelToIncomeType(contributorLabel);
  }

  const clean = rawType.trim().toLowerCase();

  if (
    clean === 'salary' ||
    clean === 'stipendio' ||
    clean === 'stipendio 1' ||
    clean === 'stipendio 2'
  ) {
    return 'salary';
  }

  if (clean === 'pension' || clean === 'pensione') {
    return 'pension';
  }

  if (
    clean === 'income' ||
    clean === 'reddito' ||
    clean === 'rendita' ||
    clean === 'annuity' ||
    clean === 'rentalincome' ||
    clean === 'financialincome'
  ) {
    return 'income';
  }

  if (clean === 'refund' || clean === 'rimborso') {
    return 'refund';
  }

  if (
    clean === 'extraordinary_contribution' ||
    clean === 'contributo straordinario' ||
    clean === 'contributo_straordinario' ||
    clean === 'bonus' ||
    clean === 'extrasalary'
  ) {
    return 'extraordinary_contribution';
  }

  if (
    clean === 'other' ||
    clean === 'altro' ||
    clean === 'gift' ||
    clean === 'sale'
  ) {
    return 'other';
  }

  // Se è un valore custom non riconosciuto direttamente, restituisce 'other'
  return 'other';
};

/**
 * Restituisce l'etichetta visibile in italiano per la tipologia di entrata.
 */
export const getIncomeTypeLabel = (
  rawType: string | undefined | null,
  contributorLabel?: string | null
): string => {
  const normalizedKey = normalizeIncomeType(rawType, contributorLabel);
  const found = INCOME_TYPE_OPTIONS.find((opt) => opt.key === normalizedKey);
  return found ? found.label : 'Altro';
};
