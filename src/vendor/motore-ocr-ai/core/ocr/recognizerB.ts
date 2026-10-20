import type {Box,OcrPage,OcrProviderVariantEvidence,OcrToken} from '../../contracts.js';
import type {OcrPageInput,OcrProvider,OcrRetryRegion} from './provider.js';

export interface RecognizerBResult{
  id:string;
  tokens:OcrToken[];
  text:string;
  score:number;
  confidence:number|null;
  warnings:string[];
  timingMs?:number;
}

export interface RecognizerB{
  readonly id:string;
  recognize(input:OcrPageInput,signal?:AbortSignal):Promise<RecognizerBResult>;
  recognizeRegions?(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>;
}

export interface OcrsWasmRecognizerBOptions{
  moduleUrl?:string;
  detectionModelUrl?:string;
  recognitionModelUrl?:string;
  regionLimit?:number;
}

interface OcrsWordJson{text:string;rect:[number,number,number,number]}
interface OcrsWasmInstance{recognize_rgba:(pixels:Uint8Array,width:number,height:number)=>string|Promise<string>}
interface OcrsWasmConstructor{new(detection:Uint8Array,recognition:Uint8Array):OcrsWasmInstance}
interface OcrsWasmModule{
  default?:(input?:unknown)=>Promise<unknown>|unknown;
  OcrsRecognizer?:OcrsWasmConstructor;
}

const dynamicImport=(url:string)=>new Function('u','return import(u)')(url) as Promise<OcrsWasmModule>;

export class OcrsWasmRecognizerB implements RecognizerB{
  readonly id='ocrs-rten-wasm';
  private runtime?:Promise<OcrsWasmInstance>;
  private readonly options:Required<OcrsWasmRecognizerBOptions>;
  constructor(options:OcrsWasmRecognizerBOptions={}){
    this.options={
      moduleUrl:options.moduleUrl??'/recognizer-b/ocrs_wasm.js',
      detectionModelUrl:options.detectionModelUrl??'/models/text-detection.rten',
      recognitionModelUrl:options.recognitionModelUrl??'/models/text-recognition.rten',
      regionLimit:options.regionLimit??8
    };
  }

  async recognize(input:OcrPageInput,signal?:AbortSignal):Promise<RecognizerBResult>{
    const started=performance.now();
    signal?.throwIfAborted();
    if(!isCanvas(input.image))return{id:this.id,tokens:[],text:'',score:0,confidence:null,warnings:['RECOGNIZER_B_IMAGE_UNAVAILABLE'],timingMs:performance.now()-started};
    try{
      const runtime=await this.getRuntime(signal);
      const words=await recognizeCanvas(runtime,input.image,signal);
      const tokens=wordsToTokens(words,input.pageNumber,0,0,'b');
      return{id:this.id,tokens,text:rebuild(tokens),score:scoreTokens(tokens),confidence:tokens.length?averageConfidence(tokens):null,warnings:[],timingMs:performance.now()-started};
    }catch(error){
      return{id:this.id,tokens:[],text:'',score:0,confidence:null,warnings:[`RECOGNIZER_B_UNAVAILABLE:${message(error)}`],timingMs:performance.now()-started};
    }
  }

  async recognizeRegions(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    signal?.throwIfAborted();
    if(!isCanvas(input.image)||!regions.length)return[];
    let runtime:OcrsWasmInstance;
    try{runtime=await this.getRuntime(signal);}catch{return[];}
    const output:OcrToken[]=[];
    for(const [index,region] of regions.slice(0,this.options.regionLimit).entries()){
      signal?.throwIfAborted();
      const crop=cropCanvas(input.image,region.box,.08);
      if(!crop)continue;
      const words=await recognizeCanvas(runtime,crop.canvas,signal).catch(()=>[]);
      const mapped=wordsToTokens(words,input.pageNumber,crop.x,crop.y,`br${index}`);
      for(const token of mapped){
        token.correctionReason=`recognizer-b:${this.id}:${region.reason}`;
        output.push(token);
      }
    }
    return output;
  }

  private async getRuntime(signal?:AbortSignal):Promise<OcrsWasmInstance>{
    if(!this.runtime)this.runtime=this.loadRuntime(signal);
    return this.runtime;
  }

  private async loadRuntime(signal?:AbortSignal):Promise<OcrsWasmInstance>{
    signal?.throwIfAborted();
    const [module,detection,recognition]=await Promise.all([
      dynamicImport(this.options.moduleUrl),
      fetchBytes(this.options.detectionModelUrl,signal),
      fetchBytes(this.options.recognitionModelUrl,signal)
    ]);
    if(module.default)await module.default();
    if(!module.OcrsRecognizer)throw new Error('OcrsRecognizer export mancante nel modulo WASM');
    return new module.OcrsRecognizer(detection,recognition);
  }
}

export class DualRecognizerOcrProvider implements OcrProvider{
  readonly id:string;
  constructor(private readonly primary:OcrProvider,private readonly secondary:RecognizerB){
    this.id=`dual:${primary.id}+${secondary.id}`;
  }

  async recognize(input:OcrPageInput,signal?:AbortSignal):Promise<OcrPage>{
    signal?.throwIfAborted();
    const wallStarted=performance.now();
    const independentInput=this.primary.prepareIndependentInput?.(input)??input;

    // Full-page readers are deliberately started together. Reconciliation still treats
    // the primary raster as immutable and the secondary result only as independent evidence.
    const primaryStarted=performance.now();
    const primaryPromise=this.primary.recognize(input,signal).then(page=>({
      page,
      timingMs:performance.now()-primaryStarted
    }));
    const secondaryStarted=performance.now();
    const secondaryPromise=this.secondary.recognize(independentInput,signal).then(result=>({
      result,
      timingMs:result.timingMs??(performance.now()-secondaryStarted)
    }));

    const [{page,timingMs:primaryMs},{result,timingMs:secondaryMs}]=await Promise.all([primaryPromise,secondaryPromise]);
    signal?.throwIfAborted();
    const wallMs=performance.now()-wallStarted;
    const timingWarnings=[
      'OCR_DUAL_EXECUTION_MODE:parallel-full-page',
      `OCR_PRIMARY_MS:${Math.round(primaryMs)}`,
      `OCR_SECONDARY_MS:${Math.round(secondaryMs)}`,
      `OCR_DUAL_WALL_MS:${Math.round(wallMs)}`
    ];

    // The quality gate still controls whether secondary evidence may affect the page.
    // In parallel mode the secondary read has already completed, so a clean primary page
    // pays no extra wall-clock serialization penalty.
    if(!shouldRunSecondary(page)){
      return{
        ...page,
        warnings:[...page.warnings,...timingWarnings,'RECOGNIZER_B_PARALLEL_UNUSED:QUALITY_GATE']
      };
    }
    if(!result.tokens.length)return{
      ...page,
      warnings:[...page.warnings,...timingWarnings,...result.warnings.map(w=>`RECOGNIZER_B:${w}`)]
    };
    const evidence:OcrProviderVariantEvidence={
      source:`recognizer-b:${result.id}`,
      score:result.score,
      confidence:result.confidence,
      tokens:result.tokens.map(cloneToken)
    };
    return{
      ...page,
      variantEvidence:[...(page.variantEvidence??[]),evidence],
      warnings:[
        ...page.warnings,
        ...timingWarnings,
        `RECOGNIZER_B_USED:${result.id}`,
        `RECOGNIZER_B_TOKENS:${result.tokens.length}`,
        `RECOGNIZER_B_SCORE:${result.score.toFixed(1)}`
      ]
    };
  }

  recognizeReceiptAmounts(input:OcrPageInput,signal?:AbortSignal):Promise<OcrToken[]>{
    return this.primary.recognizeReceiptAmounts?.(input,signal)??Promise.resolve([]);
  }
  recognizeReceiptLines(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    return this.primary.recognizeReceiptLines?.(input,regions,signal)??Promise.resolve([]);
  }
  recognizeRegions(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    return this.primary.recognizeRegions?.(input,regions,signal)??Promise.resolve([]);
  }
  recognizeIndependentRegions(input:OcrPageInput,regions:OcrRetryRegion[],signal?:AbortSignal):Promise<OcrToken[]>{
    const independentInput=this.primary.prepareIndependentInput?.(input)??input;
    return this.secondary.recognizeRegions?.(independentInput,regions,signal)??Promise.resolve([]);
  }
  prepareIndependentInput(input:OcrPageInput):OcrPageInput{
    return this.primary.prepareIndependentInput?.(input)??input;
  }
}

function shouldRunSecondary(page:OcrPage):boolean{
  if(!page.tokens.length)return true;
  if(page.warnings.some(w=>w.startsWith('OCR_WINNER_BELOW_FLOOR:')))return true;
  const low=page.tokens.filter(t=>(t.confidence??0)<80).length/Math.max(1,page.tokens.length);
  const text=page.text.toLowerCase();
  const receiptLike=/\b(totale|iva|bancomat|pagamento|documento commerciale|prezzo)\b/.test(text);
  const suspicious=page.tokens.filter(t=>textPlausibility(t.text)<.58).length/Math.max(1,page.tokens.length);
  return receiptLike||low>=.08||suspicious>=.05;
}

async function fetchBytes(url:string,signal?:AbortSignal):Promise<Uint8Array>{
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error(`${response.status} ${response.statusText} per ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function recognizeCanvas(runtime:OcrsWasmInstance,canvas:HTMLCanvasElement,signal?:AbortSignal):Promise<OcrsWordJson[]>{
  signal?.throwIfAborted();
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)return[];
  const image=context.getImageData(0,0,canvas.width,canvas.height);
  const raw=await runtime.recognize_rgba(new Uint8Array(image.data.buffer.slice(0)),canvas.width,canvas.height);
  const parsed=JSON.parse(raw) as OcrsWordJson[];
  return Array.isArray(parsed)?parsed.filter(validWord):[];
}
function validWord(word:OcrsWordJson):boolean{
  return !!word&&typeof word.text==='string'&&Array.isArray(word.rect)&&word.rect.length===4&&word.rect.every(Number.isFinite);
}
function wordsToTokens(words:OcrsWordJson[],pageNumber:number,offsetX:number,offsetY:number,prefix:string):OcrToken[]{
  const sorted=[...words].sort((a,b)=>a.rect[1]-b.rect[1]||a.rect[0]-b.rect[0]);
  const lines:OcrsWordJson[][]=[];
  for(const word of sorted){
    const cy=(word.rect[1]+word.rect[3])/2;
    const existing=lines.find(line=>{
      const ys=line.map(item=>(item.rect[1]+item.rect[3])/2);
      const mean=ys.reduce((a,b)=>a+b,0)/ys.length;
      const h=Math.max(...line.map(item=>item.rect[3]-item.rect[1]),word.rect[3]-word.rect[1]);
      return Math.abs(mean-cy)<=Math.max(4,h*.55);
    });
    if(existing)existing.push(word);else lines.push([word]);
  }
  const tokens:OcrToken[]=[];
  lines.forEach((line,lineIndex)=>{
    line.sort((a,b)=>a.rect[0]-b.rect[0]);
    line.forEach((word,wordIndex)=>{
      const [l,t,r,b]=word.rect;
      const confidence=heuristicConfidence(word.text);
      tokens.push({
        id:`p${pageNumber}-${prefix}-${lineIndex}-${wordIndex}`,
        text:word.text.trim(),confidence,
        box:{x:l+offsetX,y:t+offsetY,width:Math.max(1,r-l),height:Math.max(1,b-t)},
        lineId:`p${pageNumber}-${prefix}-line-${lineIndex}`,
        provenance:'ocr',rawText:word.text,normalizedText:word.text.normalize('NFKC'),
        correctionReason:'recognizer-b:ocrs-rten'
      });
    });
  });
  return tokens.filter(token=>token.text.length>0);
}
function heuristicConfidence(text:string):number{
  const value=text.trim();if(!value)return 0;
  const plausibility=textPlausibility(value);
  const structured=/^(?:€\s*)?\d{1,6}[.,]\d{2}%?$/.test(value)||/^\d{1,2}[:/.\-]\d{1,4}/.test(value);
  return Math.round(Math.max(72,Math.min(88,78+plausibility*7+(structured?3:0))));
}
function scoreTokens(tokens:OcrToken[]):number{
  if(!tokens.length)return 0;
  const confidence=averageConfidence(tokens);
  const plausibility=tokens.reduce((sum,token)=>sum+textPlausibility(token.text),0)/tokens.length*100;
  return Math.max(0,Math.min(100,confidence*.55+plausibility*.45));
}
function averageConfidence(tokens:OcrToken[]):number{
  const values=tokens.map(t=>t.confidence).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
}
function textPlausibility(value:string):number{
  const text=value.trim();if(!text)return 0;
  const alnum=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  let score=.35+.55*(alnum/Math.max(1,[...text].length));
  if(/[{}\[\]\\|]{2,}/.test(text))score-=.35;
  if(/^[^\p{L}\p{N}]{2,}$/u.test(text))score-=.25;
  return Math.max(0,Math.min(1,score));
}
function rebuild(tokens:OcrToken[]):string{
  const lines=new Map<string,OcrToken[]>();
  for(const token of tokens){const line=lines.get(token.lineId)??[];line.push(token);lines.set(token.lineId,line);}
  return[...lines.values()].map(line=>line.sort((a,b)=>a.box.x-b.box.x).map(t=>t.text).join(' ')).join('\n');
}
function cropCanvas(source:HTMLCanvasElement,box:Box,marginRatio:number):{canvas:HTMLCanvasElement;x:number;y:number}|null{
  const mx=box.width*marginRatio,my=box.height*Math.max(.2,marginRatio);
  const x=Math.max(0,Math.floor(box.x-mx)),y=Math.max(0,Math.floor(box.y-my));
  const right=Math.min(source.width,Math.ceil(box.x+box.width+mx)),bottom=Math.min(source.height,Math.ceil(box.y+box.height+my));
  if(right<=x||bottom<=y)return null;
  const canvas=document.createElement('canvas');canvas.width=right-x;canvas.height=bottom-y;
  canvas.getContext('2d')?.drawImage(source,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
  return{canvas,x,y};
}
function isCanvas(image:unknown):image is HTMLCanvasElement{
  return typeof HTMLCanvasElement!=='undefined'&&image instanceof HTMLCanvasElement;
}
function cloneToken(token:OcrToken):OcrToken{
  return{...token,box:{...token.box},...(token.alternatives?{alternatives:[...token.alternatives]}:{})};
}
function message(error:unknown):string{return error instanceof Error?error.message:String(error);}
