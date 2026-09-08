import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { ocrService } from '../services/ocrService';
import {
  documentSessionRepository,
  documentPageSegmentRepository,
  attachmentRepository,
  ocrProcessRepository,
  expenseRepository,
} from '../repositories';
import { OCRProgress } from '../types';

describe('Motore OCR Local-First (TEST-OCR-ENGINE)', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    ocrService.setMockEngine(null);
  });

  it('TEST-OCR-001: Riconoscimento documento singolo (1 pagina)', async () => {
    // Mock del motore per restituire testo noto in ambiente test
    ocrService.setMockEngine(async (_storageKey) => {
      return {
        text: 'SUPERMERCATO DESPAR\nSCONTRINO FISCALE\nTOTALE EURO 24.50',
        confidence: 92,
      };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'scontrino_single.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 35000,
      storageKey: 'data:image/jpeg;base64,dummySingleImageData',
      fileHash: 'hash-single-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'scontrino_single.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-single-01',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    expect(ocrProcess.id).toBeDefined();
    expect(ocrProcess.status).toBe('completed');
    expect(ocrProcess.rawText).toContain('SUPERMERCATO DESPAR');
    expect(ocrProcess.rawText).toContain('TOTALE EURO 24.50');
    expect(ocrProcess.confidence).toBe(92);
    expect(ocrProcess.processedAt).toBeDefined();
    expect(ocrProcess.errorMessage).toBeNull();

    // Verifiche architetturali vincolanti
    expect(ocrProcess.detectedSupplier).toBeUndefined();
    expect(ocrProcess.detectedDate).toBeUndefined();
    expect(ocrProcess.detectedTotal).toBeUndefined();

    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(0); // Nessuna spesa creata!
  });

  it('TEST-OCR-002: Riconoscimento multipagina con concatenazione in ordine di sequenceIndex', async () => {
    ocrService.setMockEngine(async (_storageKey, pageIndex) => {
      if (pageIndex === 0) {
        return { text: 'FATTURA N. 1024\nPAGINA 1 DI 2\nIMPORTO PARZIALE 100.00', confidence: 95 };
      }
      return { text: 'PAGINA 2 DI 2\nIVA 22% 22.00\nTOTALE FATTURA 122.00', confidence: 90 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'invoice',
      sourceMode: 'multiplePages',
      processingMode: 'multiPageDocument',
      status: 'ready',
    });

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'pag1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 40000,
      storageKey: 'data:image/jpeg;base64,pag1',
      fileHash: 'hash-multi-01',
      status: 'active',
    });

    const att2 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'pag2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 42000,
      storageKey: 'data:image/jpeg;base64,pag2',
      fileHash: 'hash-multi-02',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'pag1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-multi-01',
      processingStatus: 'pending',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: att2.id,
      originalFileName: 'pag2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-multi-02',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    expect(ocrProcess.status).toBe('completed');
    expect(ocrProcess.rawText).toContain('PAGINA 1 DI 2');
    expect(ocrProcess.rawText).toContain('PAGINA 2 DI 2');
    // Verifica che il testo di pagina 1 sia prima di pagina 2
    const posPage1 = ocrProcess.rawText!.indexOf('PAGINA 1 DI 2');
    const posPage2 = ocrProcess.rawText!.indexOf('PAGINA 2 DI 2');
    expect(posPage1).toBeGreaterThan(-1);
    expect(posPage2).toBeGreaterThan(posPage1);

    expect(ocrProcess.confidence).toBe(93); // Media tra 95 e 90
  });

  it('TEST-OCR-003: Scontrino lungo (longReceipt) concatenazione senza rimozione sovrapposizione', async () => {
    ocrService.setMockEngine(async (_storageKey, pageIndex) => {
      if (pageIndex === 0) {
        return { text: 'SUPERMERCATO CONAD\nLATTE BISCRO\nPANE FRESCO', confidence: 88 };
      }
      return { text: 'PANE FRESCO\nPASTA BARILLA\nSUBTOTALE 15.80', confidence: 86 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'overlappingImages',
      processingMode: 'longReceipt',
      status: 'ready',
    });

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'part1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 30000,
      storageKey: 'data:image/jpeg;base64,part1',
      fileHash: 'hash-long-01',
      status: 'active',
    });

    const att2 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'part2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 31000,
      storageKey: 'data:image/jpeg;base64,part2',
      fileHash: 'hash-long-02',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'part1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      fileHash: 'hash-long-01',
      processingStatus: 'pending',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 1,
      attachmentId: att2.id,
      originalFileName: 'part2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'overlappingSegment',
      overlapWithPrevious: true,
      fileHash: 'hash-long-02',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    expect(ocrProcess.status).toBe('completed');
    expect(ocrProcess.rawText).toContain('LATTE BISCRO');
    expect(ocrProcess.rawText).toContain('PASTA BARILLA');
  });

  it('TEST-OCR-003B: stitchSegmentTexts rimuove deterministicamente righe duplicate da sovrapposizione tra segmenti', () => {
    const segment1 = `SUPERMERCATO ORIZZONTE
VIA PONTINA 120
PRODOTTO ALFA 2,50
PRODOTTO BETA 4,10
PRODOTTO GAMMA 1,99`;

    const segment2 = `PRODOTTO BETA 4,10
PRODOTTO GAMMA 1,99
PRODOTTO DELTA 5,50
TOTALE 14,09`;

    const stitched = ocrService.stitchSegmentTexts([segment1, segment2]);

    // Verifichiamo che la sovrapposizione esatta di 2 righe sia stata deduped
    const lines = stitched.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const countBeta = lines.filter(l => l.includes('PRODOTTO BETA 4,10')).length;
    const countGamma = lines.filter(l => l.includes('PRODOTTO GAMMA 1,99')).length;
    const countDelta = lines.filter(l => l.includes('PRODOTTO DELTA 5,50')).length;

    expect(countBeta).toBe(1);
    expect(countGamma).toBe(1);
    expect(countDelta).toBe(1);
    expect(stitched).toContain('SUPERMERCATO ORIZZONTE');
    expect(stitched).toContain('TOTALE 14,09');
  });

  it('TEST-OCR-003C: stitchSegmentTexts esegue deduplicazione topologica di giunzione con overlap non terminale e rumore OCR', () => {
    // p01 ha righe fiscali/totali nella sua parte terminale, quindi la sovrapposizione con p02
    // si trova all'interno della finestra precedente (10 righe prima della fine di p01).
    // Inoltre p02 presenta leggere deformazioni OCR (es. virgole lette come punti, spaziature, caratteri sfocati).
    const segment1 = `SUPERMERCATO ORIZZONTE
VIA PONTINA 120
PRODOTTO ALFA 2,50
PRODOTTO BETA 4,10
PRODOTTO GAMMA 1,99
PRODOTTO GAMMA 1,99
PRODOTTO EXTRA 3,20
TOTALE PROVVISORIO 15,88
PAGAMENTO CONTANTI 20,00
RESTO 4,12
28-08-2026 15:40
DOCUMENTO N. 100
ART 99IEC013792
DETTAGLIO FORME PAGAMENTO
CONTANTI`;

    const segment2 = `PRODOTTO BETA 4.10
PRODOTTO GAMMA 1,99
PRODOTTO GAMMA 1,99
PRODOTTO DELTA 5,50
Riepilogo acquisti
Scontrino fiscale
BANCOMAT
EURO EUR 21,38
Transazione eseguita`;

    const stitched = ocrService.stitchSegmentTexts([segment1, segment2]);

    const lines = stitched.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // 1. Conserva integralmente p01 (inclusi i metadati e totali di p01)
    expect(stitched).toContain('SUPERMERCATO ORIZZONTE');
    expect(stitched).toContain('PRODOTTO ALFA 2,50');
    expect(stitched).toContain('DOCUMENTO N. 100');
    expect(stitched).toContain('DETTAGLIO FORME PAGAMENTO');

    // 2. I prodotti legittimamente ripetuti (PRODOTTO GAMMA 1,99 x 2) all'interno di p01 rimangono esattamente 2
    const countGamma = lines.filter(l => l.includes('PRODOTTO GAMMA')).length;
    expect(countGamma).toBe(2);

    // 3. Il prodotto non duplicato BETA compare esattamente 1 volta
    const countBeta = lines.filter(l => l.includes('PRODOTTO BETA')).length;
    expect(countBeta).toBe(1);

    // 4. La parte nuova successiva di p02 (incluso POS) viene conservata
    expect(stitched).toContain('PRODOTTO DELTA 5,50');
    expect(stitched).toContain('BANCOMAT');
    expect(stitched).toContain('EURO EUR 21,38');
    expect(stitched).toContain('Transazione eseguita');
  });

  it('TEST-OCR-003D: stitchSegmentTexts preserva entrambi i segmenti se non vi è overlap o se l overlap è ambiguo/troppo debole', () => {
    // Caso 1: Nessun overlap
    const segA = `BAR CENTRALE
CAFFE 1,20
CORNETTO 1,50`;

    const segB = `PANIFICIO SUD
PANE CASERECCIO 2,00
PIZZA BIANCA 1,80`;

    const stitchedNoOverlap = ocrService.stitchSegmentTexts([segA, segB]);
    expect(stitchedNoOverlap).toContain('BAR CENTRALE');
    expect(stitchedNoOverlap).toContain('CAFFE 1,20');
    expect(stitchedNoOverlap).toContain('PANIFICIO SUD');
    expect(stitchedNoOverlap).toContain('PIZZA BIANCA 1,80');

    // Caso 2: Overlap ambiguo su singola parola generica brevissima (non deve innescare dedup aggressiva)
    const segC = `NEGOZIO UNO
GRAZIE`;

    const segD = `GRAZIE
ARRIVEDERCI`;

    const stitchedAmbiguous = ocrService.stitchSegmentTexts([segC, segD]);
    // Con un match ambiguo/troppo corto di una sola riga priva di contesto, non si rimuove aggressivamente la testa
    expect(stitchedAmbiguous).toContain('NEGOZIO UNO');
    expect(stitchedAmbiguous).toContain('ARRIVEDERCI');
  });

  it('TEST-OCR-003E: Suite completa deduplicazione topologica multi-segmento (Casi A-I)', () => {
    // Caso A: p02 con 1 riga spuria prima dell'overlap
    const segA1 = `SUPERMERCATO ORIZZONTE
SACCHI PATT.52X51 BLU 25P Z SPAZZY 1,95
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70`;

    const segA2 = `A e O
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
BANCOMAT
ACQUISTO
EURO EUR 20,25`;

    const stitchedA = ocrService.stitchSegmentTexts([segA1, segA2]);
    expect(stitchedA).not.toContain('A e O');
    expect(stitchedA).toContain('SUPERMERCATO ORIZZONTE');
    expect(stitchedA).toContain('SACCHI PATT.52X51 BLU 25P Z SPAZZY 1,95');
    const linesA = stitchedA.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const countSacchi70A = linesA.filter((l) => l.includes('SACCHI PATT.70X120')).length;
    expect(countSacchi70A).toBe(2);
    expect(stitchedA).toContain('BANCOMAT');
    expect(stitchedA).toContain('ACQUISTO');
    expect(stitchedA).toContain('EURO EUR 20,25');

    // Caso B: p02 con 2-3 righe spurie prima dell'overlap
    const segB1 = `SUPERMERCATO ORIZZONTE
DETERGENTE CASA 3,50
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70`;

    const segB2 = `FRAME NOISE 1
TAGLIO SUPERIORE
di vendita O
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
BANCOMAT
EURO EUR 15,00`;

    const stitchedB = ocrService.stitchSegmentTexts([segB1, segB2]);
    expect(stitchedB).not.toContain('FRAME NOISE 1');
    expect(stitchedB).not.toContain('TAGLIO SUPERIORE');
    expect(stitchedB).not.toContain('di vendita O');
    expect(stitchedB).toContain('DETERGENTE CASA 3,50');
    const linesB = stitchedB.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    expect(linesB.filter((l) => l.includes('SACCHI PATT.70X120')).length).toBe(2);
    expect(stitchedB).toContain('BANCOMAT');
    expect(stitchedB).toContain('EURO EUR 15,00');

    // Caso C: differenze OCR lievi
    const segC1 = `SUPERMERCATO ORIZZONTE
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70`;

    const segC2 = `SACCHI PATT. 70X120 10PZ T. RASPARENTE 2.70
SACCHI PATT. 70X120 10PZ T. RASPARENTE 2.70
PRODOTTO EXTRA FINALE 4,90`;

    const stitchedC = ocrService.stitchSegmentTexts([segC1, segC2]);
    const linesC = stitchedC.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    expect(linesC.filter((l) => l.includes('RASPARENTE')).length).toBe(2);
    expect(stitchedC).toContain('PRODOTTO EXTRA FINALE 4,90');

    // Caso D: wrap 1->2 (1 riga in p01 <-> 2 righe in p02)
    const segD1 = `SUPERMERCATO ORIZZONTE
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70`;

    const segD2 = `SACCHI PATT.70X120 10PZ
T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ
T RASPARENTE 2,70
CHIUSURA SCONTRINO 10,00`;

    const stitchedD = ocrService.stitchSegmentTexts([segD1, segD2]);
    expect(stitchedD).toContain('SUPERMERCATO ORIZZONTE');
    expect(stitchedD).toContain('CHIUSURA SCONTRINO 10,00');
    const linesD = stitchedD.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    expect(linesD.filter((l) => l.includes('CHIUSURA SCONTRINO')).length).toBe(1);

    // Caso E: wrap 2->1 (2 righe in p01 <-> 1 riga in p02)
    const segE1 = `SUPERMERCATO ORIZZONTE
SACCHI PATT.70X120 10PZ
T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ
T RASPARENTE 2,70`;

    const segE2 = `SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
BANCOMAT ACQUISTO`;

    const stitchedE = ocrService.stitchSegmentTexts([segE1, segE2]);
    expect(stitchedE).toContain('BANCOMAT ACQUISTO');

    // Caso F: POS immediatamente successivo all'overlap deve restare
    const segF1 = `ORIZZONTE
ARTICOLO BASE 1,00
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70`;

    const segF2 = `SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 2,70
BANCOMAT
ACQUISTO
ORIZZONTE
ROMA VIA PADRE CORRADO D
C/C NUMERO **** 1234
EURO EUR 20,25
Transazione eseguita`;

    const stitchedF = ocrService.stitchSegmentTexts([segF1, segF2]);
    expect(stitchedF).toContain('BANCOMAT');
    expect(stitchedF).toContain('ACQUISTO');
    expect(stitchedF).toContain('ROMA VIA PADRE CORRADO D');
    expect(stitchedF).toContain('C/C NUMERO **** 1234');
    expect(stitchedF).toContain('EURO EUR 20,25');
    expect(stitchedF).toContain('Transazione eseguita');

    // Caso G: due prodotti identici legittimi non devono essere deduplicati internamente
    const segG1 = `SUPERMERCATO
SACCHI PATT.52X51 BLU 25P Z SPAZZY 1,95
SACCHI PATT.52X51 BLU 25P Z SPAZZY 1,95`;

    const segG2 = `DETERSIVO PIATTI 2,10
CANDEGGINA 1,50`;

    const stitchedG = ocrService.stitchSegmentTexts([segG1, segG2]);
    const linesG = stitchedG.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    expect(linesG.filter((l) => l.includes('SACCHI PATT.52X51')).length).toBe(2);

    // Caso H: candidato ambiguo non deve deduplicare
    const segH1 = `NEGOZIO UNO
GRAZIE
ARRIVEDERCI`;

    const segH2 = `GRAZIE
ARRIVEDERCI
ALTRO NEGOZIO 10,00`;

    const stitchedH = ocrService.stitchSegmentTexts([segH1, segH2]);
    expect(stitchedH).toContain('NEGOZIO UNO');
    expect(stitchedH).toContain('ALTRO NEGOZIO 10,00');
    expect(stitchedH).toContain('GRAZIE');

    // Caso I: nessun overlap: concatenazione invariata
    const segI1 = `FARMACIA CENTRO
ASPIRINA 5,00`;

    const segI2 = `LIBRERIA NORD
QUADERNO 2,00`;

    const stitchedI = ocrService.stitchSegmentTexts([segI1, segI2]);
    expect(stitchedI).toContain('ASPIRINA 5,00');
    expect(stitchedI).toContain('QUADERNO 2,00');
  });

  it('TEST-OCR-003F: Verifica specifica diagnostica replay ORIZZONTE reale multi-segmento', () => {
    const p01 = `DOCUMENTO COMMERCIALE
di vendita o prestazione
TOVAGLIOLI 2V 50PZ NICKY PIEGATO 22,00% 1,80
FILO GIARDINO LEGACCI PVC VERDE 3,5MM 22,00% 2,60
FILO GIARDINO LEGACCI PVC VERDE 3,5MM 22,00% 2,60
SHOPPERS ORIZZONTE GRANDE M-B 40+12+12 22,00% 0,20
TOVAGLIOLI 2V 50PZ NICKY PIEGATO 22,00% 1,80
SACCHI PATT.52X51 BLU 25P Z SPAZZY 22,00% 1,95
SACCHI PATT.52X51 BLU 25P Z SPAZZY 22,00% 1,95
SACCHI PATT.52X51 BLU 25P Z SPAZZY 22,00% 1,95
SACCHI PATT.70X120 10PZ T RASPARENTE 11 22,00% 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 11 22,00% 2,70
TOTALE COMPLESSIVO 20,25
Pagamento elettronico
Importo pagato 20,25
28-08-2026 15:48
DOCUMENTO N. 1496-0142`;

    const p02 = `A e O
SACCHI PATT.70X120 10PZ T RASPARENTE 11 22,00% 2,70
SACCHI PATT.70X120 10PZ T RASPARENTE 11 22,00% 2,70
TOTALE COMPLESSIVO 20,25
BANCOMAT
ACQUISTO
ORIZZONTE
ROMA VIA PADRE CORRADO D
C/C NUMERO **** 1234
EURO EUR 20,25
Transazione eseguita`;

    const prevLines = p01.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const nextLines = p02.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const match = ocrService.findTopologicalOverlap(prevLines, nextLines);

    expect(match).not.toBeNull();
    if (match) {
      expect(match.headOffset).toBe(1);
      expect(match.matchedLinesCount).toBeGreaterThanOrEqual(2);
      expect(match.avgSim).toBeGreaterThanOrEqual(0.75);
      expect(match.overlapInNextCount).toBe(4); // 1 riga spuria ("A e O") + 3 righe overlap ("SACCHI...", "SACCHI...", "TOTALE...")
    }

    const stitched = ocrService.stitchSegmentTexts([p01, p02]);

    // Righe eliminate da p02: "A e O", le 2 righe sacchi duplicate e totale complessivo duplicato
    expect(stitched).not.toContain('A e O');
    // POS deve RESTARE nel rawText
    expect(stitched).toContain('BANCOMAT');
    expect(stitched).toContain('ACQUISTO');
    expect(stitched).toContain('ORIZZONTE');
    expect(stitched).toContain('ROMA VIA PADRE CORRADO D');
    expect(stitched).toContain('C/C NUMERO **** 1234');
    expect(stitched).toContain('EURO EUR 20,25');
    expect(stitched).toContain('Transazione eseguita');

    // Le due righe SACCHI PATT.70X120 autentiche compaiono esattamente 2 volte in totale
    const lines = stitched.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const countSacchi70 = lines.filter((l) => l.includes('SACCHI PATT.70X120')).length;
    expect(countSacchi70).toBe(2);
  });

  it('TEST-OCR-004: Monitoraggio della progressione durante il riconoscimento', async () => {
    ocrService.setMockEngine(async (_storageKey, pageIndex, _totalPages, onProgressPct) => {
      onProgressPct(50);
      onProgressPct(100);
      return { text: `Pagina ${pageIndex + 1}`, confidence: 90 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'generic',
      sourceMode: 'multiplePages',
      processingMode: 'multiPageDocument',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'prog.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 20000,
      storageKey: 'data:image/jpeg;base64,prog',
      fileHash: 'hash-prog-01',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'prog.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-prog-01',
      processingStatus: 'pending',
    });

    const progressUpdates: OCRProgress[] = [];
    await ocrService.recognize(session.id, (prog) => {
      progressUpdates.push({ ...prog });
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.some((p) => p.status === 'loading_model')).toBe(true);
    expect(progressUpdates.some((p) => p.status === 'completed')).toBe(true);

    const lastProgress = progressUpdates[progressUpdates.length - 1];
    expect(lastProgress.progressPercentage).toBe(100);
    expect(lastProgress.status).toBe('completed');
  });

  it('TEST-OCR-005: Annullamento dell elaborazione e rilascio risorse', async () => {
    let cancelCalled = false;

    ocrService.setMockEngine(async (_storageKey, pageIndex) => {
      if (pageIndex === 1) {
        // Durante la seconda pagina invochiamo il cancel
        await ocrService.cancel(sessionId);
        cancelCalled = true;
      }
      return { text: `Pagina ${pageIndex + 1}`, confidence: 80 };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'multiplePages',
      processingMode: 'multiPageDocument',
      status: 'ready',
    });
    const sessionId = session.id;

    const att1 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: sessionId,
      fileName: 'c1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 15000,
      storageKey: 'data:image/jpeg;base64,c1',
      fileHash: 'hash-c-01',
      status: 'active',
    });

    const att2 = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: sessionId,
      fileName: 'c2.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 15000,
      storageKey: 'data:image/jpeg;base64,c2',
      fileHash: 'hash-c-02',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId,
      sequenceIndex: 0,
      attachmentId: att1.id,
      originalFileName: 'c1.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-c-01',
      processingStatus: 'pending',
    });

    await documentPageSegmentRepository.create({
      sessionId,
      sequenceIndex: 1,
      attachmentId: att2.id,
      originalFileName: 'c2.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-c-02',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(sessionId);

    expect(cancelCalled).toBe(true);
    expect(ocrProcess.status).toBe('failed');
    expect(ocrProcess.errorMessage).toContain('annullata');

    const updatedSession = await documentSessionRepository.getById(sessionId);
    expect(updatedSession?.status).toBe('draft');
  });

  it('TEST-OCR-006: Gestione errori per documento vuoto (0 segmenti)', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    await expect(ocrService.recognize(session.id)).rejects.toThrow('Documento vuoto');

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('failed');

    const ocrProcesses = await ocrProcessRepository.getAll();
    expect(ocrProcesses.length).toBe(1);
    expect(ocrProcesses[0].status).toBe('failed');
    expect(ocrProcesses[0].errorMessage).toContain('Documento vuoto');
  });

  it('TEST-OCR-007: Gestione errori per allegato/immagine mancante', async () => {
    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: 'att-non-esistente',
      originalFileName: 'missing.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-missing',
      processingStatus: 'pending',
    });

    await expect(ocrService.recognize(session.id)).rejects.toThrow('Allegato non trovato');

    const updatedSession = await documentSessionRepository.getById(session.id);
    expect(updatedSession?.status).toBe('failed');
  });

  it('TEST-OCR-008: Tassativa assenza di interpretazione e di creazione spese', async () => {
    ocrService.setMockEngine(async () => {
      return {
        text: 'ESSELUNGA S.P.A.\n12/05/2026\nPASTA RUMMO 1.20\nCARNE BOVINA 8.50\nTOTALE 9.70',
        confidence: 94,
      };
    });

    const session = await documentSessionRepository.create({
      documentType: 'receipt',
      sourceMode: 'singleImage',
      processingMode: 'singleReceipt',
      status: 'ready',
    });

    const att = await attachmentRepository.create({
      entityType: 'unlinked',
      entityId: session.id,
      fileName: 'esselunga.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 50000,
      storageKey: 'data:image/jpeg;base64,esselunga',
      fileHash: 'hash-esselunga',
      status: 'active',
    });

    await documentPageSegmentRepository.create({
      sessionId: session.id,
      sequenceIndex: 0,
      attachmentId: att.id,
      originalFileName: 'esselunga.jpg',
      originalMimeType: 'image/jpeg',
      rotationDegrees: 0,
      segmentMode: 'page',
      fileHash: 'hash-esselunga',
      processingStatus: 'pending',
    });

    const ocrProcess = await ocrService.recognize(session.id);

    // Verifiche:
    // 1. rawText presente
    expect(ocrProcess.rawText).toContain('TOTALE 9.70');
    // 2. Nessun dato interpretato in questa fase
    expect(ocrProcess.detectedSupplier).toBeUndefined();
    expect(ocrProcess.detectedDate).toBeUndefined();
    expect(ocrProcess.detectedTotal).toBeUndefined();
    // 3. Nessuna spesa o voce di spesa creata
    const expenses = await expenseRepository.getAll();
    expect(expenses.length).toBe(0);
  });
});
