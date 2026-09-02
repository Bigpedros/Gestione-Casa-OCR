/**
 * =========================================================================
 * COSTANTI DI SICUREZZA OCR QUALITY SAFETY GATE (FASE P4-D1-R1)
 * =========================================================================
 *
 * Parametri di riferimento e soglie per la calibrazione della confidenza,
 * la protezione da allucinazioni su documenti a bassa risoluzione o degradati,
 * la soppressione del rumore e la validazione dei dati fiscali.
 */

/**
 * Soglia minima di confidenza Tesseract (0-100) per considerare il documento
 * leggibile senza penalità di degrado severo.
 */
export const OCR_CONFIDENCE_MIN_RELIABLE = 60;

/**
 * Soglia critica di confidenza Tesseract sotto la quale il testo è altamente degradato.
 */
export const OCR_CONFIDENCE_CRITICAL_LOW = 40;

/**
 * Punteggio di qualità oggettivo minimo (evaluateReceiptOcrQuality: 0-100)
 * richiesto per consentire attribuzioni ad alta confidenza su fornitore e righe.
 */
export const OCR_QUALITY_SCORE_MIN_RELIABLE = 35;

/**
 * Punteggio di qualità oggettivo critico sotto il quale il documento è quasi illeggibile.
 */
export const OCR_QUALITY_SCORE_CRITICAL_LOW = 20;

/**
 * Limite massimo di overallConfidence consentito per documenti con classificazione 'UNKNOWN'.
 */
export const MAX_CONFIDENCE_UNKNOWN_CATEGORY = 35;

/**
 * Limite massimo di overallConfidence per documenti con punteggio di qualità OCR critico (< 20).
 */
export const MAX_CONFIDENCE_CRITICAL_OCR_QUALITY = 30;

/**
 * Limite massimo di overallConfidence quando non è stata estratta alcuna riga articolo attendibile con prezzo.
 */
export const MAX_CONFIDENCE_NO_RELIABLE_LINES = 50;

/**
 * Rapporto minimo tra caratteri alfabetici e lunghezza totale per un nome fornitore plausibile.
 */
export const SUPPLIER_MIN_ALPHA_RATIO = 0.60;

/**
 * Rapporto massimo consentito di caratteri di rumore / simboli non convenzionali per un fornitore.
 */
export const SUPPLIER_MAX_NOISE_RATIO = 0.20;

/**
 * Numero minimo di caratteri alfabetici per poter considerare un candidato fornitore.
 */
export const SUPPLIER_MIN_LETTERS = 3;

/**
 * Rapporto minimo tra caratteri alfabetici e lunghezza totale per una descrizione articolo.
 */
export const ITEM_MIN_ALPHA_RATIO = 0.50;

/**
 * Rapporto massimo consentito di caratteri di rumore/simboli per una descrizione articolo.
 */
export const ITEM_MAX_NOISE_RATIO = 0.25;

/**
 * Soglia sotto la quale il documento richiede obbligatoriamente revisione manuale.
 */
export const MANUAL_REVIEW_CONFIDENCE_THRESHOLD = 70;

/**
 * Numero minimo di caratteri alfabetici per poter considerare una riga descrizione prodotto.
 */
export const ITEM_MIN_LETTERS = 3;

/**
 * Lunghezza minima in caratteri alfabetici per una parola valida nella descrizione prodotto.
 */
export const ITEM_MIN_WORD_LENGTH = 2;
