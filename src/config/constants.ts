export const CLASSIFICATION_LABELS = {
  necessary: 'Necessaria',
  voluntary: 'Volontaria',
  toEvaluate: 'Da valutare',
} as const;

export const EXPENSE_STATUS_LABELS = {
  draft: 'Bozza',
  planned: 'Pianificata',
  paid: 'Pagata',
  cancelled: 'Annullata',
} as const;

export const PROJECT_STATUS_LABELS = {
  active: 'Attivo',
  completed: 'Completato',
  cancelled: 'Annullato',
} as const;

export const SAVING_STATUS_LABELS = {
  active: 'Attivo',
  completed: 'Completato',
  suspended: 'Sospeso',
  cancelled: 'Annullato',
} as const;

export const REPORT_STATUS_LABELS = {
  provisional: 'Provvisorio',
  final: 'Definitivo',
} as const;
