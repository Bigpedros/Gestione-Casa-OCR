import {createWorker,OEM,PSM,type Worker} from 'tesseract.js';
import type {OcrPage,OcrToken,QualityReport} from '../../contracts.js';
import {scanPhotographedDocument} from '../geometry/photoDocumentScanner.js';
import {estimateOrientation,normalizeRasterGeometry,rotateRightAngle} from '../geometry/imageGeometryNormalizer.js';
import {qualityFromCanvas} from '../quality/qualityAnalyzer.js';
import {cleanCameraDocument} from '../geometry/cameraCleanup.js';
import {detectStructuralRegions} from '../structure/regionDetector.js';
import {detectNonTextObjects} from '../structure/objectDetector.js';
import {buildTextHierarchy} from '../structure/textHierarchy.js';
import type {OcrPageInput,OcrProvider,OcrRetryRegion} from './provider.js';
import {
  createOcrImageVariant,
  OCR_VARIANT_ORDER,
  remapVariantPage,
  scoreOcrVariant,
  selectRawOcrVariant,
  selectOcrVariantWinner,
  type OcrVariantResult
} from './imageVariants.js';
import {evaluateSemanticOcrQuality,shouldStopOcrCascade} from './semanticQualityGate.js';

export interface TesseractLocalOptions {
  language?:string;
  segmentation?:'auto'|'block'|'sparse';
  dpi?:number;
  maxVariantDimension?:number;
  performanceProfile?:'min'|'med'|'max';
}

export class TesseractLocalProvider implements OcrProvider {
  readonly id='tesseract-local';
  private worker?:Worker;
  private cache=new WeakMap<HTMLCanvasElement,OcrPage>();
  private evidenceCanvas=new WeakMap<HTMLCanvasElement,HTMLCanvasElement>();
  private lastSelectedVariant?:{canvas:HTMLCanvasElement;scaleX:number;scaleY:number;pageWidth:number;pageHeight:number};
  constructor(private readonly options:TesseractLocalOptions={}){}

  async recognize(input:OcrPageInput,signal?:AbortSignal):Promise<OcrPage>{
    signal?.throwIfAborted();
    if(!input.image)return{pageNumber:input.pageNumber,width:input.width,height:input.height,text:'',tokens:[],warnings:['OCR_IMAGE_MISSING']};
    const worker=await this.getWorker();

    if(canUseCanvas(input.image)){
      const original=input.image as HTMLCanvasElement;
      const cached=this.cache.get(original);
      if(cached)return clonePage(cached);
      const perfStart=performance.now();
      const scanStart=performance.now();
      const scan=scanPhotographedDocument(original);
      const scanMs=performance.now()-scanStart;
      const pageBox=scan.metadata.corners?boundsOfCorners(scan.metadata.corners):undefined;
      const qualityStart=performance.now();
      const quality=qualityFromCanvas(original,pageBox);
      const qualityMs=performance.now()-qualityStart;
      if(scan.metadata.corners){
        quality.perspective=perspectiveScore(scan.metadata.corners);
        quality.score=Math.max(0,Math.min(1,quality.score*.9+quality.perspective*.1));
        quality.decision=quality.score<.28?'reacquire':quality.score<.52?'warning':'continue';
      }
      if(quality.decision==='reacquire'){
        const rejected={pageNumber:input.pageNumber,width:original.width,height:original.height,text:'',tokens:[],
          warnings:['QUALITY_GATE_REACQUIRE',...quality.warnings.map(x=>`QUALITY:${x}`)],quality,photoScan:scan.metadata} satisfies OcrPage;
        this.cache.set(original,rejected);
        return clonePage(rejected);
      }
      const orientationStart=performance.now();
      let orientation=await chooseOcrOrientation(worker,scan.canvas,input,this.options.dpi??300,signal);
      let orientationMs=performance.now()-orientationStart;
      let preGeometry=orientation.canvas;
      let sourceFallback=false;
      let originalProbeScore:number|undefined;

      // La rettifica fotografica affidabile mantiene priorità geometrica.
      // Confrontiamo l'originale solo quando lo scanner è incerto o l'OCR rettificato è realmente debole.
      const trustedScan=scan.metadata.applied&&scan.metadata.confidence>=.90&&orientation.score>=68;
      if(scan.metadata.applied&&!trustedScan){
        const fallbackOrientationStart=performance.now();
        const originalOrientation=await chooseOcrOrientation(worker,original,input,this.options.dpi??300,signal);
        orientationMs+=performance.now()-fallbackOrientationStart;
        originalProbeScore=originalOrientation.score;
        const catastrophicDrop=orientation.score<45&&originalOrientation.score>=55;
        const clearOriginalAdvantage=originalOrientation.score>=orientation.score+15;
        if(catastrophicDrop||clearOriginalAdvantage){
          orientation=originalOrientation;
          preGeometry=orientation.canvas;
          sourceFallback=true;
        }
      }

      const geometryStart=performance.now();
      let geometry=normalizeRasterGeometry(preGeometry,orientation.degrees);
      let geometryMs=performance.now()-geometryStart;
      let ocrSource=geometry.canvas;
      const transformedProbe=(geometry.metadata.deskewApplied||geometry.metadata.dewarpApplied)
        ?await quickOcrProbe(worker,ocrSource,input,this.options.dpi??300,signal)
        :orientation;
      let transformFallback=false;
      if(
        (geometry.metadata.deskewApplied||geometry.metadata.dewarpApplied)&&
        orientation.score>=55&&
        transformedProbe.score<orientation.score-15
      ){
        geometry={canvas:preGeometry,metadata:{...geometry.metadata,deskewApplied:false,deskewDegrees:0,dewarpApplied:false,dewarpStrength:0}};
        ocrSource=preGeometry;
        transformFallback=true;
      }

      // Camera cleanup is a separate, reversible stage after geometry. It is only kept when
      // it preserves or improves OCR evidence, so colour stamps/ink and already-clean scans
      // are not sacrificed for cosmetic whitening.
      const cleanupStart=performance.now();
      const cleanup=cleanCameraDocument(ocrSource,60);
      let cleanupMs=performance.now()-cleanupStart;
      let cleanupAccepted=false;
      let cleanupProbeScore:number|undefined;
      if(cleanup.metrics.applied){
        const lightingImproved=cleanup.metrics.backgroundVariationAfter<=cleanup.metrics.backgroundVariationBefore*.92;
        if(lightingImproved){
          const cleanupProbeStart=performance.now();
          const cleanupProbe=await quickOcrProbe(worker,cleanup.canvas,input,this.options.dpi??300,signal);
          cleanupMs+=performance.now()-cleanupProbeStart;
          cleanupProbeScore=cleanupProbe.score;
          const referenceScore=(geometry.metadata.deskewApplied||geometry.metadata.dewarpApplied)?transformedProbe.score:orientation.score;
          const noOcrRegression=cleanupProbe.score>=referenceScore-4;
          if(noOcrRegression){
            ocrSource=cleanup.canvas;
            cleanupAccepted=true;
          }
        }
      }

      this.evidenceCanvas.set(original,ocrSource);
      const preparedInput={...input,width:ocrSource.width,height:ocrSource.height,image:ocrSource};
      const profile=profileConfig(this.options.performanceProfile??'med');
      const variantNames=OCR_VARIANT_ORDER.slice(0,profile.variantCount);
      const variants:ReturnType<typeof createOcrImageVariant>[]=[];
      const results:OcrVariantResult[]=[];
      let variantPreprocessMs=0,variantOcrMs=0;
      const psm=chooseSegmentation(ocrSource.width,ocrSource.height,this.normalPsm());

      await worker.setParameters({
        tessedit_pageseg_mode:psm,
        preserve_interword_spaces:'1',
        user_defined_dpi:String(this.options.dpi??300),
        tessedit_char_whitelist:''
      });

      for(let index=0;index<variantNames.length;index++){
        signal?.throwIfAborted();
        const variantStart=performance.now();
        const variant=createOcrImageVariant(ocrSource,variantNames[index]!,this.options.maxVariantDimension??profile.maxDimension);
        variants.push(variant);
        variantPreprocessMs+=performance.now()-variantStart;
        const ocrStart=performance.now();
        const recognized=await worker.recognize(variant.canvas as never,{}, {text:true,blocks:true});
        variantOcrMs+=performance.now()-ocrStart;
        const local=pageFromResult(
          {...preparedInput,width:variant.canvas.width,height:variant.canvas.height,image:variant.canvas},
          recognized.data.blocks??[],
          recognized.data.text
        );
        const mapped=remapVariantPage(local,ocrSource.width,ocrSource.height,variant.scaleX,variant.scaleY);
        const confidence=Math.round(recognized.data.confidence??averageConfidence(mapped));
        const rawScore=scoreOcrVariant(mapped);
        const semantic=evaluateSemanticOcrQuality(mapped,rawScore);
        const score=semantic.adjustedScore;
        results.push({name:variant.name,page:mapped,score,confidence});
        const lowRatio=mapped.tokens.filter(t=>(t.confidence??0)<60).length/Math.max(1,mapped.tokens.length);
        if(shouldStopOcrCascade(semantic,confidence,lowRatio,index))break;
        if(index===1){
          const ranked=[...results].sort((a,b)=>b.score-a.score);
          const best=ranked[0]!,second=ranked[1]!;
          const bestSemantic=evaluateSemanticOcrQuality(best.page,best.score);
          if(best.score>=80&&best.score-second.score<=4&&shouldStopOcrCascade(bestSemantic,best.confidence??confidence,lowRatio,index))break;

          // Se due varianti globali forti producono quasi lo stesso risultato, ulteriori
          // preprocessing raramente aggiungono informazione: fermiamo il global OCR e
          // lasciamo i campi critici al re-OCR locale contestuale.
          const originalResult=results.find(item=>item.name==='original');
          const plateau=!!originalResult&&originalResult.score>=72&&best.score>=74&&Math.abs(best.score-originalResult.score)<=3.5;
          const localizedUncertainty=bestSemantic.suspiciousRatio<=.14;
          if(plateau&&localizedUncertainty)break;
        }
      }

      const winnerDecision=selectOcrVariantWinner(results,45);
      const winnerIndex=Math.max(0,winnerDecision.index);
      const winner=results[winnerIndex]!;
      const rawResult=selectRawOcrVariant(results)??winner;
      const rawPage=rawResult.page;
      const winnerSemantic=evaluateSemanticOcrQuality(winner.page,winner.score);
      const detectedObjects=detectNonTextObjects(ocrSource,winner.page.tokens,detectStructuralRegions(ocrSource,winner.page.tokens));
      const autoRegions=winnerSemantic.receiptLike?detectedObjects.filter(region=>region.kind!=='radio'):detectedObjects;
      const textHeight=median(rawPage.tokens.map(t=>t.box.height).filter(v=>v>0));
      if(textHeight){quality.estimatedTextHeightPx=Math.round(textHeight*10)/10;quality.estimatedEffectiveDpi=Math.round(textHeight*72/10);}
      const hierarchy=buildTextHierarchy(rawPage);
      const totalMs=performance.now()-perfStart;
      const page:OcrPage={...rawPage,
        lines:hierarchy.lines,
        blocks:hierarchy.blocks,
        quality:quality as QualityReport,
        photoScan:scan.metadata,
        geometryCorrection:geometry.metadata,
        detectedRegions:autoRegions,
        variantEvidence:results
          .filter(item=>item!==rawResult)
          .map(item=>({
            source:`ocr-variant:${item.name}`,
            score:item.score,
            confidence:item.confidence??null,
            tokens:item.page.tokens.map(token=>({
              ...token,box:{...token.box},
              ...(token.characters?{characters:token.characters.map(character=>({...character,box:{...character.box}}))}:{}),
              ...(token.alternatives?{alternatives:[...token.alternatives]}:{})
            }))
          })),
        warnings:[
          ...rawPage.warnings,
          ...(quality.decision==='warning'?['QUALITY_GATE_WARNING',...quality.warnings.map(x=>`QUALITY:${x}`)]:[]),
          scan.metadata.applied?`PHOTO_SCAN_APPLIED:${Math.round(scan.metadata.confidence*100)}`:`PHOTO_SCAN_SKIPPED:${Math.round(scan.metadata.confidence*100)}`,
          geometry.metadata.deskewApplied?`DESKEW_APPLIED:${geometry.metadata.deskewDegrees}`:'DESKEW_NOT_NEEDED',
          geometry.metadata.dewarpApplied?`DEWARP_APPLIED:${geometry.metadata.dewarpStrength.toFixed(1)}`:'DEWARP_NOT_NEEDED',
          `ORIENTATION:${geometry.metadata.orientationDegrees}`,
          `ORIENTATION_OCR_SCORES:${orientation.scores.map(item=>`${item.degrees}=${item.score.toFixed(1)}`).join(',')}`,
          ...(originalProbeScore===undefined?[]:[`ORIGINAL_PROBE_SCORE:${originalProbeScore.toFixed(1)}`]),
          sourceFallback?'PHOTO_SCAN_REJECTED_BY_OCR_GATE':'PHOTO_SCAN_ACCEPTED_BY_OCR_GATE',
          transformFallback?'GEOMETRY_REJECTED_BY_OCR_GATE':'GEOMETRY_ACCEPTED_BY_OCR_GATE',
          cleanupAccepted?`CAMERA_CLEANUP_APPLIED:BG_STD_${cleanup.metrics.backgroundVariationBefore.toFixed(1)}->${cleanup.metrics.backgroundVariationAfter.toFixed(1)}`:'CAMERA_CLEANUP_SKIPPED_OR_REJECTED',
          ...(cleanupProbeScore===undefined?[]:[`CAMERA_CLEANUP_PROBE_SCORE:${cleanupProbeScore.toFixed(1)}`]),
          `CAMERA_CLEANUP_DESPECKLED:${cleanup.metrics.despeckledPixels}`,
          'OCR_PIPELINE:GENERAL_HIGH_RELIABILITY',
          'OCR_RAW_POLICY:ORIGINAL_VARIANT_IMMUTABLE',
          `OCR_RAW_VARIANT:${rawResult.name}`,
          `OCR_VARIANT_WINNER:${winner.name}`,
          `OCR_VARIANT_SCORES:${results.map(item=>`${item.name}=${item.score.toFixed(1)}`).join(',')}`,
          `SEMANTIC_QUALITY_GATE:${winnerSemantic.reasons.length?'REVIEW':'PASS'}`,
          ...(winnerSemantic.receiptLike?[`CRITICAL_FIELD_GATE:${winnerSemantic.criticalFieldGate?'PASS':'FAIL'}`]:[]),
          ...winnerSemantic.reasons.map((reason:string)=>`SEMANTIC:${reason}`),
          `OCR_VARIANT_EVIDENCE_COUNT:${Math.max(0,results.length-1)}`,
          `PERF_SCAN_MS:${Math.round(scanMs)}`,
          `PERF_QUALITY_MS:${Math.round(qualityMs)}`,
          `PERF_ORIENTATION_MS:${Math.round(orientationMs)}`,
          `PERF_GEOMETRY_MS:${Math.round(geometryMs)}`,
          `PERF_CLEANUP_MS:${Math.round(cleanupMs)}`,
          `PERF_VARIANT_PREPROCESS_MS:${Math.round(variantPreprocessMs)}`,
          `PERF_TESSERACT_MS:${Math.round(variantOcrMs)}`,
          `PERF_VARIANTS_BUILT:${variants.length}/${variantNames.length}`,
          variants.length<variantNames.length?'PERF_FAST_PATH:EARLY_EXIT':'PERF_FAST_PATH:FULL_CASCADE',
          `PERF_TOTAL_PRIMARY_MS:${Math.round(totalMs)}`,
          ...(winnerDecision.acceptable?[]:[`OCR_WINNER_BELOW_FLOOR:${winnerDecision.score.toFixed(1)}`])
        ]
      };
      const selected=variants.find(v=>v.name===winner.name)??variants[0]!;
      this.lastSelectedVariant={canvas:selected.canvas,scaleX:selected.scaleX,scaleY:selected.scaleY,pageWidth:ocrSource.width,pageHeight:ocrSource.height};
      this.cache.set(original,page);
      return clonePage(page);
    }

    await worker.setParameters({tessedit_pageseg_mode:this.normalPsm(),preserve_interword_spaces:'1',user_defined_dpi:String(this.options.dpi??300),tessedit_char_whitelist:''});
    const primary=await worker.recognize(input.image as never,{}, {text:true,blocks:true});
    const page=pageFromResult(input,primary.data.blocks??[],primary.data.text);
    const hierarchy=buildTextHierarchy(page);
    return{...page,lines:hierarchy.lines,blocks:hierarchy.blocks};
  }

  prepareIndependentInput(input:OcrPageInput):OcrPageInput{
    if(canUseCanvas(input.image)){
      const canvas=this.evidenceCanvas.get(input.image as HTMLCanvasElement);
      if(canvas)return{...input,width:canvas.width,height:canvas.height,image:canvas};
    }
    return input;
  }

  async recognizeRegions(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    signal?.throwIfAborted();
    const selected=this.lastSelectedVariant;
    if(!selected||!regions.length)return[];
    const worker=await this.getWorker();
    const output:OcrToken[]=[];
    try{
      const retryLimit=profileConfig(this.options.performanceProfile??'med').retryLimit;
      for(const [regionIndex,region] of regions.slice(0,retryLimit).entries()){
        signal?.throwIfAborted();
        const critical=region.reason.startsWith('critical-receipt:');
        const margin=critical ? .06 : .12;
        const x=Math.max(0,region.box.x-region.box.width*margin),y=Math.max(0,region.box.y-region.box.height*(critical ? .22 : .12));
        const r=Math.min(selected.pageWidth,region.box.x+region.box.width*(1+margin));
        const b=Math.min(selected.pageHeight,region.box.y+region.box.height*(critical?1.22:1.12));
        const left=Math.floor(x/selected.scaleX),top=Math.floor(y/selected.scaleY);
        const width=Math.max(1,Math.ceil((r-x)/selected.scaleX)),height=Math.max(1,Math.ceil((b-y)/selected.scaleY));
        const crop=document.createElement('canvas');crop.width=width;crop.height=height;
        crop.getContext('2d')!.drawImage(selected.canvas,left,top,width,height,0,0,width,height);

        const targetHeight=region.kind==='money'||region.kind==='numeric'?150:region.kind==='date'?135:105;
        const baseScale=critical?Math.max(1.25,Math.min(4,targetHeight/Math.max(1,crop.height))):1;
        const prepared=document.createElement('canvas');
        prepared.width=Math.max(1,Math.round(crop.width*baseScale));prepared.height=Math.max(1,Math.round(crop.height*baseScale));
        const pctx=prepared.getContext('2d',{willReadFrequently:true})!;
        pctx.imageSmoothingEnabled=true;pctx.imageSmoothingQuality='high';pctx.drawImage(crop,0,0,prepared.width,prepared.height);

        const variants=localRetryVariants(prepared);
        const candidates:Array<{text:string;confidence:number;box:{x:number;y:number;width:number;height:number}}>=[];

        for(const variant of variants){
          const psm=region.kind==='text'?PSM.SINGLE_LINE:PSM.SINGLE_WORD;
          const whitelist=region.kind==='money'||region.kind==='numeric'?'0123456789.,€':region.kind==='date'?'0123456789/.-:':'';
          await worker.setParameters({
            tessedit_pageseg_mode:psm,
            preserve_interword_spaces:'1',
            user_defined_dpi:'300',
            tessedit_char_whitelist:whitelist
          });
          const result=await worker.recognize(variant as never,{}, {text:true,blocks:true});
          const words=result.data.blocks?.flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)))??[];
          let text=words.map(w=>w.text.trim()).filter(Boolean).join(' ').trim();
          if(!text)text=(result.data.text??'').trim().replace(/\s+/g,' ');
          text=cleanCriticalReading(text,region.kind);
          const confidence=result.data.confidence??averageWordConfidence(words);
          if(text&&criticalReadingValid(text,region.kind))candidates.push({text,confidence,box:{...region.box}});
          if(!critical&&text&&confidence>=86)break;
        }
        const chosen=critical?criticalConsensusCandidate(candidates,region.kind):consensusCandidate(candidates);
        if(chosen&&chosen.confidence>=(critical?72:65))output.push({
          id:`p${input.pageNumber}-retry-${regionIndex}-${output.length}`,text:chosen.text,confidence:chosen.confidence,box:chosen.box,
          lineId:`p${input.pageNumber}-retry-${regionIndex}`,provenance:'ocr',
          alternatives:[...new Set(candidates.map(candidate=>candidate.text))]
        });
      }
      return output;
    }finally{
      await worker.setParameters({tessedit_pageseg_mode:this.normalPsm(),preserve_interword_spaces:'1',user_defined_dpi:String(this.options.dpi??300),tessedit_char_whitelist:''});
    }
  }

  async recognizeReceiptLines(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    signal?.throwIfAborted();
    const selected=this.lastSelectedVariant;
    if(!selected||!regions.length)return[];
    const worker=await this.getWorker();
    const output:OcrToken[]=[];
    try{
      for(const [regionIndex,region] of regions.slice(0,10).entries()){
        signal?.throwIfAborted();
        const margin=.08;
        const x=Math.max(0,region.box.x-region.box.width*margin);
        const y=Math.max(0,region.box.y-region.box.height*.35);
        const r=Math.min(selected.pageWidth,region.box.x+region.box.width*(1+margin));
        const b=Math.min(selected.pageHeight,region.box.y+region.box.height*1.35);
        const left=Math.floor(x/selected.scaleX),top=Math.floor(y/selected.scaleY);
        const width=Math.max(1,Math.ceil((r-x)/selected.scaleX)),height=Math.max(1,Math.ceil((b-y)/selected.scaleY));
        const crop=document.createElement('canvas');crop.width=width;crop.height=height;
        crop.getContext('2d')!.drawImage(selected.canvas,left,top,width,height,0,0,width,height);

        const baseScale=Math.max(1,Math.min(2.6,96/Math.max(1,crop.height)));
        const enlarged=document.createElement('canvas');
        enlarged.width=Math.max(1,Math.round(crop.width*baseScale));
        enlarged.height=Math.max(1,Math.round(crop.height*baseScale));
        const enlargedCtx=enlarged.getContext('2d',{willReadFrequently:true})!;
        enlargedCtx.imageSmoothingEnabled=true;enlargedCtx.imageSmoothingQuality='high';
        enlargedCtx.drawImage(crop,0,0,enlarged.width,enlarged.height);

        const variants=localRetryVariants(enlarged);
        let best:{words:any[];confidence:number;factor:number}|undefined;
        for(const variant of variants){
          await worker.setParameters({
            tessedit_pageseg_mode:PSM.SINGLE_LINE,
            preserve_interword_spaces:'1',
            user_defined_dpi:'300',
            tessedit_char_whitelist:''
          });
          const result=await worker.recognize(variant as never,{}, {text:true,blocks:true});
          const words=result.data.blocks?.flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)))??[];
          const useful=words.filter(word=>word.text?.trim());
          const confidence=result.data.confidence??averageWordConfidence(useful);
          const factor=variant.width/Math.max(1,crop.width);
          const lexical=useful.filter(word=>/[\p{L}\p{N}]/u.test(word.text??'')).length;
          const score=confidence+Math.min(8,lexical*.8);
          const bestScore=best?best.confidence+Math.min(8,best.words.length*.8):-1;
          if(useful.length&&score>bestScore)best={words:useful,confidence,factor};
          if(useful.length&&confidence>=90)break;
        }
        if(!best)continue;
        for(const word of best.words){
          const text=String(word.text??'').trim();if(!text)continue;
          const confidence=Number.isFinite(word.confidence)?Number(word.confidence):best.confidence;
          if(confidence<58)continue;
          const bbox=word.bbox??{x0:0,y0:0,x1:0,y1:0};
          const factor=best.factor;
          const box={
            x:(left+(bbox.x0/factor))*selected.scaleX,
            y:(top+(bbox.y0/factor))*selected.scaleY,
            width:Math.max(1,((bbox.x1-bbox.x0)/factor)*selected.scaleX),
            height:Math.max(1,((bbox.y1-bbox.y0)/factor)*selected.scaleY)
          };
          output.push({
            id:`p${input.pageNumber}-receipt-line-${regionIndex}-${output.length}`,
            text,confidence,box,lineId:`p${input.pageNumber}-receipt-line-${regionIndex}`,provenance:'ocr'
          });
        }
      }
      return output;
    }finally{
      await worker.setParameters({tessedit_pageseg_mode:this.normalPsm(),preserve_interword_spaces:'1',user_defined_dpi:String(this.options.dpi??300),tessedit_char_whitelist:''});
    }
  }

  async recognizeReceiptAmounts(input:OcrPageInput,signal?:AbortSignal):Promise<OcrToken[]>{
    signal?.throwIfAborted();
    const selected=this.lastSelectedVariant;
    if(!selected)return[];
    const worker=await this.getWorker();
    const source=selected.canvas,scaleX=selected.scaleX,scaleY=selected.scaleY;
    const recovered:OcrToken[]=[];
    const regions=[
      {x:0,y:.20,w:1,h:.38,psm:PSM.SINGLE_COLUMN},
      {x:.52,y:.18,w:.48,h:.48,psm:PSM.SPARSE_TEXT},
      {x:0,y:.36,w:1,h:.26,psm:PSM.SINGLE_COLUMN}
    ];
    try{
      for(const region of regions){
        const left=Math.floor(source.width*region.x),top=Math.floor(source.height*region.y),width=Math.max(1,Math.floor(source.width*region.w)),height=Math.max(1,Math.floor(source.height*region.h));
        const crop=document.createElement('canvas');crop.width=width;crop.height=height;crop.getContext('2d')!.drawImage(source,left,top,width,height,0,0,width,height);
        await worker.setParameters({tessedit_pageseg_mode:region.psm,preserve_interword_spaces:'1',user_defined_dpi:String(this.options.dpi??300),tessedit_char_whitelist:''});
        const result=await worker.recognize(crop as never,{}, {text:true,blocks:true});
        for(const block of result.data.blocks??[])for(const paragraph of block.paragraphs??[])for(const line of paragraph.lines??[])for(const word of line.words??[]){
          const clean=word.text.trim().replace(/^[€"'\[({\s]+|[€"'\])}\s]+$/g,'');
          if(!/^[-−]?\d{1,4}[.,]\d{2}$/.test(clean)||(word.confidence??0)<70)continue;
          const {x0,y0,x1,y1}=word.bbox;
          const box={x:(x0+left)*scaleX,y:(y0+top)*scaleY,width:(x1-x0)*scaleX,height:(y1-y0)*scaleY};
          if(recovered.some(existing=>sameAmount(existing.text,clean)&&boxOverlapLocal(existing.box,box)>.45))continue;
          recovered.push({id:`p${input.pageNumber}-gc-price-${recovered.length}`,text:clean,confidence:word.confidence,box,lineId:`p${input.pageNumber}-gc-price-${recovered.length}`,provenance:'ocr'});
        }
      }
      return recovered;
    }finally{
      await worker.setParameters({tessedit_pageseg_mode:this.normalPsm(),preserve_interword_spaces:'1',user_defined_dpi:String(this.options.dpi??300),tessedit_char_whitelist:''});
    }
  }

  async dispose():Promise<void>{const worker=this.worker;this.worker=undefined;if(worker)await worker.terminate();}
  private normalPsm(){return this.options.segmentation==='block'?PSM.SINGLE_BLOCK:this.options.segmentation==='sparse'?PSM.SPARSE_TEXT:PSM.AUTO;}
  private async getWorker():Promise<Worker>{if(this.worker)return this.worker;this.worker=await createWorker(this.options.language??'ita',OEM.LSTM_ONLY);await this.worker.setParameters({tessedit_pageseg_mode:this.normalPsm(),preserve_interword_spaces:'1',user_defined_dpi:String(this.options.dpi??300)});return this.worker;}
}

function chooseSegmentation(width:number,height:number,fallback:PSM):PSM{const ratio=width/Math.max(1,height);return ratio<.72&&height>width*1.35?PSM.SINGLE_COLUMN:fallback;}
function pageFromResult(input:OcrPageInput,blocks:any[],text:string):OcrPage{
  const tokens:OcrToken[]=[];let lineIndex=0,repairedCount=0,filteredCount=0;
  for(const block of blocks)for(const paragraph of block.paragraphs??[])for(const line of paragraph.lines??[]){
    const lineId=`p${input.pageNumber}-l${lineIndex++}`;
    for(const word of line.words??[]){
      if(!word.text?.trim())continue;
      const repaired=repairTesseractWord(word,input.width,input.height);
      if(!repaired){filteredCount++;continue;}
      if(repaired.repaired)repairedCount++;
      tokens.push({
        id:`p${input.pageNumber}-t${tokens.length}`,
        text:word.text.trim(),confidence:repaired.confidence,
        box:repaired.box,lineId,provenance:'ocr',
        ...(repaired.characters.length?{characters:repaired.characters}:{})
      });
    }
  }
  const clean=nmsTokens(tokens);
  const warnings:string[]=[];
  if(!clean.length)warnings.push('OCR_NO_TEXT');
  if(repairedCount)warnings.push(`TOKEN_GEOMETRY_CONFIDENCE_REPAIRED:${repairedCount}`);
  if(filteredCount)warnings.push(`TOKEN_GARBAGE_FILTERED:${filteredCount}`);
  return{pageNumber:input.pageNumber,width:input.width,height:input.height,text:rebuildPageText(clean),tokens:clean,warnings};
}
export function repairTesseractWord(word:any,pageWidth:number,pageHeight:number):{
  box:{x:number;y:number;width:number;height:number};
  confidence:number|null;
  characters:Array<{text:string;confidence:number|null;box:{x:number;y:number;width:number;height:number}}>;
  repaired:boolean;
}|null{
  const text=String(word?.text??'').trim();
  if(!text)return null;
  const raw=word?.bbox??{x0:0,y0:0,x1:0,y1:0};
  const rawBox={x:Number(raw.x0)||0,y:Number(raw.y0)||0,width:Math.max(0,(Number(raw.x1)||0)-(Number(raw.x0)||0)),height:Math.max(0,(Number(raw.y1)||0)-(Number(raw.y0)||0))};
  const chars=(word?.symbols??[]).map((symbol:any)=>{
    const b=symbol?.bbox??raw;
    return{
      text:String(symbol?.text??''),
      confidence:Number.isFinite(symbol?.confidence)?Number(symbol.confidence):null,
      box:{x:Number(b.x0)||0,y:Number(b.y0)||0,width:Math.max(0,(Number(b.x1)||0)-(Number(b.x0)||0)),height:Math.max(0,(Number(b.y1)||0)-(Number(b.y0)||0))}
    };
  }).filter((item:any)=>item.text&&item.box.width>0&&item.box.height>0);

  const wordConfidence=Number.isFinite(word?.confidence)?Math.max(0,Math.min(100,Number(word.confidence))):null;
  if(!chars.length){
    if(isGarbageTokenCandidate(text,wordConfidence,rawBox,pageWidth,pageHeight))return null;
    return{box:rawBox,confidence:wordConfidence,characters:[],repaired:false};
  }

  const widths=chars.map((ch:any)=>ch.box.width).filter((value:number)=>value>0);
  const heights=chars.map((ch:any)=>ch.box.height).filter((value:number)=>value>0);
  const medianWidth=median(widths),medianHeight=median(heights);
  const medianY=median(chars.map((ch:any)=>ch.box.y));
  let geometryRepaired=false;
  const repairedChars=chars.map((ch:any)=>{
    const box={...ch.box};
    const widthOutlier=medianWidth>0&&box.width>medianWidth*2.6;
    const heightOutlier=medianHeight>0&&box.height>medianHeight*1.55;
    if(widthOutlier){box.width=Math.min(box.width,medianWidth*1.35);geometryRepaired=true;}
    if(heightOutlier){
      box.y=medianY;
      box.height=medianHeight;
      geometryRepaired=true;
    }
    return{...ch,box};
  });
  const charUnion=unionBoxes(repairedChars.map((ch:any)=>ch.box));
  const rawArea=Math.max(1,rawBox.width*rawBox.height),charArea=Math.max(1,charUnion.width*charUnion.height);
  const rawImplausible=rawArea>charArea*1.4||rawBox.width>charUnion.width*1.32||rawBox.height>charUnion.height*1.45;
  const box=rawImplausible?charUnion:rawBox;
  if(rawImplausible)geometryRepaired=true;

  const charConfidences=repairedChars.map((ch:any)=>ch.confidence).filter((value:any):value is number=>Number.isFinite(value));
  const charConfidence=charConfidences.length?charConfidences.reduce((sum:number,value:number)=>sum+value,0)/charConfidences.length:null;
  let confidence=wordConfidence;
  let confidenceRepaired=false;
  if(charConfidence!==null){
    const suspiciousText=isSemanticallySuspiciousToken(text);
    if(wordConfidence===null)confidence=Math.round(charConfidence);
    else if(wordConfidence<60&&charConfidence>=82){
      const blended=wordConfidence*.22+charConfidence*.78;
      confidence=Math.round(suspiciousText?Math.min(69,blended):blended);
      confidenceRepaired=true;
    }else if(wordConfidence<75&&charConfidence-wordConfidence>=22){
      confidence=Math.round(wordConfidence*.4+charConfidence*.6);
      confidenceRepaired=true;
    }
  }

  if(isGarbageTokenCandidate(text,confidence,box,pageWidth,pageHeight))return null;
  return{box,confidence,characters:repairedChars,repaired:geometryRepaired||confidenceRepaired};
}
function unionBoxes(boxes:Array<{x:number;y:number;width:number;height:number}>){
  const left=Math.min(...boxes.map(box=>box.x)),top=Math.min(...boxes.map(box=>box.y));
  const right=Math.max(...boxes.map(box=>box.x+box.width)),bottom=Math.max(...boxes.map(box=>box.y+box.height));
  return{x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
}
function isSemanticallySuspiciousToken(text:string){
  if(/^[^\p{L}\p{N}]+$/u.test(text))return true;
  if(/[{}\[\]\\|]/.test(text))return true;
  if(/\p{Ll}\p{Lu}/u.test(text)&&text.length<=4)return true;
  const alnum=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  return alnum/Math.max(1,[...text].length)<.6;
}
function isGarbageTokenCandidate(text:string,confidence:number|null,box:{x:number;y:number;width:number;height:number},pageWidth:number,pageHeight:number){
  const conf=confidence??0;
  const alnum=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  if(alnum>0)return false;
  if(conf>=45)return false;
  const edge=box.x<=2||box.y<=2||box.x+box.width>=pageWidth-2||box.y+box.height>=pageHeight-2;
  const extreme=box.width<5||box.height>Math.max(40,box.width*8)||box.width>Math.max(40,box.height*8);
  const isolatedNoise=/^[|”„“'´`~^]$/.test(text);
  return edge||extreme||isolatedNoise;
}

export function selectOrientationFromScores(scores:Array<{degrees:0|90|180|270;score:number}>,margin=8,minScore=38):0|90|180|270{
  const zero=scores.find(item=>item.degrees===0)?.score??0;
  const best=[...scores].sort((a,b)=>b.score-a.score)[0];
  if(!best||best.degrees===0)return 0;
  if(best.score<minScore)return 0;
  if(best.score-zero<margin)return 0;
  return best.degrees;
}

async function chooseOcrOrientation(worker:Worker,source:HTMLCanvasElement,input:OcrPageInput,dpi:number,signal?:AbortSignal){
  const scores:Array<{degrees:0|90|180|270;score:number}>=[];
  const pages=new Map<0|90|180|270,{canvas:HTMLCanvasElement;score:number}>();
  const probe=async(degrees:0|90|180|270)=>{
    const canvas=degrees===0?source:rotateRightAngle(source,degrees);
    const result=await quickOcrProbe(worker,canvas,input,dpi,signal);
    scores.push({degrees,score:result.score});
    pages.set(degrees,{canvas,score:result.score});
    return result.score;
  };

  // Fast path: la grande maggioranza dei documenti acquisiti correttamente è già a 0°.
  const zero=await probe(0);
  if(zero>=72)return{degrees:0 as const,canvas:source,score:zero,scores};

  // 180° è il secondo candidato naturale quando la pagina è verticale ma capovolta.
  const upsideDown=await probe(180);
  const geometryHint=estimateOrientation(source);

  // 90/270 vengono provati solo se la geometria li suggerisce o se 0/180 sono entrambi deboli.
  if(geometryHint===90||geometryHint===270){
    await probe(geometryHint);
    const other=geometryHint===90?270:90;
    if(Math.max(...scores.map(item=>item.score))<58)await probe(other);
  }else if(Math.max(zero,upsideDown)<50){
    await probe(90);
    await probe(270);
  }

  const degrees=selectOrientationFromScores(scores);
  const chosen=pages.get(degrees)??pages.get(0)!;
  return{degrees,canvas:chosen.canvas,score:chosen.score,scores};
}

async function quickOcrProbe(worker:Worker,source:HTMLCanvasElement,input:OcrPageInput,dpi:number,signal?:AbortSignal){
  signal?.throwIfAborted();
  const maxDimension=1100,scale=Math.min(1,maxDimension/Math.max(source.width,source.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(source.width*scale));
  canvas.height=Math.max(1,Math.round(source.height*scale));
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1',user_defined_dpi:String(dpi),tessedit_char_whitelist:''});
  const recognized=await worker.recognize(canvas as never,{}, {text:true,blocks:true});
  const local=pageFromResult({...input,width:canvas.width,height:canvas.height,image:canvas},recognized.data.blocks??[],recognized.data.text);
  return{score:scoreOcrVariant(local),confidence:recognized.data.confidence??averageConfidence(local),page:local};
}

function canUseCanvas(image:unknown):boolean{return typeof document!=='undefined'&&typeof HTMLCanvasElement!=='undefined'&&image instanceof HTMLCanvasElement;}
function cleanCriticalReading(value:string,kind:OcrRetryRegion['kind']):string{
  let text=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(kind==='money'||kind==='numeric'){
    text=text.replace(/[^0-9.,€]/g,'');
    const match=text.match(/(?:€)?\d{1,5}[.,]\d{2}/);
    if(match)return match[0].replace('.',',');
  }
  if(kind==='date')return text.replace(/\s+/g,'').replace(/[–—]/g,'-');
  return text.replace(/^[|>_=]+\s*/,'').replace(/\s*[|>_=]+$/,'').trim();
}
function criticalReadingValid(value:string,kind:OcrRetryRegion['kind']):boolean{
  if(kind==='money')return /^(?:€)?\d{1,5}[.,]\d{2}$/.test(value);
  if(kind==='numeric')return /^\d{1,14}(?:[.,]\d{2})?$/.test(value);
  if(kind==='date')return /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:\d{1,2}:\d{2})?$/.test(value)||/^\d{1,2}:\d{2}$/.test(value);
  return /[\p{L}\p{N}]/u.test(value)&&value.length>=2;
}
function criticalConsensusCandidate(candidates:Array<{text:string;confidence:number;box:{x:number;y:number;width:number;height:number}}>,kind:OcrRetryRegion['kind']){
  if(!candidates.length)return undefined;
  const normalizeValue=(value:string)=>{
    const v=value.normalize('NFKC').toUpperCase().replace(/\s+/g,'').replace('.',',');
    return kind==='money'?v.replace(/^€/,''):v;
  };
  const groups=new Map<string,typeof candidates>();
  for(const candidate of candidates){
    const key=normalizeValue(candidate.text);
    const group=groups.get(key)??[];group.push(candidate);groups.set(key,group);
  }
  const ranked=[...groups.values()].map(group=>({
    text:group[0]!.text,
    confidence:Math.min(99,group.reduce((sum,item)=>sum+item.confidence,0)/group.length+Math.max(0,group.length-1)*5),
    box:group[0]!.box,
    votes:group.length
  })).sort((a,b)=>b.votes-a.votes||b.confidence-a.confidence);
  return ranked[0];
}

function localRetryVariants(source:HTMLCanvasElement){const variants=[source];for(const factor of [1.25,1.55]){const c=document.createElement('canvas');c.width=Math.round(source.width*factor);c.height=Math.round(source.height*factor);const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,c.width,c.height);const img=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<img.data.length;i+=4){const y=.299*img.data[i]!+.587*img.data[i+1]!+.114*img.data[i+2]!;const v=Math.max(0,Math.min(255,(y-128)*1.35+138));img.data[i]=v;img.data[i+1]=v;img.data[i+2]=v;}ctx.putImageData(img,0,0);variants.push(c);}return variants;}
function consensusCandidate(candidates:Array<{text:string;confidence:number;box:{x:number;y:number;width:number;height:number}}>) {if(!candidates.length)return undefined;const groups=new Map<string,typeof candidates>();for(const c of candidates){const k=c.text.normalize('NFKC').replace(/\s+/g,' ').trim().toUpperCase();const a=groups.get(k)??[];a.push(c);groups.set(k,a);}return[...groups.values()].map(g=>({text:g[0]!.text,confidence:Math.min(99,g.reduce((s,c)=>s+c.confidence,0)/g.length+Math.max(0,g.length-1)*4),box:g[0]!.box,votes:g.length})).sort((a,b)=>b.votes-a.votes||b.confidence-a.confidence)[0];}
function averageWordConfidence(words:any[]){return words.length?words.reduce((s,w)=>s+(w.confidence??0),0)/words.length:0;}
function averageConfidence(page:OcrPage):number{return page.tokens.length?page.tokens.reduce((sum,token)=>sum+(token.confidence??0),0)/page.tokens.length:0;}
function sameAmount(a:string,b:string){return a.replace('.',',').replace('−','-')===b.replace('.',',').replace('−','-');}
function boxOverlapLocal(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number}){const l=Math.max(a.x,b.x),t=Math.max(a.y,b.y),r=Math.min(a.x+a.width,b.x+b.width),bt=Math.min(a.y+a.height,b.y+b.height);if(r<=l||bt<=t)return 0;return((r-l)*(bt-t))/Math.max(1,Math.min(a.width*a.height,b.width*b.height));}


function boundsOfCorners(c:{topLeft:{x:number;y:number};topRight:{x:number;y:number};bottomRight:{x:number;y:number};bottomLeft:{x:number;y:number}}){
  const xs=[c.topLeft.x,c.topRight.x,c.bottomRight.x,c.bottomLeft.x],ys=[c.topLeft.y,c.topRight.y,c.bottomRight.y,c.bottomLeft.y];
  const x=Math.min(...xs),y=Math.min(...ys);return{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
}
function perspectiveScore(c:{topLeft:{x:number;y:number};topRight:{x:number;y:number};bottomRight:{x:number;y:number};bottomLeft:{x:number;y:number}}){
  const d=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
  const top=d(c.topLeft,c.topRight),bottom=d(c.bottomLeft,c.bottomRight),left=d(c.topLeft,c.bottomLeft),right=d(c.topRight,c.bottomRight);
  const w=Math.min(top,bottom)/Math.max(1,Math.max(top,bottom)),h=Math.min(left,right)/Math.max(1,Math.max(left,right));
  return Math.max(0,Math.min(1,(w+h)/2));
}


function profileConfig(profile:'min'|'med'|'max'){
  return profile==='min'?{maxDimension:1800,variantCount:2,retryLimit:4}
    :profile==='max'?{maxDimension:3000,variantCount:6,retryLimit:24}
    :{maxDimension:2400,variantCount:4,retryLimit:6};
}
function median(values:number[]){if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]!:((s[m-1]??0)+(s[m]??0))/2;}
function clonePage(page:OcrPage):OcrPage{return{
  ...page,tokens:page.tokens.map(t=>({...t,box:{...t.box},characters:t.characters?.map(ch=>({...ch,box:{...ch.box}})),alternatives:t.alternatives?[...t.alternatives]:undefined})),
  lines:page.lines?.map(line=>({...line,box:{...line.box},normalizedBox:{...line.normalizedBox},tokenIds:[...line.tokenIds]})),
  blocks:page.blocks?.map(block=>({...block,box:{...block.box},normalizedBox:{...block.normalizedBox},lineIds:[...block.lineIds]})),
  warnings:[...page.warnings],
  detectedRegions:page.detectedRegions?.map(r=>({...r,box:{...r.box},evidence:[...r.evidence]})),
  variantEvidence:page.variantEvidence?.map(evidence=>({...evidence,tokens:evidence.tokens.map(token=>({...token,box:{...token.box},characters:token.characters?.map(ch=>({...ch,box:{...ch.box}})),alternatives:token.alternatives?[...token.alternatives]:undefined}))}))
};}


function nmsTokens(tokens:OcrToken[]):OcrToken[]{
  const ordered=[...tokens].sort((a,b)=>(b.confidence??0)-(a.confidence??0));
  const kept:OcrToken[]=[];
  for(const token of ordered){
    const duplicate=kept.find(existing=>boxOverlapLocal(existing.box,token.box)>.72&&normalizeNms(existing.text)===normalizeNms(token.text));
    if(!duplicate)kept.push(token);
  }
  return kept.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
}
function normalizeNms(v:string){return v.normalize('NFKC').replace(/\s+/g,'').toUpperCase();}
function rebuildPageText(tokens:OcrToken[]):string{
  const lines=new Map<string,OcrToken[]>();for(const t of tokens){const a=lines.get(t.lineId)??[];a.push(t);lines.set(t.lineId,a);}
  return[...lines.values()].sort((a,b)=>Math.min(...a.map(t=>t.box.y))-Math.min(...b.map(t=>t.box.y))).map(line=>line.sort((a,b)=>a.box.x-b.box.x).map(t=>t.text).join(' ')).join('\n');
}
