import type {Box,OcrPage,OcrToken} from '../../contracts.js';

export type OcrImageVariantName='original'|'grayscale'|'gentle_contrast'|'adaptive'|'sauvola'|'sharpened_light';

export interface OcrImageVariant{
  name:OcrImageVariantName;
  canvas:HTMLCanvasElement;
  scaleX:number;
  scaleY:number;
}

export interface OcrVariantResult{
  name:OcrImageVariantName;
  page:OcrPage;
  score:number;
  confidence?:number;
}

/**
 * Generalizzazione della pipeline multivariante di Gestione Casa.
 * Le varianti sono ottiche, non dipendono dal tipo semantico del documento.
 */
export const OCR_VARIANT_ORDER:OcrImageVariantName[]=['original','grayscale','gentle_contrast','adaptive','sauvola','sharpened_light'];

export function createOcrImageVariant(source:HTMLCanvasElement,name:OcrImageVariantName,maxDimension=2400):OcrImageVariant{
  const scale=Math.min(1,maxDimension/Math.max(source.width,source.height));
  const width=Math.max(1,Math.round(source.width*scale));
  const height=Math.max(1,Math.round(source.height*scale));
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(source,0,0,width,height);
  if(name==='grayscale')applyGrayscale(ctx,width,height);
  if(name==='gentle_contrast'||name==='sharpened_light')applyGentleContrast(ctx,width,height);
  if(name==='adaptive')applyOtsu(ctx,width,height);
  if(name==='sauvola')applySauvola(ctx,width,height);
  if(name==='sharpened_light')applyLightSharpen(ctx,width,height);
  return{name,canvas,scaleX:source.width/width,scaleY:source.height/height};
}

export function createOcrImageVariants(source:HTMLCanvasElement,maxDimension=2400):OcrImageVariant[]{
  return OCR_VARIANT_ORDER.map(name=>createOcrImageVariant(source,name,maxDimension));
}

export function remapVariantPage(page:OcrPage,sourceWidth:number,sourceHeight:number,scaleX:number,scaleY:number):OcrPage{
  return{
    ...page,
    width:sourceWidth,
    height:sourceHeight,
    tokens:page.tokens.map(token=>({
      ...token,
      box:{
        x:token.box.x*scaleX,
        y:token.box.y*scaleY,
        width:token.box.width*scaleX,
        height:token.box.height*scaleY
      },
      characters:token.characters?.map(character=>({
        ...character,
        box:{
          x:character.box.x*scaleX,
          y:character.box.y*scaleY,
          width:character.box.width*scaleX,
          height:character.box.height*scaleY
        }
      }))
    }))
  };
}

export function scoreOcrVariant(page:OcrPage):number{
  const tokens=page.tokens.filter(token=>token.text.trim().length>0);
  if(!tokens.length)return 0;
  const confidences=tokens.map(token=>Math.max(0,Math.min(100,token.confidence??0)));
  const avgConfidence=confidences.reduce((a,b)=>a+b,0)/confidences.length;
  const confidentRatio=confidences.filter(value=>value>=60).length/confidences.length;
  const plausibleRatio=tokens.filter(token=>isPlausibleOcrToken(token.text)).length/tokens.length;
  const lexicalRatio=tokens.filter(token=>isWordLike(token.text)).length/tokens.length;
  const garbageRatio=tokens.filter(token=>isGarbageToken(token.text)).length/tokens.length;
  const lineCount=new Set(tokens.map(token=>token.lineId)).size;
  const coverage=Math.min(1,tokens.length/18);
  const lineSupport=Math.min(1,lineCount/6);
  const commonWordBonus=genericDocumentWordHits(page.text);
  const score=
    avgConfidence*.55+
    confidentRatio*14+
    plausibleRatio*12+
    lexicalRatio*8+
    coverage*4+
    lineSupport*3+
    commonWordBonus*4-
    garbageRatio*20;
  return Math.max(0,Math.min(100,score));
}

function isPlausibleOcrToken(value:string):boolean{
  const text=value.trim();
  if(!text)return false;
  if(/[{}\[\]\\|]{2,}/.test(text))return false;
  const useful=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  return useful/Math.max(1,[...text].length)>=.6;
}
function isWordLike(value:string):boolean{
  const text=value.normalize('NFKC').replace(/^[^\p{L}]+|[^\p{L}]+$/gu,'');
  if(text.length<2)return false;
  if(!/^\p{L}+$/u.test(text))return false;
  if(text.length<=3)return true;
  return /[AEIOUÀÈÉÌÒÓÙ]/iu.test(text);
}
function isGarbageToken(value:string):boolean{
  const text=value.trim();
  if(!text)return true;
  const symbols=(text.match(/[^\p{L}\p{N}.,:/%€+\-()]/gu)??[]).length;
  const alnum=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  if(symbols>Math.max(2,alnum))return true;
  if(/[{}\[\]\\|]{2,}/.test(text))return true;
  return text.length>=6&&alnum/text.length<.45;
}
function genericDocumentWordHits(text:string):number{
  const upper=text.toUpperCase();
  const words=['DOCUMENTO','DATA','NOME','COGNOME','CODICE','IMPORTO','TOTALE','PAGAMENTO','IVA','FATTURA','RICEVUTA','CONTRATTO','COMUNE','INDIRIZZO','TELEFONO','EMAIL','PREZZO','VENDITORE'];
  const hits=words.filter(word=>upper.includes(word)).length;
  return Math.min(1,hits/3);
}

export function selectRawOcrVariant(results:OcrVariantResult[]):OcrVariantResult|undefined{
  return results.find(result=>result.name==='original')??results[0];
}

export function selectOcrVariantWinner(results:OcrVariantResult[],floor=45):{index:number;score:number;acceptable:boolean}{
  if(!results.length)return{index:-1,score:0,acceptable:false};
  let index=0;
  for(let i=1;i<results.length;i++)if(results[i]!.score>results[index]!.score)index=i;
  const score=results[index]!.score;
  return{index,score,acceptable:score>=floor};
}

/**
 * Fusione fail-closed: una variante secondaria può sostituire un token solo se
 * geometricamente compatibile e chiaramente più affidabile. Token nuovi vengono
 * ammessi solo con confidenza alta e con una riga geometrica non ambigua.
 */
export function fuseOcrVariants(results:OcrVariantResult[]):OcrPage{
  if(!results.length)throw new Error('Nessun risultato OCR multivariante.');
  const ordered=[...results].sort((a,b)=>b.score-a.score);
  const winner=ordered[0]!;
  const tokens=winner.page.tokens.map(token=>({...token,box:{...token.box}}));

  for(const result of ordered.slice(1)){
    for(const candidate of result.page.tokens){
      const candidateConfidence=candidate.confidence??0;
      if(candidateConfidence<70)continue;
      const matches=tokens
        .map((token,index)=>({
          token,index,
          overlap:boxOverlap(token.box,candidate.box),
          vertical:verticalOverlap(token.box,candidate.box)
        }))
        .filter(item=>item.overlap>.38||(item.vertical>.78&&horizontalDistance(item.token.box,candidate.box)<Math.max(24,candidate.box.height*.45)))
        .sort((a,b)=>b.overlap-a.overlap||b.vertical-a.vertical);
      const best=matches[0];
      if(best){
        const currentConfidence=best.token.confidence??0;
        if(candidateConfidence>=currentConfidence+8&&textsCompatible(best.token.text,candidate.text)){
          tokens[best.index]={...candidate,id:best.token.id,lineId:best.token.lineId};
        }
        continue;
      }
      if(candidateConfidence<84)continue;
      const lineId=nearestUnambiguousLine(tokens,candidate.box);
      if(!lineId)continue;
      if(tokens.some(token=>boxOverlap(token.box,candidate.box)>.18))continue;
      tokens.push({...candidate,id:`p${winner.page.pageNumber}-t${tokens.length}`,lineId});
    }
  }

  tokens.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
  const text=rebuildText(tokens);
  return{
    ...winner.page,
    text,
    tokens,
    warnings:[
      ...winner.page.warnings,
      `OCR_MULTIVARIANT_WINNER:${winner.name}`,
      `OCR_MULTIVARIANT_SCORES:${ordered.map(item=>`${item.name}=${item.score.toFixed(1)}`).join(',')}`
    ]
  };
}


function applyGrayscale(ctx:CanvasRenderingContext2D,width:number,height:number):void{
  const image=ctx.getImageData(0,0,width,height),d=image.data;
  for(let i=0;i<d.length;i+=4){const y=Math.round(.299*d[i]!+.587*d[i+1]!+.114*d[i+2]!);d[i]=d[i+1]=d[i+2]=y;}ctx.putImageData(image,0,0);
}
function applyOtsu(ctx:CanvasRenderingContext2D,width:number,height:number):void{
  const image=ctx.getImageData(0,0,width,height),d=image.data,hist=new Uint32Array(256),gray=new Uint8Array(width*height);
  for(let i=0,p=0;i<d.length;i+=4,p++){const y=Math.round(.299*d[i]!+.587*d[i+1]!+.114*d[i+2]!);gray[p]=y;hist[y]!++;}
  const total=gray.length;let sum=0;for(let i=0;i<256;i++)sum+=i*(hist[i]??0);let sumB=0,wB=0,max=0,t=128;
  for(let i=0;i<256;i++){wB+=hist[i]??0;if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=i*(hist[i]??0);const mB=sumB/wB,mF=(sum-sumB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>max){max=v;t=i;}}
  for(let p=0;p<gray.length;p++){const v=gray[p]!>t?255:0,i=p*4;d[i]=d[i+1]=d[i+2]=v;}ctx.putImageData(image,0,0);
}
function applySauvola(ctx:CanvasRenderingContext2D,width:number,height:number):void{
  const image=ctx.getImageData(0,0,width,height),d=image.data,gray=new Uint8Array(width*height);
  for(let i=0,p=0;i<d.length;i+=4,p++)gray[p]=Math.round(.299*d[i]!+.587*d[i+1]!+.114*d[i+2]!);
  const radius=Math.max(5,Math.min(18,Math.round(Math.min(width,height)/90))),integral=new Float64Array((width+1)*(height+1)),sq=new Float64Array((width+1)*(height+1));
  for(let y=1;y<=height;y++){let rs=0,rq=0;for(let x=1;x<=width;x++){const v=gray[(y-1)*width+x-1]!;rs+=v;rq+=v*v;const idx=y*(width+1)+x;integral[idx]=(integral[idx-(width+1)]??0)+rs;sq[idx]=(sq[idx-(width+1)]??0)+rq;}}
  const areaSum=(arr:Float64Array,x0:number,y0:number,x1:number,y1:number)=>arr[y1*(width+1)+x1]!-arr[y0*(width+1)+x1]!-arr[y1*(width+1)+x0]!+arr[y0*(width+1)+x0]!;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const x0=Math.max(0,x-radius),y0=Math.max(0,y-radius),x1=Math.min(width,x+radius+1),y1=Math.min(height,y+radius+1),n=(x1-x0)*(y1-y0);const mean=areaSum(integral,x0,y0,x1,y1)/n;const variance=Math.max(0,areaSum(sq,x0,y0,x1,y1)/n-mean*mean);const std=Math.sqrt(variance),threshold=mean*(1+.28*(std/128-1));const v=gray[y*width+x]!>threshold?255:0,i=(y*width+x)*4;d[i]=d[i+1]=d[i+2]=v;}ctx.putImageData(image,0,0);
}

function applyGentleContrast(ctx:CanvasRenderingContext2D,width:number,height:number):void{
  const image=ctx.getImageData(0,0,width,height);
  const data=image.data;
  const gray=new Float32Array(width*height);
  const hist=new Uint32Array(256);
  for(let i=0,p=0;i<data.length;i+=4,p++){
    const value=.2126*data[i]!+.7152*data[i+1]!+.0722*data[i+2]!;
    gray[p]=value;hist[Math.max(0,Math.min(255,Math.round(value)))]!++;
  }
  const total=width*height,p1=Math.floor(total*.01),p99=Math.floor(total*.99);
  let cumulative=0,min=0,max=255,foundMin=false;
  for(let value=0;value<256;value++){
    cumulative+=hist[value]??0;
    if(!foundMin&&cumulative>=p1){min=value;foundMin=true;}
    if(cumulative>=p99){max=value;break;}
  }
  if(max<=min){min=0;max=255;}
  const range=Math.max(30,max-min);
  for(let p=0;p<gray.length;p++){
    const normalized=Math.max(0,Math.min(1,(gray[p]!-min)/range));
    const value=Math.max(0,Math.min(255,Math.pow(normalized,.92)*255));
    const i=p*4;data[i]=value;data[i+1]=value;data[i+2]=value;
  }
  ctx.putImageData(image,0,0);
}

function applyLightSharpen(ctx:CanvasRenderingContext2D,width:number,height:number):void{
  if(width<3||height<3)return;
  const src=ctx.getImageData(0,0,width,height);
  const out=ctx.createImageData(width,height);
  out.data.set(src.data);
  const kernel=[0,-.35,0,-.35,2.4,-.35,0,-.35,0];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    let sum=0;
    for(let ky=-1;ky<=1;ky++)for(let kx=-1;kx<=1;kx++){
      const offset=((y+ky)*width+(x+kx))*4;
      sum+=src.data[offset]!*kernel[(ky+1)*3+(kx+1)]!;
    }
    const value=Math.max(0,Math.min(255,sum));
    const offset=(y*width+x)*4;
    out.data[offset]=value;out.data[offset+1]=value;out.data[offset+2]=value;out.data[offset+3]=255;
  }
  ctx.putImageData(out,0,0);
}

function rebuildText(tokens:OcrToken[]):string{
  const lines=new Map<string,OcrToken[]>();
  for(const token of tokens){const line=lines.get(token.lineId)??[];line.push(token);lines.set(token.lineId,line);}
  return[...lines.values()]
    .sort((a,b)=>Math.min(...a.map(t=>t.box.y))-Math.min(...b.map(t=>t.box.y)))
    .map(line=>line.sort((a,b)=>a.box.x-b.box.x).map(token=>token.text).join(' '))
    .join('\n');
}

function nearestUnambiguousLine(tokens:OcrToken[],box:Box):string|undefined{
  const groups=new Map<string,OcrToken[]>();
  for(const token of tokens){const line=groups.get(token.lineId)??[];line.push(token);groups.set(token.lineId,line);}
  const cy=box.y+box.height/2;
  const ranked=[...groups].map(([lineId,line])=>{
    const top=Math.min(...line.map(token=>token.box.y));
    const bottom=Math.max(...line.map(token=>token.box.y+token.box.height));
    const overlap=Math.max(0,Math.min(bottom,box.y+box.height)-Math.max(top,box.y))/Math.max(1,Math.min(bottom-top,box.height));
    return{lineId,overlap,distance:Math.abs((top+bottom)/2-cy)};
  }).filter(item=>item.overlap>.25||item.distance<=Math.max(45,box.height*.7))
    .sort((a,b)=>b.overlap-a.overlap||a.distance-b.distance);
  if(!ranked.length)return undefined;
  if(ranked.length>1&&Math.abs(ranked[0]!.distance-ranked[1]!.distance)<3&&Math.abs(ranked[0]!.overlap-ranked[1]!.overlap)<.05)return undefined;
  return ranked[0]!.lineId;
}

function textsCompatible(current:string,candidate:string):boolean{
  const a=current.trim(),b=candidate.trim();
  if(!a||!b)return false;
  const numericA=/^[€\d.,%\s-]+$/.test(a),numericB=/^[€\d.,%\s-]+$/.test(b);
  if(numericA!==numericB)return false;
  return true;
}
function boxOverlap(a:Box,b:Box):number{
  const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  if(right<=left||bottom<=top)return 0;
  return((right-left)*(bottom-top))/Math.max(1,Math.min(a.width*a.height,b.width*b.height));
}
function verticalOverlap(a:Box,b:Box):number{
  const top=Math.max(a.y,b.y),bottom=Math.min(a.y+a.height,b.y+b.height);
  return bottom<=top?0:(bottom-top)/Math.max(1,Math.min(a.height,b.height));
}
function horizontalDistance(a:Box,b:Box):number{
  if(a.x<=b.x+b.width&&b.x<=a.x+a.width)return 0;
  return a.x+a.width<b.x?b.x-(a.x+a.width):a.x-(b.x+b.width);
}


export function tokenAuthority(token:OcrToken,source:'original'|'variant'='variant'):number{
  const word=Math.max(0,Math.min(100,token.confidence??0))/100;
  const chars=(token.characters??[]).map(character=>character.confidence).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  const charMean=chars.length?chars.reduce((sum,value)=>sum+Math.max(0,Math.min(100,value)),0)/(chars.length*100):word;
  const charFloor=chars.length?Math.min(...chars.map(value=>Math.max(0,Math.min(100,value))))/100:word;
  const plausibility=tokenTextPlausibility(token.text);
  const geometry=token.box.width>0&&token.box.height>0 ? .95 : .2;
  const sourceBonus=source==='original' ? .08 : 0;
  return Math.max(0,Math.min(1,word*.38+charMean*.30+charFloor*.12+plausibility*.15+geometry*.05+sourceBonus));
}

export function fuseAroundWinner(results:OcrVariantResult[],winnerIndex:number):OcrPage{
  if(!results.length)throw new Error('Nessun risultato OCR multivariante.');
  const winner=results[Math.max(0,Math.min(results.length-1,winnerIndex))]!;
  const original=results.find(result=>result.name==='original');
  const consumed=new Set<OcrToken>();
  const tokens:OcrToken[]=[];

  for(const base of winner.page.tokens){
    const observations:Array<{token:OcrToken;result:OcrVariantResult;authority:number}>=[];
    for(const result of results){
      const match=findCompatibleToken(result.page.tokens,base);
      if(!match)continue;
      observations.push({
        token:match,
        result,
        authority:tokenAuthority(match,result.name==='original'?'original':'variant')
      });
      if(result!==winner)consumed.add(match);
    }
    if(!observations.length){
      tokens.push({...base,box:{...base.box}});
      continue;
    }

    const originalObservation=original?observations.find(item=>item.result===original):undefined;
    const groups=new Map<string,typeof observations>();
    for(const observation of observations){
      const key=normalizeConsensusText(observation.token.text);
      const group=groups.get(key)??[];
      group.push(observation);
      groups.set(key,group);
    }
    const ranked=[...groups.entries()].map(([key,group])=>{
      const weighted=group.reduce((sum,item)=>sum+item.authority*(.72+item.result.score/100*.28),0);
      const sources=new Set(group.map(item=>item.result.name)).size;
      const best=[...group].sort((a,b)=>b.authority-a.authority)[0]!;
      return{key,group,best,score:weighted+Math.max(0,sources-1)*.12,sources};
    }).sort((a,b)=>b.score-a.score);

    let selected=ranked[0]!;
    const originalStrong=originalObservation&&originalObservation.authority>=.82&&tokenTextPlausibility(originalObservation.token.text)>=.78;
    if(originalStrong){
      const originalKey=normalizeConsensusText(originalObservation!.token.text);
      const originalGroup=ranked.find(item=>item.key===originalKey);
      const challenger=ranked[0]!;
      const clearOverride=challenger.key!==originalKey&&challenger.sources>=2&&challenger.score>=(originalGroup?.score??originalObservation!.authority)+.28&&challenger.best.authority>=originalObservation!.authority+.10;
      if(!clearOverride&&originalGroup)selected=originalGroup;
    }

    const selectedToken=selected.best.token;
    const alternatives=[...new Set(observations.map(item=>item.token.text))];
    const rawAnchor=originalObservation?.token.text??base.rawText??base.text;
    const differs=normalizeConsensusText(selectedToken.text)!==normalizeConsensusText(rawAnchor);
    const confidence=Math.round(Math.max(...selected.group.map(item=>item.token.confidence??0)));
    tokens.push({
      ...selectedToken,
      id:base.id,
      lineId:base.lineId,
      confidence,
      rawText:rawAnchor,
      normalizedText:selectedToken.text.normalize('NFKC'),
      alternatives,
      ...(differs?{correctionReason:'weighted multi-variant evidence'}:{}),
      box:{...selectedToken.box}
    });
  }

  // Token assenti nel winner: entrano solo se molto autorevoli e non duplicano geometria esistente.
  for(const result of results){
    if(result===winner)continue;
    for(const candidate of result.page.tokens){
      if(consumed.has(candidate))continue;
      const authority=tokenAuthority(candidate,result.name==='original'?'original':'variant');
      if(authority<.88)continue;
      if(tokens.some(token=>boxOverlap(token.box,candidate.box)>.25))continue;
      const lineId=nearestUnambiguousLine(tokens,candidate.box);
      if(!lineId)continue;
      tokens.push({...candidate,id:`p${winner.page.pageNumber}-t${tokens.length}`,lineId,box:{...candidate.box}});
    }
  }

  const contextProtected=protectCriticalFieldContexts(tokens);
  contextProtected.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
  return{...winner.page,text:rebuildText(contextProtected),tokens:contextProtected,warnings:[
    ...winner.page.warnings,
    `OCR_CONSENSUS_BASE:${winner.name}`,
    `OCR_CONSENSUS_VARIANTS:${results.length}`,
    'OCR_FUSION_POLICY:WEIGHTED_FAIL_CLOSED'
  ]};
}

function findCompatibleToken(tokens:OcrToken[],anchor:OcrToken):OcrToken|undefined{
  return tokens.map(token=>({token,overlap:boxOverlap(token.box,anchor.box),vertical:verticalOverlap(token.box,anchor.box),distance:horizontalDistance(token.box,anchor.box)}))
    .filter(item=>item.overlap>.42||(item.vertical>.82&&item.distance<Math.max(20,anchor.box.height*.4)))
    .sort((a,b)=>b.overlap-a.overlap||b.vertical-a.vertical||a.distance-b.distance)[0]?.token;
}

function tokenTextPlausibility(value:string):number{
  const text=value.trim();
  if(!text)return 0;
  if(/[{}\[\]\\|]{2,}/.test(text))return .15;
  const alnum=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  const ratio=alnum/Math.max(1,[...text].length);
  let score=.45+ratio*.45;
  if(/^[A-Za-zÀ-ÿ]{1,3}\-?\d+[A-Za-zÀ-ÿ]+$/.test(text))score-=.28;
  if(text.length<=4&&/[a-zà-ÿ]/.test(text)&&/[A-ZÀ-Ý]/.test(text))score-=.22;
  if(/^[^\p{L}\p{N}]+$/u.test(text))score-=.25;
  if(/^[\p{L}]+$/u.test(text)&&text.length>=4&&!/[AEIOUÀÈÉÌÒÓÙ]/iu.test(text))score-=.12;
  return Math.max(0,Math.min(1,score));
}

function protectCriticalFieldContexts(tokens:OcrToken[]):OcrToken[]{
  const byLine=new Map<string,OcrToken[]>();
  for(const token of tokens){const row=byLine.get(token.lineId)??[];row.push(token);byLine.set(token.lineId,row);}
  const output=tokens.map(token=>({...token,box:{...token.box}}));
  const indexById=new Map(output.map((token,index)=>[token.id,index]));
  for(const line of byLine.values()){
    const ordered=[...line].sort((a,b)=>a.box.x-b.box.x);
    const labelIndex=ordered.findIndex(token=>/^(?:P\.?\s*IVA|PARTITA)$/i.test(token.text.trim()));
    if(labelIndex<0)continue;
    for(const token of ordered.slice(labelIndex+1)){
      if(token.text.trim().length===0)continue;
      if(/^\d{11}$/.test(token.text.trim()))continue;
      const idx=indexById.get(token.id);if(idx===undefined)continue;
      const existing=output[idx]!;
      output[idx]={
        ...existing,
        confidence:Math.min(existing.confidence??100,69),
        alternatives:[...new Set([...(existing.alternatives??[]),existing.text])],
        correctionReason:existing.correctionReason??'critical VAT field requires numeric re-OCR'
      };
    }
  }
  return output;
}

function normalizeConsensusText(v:string){return v.normalize('NFKC').replace(/[|']/g,'I').replace(/\s+/g,'').toUpperCase();}
