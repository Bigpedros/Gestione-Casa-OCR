import fs from 'fs';
import path from 'path';
import { createWorker, Worker } from 'tesseract.js';
import {
  ensureCanvasEnvironment,
} from '../src/tests/harness/rc05hBenchmarkRunner';
import {
  RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH,
} from '../src/tests/fixtures/real-receipts/rc05h-corpus-ground-truth';
import {
  createReceiptImageVariants,
  evaluateReceiptOcrQuality,
  ReceiptVariantName,
} from '../src/utils/imagePreprocessing';
import {
  resolveRelativeCropBox,
  SHADOW_REFERENCE_POLICY,
} from '../src/services/ocrParser/regional/geometry';
import {
  executeRegionalCropRecognition,
  PRODUCTION_TESSERACT_PARAMETERS,
} from '../src/services/ocrParser/regional/regionalWorkerHelper';
import { extractRegionalMonetaryTokens } from '../src/services/ocrParser/regional/monetaryTokenParser';

const BLOCKER_IDS = [
  'TODIS_001',
  'PEWEX_001',
  'CARREFOUR_CONTACT_001',
  'DE_CAFFE_DOC_A_001',
  'DE_CAFFE_DOC_B_001',
  'R_STORE_001',
  'EURORISPARMIO_CASA_001',
];

async function main() {
  ensureCanvasEnvironment();
  const assetsDir = path.resolve('local-test-assets/rc05h');

  const worker: Worker = await createWorker('ita', 1, {
    logger: () => {},
  });

  await worker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    tessedit_pageseg_mode: '4' as any,
  });

  const matrixResults: any[] = [];

  for (const docId of BLOCKER_IDS) {
    const doc = RC05H_PHYSICAL_DOCUMENTS_GROUND_TRUTH.find((d) => d.documentId === docId);
    if (!doc) continue;

    console.log(`\n================================================================================`);
    console.log(`ANALISI EVIDENCE MATRIX: ${docId} (${doc.label})`);
    console.log(`Expected Total: ${doc.total.value} € | Expected Lines: ${doc.lineCount.value}`);
    console.log(`================================================================================`);

    const docResult: any = {
      documentId: docId,
      expectedTotal: doc.total.value,
      expectedLines: doc.lineCount.value,
      images: [],
    };

    for (const imgName of doc.associatedImages) {
      const imgPath = path.join(assetsDir, imgName);
      const fileBuf = fs.readFileSync(imgPath);
      const rawDataUrl = `data:image/jpeg;base64,${fileBuf.toString('base64')}`;

      // 3 varianti
      const variants = await createReceiptImageVariants(rawDataUrl, {
        rotationDegrees: 0,
        maxDimension: 2400,
      });

      const variantOcr: Record<string, { text: string; conf: number; score: number }> = {};

      for (const v of variants) {
        const res = await worker.recognize(v.dataUrl);
        const txt = res.data.text || '';
        const conf = Math.round(res.data.confidence || 0);
        const evaluation = evaluateReceiptOcrQuality(txt, conf);
        variantOcr[v.name] = {
          text: txt,
          conf,
          score: evaluation.overallScore,
        };
      }

      // Seleziona vincente come fa la pipeline
      const sorted = [...variants].sort(
        (a, b) => variantOcr[b.name].score - variantOcr[a.name].score
      );
      const winnerName = sorted[0].name;

      // Regional crop su footer e body usando l'immagine vincente
      const winnerDataUrl = variants.find((v) => v.name === winnerName)!.dataUrl;

      // Dimensioni
      const dims = { width: 1000, height: 2000 }; // reference
      const footerPixelBox = resolveRelativeCropBox(dims.width, dims.height, SHADOW_REFERENCE_POLICY.footerBox);
      const bodyPixelBox = resolveRelativeCropBox(dims.width, dims.height, SHADOW_REFERENCE_POLICY.bodyBox);

      let regionalFooterText = '';
      let regionalBodyText = '';

      try {
        const footerRes = await executeRegionalCropRecognition(
          worker,
          winnerDataUrl,
          footerPixelBox,
          PRODUCTION_TESSERACT_PARAMETERS
        );
        regionalFooterText = footerRes.text;
      } catch (e: any) {
        regionalFooterText = `ERROR: ${e?.message}`;
      }

      try {
        const bodyRes = await executeRegionalCropRecognition(
          worker,
          winnerDataUrl,
          bodyPixelBox,
          PRODUCTION_TESSERACT_PARAMETERS
        );
        regionalBodyText = bodyRes.text;
      } catch (e: any) {
        regionalBodyText = `ERROR: ${e?.message}`;
      }

      // Analizziamo la presenza del totale atteso in ciascun canale
      const targetStr = doc.total.value?.toFixed(2).replace('.', ',');
      const targetDotStr = doc.total.value?.toFixed(2);

      const checkHasTotal = (txt: string) => {
        if (!targetStr && !targetDotStr) return false;
        // Cerca target esatto o con virgola/punto
        const hasLiteral = (targetStr && txt.includes(targetStr)) || (targetDotStr && txt.includes(targetDotStr));
        // Cerca anche token monetari estratti
        const tokens = extractRegionalMonetaryTokens(txt);
        const hasToken = tokens.some((t) => t.parsedValue === doc.total.value);
        return hasLiteral || hasToken;
      };

      const imgAnalysis = {
        imageName: imgName,
        winner: winnerName,
        original: {
          conf: variantOcr['original']?.conf,
          score: variantOcr['original']?.score,
          hasTotal: checkHasTotal(variantOcr['original']?.text || ''),
          snippet: variantOcr['original']?.text.slice(0, 200).replace(/\n+/g, ' | '),
          fullText: variantOcr['original']?.text,
        },
        gentle: {
          conf: variantOcr['gentle_contrast']?.conf,
          score: variantOcr['gentle_contrast']?.score,
          hasTotal: checkHasTotal(variantOcr['gentle_contrast']?.text || ''),
          snippet: variantOcr['gentle_contrast']?.text.slice(0, 200).replace(/\n+/g, ' | '),
          fullText: variantOcr['gentle_contrast']?.text,
        },
        sharpened: {
          conf: variantOcr['sharpened_light']?.conf,
          score: variantOcr['sharpened_light']?.score,
          hasTotal: checkHasTotal(variantOcr['sharpened_light']?.text || ''),
          snippet: variantOcr['sharpened_light']?.text.slice(0, 200).replace(/\n+/g, ' | '),
          fullText: variantOcr['sharpened_light']?.text,
        },
        regionalFooter: {
          hasTotal: checkHasTotal(regionalFooterText),
          snippet: regionalFooterText.slice(0, 200).replace(/\n+/g, ' | '),
          fullText: regionalFooterText,
        },
        regionalBody: {
          snippet: regionalBodyText.slice(0, 200).replace(/\n+/g, ' | '),
          fullText: regionalBodyText,
        },
      };

      console.log(`[Image: ${imgName}] Winner: ${winnerName}`);
      console.log(` - Original has Total (${doc.total.value}): ${imgAnalysis.original.hasTotal} (Score: ${imgAnalysis.original.score}, Conf: ${imgAnalysis.original.conf}%)`);
      console.log(` - Gentle has Total (${doc.total.value}): ${imgAnalysis.gentle.hasTotal} (Score: ${imgAnalysis.gentle.score}, Conf: ${imgAnalysis.gentle.conf}%)`);
      console.log(` - Sharpened has Total (${doc.total.value}): ${imgAnalysis.sharpened.hasTotal} (Score: ${imgAnalysis.sharpened.score}, Conf: ${imgAnalysis.sharpened.conf}%)`);
      console.log(` - Regional Footer has Total (${doc.total.value}): ${imgAnalysis.regionalFooter.hasTotal}`);
      console.log(`   * Footer text: ${regionalFooterText.replace(/\n+/g, ' # ')}`);

      docResult.images.push(imgAnalysis);
    }

    matrixResults.push(docResult);
  }

  await worker.terminate();

  fs.writeFileSync(
    'evidence-matrix-raw.json',
    JSON.stringify(matrixResults, null, 2),
    'utf8'
  );
  console.log('\nEvidence Matrix salvata in evidence-matrix-raw.json');
}

main().catch(console.error);
