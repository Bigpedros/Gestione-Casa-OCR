import type {OcrPage,OcrToken} from '../../contracts.js';
import type {OcrPageInput,OcrProvider,OcrRetryRegion} from './provider.js';
import {
  addEvidenceTokens,
  createEvidenceSet,
  createNormalizedImageCheckpoint,
  createRawOcrSnapshot,
  type OcrEvidenceSet,
  type RawOcrSnapshot,
  type StabilizedOcrCheckpoint,
  type NormalizedImageCheckpoint
} from '../pipeline/checkpoints.js';
import {stabilizeOcrPage} from '../pipeline/decisionEngine.js';

export interface OcrSessionDiagnostics{
  providerId:string;
  initialMs:number;
  regionalMs:number;
  receiptLineMs:number;
  receiptAmountMs:number;
  stabilizationMs:number;
  initialVariantEvidence:number;
  independentVariantEvidence:number;
  regionalPasses:number;
}
export interface OcrPageSession{
  input:OcrPageInput;
  normalizedImage:NormalizedImageCheckpoint;
  raw:RawOcrSnapshot;
  evidence:OcrEvidenceSet;
  stabilized:StabilizedOcrCheckpoint;
  diagnostics:OcrSessionDiagnostics;
}
export interface RegionalPassOptions{
  source:'targeted-reocr'|'critical-reocr';
  reason:string;
  independent?:boolean;
}

export class OcrPageOrchestrator{
  constructor(private readonly provider:OcrProvider){}

  async start(input:OcrPageInput,signal?:AbortSignal):Promise<OcrPageSession>{
    signal?.throwIfAborted();
    const started=performance.now();
    const page=await this.provider.recognize(input,signal);
    const initialMs=performance.now()-started;
    const normalizedImage=createNormalizedImageCheckpoint(page);
    const raw=createRawOcrSnapshot(page);
    const evidence=createEvidenceSet(raw);
    let independentVariantEvidence=0;
    for(const variant of page.variantEvidence??[]){
      const source=variant.source.startsWith('recognizer-b:')?'recognizer-b':'variant';
      if(source==='recognizer-b')independentVariantEvidence++;
      addEvidenceTokens(evidence,source,variant.tokens,`${variant.source}; score=${variant.score.toFixed(1)}`);
    }
    const s=performance.now();
    const stabilized=stabilizeOcrPage(evidence);
    return{
      input,normalizedImage,raw,evidence,stabilized,
      diagnostics:{
        providerId:this.provider.id,initialMs,
        regionalMs:0,receiptLineMs:0,receiptAmountMs:0,
        stabilizationMs:performance.now()-s,
        initialVariantEvidence:page.variantEvidence?.length??0,
        independentVariantEvidence,
        regionalPasses:0
      }
    };
  }

  stabilize(session:OcrPageSession):StabilizedOcrCheckpoint{
    const started=performance.now();
    session.stabilized=stabilizeOcrPage(session.evidence);
    session.diagnostics.stabilizationMs+=performance.now()-started;
    return session.stabilized;
  }

  addEvidence(session:OcrPageSession,source:Parameters<typeof addEvidenceTokens>[1],tokens:OcrToken[],reason:string):void{
    if(tokens.length)addEvidenceTokens(session.evidence,source,tokens,reason);
  }

  async runRegionalPass(session:OcrPageSession,regions:OcrRetryRegion[],options:RegionalPassOptions,signal?:AbortSignal):Promise<OcrToken[]>{
    if(!regions.length)return[];
    const started=performance.now();
    const fn=options.independent?this.provider.recognizeIndependentRegions:this.provider.recognizeRegions;
    if(!fn)return[];
    const tokens=await fn.call(this.provider,session.input,regions,signal);
    session.diagnostics.regionalMs+=performance.now()-started;
    session.diagnostics.regionalPasses++;
    if(tokens.length)addEvidenceTokens(
      session.evidence,
      options.independent?'recognizer-b-region':options.source,
      tokens,
      options.reason
    );
    return tokens;
  }

  async runReceiptLinePass(session:OcrPageSession,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    if(!regions.length||!this.provider.recognizeReceiptLines)return[];
    const started=performance.now();
    const tokens=await this.provider.recognizeReceiptLines(session.input,regions,signal);
    session.diagnostics.receiptLineMs+=performance.now()-started;
    if(tokens.length)addEvidenceTokens(session.evidence,'receipt-line',tokens,'high-resolution receipt line OCR');
    return tokens;
  }

  async runReceiptAmountPass(session:OcrPageSession,signal?:AbortSignal):Promise<OcrToken[]>{
    if(!this.provider.recognizeReceiptAmounts)return[];
    const started=performance.now();
    const tokens=await this.provider.recognizeReceiptAmounts(session.input,signal);
    session.diagnostics.receiptAmountMs+=performance.now()-started;
    if(tokens.length)addEvidenceTokens(session.evidence,'receipt-amount',tokens,'regional receipt amount OCR');
    return tokens;
  }

  currentPage(session:OcrPageSession):OcrPage{return session.stabilized.page;}
}
