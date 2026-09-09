/**
 * RC-05H-B: IN-MEMORY REGIONAL EVIDENCE STORE
 *
 * Safe, transient in-memory store for passing high-confidence regional OCR evidence
 * between the second-pass regional runner and the receipt parser service.
 * Consumed once and cleared immediately to prevent state leakage.
 */

import { RegionalOcrEvidence } from './types';

let transientRegionalEvidence: RegionalOcrEvidence | null = null;

export const regionalEvidenceStore = {
  set(evidence: RegionalOcrEvidence | null): void {
    transientRegionalEvidence = evidence;
  },

  get(): RegionalOcrEvidence | null {
    return transientRegionalEvidence;
  },

  consume(): RegionalOcrEvidence | null {
    const ev = transientRegionalEvidence;
    transientRegionalEvidence = null;
    return ev;
  },

  clear(): void {
    transientRegionalEvidence = null;
  },
};
