/**
 * RC-05H-B: SCRIPT DI ESECUZIONE BENCHMARK OCR REALE
 *
 * Esegue il motore Tesseract.js su tutte le 19 immagini dei 15 documenti fisici,
 * senza mock, confrontando i risultati estratti con la Ground Truth RC-05H.
 */

import fs from 'fs';
import path from 'path';
import {
  runRc05hRealBenchmark,
  Rc05hDocumentBenchmarkResult,
  Rc05hBenchmarkSummary,
} from '../src/tests/harness/rc05hBenchmarkRunner';

function formatPercent(num: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((num / total) * 100).toFixed(1) + '%';
}

async function main() {
  console.log('================================================================================');
  console.log('RC-05H-B: BENCHMARK OCR REALE SUL CORPUS COMPLETO (15 DOCS, 19 IMMAGINI)');
  console.log('================================================================================\n');

  const { results, summary } = await runRc05hRealBenchmark({
    onProgress: (idx, total, docId) => {
      console.log(`Progresso: [${idx}/${total}] ${docId}...`);
    },
  });

  // Salva i risultati completi su file JSON per analisi dettagliata
  const outputPath = path.resolve('rc05h-real-benchmark-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({ summary, results }, null, 2), 'utf8');
  console.log(`\nRisultati dettagliati salvati in: ${outputPath}\n`);

  console.log('================================================================================');
  console.log('TABELLA RISULTATI SINTETICA PER DOCUMENTO (PRODUCTION-EQUIVALENT GATE)');
  console.log('================================================================================');
  console.log(
    'ID DOC               | GATE STATUS  | CAT | MER | DATA | TOT | RIGHE (D/E) | VARIANTE (P1)     | TEMPO '
  );
  console.log('--------------------------------------------------------------------------------');

  for (const r of results) {
    const docId = r.documentId.padEnd(20).slice(0, 20);
    const gateSt = (r.gateStatus || 'UNKNOWN').padEnd(12);
    const cat = (r.categoryMatch ? '✓' : '✗').padEnd(3);
    const mer = (r.merchantMatch ? '✓' : '✗').padEnd(3);
    const dat = (r.dateMatch ? '✓' : '✗').padEnd(4);
    const tot = (r.totalMatch ? '✓' : '✗').padEnd(3);
    const lines = `${r.detectedLineCount}/${r.expectedLineCount ?? '?'}`.padEnd(11);
    const vName = (r.selectedVariants?.[0]?.selectedVariant || 'original').padEnd(17).slice(0, 17);
    const time = `${(r.durationMs / 1000).toFixed(1)}s`.padStart(6);

    console.log(`${docId} | ${gateSt} | ${cat} | ${mer} | ${dat} | ${tot} | ${lines} | ${vName} | ${time}`);
  }

  console.log('================================================================================\n');
  console.log('================================================================================');
  console.log('METRICHE GENERALI DEL BENCHMARK');
  console.log('================================================================================');
  console.log(`Documenti Totali               : ${summary.totalDocuments}`);
  console.log(`Immagini Totali                : ${summary.totalImages}`);
  console.log(`Elaborati con Successo         : ${summary.successfullyProcessed} / ${summary.totalDocuments} (${formatPercent(summary.successfullyProcessed, summary.totalDocuments)})`);
  console.log(`Falliti Tecnicamente           : ${summary.technicalFailures} / ${summary.totalDocuments}`);
  console.log('--------------------------------------------------------------------------------');
  console.log(`PASS                           : ${summary.passCount ?? 0} / ${summary.totalDocuments}`);
  console.log(`NON_BLOCKING                   : ${summary.nonBlockingCount ?? 0} / ${summary.totalDocuments}`);
  console.log(`BLOCKING                       : ${summary.blockingCount ?? 0} / ${summary.totalDocuments}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('--------------------------------------------------------------------------------');
  console.log(`Classificazioni Categoria OK   : ${summary.categoryMatches} / ${summary.totalDocuments} (${formatPercent(summary.categoryMatches, summary.totalDocuments)})`);
  console.log(`Esercenti Riconosciuti OK      : ${summary.merchantMatches} / ${summary.totalDocuments} (${formatPercent(summary.merchantMatches, summary.totalDocuments)})`);
  console.log(`Totali Corrispondenti OK       : ${summary.totalMatches} / ${summary.totalDocuments} (${formatPercent(summary.totalMatches, summary.totalDocuments)})`);
  console.log(`Date Rilevate OK               : ${summary.dateMatches} / ${summary.totalDocuments} (${formatPercent(summary.dateMatches, summary.totalDocuments)})`);
  console.log(`Ore Rilevate OK                : ${summary.timeMatches} / ${summary.totalDocuments} (${formatPercent(summary.timeMatches, summary.totalDocuments)})`);
  console.log(`Metodi Pagamento OK            : ${summary.paymentMethodMatches} / ${summary.totalDocuments} (${formatPercent(summary.paymentMethodMatches, summary.totalDocuments)})`);
  console.log(`Conteggio Righe Esatto         : ${summary.lineCountMatches} / ${summary.totalDocuments} (${formatPercent(summary.lineCountMatches, summary.totalDocuments)})`);
  console.log('--------------------------------------------------------------------------------');
  console.log(`Righe Commerciali Attese (GT)  : ${summary.totalExpectedLines}`);
  console.log(`Righe Commerciali Rilevate     : ${summary.totalDetectedLines}`);
  console.log(`Righe Matchate con GT          : ${summary.totalMatchedLines} (${formatPercent(summary.totalMatchedLines, summary.totalExpectedLines)} di coverage GT)`);
  console.log(`Righe Mancanti (False Neg)     : ${summary.totalMissingLines} (${formatPercent(summary.totalMissingLines, summary.totalExpectedLines)})`);
  console.log(`Righe False Positive           : ${summary.totalFalsePositiveLines}`);
  console.log(`Righe Fiscali/POS scambiate    : ${summary.totalFiscalOrPosAsProduct}`);
  console.log(`Duplicazioni Multi-view/Segm.  : ${summary.totalMultiViewOrSegmentDuplicates}`);
  console.log('--------------------------------------------------------------------------------');
  console.log(`Prezzi Corretti (su matchate)  : ${summary.totalCorrectPrices} (${formatPercent(summary.totalCorrectPrices, summary.totalMatchedLines)})`);
  console.log(`Prezzi Errati (su matchate)    : ${summary.totalWrongPrices} (${formatPercent(summary.totalWrongPrices, summary.totalMatchedLines)})`);
  console.log(`Prezzi Assenti (su matchate)   : ${summary.totalAbsentPrices} (${formatPercent(summary.totalAbsentPrices, summary.totalMatchedLines)})`);
  console.log('--------------------------------------------------------------------------------');
  console.log(`Quantità Corrette (su match)   : ${summary.totalCorrectQuantities} (${formatPercent(summary.totalCorrectQuantities, summary.totalMatchedLines)})`);
  console.log(`Quantità Errate (su match)     : ${summary.totalWrongQuantities} (${formatPercent(summary.totalWrongQuantities, summary.totalMatchedLines)})`);
  console.log(`Quantità Assenti (su match)    : ${summary.totalAbsentQuantities} (${formatPercent(summary.totalAbsentQuantities, summary.totalMatchedLines)})`);
  console.log('--------------------------------------------------------------------------------');
  console.log(`Tempo Totale di Esecuzione     : ${(summary.totalDurationMs / 1000).toFixed(2)} s`);
  console.log(`Tempo Medio per Documento      : ${(summary.averageDurationPerDocMs / 1000).toFixed(2)} s`);
  console.log('================================================================================\n');

  console.log('================================================================================');
  console.log('TABELLA SELEZIONE VARIANTI PER IMMAGINE (19/19 IMMAGINI)');
  console.log('================================================================================');
  console.log('DOC ID               | FILE IMMAGINE                    | VARIANTE SELEZIONATA | SCORE | CONF ');
  console.log('--------------------------------------------------------------------------------');
  for (const r of results) {
    for (const v of r.selectedVariants || []) {
      const docId = r.documentId.padEnd(20).slice(0, 20);
      const fName = v.filename.padEnd(32).slice(0, 32);
      const vName = v.selectedVariant.padEnd(20);
      const score = String(v.qualityScore).padStart(5);
      const conf = `${v.ocrConfidence}%`.padStart(5);
      console.log(`${docId} | ${fName} | ${vName} | ${score} | ${conf}`);
    }
  }
  console.log('================================================================================\n');

  console.log('================================================================================');
  console.log('DETTAGLIO PER CIASCUN DOCUMENTO');
  console.log('================================================================================');
  for (const r of results) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[${r.documentIndex}/15] ${r.documentId} — ${r.label}`);
    console.log(`  Relazione Immagini: ${r.relationship} (${r.associatedImages.join(', ')})`);
    console.log(`  Stato Tecnico: ${r.status} (Durata: ${r.durationMs}ms, Confidenza OCR: ${r.ocrConfidence}%)`);
    console.log(`  Categoria: [${r.categoryMatch ? 'MATCH' : 'MISMATCH'}] Rilevata: "${r.detectedCategory}", Attesa: "${r.expectedCategory}" (${r.categoryStatus})`);
    console.log(`  Esercente: [${r.merchantMatch ? 'MATCH' : 'MISMATCH'}] Rilevato: "${r.detectedMerchant}" (raw: "${r.rawMerchant}"), Atteso: ${JSON.stringify(r.expectedMerchant)} (${r.merchantStatus})`);
    console.log(`  Data: [${r.dateMatch ? 'MATCH' : 'MISMATCH'}] Rilevata: ${r.detectedDate || 'NULL'}, Attesa: ${r.expectedDate || 'NULL'} (${r.dateStatus})`);
    console.log(`  Ora: [${r.timeMatch ? 'MATCH' : 'MISMATCH'}] Rilevata: ${r.detectedTime || 'NULL'}, Attesa: ${r.expectedTime || 'NULL'} (${r.timeStatus})`);
    console.log(`  Totale: [${r.totalMatch ? 'MATCH' : 'MISMATCH'}] Rilevato: ${r.detectedTotal !== null ? r.detectedTotal.toFixed(2) + ' €' : 'NULL'}, Atteso: ${r.expectedTotal !== null ? r.expectedTotal.toFixed(2) + ' €' : 'NULL'} (Diff: ${r.totalDiff !== null ? r.totalDiff.toFixed(2) + ' €' : 'N/A'}) (${r.totalStatus})`);
    console.log(`  Pagamento: [${r.paymentMethodMatch ? 'MATCH' : 'MISMATCH'}] Rilevato: "${r.detectedPaymentMethod || 'NULL'}", Atteso: "${r.expectedPaymentMethod || 'NULL'}" (${r.paymentMethodStatus})`);
    console.log(`  Righe: Rilevate: ${r.detectedLineCount}, Attese GT: ${r.expectedLineCount ?? 'N/A'}`);
    console.log(`    - Righe Matchate: ${r.matchedLinesCount}`);
    console.log(`    - Righe Mancanti: ${r.missingLinesCount}`);
    console.log(`    - False Positive: ${r.falsePositiveLinesCount} (di cui ${r.fiscalOrPosAsProductCount} fiscali/POS)`);
    console.log(`    - Duplicati: ${r.duplicateLinesCount}`);
    console.log(`    - Prezzi: ${r.correctPricesCount} OK, ${r.wrongPricesCount} Errati, ${r.absentPricesCount} Assenti`);
    console.log(`    - Quantità: ${r.correctQuantitiesCount} OK, ${r.wrongQuantitiesCount} Errate, ${r.absentQuantitiesCount} Assenti`);

    if (r.matchedItemsDetail.length > 0) {
      console.log(`  Articoli Riconosciuti (${r.matchedItemsDetail.length}):`);
      for (const m of r.matchedItemsDetail) {
        console.log(`    * [${m.priceStatus === 'CORRECT' ? 'P:OK' : 'P:' + m.priceStatus}] [${m.quantityStatus === 'CORRECT' ? 'Q:OK' : 'Q:' + m.quantityStatus}] GT: "${m.gtDescription}" (${m.gtPrice !== null ? m.gtPrice.toFixed(2) + '€' : '-'}) -> OCR: "${m.detectedDescription}" (${m.detectedPrice !== null ? m.detectedPrice.toFixed(2) + '€' : '-'})`);
      }
    }

    if (r.missingItemsDetail.length > 0) {
      console.log(`  Articoli Mancanti (${r.missingItemsDetail.length}):`);
      for (const m of r.missingItemsDetail) {
        console.log(`    ! GT: "${m.gtDescription}" (${m.expectedPrice !== null ? m.expectedPrice.toFixed(2) + '€' : '-'}, Qty: ${m.expectedQuantity ?? 1}) [Status: ${m.gtStatus}]`);
      }
    }

    if (r.falsePositiveLinesDetail.length > 0) {
      console.log(`  Righe False Positive (${r.falsePositiveLinesDetail.length}):`);
      for (const fp of r.falsePositiveLinesDetail.slice(0, 5)) {
        console.log(`    ? "${fp.description}" (${fp.price !== null ? fp.price.toFixed(2) + '€' : '-'}) ${fp.isFiscalOrPos ? '[RUMORE_FISCALE_POS]' : ''}`);
      }
      if (r.falsePositiveLinesDetail.length > 5) {
        console.log(`    ... altri ${r.falsePositiveLinesDetail.length - 5} falsi positivi`);
      }
    }

    if (r.duplicateLinesDetail.length > 0) {
      console.log(`  Duplicazioni (${r.duplicateLinesDetail.length}):`);
      for (const d of r.duplicateLinesDetail) {
        console.log(`    ~ "${d.description}" (${d.price !== null ? d.price.toFixed(2) + '€' : '-'}) x${d.occurrences + 1} volte (+${d.occurrences} extra)`);
      }
    }

    if (r.warnings.length > 0) {
      console.log(`  Warning generati dal parser (${r.warnings.length}):`);
      for (const w of r.warnings.slice(0, 4)) {
        console.log(`    # ${w}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('Errore critico durante il benchmark:', err);
  process.exit(1);
});
