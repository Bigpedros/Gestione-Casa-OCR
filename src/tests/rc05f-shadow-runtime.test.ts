/**
 * RC-05F-R1: PER-CALL ISOLATION, WORKER RESTORE AND TEST COMPLETION
 *
 * Test suite esaustiva per verificare:
 * 1. PER-CALL EVIDENCE: L'evidenza vive solo nello stack locale, nessun getter/setter pubblico.
 * 2. CONCURRENT CALLS: Due sessioni concorrenti con Promise.all non condividono stato né interferiscono.
 * 3. IMMUTABLE KILL SWITCH: Nessun setter pubblico, valore immutabile per-run.
 * 4. PRICE_NOT_DETECTED: Warning PRICE_NOT_DETECTED e prezzi null preservati senza promozioni arbitrarie.
 * 5. SINGLE TERMINATE: worker.terminate() invocato esattamente una volta sia con successo che con errore.
 * 6. PEWEX RUNTIME SAFETY: La fixture reale PEWEX passa intatta senza alterazioni né falsi totali.
 * 7. NO PERSISTENCE: Nessun dato regional o evidence persistito in Dexie o nei repository.
 * 8. MULTI-SOURCE SAFETY: Documenti multi-segmento/multi-pagina saltano il crop regionale in sicurezza.
 * 9. PARAMETER RESTORATION: Ripristino esplicito dei parametri Tesseract (PSM 6 -> parametri chiamante).
 * 10. SHADOW BASELINE: Trigger, categorie ineleggibili, isolamento fallimenti e log deterministico.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../database/db';
import { ocrService } from '../services/ocrService';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
} from '../repositories';
import { receiptParserService } from '../services/ocrParser/receiptParserService';
import {
  runRegionalSecondPassShadow,
  formatRegionalDiagnosticLog,
} from '../services/ocrParser/regional/shadowOrchestrator';
import {
  executeRegionalCropRecognition,
  PRODUCTION_TESSERACT_PARAMETERS,
  WorkerRestoreError,
} from '../services/ocrParser/regional/regionalWorkerHelper';
import { PEWEX_REAL_RAW_TEXT } from './fixtures/real-receipts/pewex.fixture';

const { mockTerminateFn, mockWorkerRecognizeFn, mockSetParametersFn } = vi.hoisted(() => {
  return {
    mockTerminateFn: vi.fn().mockResolvedValue({}),
    mockWorkerRecognizeFn: vi.fn().mockResolvedValue({
      data: {
        text: 'CONAD\nDOCUMENTO COMMERCIALE\nPASTA 1.00\nTOTALE 1.00',
        confidence: 90,
      },
    }),
    mockSetParametersFn: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockImplementation(async () => ({
    setParameters: mockSetParametersFn,
    recognize: mockWorkerRecognizeFn,
    terminate: mockTerminateFn,
  })),
}));

describe('RC-05F-R1: Per-Call Isolation, Worker Restore and Test Completion', () => {
  let testCounter = 0;

  beforeEach(async () => {
    testCounter++;
    await db.delete();
    await db.open();
    ocrService.setMockEngine(null);
    mockTerminateFn.mockClear();
    mockWorkerRecognizeFn.mockClear();
    mockSetParametersFn.mockClear();
    mockWorkerRecognizeFn.mockResolvedValue({
      data: {
        text: 'CONAD\nDOCUMENTO COMMERCIALE\nPASTA 1.00\nTOTALE 1.00',
        confidence: 90,
      },
    });
  });

  async function createTestSession(rawText: string, options?: { customEngine?: boolean }) {
    const uniqueId = `${Date.now()}_${testCounter}_${Math.random().toString(36).substring(7)}`;

    if (!options?.customEngine) {
      ocrService.setMockEngine(async () => ({
        text: rawText,
        confidence: 85,
      }));
    }

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: `scontrino_test_${uniqueId}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 45000,
      storageKey: 'data:image/jpeg;base64,dummyShadowBase64Data',
      fileHash: `hash-test-${uniqueId}`,
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: `scontrino_test_${uniqueId}.jpg`,
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: `hash-test-${uniqueId}`,
      processingStatus: 'pending',
    });

    return session;
  }

  // ---------------------------------------------------------------------------
  // 1. PER-CALL EVIDENCE
  // ---------------------------------------------------------------------------
  describe('1. PER-CALL EVIDENCE', () => {
    it('non espone getter/setter o stato persistente su OCRService', () => {
      const anyOcr = ocrService as any;
      expect(anyOcr.getLastRegionalOcrEvidence).toBeUndefined();
      expect(anyOcr.getLastRegionalDiagnostic).toBeUndefined();
      expect(anyOcr.setMockRegionalWorker).toBeUndefined();
      expect(anyOcr.lastRegionalOcrEvidence).toBeUndefined();
      expect(anyOcr.lastRegionalDiagnostic).toBeUndefined();
    });

    it('restituisce evidence e diagnostica come valore locale a runRegionalSecondPassShadow', async () => {
      const sampleText = `ESSELUNGA S.P.A.
DOCUMENTO COMMERCIALE
PANE 1.50
LATTE 1.20`;

      const mockWorker = {
        setParameters: vi.fn().mockResolvedValue({}),
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'TOTALE EURO 2.70\nCARTA', confidence: 92 },
        }),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,sample',
        combinedRawText: sampleText,
        overallConfidence: 85,
        shadowEnabled: true,
      });

      expect(result.evidence).not.toBeNull();
      expect(result.evidence?.executed).toBe(true);
      expect(result.evidence?.footerEvidence?.totalCandidate?.parsedValue).toBe(2.7);
      expect(result.diagnostic.triggerActivated).toBe(true);
      expect(result.diagnostic.triggerReason).toBe('missing_total');
      expect(result.diagnostic.skipReason).toBeUndefined();
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(result.diagnostic.totalRecovered).toBe(2.7);

      // Verifichiamo che il singleton ocrService non abbia memorizzato questo risultato
      const anyOcr = ocrService as any;
      expect(anyOcr.lastRegionalOcrEvidence).toBeUndefined();
    });

    it('due chiamate sequenziali di recognize() non mantengono alcuno stato residuo condiviso', async () => {
      const session1 = await createTestSession('TEST PRIMA SCANSIONE 1.00');
      const res1 = await ocrService.recognize(session1.id);

      const session2 = await createTestSession('TEST SECONDA SCANSIONE 2.00');
      const res2 = await ocrService.recognize(session2.id);

      expect(res1.status).toBe('completed');
      expect(res2.status).toBe('completed');
      expect(res1.rawText).toContain('TEST PRIMA SCANSIONE 1.00');
      expect(res2.rawText).toContain('TEST SECONDA SCANSIONE 2.00');

      const anyOcr = ocrService as any;
      expect(anyOcr.lastRegionalOcrEvidence).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. CONCURRENT CALLS
  // ---------------------------------------------------------------------------
  describe('2. CONCURRENT CALLS', () => {
    it('due sessioni distinte eseguite in parallelo con Promise.all non condividono stato né dati', async () => {
      const textA = `ESSELUNGA S.P.A.
DOCUMENTO COMMERCIALE
MELE GOLDEN 2.50
BANANE 1.80`;

      const textB = `CONAD NORD OVEST
DOCUMENTO COMMERCIALE
PASTA INTEGRALE 1.15
SUGO PRONTO 2.30`;

      ocrService.setMockEngine(async (imageSource) => {
        const src = String(imageSource);
        if (src.includes('session_a')) {
          return { text: textA, confidence: 91 };
        }
        return { text: textB, confidence: 89 };
      });

      const uniqueA = `session_a_${Date.now()}`;
      const sessionA = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        processingMode: 'singleReceipt',
        status: 'ready',
      });
      const attA = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: sessionA.id,
        fileName: 'sess_a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 12000,
        storageKey: `data:image/jpeg;base64,${uniqueA}`,
        fileHash: `hash-${uniqueA}`,
        status: 'active',
      });
      await documentPageSegmentRepository.create({
        sessionId: sessionA.id,
        sequenceIndex: 0,
        attachmentId: attA.id,
        originalFileName: 'sess_a.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: `hash-${uniqueA}`,
        processingStatus: 'pending',
      });

      const uniqueB = `session_b_${Date.now()}`;
      const sessionB = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'singleImage',
        processingMode: 'singleReceipt',
        status: 'ready',
      });
      const attB = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: sessionB.id,
        fileName: 'sess_b.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 13000,
        storageKey: `data:image/jpeg;base64,${uniqueB}`,
        fileHash: `hash-${uniqueB}`,
        status: 'active',
      });
      await documentPageSegmentRepository.create({
        sessionId: sessionB.id,
        sequenceIndex: 0,
        attachmentId: attB.id,
        originalFileName: 'sess_b.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: `hash-${uniqueB}`,
        processingStatus: 'pending',
      });

      const [resA, resB] = await Promise.all([
        ocrService.recognize(sessionA.id),
        ocrService.recognize(sessionB.id),
      ]);

      expect(resA.status).toBe('completed');
      expect(resB.status).toBe('completed');
      expect(resA.rawText).toBe(textA);
      expect(resB.rawText).toBe(textB);
      expect(resA.rawText).not.toContain('PASTA INTEGRALE');
      expect(resB.rawText).not.toContain('MELE GOLDEN');

      const anyOcr = ocrService as any;
      expect(anyOcr.lastRegionalOcrEvidence).toBeUndefined();
      expect(anyOcr.lastRegionalDiagnostic).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. IMMUTABLE KILL SWITCH
  // ---------------------------------------------------------------------------
  describe('3. IMMUTABLE KILL SWITCH', () => {
    it('non espone setSecondPassShadowEnabled né isSecondPassShadowEnabled sul servizio', () => {
      const anyOcr = ocrService as any;
      expect(anyOcr.setSecondPassShadowEnabled).toBeUndefined();
      expect(anyOcr.isSecondPassShadowEnabled).toBeUndefined();
      expect(anyOcr.secondPassShadowEnabled).toBeUndefined();
    });

    it('runRegionalSecondPassShadow con shadowEnabled: false disabilita determinatamente il crop', async () => {
      const mockWorker = {
        setParameters: vi.fn(),
        recognize: vi.fn(),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,sample',
        combinedRawText: 'ESSELUNGA\nDOCUMENTO COMMERCIALE\nPANE 1.50',
        overallConfidence: 85,
        shadowEnabled: false,
      });

      expect(result.evidence).toBeNull();
      expect(result.diagnostic.shadowEnabled).toBe(false);
      expect(result.diagnostic.triggerReason).toBeNull();
      expect(result.diagnostic.skipReason).toBe('shadow_mode_disabled');
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(mockWorker.recognize).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. PRICE_NOT_DETECTED
  // ---------------------------------------------------------------------------
  describe('4. PRICE_NOT_DETECTED', () => {
    it('preserva warning PRICE_NOT_DETECTED e prezzo null senza promozioni shadow', async () => {
      const receiptWithMissingLinePrice = `ALIMENTARI S.R.L.
DOCUMENTO COMMERCIALE
di vendita
LATTE INTERO 1,80
PANE
SUBTOTAL 1,80
TOTALE 1,80
CONTANTI 2,00`;

      const session = await createTestSession(receiptWithMissingLinePrice);
      const result = await ocrService.recognize(session.id);

      expect(result.status).toBe('completed');
      expect(result.rawText).toBe(receiptWithMissingLinePrice);

      const officialParsed = receiptParserService.parseText(result.rawText || '');
      expect(officialParsed.documentCategory).toBe('COMMERCIAL_RECEIPT');

      const degradedLine = officialParsed.lines.find((l) =>
        l.normalizedDescription === 'PANE' || l.originalText.includes('PANE')
      );
      expect(degradedLine).toBeDefined();
      expect([0, null]).toContain(degradedLine?.lineTotal);
      expect(degradedLine?.warnings).toContain('PRICE_NOT_DETECTED');
      expect(officialParsed.total.value).toBe(1.8);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. SINGLE TERMINATE
  // ---------------------------------------------------------------------------
  describe('5. SINGLE TERMINATE', () => {
    it('invoca worker.terminate() esattamente una volta nel flusso con successo', async () => {
      ocrService.setMockEngine(null);

      const session = await createTestSession('dummy', { customEngine: true });
      const result = await ocrService.recognize(session.id);

      expect(result.status).toBe('completed');
      expect(mockTerminateFn).toHaveBeenCalledTimes(1);
    });

    it('invoca worker.terminate() esattamente una volta anche se il riconoscimento lancia eccezione', async () => {
      mockWorkerRecognizeFn.mockRejectedValue(new Error('TESSERACT_OCR_FATAL_ERROR'));
      ocrService.setMockEngine(null);

      const session = await createTestSession('dummy', { customEngine: true });
      await expect(ocrService.recognize(session.id)).rejects.toThrow('TESSERACT_OCR_FATAL_ERROR');

      expect(mockTerminateFn).toHaveBeenCalledTimes(1);

      const sess = await documentSessionRepository.getById(session.id);
      expect(sess?.status).toBe('failed');

      const allProcesses = await ocrProcessRepository.getAll();
      expect(allProcesses.length).toBeGreaterThan(0);
      expect(allProcesses[0].status).toBe('failed');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. PEWEX RUNTIME SAFETY
  // ---------------------------------------------------------------------------
  describe('6. PEWEX RUNTIME SAFETY', () => {
    it('processa il testo reale PEWEX senza alterare il risultato ufficiale né introdurre falsi totali', async () => {
      const session = await createTestSession(PEWEX_REAL_RAW_TEXT);
      const result = await ocrService.recognize(session.id);

      expect(result.status).toBe('completed');
      expect(result.rawText).toBe(PEWEX_REAL_RAW_TEXT);

      const officialParsed = receiptParserService.parseText(result.rawText || '');
      expect(officialParsed.documentCategory).toBe('COMMERCIAL_RECEIPT');

      const supplierName = officialParsed.supplier?.value?.toUpperCase() || '';
      expect(supplierName.includes('PEWEX') || supplierName.includes('MGDR')).toBe(true);

      if (officialParsed.total.value !== null) {
        expect([34.53, 0.1, 12.2, 12.44, 2.93, 2.49, 2.99]).toContain(officialParsed.total.value);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. NO PERSISTENCE
  // ---------------------------------------------------------------------------
  describe('7. NO PERSISTENCE', () => {
    it('nessun dato regional o evidence viene scritto su Dexie o nei repository', async () => {
      const session = await createTestSession(`ESSELUNGA S.P.A.
DOCUMENTO COMMERCIALE
PANE 1.50
LATTE 1.20`);

      const result = await ocrService.recognize(session.id);
      expect(result.status).toBe('completed');

      const persistedProcess = await ocrProcessRepository.getById(result.id);
      expect(persistedProcess).not.toBeNull();

      const procAny = persistedProcess as any;
      expect(procAny.lastRegionalOcrEvidence).toBeUndefined();
      expect(procAny.evidence).toBeUndefined();
      expect(procAny.regionalEvidence).toBeUndefined();
      expect(procAny.secondPassExecuted).toBeUndefined();
      expect(procAny.priceSource).toBeUndefined();
      expect(procAny.proposals).toBeUndefined();

      const persistedSession = await documentSessionRepository.getById(session.id);
      const sessAny = persistedSession as any;
      expect(sessAny.lastRegionalOcrEvidence).toBeUndefined();
      expect(sessAny.evidence).toBeUndefined();

      const allLines = await db.ocrReceiptLines.where('ocrProcessId').equals(result.id).toArray();
      for (const line of allLines) {
        const lineAny = line as any;
        expect(lineAny.secondPassExecuted).toBeUndefined();
        expect(lineAny.priceSource).toBeUndefined();
        expect(lineAny.regionalEvidence).toBeUndefined();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 8. MULTI-SOURCE SAFETY
  // ---------------------------------------------------------------------------
  describe('8. MULTI-SOURCE SAFETY', () => {
    it('multi_source_document_skipped: salta il crop regionale quando sono presenti più segmenti/pagine', async () => {
      const mockWorker = {
        setParameters: vi.fn(),
        recognize: vi.fn(),
      };

      const orchestratorResult = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,page1',
        combinedRawText: 'DOCUMENTO COMMERCIALE\nPAGINA 1\nPAGINA 2',
        overallConfidence: 80,
        shadowEnabled: true,
        sourceCount: 2,
      });

      expect(orchestratorResult.evidence).toBeNull();
      expect(orchestratorResult.diagnostic.triggerActivated).toBe(false);
      expect(orchestratorResult.diagnostic.triggerReason).toBeNull();
      expect(orchestratorResult.diagnostic.skipReason).toBe('multi_source_document_skipped');
      expect(orchestratorResult.diagnostic.failureReason).toBeUndefined();
      expect(mockWorker.recognize).not.toHaveBeenCalled();

      const session = await documentSessionRepository.create({
        documentType: 'receipt',
        sourceMode: 'multiplePages',
        processingMode: 'singleReceipt',
        status: 'ready',
      });

      const att1 = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: session.id,
        fileName: 'page1.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 20000,
        storageKey: 'data:image/jpeg;base64,page1Data',
        fileHash: `hash-page1-${Date.now()}`,
        status: 'active',
      });

      const att2 = await attachmentRepository.create({
        entityType: 'unlinked',
        entityId: session.id,
        fileName: 'page2.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 20000,
        storageKey: 'data:image/jpeg;base64,page2Data',
        fileHash: `hash-page2-${Date.now()}`,
        status: 'active',
      });

      await documentPageSegmentRepository.create({
        sessionId: session.id,
        sequenceIndex: 0,
        attachmentId: att1.id,
        originalFileName: 'page1.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: `hash-page1-${Date.now()}`,
        processingStatus: 'pending',
      });

      await documentPageSegmentRepository.create({
        sessionId: session.id,
        sequenceIndex: 1,
        attachmentId: att2.id,
        originalFileName: 'page2.jpg',
        originalMimeType: 'image/jpeg',
        rotationDegrees: 0,
        segmentMode: 'page',
        fileHash: `hash-page2-${Date.now()}`,
        processingStatus: 'pending',
      });

      ocrService.setMockEngine(async (_source, pageIdx) => {
        if (pageIdx === 0) {
          return { text: 'PAGINA 1: PANE 1.50', confidence: 90 };
        }
        return { text: 'PAGINA 2: TOTALE 1.50', confidence: 90 };
      });

      const proc = await ocrService.recognize(session.id);
      expect(proc.status).toBe('completed');
      expect(proc.rawText).toContain('PAGINA 1: PANE 1.50');
      expect(proc.rawText).toContain('PAGINA 2: TOTALE 1.50');
    });
  });

  // ---------------------------------------------------------------------------
  // 9. PARAMETER RESTORATION
  // ---------------------------------------------------------------------------
  describe('9. PARAMETER RESTORATION', () => {
    it('ripristina i parametri di default (PSM 4) al termine del crop regionale', async () => {
      const setParamCalls: Array<Record<string, unknown>> = [];
      const mockWorker = {
        setParameters: vi.fn().mockImplementation(async (params) => {
          setParamCalls.push(params);
          return {};
        }),
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'TOTALE 12.34', confidence: 95 },
        }),
      };

      await executeRegionalCropRecognition(
        mockWorker,
        'dummy-image',
        { left: 0, top: 0, width: 100, height: 100 },
        PRODUCTION_TESSERACT_PARAMETERS
      );

      expect(setParamCalls.length).toBe(2);
      expect(setParamCalls[0]).toMatchObject({ tessedit_pageseg_mode: '6' });
      expect(setParamCalls[1]).toMatchObject({ tessedit_pageseg_mode: '4' });
    });

    it('ripristina parametri personalizzati diversi da PSM 4 passati dal chiamante', async () => {
      const setParamCalls: Array<Record<string, unknown>> = [];
      const mockWorker = {
        setParameters: vi.fn().mockImplementation(async (params) => {
          setParamCalls.push(params);
          return {};
        }),
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'TOTALE 5.00', confidence: 90 },
        }),
      };

      const customCallerParams = {
        tessedit_pageseg_mode: '3',
        user_defined_dpi: '150',
      };

      await executeRegionalCropRecognition(
        mockWorker,
        'dummy-image',
        { left: 0, top: 0, width: 100, height: 100 },
        customCallerParams
      );

      expect(setParamCalls.length).toBe(2);
      expect(setParamCalls[0]).toMatchObject({ tessedit_pageseg_mode: '6' });
      expect(setParamCalls[1]).toMatchObject({
        tessedit_pageseg_mode: '3',
        user_defined_dpi: '150',
      });
    });

    it('garantisce il ripristino dei parametri anche in caso di eccezione durante il recognize', async () => {
      const setParamCalls: Array<Record<string, unknown>> = [];
      const mockWorker = {
        setParameters: vi.fn().mockImplementation(async (params) => {
          setParamCalls.push(params);
          return {};
        }),
        recognize: vi.fn().mockRejectedValue(new Error('RECOGNIZE_CRASH')),
      };

      await expect(
        executeRegionalCropRecognition(
          mockWorker,
          'dummy-image',
          { left: 0, top: 0, width: 100, height: 100 },
          { tessedit_pageseg_mode: '4' }
        )
      ).rejects.toThrow('RECOGNIZE_CRASH');

      expect(setParamCalls.length).toBe(2);
      expect(setParamCalls[0]).toMatchObject({ tessedit_pageseg_mode: '6' });
      expect(setParamCalls[1]).toMatchObject({ tessedit_pageseg_mode: '4' });
    });

    it('solleva WorkerRestoreError se il ripristino parametri fallisce nel blocco finally', async () => {
      let callCount = 0;
      const mockWorker = {
        setParameters: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 2) {
            throw new Error('FAIL_SET_PARAMETERS_RESTORE');
          }
          return {};
        }),
        recognize: vi.fn().mockResolvedValue({ data: { text: '', confidence: 0 } }),
      };

      await expect(
        executeRegionalCropRecognition(
          mockWorker,
          'dummy-image',
          { left: 0, top: 0, width: 100, height: 100 }
        )
      ).rejects.toThrow(WorkerRestoreError);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. SHADOW BASELINE
  // ---------------------------------------------------------------------------
  describe('10. SHADOW BASELINE', () => {
    it('COMMERCIAL_RECEIPT con missing_total attiva shadow run e produce diagnostica', async () => {
      const textMissingTotal = `ESSELUNGA S.P.A.
DOCUMENTO COMMERCIALE
PANE CIABATTA 1.50
LATTE FRESCO 1.20`;

      const mockWorker = {
        setParameters: vi.fn().mockResolvedValue({}),
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'TOTALE EURO 2.70\nPAGAMENTO CARTA', confidence: 91 },
        }),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,dummy',
        combinedRawText: textMissingTotal,
        overallConfidence: 85,
        shadowEnabled: true,
      });

      expect(result.evidence).not.toBeNull();
      expect(result.evidence?.executed).toBe(true);
      expect(result.evidence?.footerEvidence?.totalCandidate?.parsedValue).toBe(2.7);
      expect(result.diagnostic.triggerActivated).toBe(true);
      expect(result.diagnostic.triggerReason).toBe('missing_total');
      expect(result.diagnostic.skipReason).toBeUndefined();
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(result.diagnostic.totalRecovered).toBe(2.7);
    });

    it('COMMERCIAL_RECEIPT pulito non attiva il shadow run', async () => {
      const cleanText = `CONAD NORD OVEST
DOCUMENTO COMMERCIALE
PANE 1.50
LATTE 1.20
TOTALE EURO 2.70
PAGAMENTO CONTANTI`;

      const mockWorker = {
        setParameters: vi.fn(),
        recognize: vi.fn(),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,dummy',
        combinedRawText: cleanText,
        overallConfidence: 95,
        shadowEnabled: true,
      });

      expect(result.evidence).toBeNull();
      expect(result.diagnostic.triggerActivated).toBe(false);
      expect(result.diagnostic.triggerReason).toBeNull();
      expect(result.diagnostic.skipReason).toBe('trigger_not_activated');
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(mockWorker.recognize).not.toHaveBeenCalled();
    });

    it('PAYMENT_PROOF è esclusa e non attiva il shadow run', async () => {
      const posText = `BANCA INTESA SANPAOLO
TRANSAZIONE POS CARTA
IMPORTO EUR 45.00
AUT: 987654
TRANSAZIONE ESEGUITA CON SUCCESSO`;

      const mockWorker = {
        setParameters: vi.fn(),
        recognize: vi.fn(),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,dummy',
        combinedRawText: posText,
        overallConfidence: 90,
        shadowEnabled: true,
      });

      expect(result.evidence).toBeNull();
      expect(result.diagnostic.triggerActivated).toBe(false);
      expect(result.diagnostic.triggerReason).toBeNull();
      expect(result.diagnostic.skipReason).toBe('ineligible_document_category');
      expect(result.diagnostic.documentCategory).toBe('PAYMENT_PROOF');
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(mockWorker.recognize).not.toHaveBeenCalled();
    });

    it('UNKNOWN category è esclusa con skipReason ineligible_document_category', async () => {
      const unknownText = `CONTRATTO DI LOCAZIONE
TRA LE PARTI SOTTOSCRITTE
ARTICOLO 1 - OGGETTO`;

      const mockWorker = {
        setParameters: vi.fn(),
        recognize: vi.fn(),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,dummy',
        combinedRawText: unknownText,
        overallConfidence: 85,
        shadowEnabled: true,
      });

      expect(result.evidence).toBeNull();
      expect(result.diagnostic.triggerActivated).toBe(false);
      expect(result.diagnostic.triggerReason).toBeNull();
      expect(result.diagnostic.skipReason).toBe('ineligible_document_category');
      expect(result.diagnostic.documentCategory).toBe('UNKNOWN');
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(mockWorker.recognize).not.toHaveBeenCalled();
    });

    it('low_price_density: attiva shadow run con triggerReason low_price_density quando mancano prezzi riga', async () => {
      const lowDensityText = `ALIMENTARI S.R.L.
DOCUMENTO COMMERCIALE
di vendita
LATTE INTERO 1,80
PANE
TOTALE 1,80
CONTANTI 2,00`;

      const mockWorker = {
        setParameters: vi.fn().mockResolvedValue({}),
        recognize: vi.fn().mockResolvedValue({
          data: { text: 'PREZZO 2.50\nPREZZO 3.00', confidence: 88 },
        }),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: 'data:image/jpeg;base64,dummy',
        combinedRawText: lowDensityText,
        overallConfidence: 85,
        shadowEnabled: true,
      });

      expect(result.diagnostic.triggerActivated).toBe(true);
      expect(result.diagnostic.triggerReason).toBe('low_price_density');
      expect(result.diagnostic.skipReason).toBeUndefined();
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(result.evidence?.triggerReason).toBe('low_price_density');
    });

    it('image_source_unavailable: skip nominale quando la sorgente immagine è assente', async () => {
      const mockWorker = {
        setParameters: vi.fn(),
        recognize: vi.fn(),
      };

      const result = await runRegionalSecondPassShadow({
        worker: mockWorker,
        imageSource: null,
        combinedRawText: 'ESSELUNGA\nDOCUMENTO COMMERCIALE\nPANE 1.50',
        overallConfidence: 85,
        shadowEnabled: true,
      });

      expect(result.evidence).toBeNull();
      expect(result.diagnostic.triggerActivated).toBe(false);
      expect(result.diagnostic.triggerReason).toBeNull();
      expect(result.diagnostic.skipReason).toBe('image_source_unavailable');
      expect(result.diagnostic.failureReason).toBeUndefined();
      expect(mockWorker.recognize).not.toHaveBeenCalled();
    });

    it('failure isolation: eccezione nel crop viene catturata senza crash', async () => {
      const crashingWorker = {
        setParameters: vi.fn().mockResolvedValue({}),
        recognize: vi.fn().mockRejectedValue(new Error('SIMULATED_TESSERACT_WASM_CRASH')),
      };

      const result = await runRegionalSecondPassShadow({
        worker: crashingWorker,
        imageSource: 'data:image/jpeg;base64,dummy',
        combinedRawText: 'ESSELUNGA\nDOCUMENTO COMMERCIALE\nPANE 1.50',
        overallConfidence: 85,
        shadowEnabled: true,
      });

      expect(result.evidence).toBeNull();
      expect(result.diagnostic.triggerActivated).toBe(true);
      expect(result.diagnostic.triggerReason).toBe('missing_total');
      expect(result.diagnostic.skipReason).toBeUndefined();
      expect(result.diagnostic.failureReason).toContain('SIMULATED_TESSERACT_WASM_CRASH');
    });

    it('immutabilità del testo raw e coerenza del log formattato con skip e failure separati', () => {
      const logSuccess = formatRegionalDiagnosticLog({
        shadowEnabled: true,
        documentCategory: 'COMMERCIAL_RECEIPT',
        triggerActivated: true,
        triggerReason: 'missing_total',
        regionsAttempted: ['footer'],
        pricesExtractedCount: 1,
        mergeSuccessCount: 0,
        totalRecovered: 12.5,
        durationMs: 45,
      });

      expect(logSuccess).toContain('[OCRService:SecondPass]');
      expect(logSuccess).toContain('shadowEnabled=true');
      expect(logSuccess).toContain('documentCategory=COMMERCIAL_RECEIPT');
      expect(logSuccess).toContain('triggerActivated=true');
      expect(logSuccess).toContain('triggerReason=missing_total');
      expect(logSuccess).toContain('totalRecovered=12.5');
      expect(logSuccess).not.toContain('undefined');
      expect(logSuccess).not.toContain('skipReason');
      expect(logSuccess).not.toContain('failureReason');

      const logSkip = formatRegionalDiagnosticLog({
        shadowEnabled: true,
        documentCategory: 'PAYMENT_PROOF',
        triggerActivated: false,
        triggerReason: null,
        skipReason: 'ineligible_document_category',
        regionsAttempted: [],
        pricesExtractedCount: 0,
        mergeSuccessCount: 0,
        totalRecovered: null,
        durationMs: 2,
      });

      expect(logSkip).toContain('[OCRService:SecondPass]');
      expect(logSkip).toContain('triggerActivated=false');
      expect(logSkip).toContain('triggerReason=null');
      expect(logSkip).toContain('skipReason=ineligible_document_category');
      expect(logSkip).not.toContain('undefined');
      expect(logSkip).not.toContain('failureReason');

      const logFailure = formatRegionalDiagnosticLog({
        shadowEnabled: true,
        documentCategory: 'COMMERCIAL_RECEIPT',
        triggerActivated: true,
        triggerReason: 'missing_total',
        regionsAttempted: ['footer'],
        pricesExtractedCount: 0,
        mergeSuccessCount: 0,
        totalRecovered: null,
        durationMs: 10,
        failureReason: 'worker_not_available',
      });

      expect(logFailure).toContain('[OCRService:SecondPass]');
      expect(logFailure).toContain('triggerActivated=true');
      expect(logFailure).toContain('triggerReason=missing_total');
      expect(logFailure).toContain('failureReason=worker_not_available');
      expect(logFailure).not.toContain('undefined');
      expect(logFailure).not.toContain('skipReason');
    });

    it('gestione worker mancante produce diagnostica conforme', async () => {
      const res = await runRegionalSecondPassShadow({
        worker: null,
        imageSource: 'data:image/jpeg;base64,dummy',
        combinedRawText: 'ESSELUNGA S.P.A.\nDOCUMENTO COMMERCIALE\nPRODOTTO 1.00',
        overallConfidence: 80,
        shadowEnabled: true,
      });

      expect(res.evidence).toBeNull();
      expect(res.diagnostic.triggerActivated).toBe(true);
      expect(res.diagnostic.triggerReason).toBe('missing_total');
      expect(res.diagnostic.skipReason).toBeUndefined();
      expect(res.diagnostic.failureReason).toBe('worker_not_available');
    });
  });
});
