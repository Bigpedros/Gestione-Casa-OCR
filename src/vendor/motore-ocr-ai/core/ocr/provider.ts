import type {OcrPage,OcrToken} from '../../contracts.js';

export interface OcrPageInput {
  pageNumber:number; width:number; height:number; image?:unknown; nativeTokens?:OcrToken[];
}
export interface OcrRetryRegion{box:import('../../contracts.js').Box;reason:string;kind?:'text'|'numeric'|'money'|'date'|'code'}
export interface OcrProvider {
  readonly id:string;
  recognize(input:OcrPageInput,signal?:AbortSignal):Promise<OcrPage>;
  recognizeReceiptAmounts?(input:OcrPageInput,signal?:AbortSignal):Promise<OcrToken[]>;
  recognizeReceiptLines?(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>;
  recognizeRegions?(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>;
  /** Independent Recognizer B channel. Results remain a separate evidence source. */
  recognizeIndependentRegions?(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>;
  /** Returns the normalized raster coordinate space shared with independent recognizers. */
  prepareIndependentInput?(input:OcrPageInput):OcrPageInput;
}

export class NativeFirstOcrProvider implements OcrProvider {
  readonly id='native-first';
  constructor(private readonly fallback:OcrProvider){}
  async recognize(input:OcrPageInput,signal?:AbortSignal):Promise<OcrPage>{
    signal?.throwIfAborted();
    const native=input.nativeTokens?.filter(t=>t.text.trim())??[];
    if(native.length&&nativeLayerCoherent(native,input.width,input.height))return {
      pageNumber:input.pageNumber,width:input.width,height:input.height,
      text:rebuildNativeText(native),tokens:native,warnings:['NATIVE_PDF_LAYER_VERIFIED']
    };
    const fallback=await this.fallback.recognize(input,signal);
    if(native.length)fallback.warnings.push('NATIVE_PDF_LAYER_REJECTED');
    return fallback;
  }
  async recognizeReceiptAmounts(input:OcrPageInput,signal?:AbortSignal):Promise<OcrToken[]>{
    return this.fallback.recognizeReceiptAmounts?.(input,signal)??[];
  }
  async recognizeReceiptLines(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    return this.fallback.recognizeReceiptLines?.(input,regions,signal)??[];
  }
  async recognizeRegions(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    return this.fallback.recognizeRegions?.(input,regions,signal)??[];
  }
  async recognizeIndependentRegions(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    return this.fallback.recognizeIndependentRegions?.(input,regions,signal)??[];
  }
  prepareIndependentInput(input:OcrPageInput):OcrPageInput{
    return this.fallback.prepareIndependentInput?.(input)??input;
  }
}


function nativeLayerCoherent(tokens:OcrToken[],width:number,height:number):boolean{
  if(!tokens.length)return false;
  const invalid=tokens.filter(t=>!Number.isFinite(t.box.x)||!Number.isFinite(t.box.y)||t.box.width<=0||t.box.height<=0||t.box.x<-5||t.box.y<-5||t.box.x>width+5||t.box.y>height+5).length;
  const chars=tokens.map(t=>t.text).join('');const weird=(chars.match(/[\uFFFD\x00-\x08\x0B\x0C\x0E-\x1F]/g)||[]).length;
  const useful=tokens.filter(t=>/[\p{L}\p{N}]/u.test(t.text)).length;
  return invalid/tokens.length<.08&&weird/Math.max(1,chars.length)<.02&&useful/tokens.length>.45;
}
function rebuildNativeText(tokens:OcrToken[]):string{
  const lines=new Map<string,OcrToken[]>();for(const token of tokens){const a=lines.get(token.lineId)??[];a.push(token);lines.set(token.lineId,a);}
  return[...lines.values()].sort((a,b)=>Math.min(...a.map(t=>t.box.y))-Math.min(...b.map(t=>t.box.y))).map(line=>line.sort((a,b)=>a.box.x-b.box.x).map(t=>t.text).join(' ')).join('\n');
}
