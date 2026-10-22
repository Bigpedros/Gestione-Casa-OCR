import type { Box, OcrPage, OcrToken } from '../../contracts.js';

export type ReconstructionStatus='reliable'|'uncertain'|'error'|'unreadable';
export interface ReconstructionElement{
  id:string; lineId:string; box:Box; originalText:string; normalizedText:string;
  text:string; confidence:number|null; status:ReconstructionStatus;
}
export interface ReconstructionLineSegment{
  id:string; box:Box; elementIds:string[]; alignment:'left'|'center'|'right';
}
export interface ReconstructionLine{
  id:string; box:Box; baselineY:number; fontSize:number; segments:ReconstructionLineSegment[];
}
export interface DigitalPageReconstruction{
  schemaVersion:'1.5'; pageNumber:number; width:number; height:number;
  elements:ReconstructionElement[]; lines:ReconstructionLine[];
}

/**
 * Ricostruzione geometrica general-purpose.
 * Fail-safe rispetto a box OCR patologiche: la tipografia deriva dalla statistica
 * dell'intera pagina e le righe vengono ricostruite per prossimità geometrica,
 * senza dipendere dal parser semantico o da layout specifici.
 */
export function buildDigitalPageReconstruction(page:OcrPage):DigitalPageReconstruction{
  const rawElements=page.tokens
    .filter(token=>token.text.trim()&&isRenderableToken(token.text))
    .map(token=>fromToken(token,page.width,page.height));

  const canonicalHeight=robustMedian(
    rawElements.map(element=>element.box.height)
      .filter(value=>Number.isFinite(value)&&value>2&&value<Math.max(20,page.height*.12))
  )||Math.max(10,page.height*.018);

  const elements=rawElements.map(element=>({
    ...element,
    box:sanitizeBox(element.box,element.text,canonicalHeight,page.width,page.height)
  }));

  const pageSlope=estimatePageTextSlope(elements,page.width,canonicalHeight);
  const rows=clusterRows(elements,canonicalHeight,pageSlope);
  const lines=rows.map((row,index)=>
    buildLine(`geo-line-${index}`,row.sort((a,b)=>a.box.x-b.box.x),page.width,page.height,canonicalHeight)
  ).sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);

  return{
    schemaVersion:'1.5',
    pageNumber:page.pageNumber,
    width:page.width,
    height:page.height,
    elements,
    lines
  };
}

export function getDigitalPageText(reconstruction:DigitalPageReconstruction):string{
  const byId=new Map(reconstruction.elements.map(element=>[element.id,element]));
  return reconstruction.lines.map(line=>
    line.segments
      .slice().sort((a,b)=>a.box.x-b.box.x)
      .map(segment=>segment.elementIds.map(id=>byId.get(id)?.text??'').filter(Boolean).join(' '))
      .filter(Boolean).join('   ')
  ).join('\n');
}

function clusterRows(
  elements:ReconstructionElement[],
  canonicalHeight:number,
  pageSlope:number
):ReconstructionElement[][]{
  const coarseY=(element:ReconstructionElement)=>centerY(element.box)-pageSlope*centerX(element.box);
  const ordered=[...elements].sort((a,b)=>coarseY(a)-coarseY(b)||a.box.x-b.box.x);
  const rows:ReconstructionElement[][]=[];
  const baseTolerance=Math.max(5,canonicalHeight*.82);

  for(const element of ordered){
    const x=centerX(element.box);
    const y=centerY(element.box);
    let best:ReconstructionElement[]|undefined;
    let bestScore=Infinity;

    for(const row of rows){
      const predictedY=predictLocalRowY(row,x,pageSlope,canonicalHeight);
      const distance=Math.abs(y-predictedY);
      const sameLineHint=row.some(item=>item.lineId===element.lineId);
      const xs=row.map(item=>centerX(item.box));
      const minX=Math.min(...xs);
      const maxX=Math.max(...xs);
      const outsideDistance=x<minX?minX-x:x>maxX?x-maxX:0;
      const extrapolationBoost=outsideDistance>0
        ?Math.min(canonicalHeight*1.1,(outsideDistance/Math.max(1,canonicalHeight))*canonicalHeight*.08)
        :0;
      const tolerance=baseTolerance*(sameLineHint?1.2:1)+extrapolationBoost;
      if(distance>tolerance)continue;
      if(hasStrongHorizontalOverlap(row,element,canonicalHeight)&&!sameLineHint)continue;

      const score=distance-(sameLineHint?canonicalHeight*.15:0)-extrapolationBoost*.2;
      if(score<bestScore){
        best=row;
        bestScore=score;
      }
    }

    if(best)best.push(element);
    else rows.push([element]);
  }

  return rows;
}

function predictLocalRowY(
  row:ReconstructionElement[],
  x:number,
  fallbackSlope:number,
  canonicalHeight:number
):number{
  if(row.length===1){
    const only=row[0]!;
    return centerY(only.box)+fallbackSlope*(x-centerX(only.box));
  }

  const xs=row.map(item=>centerX(item.box));
  const ys=row.map(item=>centerY(item.box));
  const xMean=xs.reduce((sum,value)=>sum+value,0)/xs.length;
  const yMean=ys.reduce((sum,value)=>sum+value,0)/ys.length;
  let numerator=0;
  let denominator=0;
  for(let index=0;index<row.length;index++){
    const dx=xs[index]!-xMean;
    numerator+=dx*(ys[index]!-yMean);
    denominator+=dx*dx;
  }

  const span=Math.max(...xs)-Math.min(...xs);
  let slope=denominator>0&&span>=canonicalHeight*2.5?numerator/denominator:fallbackSlope;
  if(!Number.isFinite(slope))slope=fallbackSlope;
  slope=clamp(slope,-.22,.22);
  return yMean+slope*(x-xMean);
}

function hasStrongHorizontalOverlap(
  row:ReconstructionElement[],
  element:ReconstructionElement,
  canonicalHeight:number
):boolean{
  const left=element.box.x;
  const right=element.box.x+element.box.width;
  for(const item of row){
    const overlap=Math.min(right,item.box.x+item.box.width)-Math.max(left,item.box.x);
    if(overlap>Math.min(element.box.width,item.box.width)*.45){
      const verticalDistance=Math.abs(centerY(item.box)-centerY(element.box));
      if(verticalDistance>canonicalHeight*.45)return true;
    }
  }
  return false;
}

function estimatePageTextSlope(
  elements:ReconstructionElement[],
  pageWidth:number,
  canonicalHeight:number
):number{
  const byLineId=new Map<string,ReconstructionElement[]>();
  for(const element of elements){
    if(!element.lineId||element.lineId==='unassigned')continue;
    const row=byLineId.get(element.lineId)??[];
    row.push(element);byLineId.set(element.lineId,row);
  }

  const slopes:number[]=[];
  for(const row of byLineId.values()){
    if(row.length<2)continue;
    const sorted=[...row].sort((a,b)=>centerX(a.box)-centerX(b.box));
    const first=sorted[0]!,last=sorted.at(-1)!;
    const dx=centerX(last.box)-centerX(first.box);
    if(dx<Math.max(pageWidth*.08,canonicalHeight*4))continue;
    const slope=(centerY(last.box)-centerY(first.box))/dx;
    if(Number.isFinite(slope)&&Math.abs(slope)<=.18)slopes.push(slope);
  }
  return slopes.length>=2?median(slopes):0;
}

function buildLine(
  id:string,
  elements:ReconstructionElement[],
  pageWidth:number,
  pageHeight:number,
  canonicalHeight:number
):ReconstructionLine{
  const center=median(elements.map(element=>centerY(element.box)));
  const lineHeight=clamp(canonicalHeight,6,Math.max(6,pageHeight*.04));
  const y=clamp(center-lineHeight/2,0,Math.max(0,pageHeight-lineHeight));
  const x=Math.max(0,Math.min(...elements.map(element=>element.box.x)));
  const right=Math.min(pageWidth,Math.max(...elements.map(element=>element.box.x+element.box.width)));
  return{
    id,
    box:{x,y,width:Math.max(1,right-x),height:lineHeight},
    baselineY:y+lineHeight*.78,
    fontSize:clamp(canonicalHeight*.68,5,Math.max(6,canonicalHeight*.9)),
    segments:buildSegments(id,elements,lineHeight,pageWidth,y,canonicalHeight)
  };
}

function buildSegments(
  lineId:string,
  elements:ReconstructionElement[],
  lineHeight:number,
  pageWidth:number,
  lineY:number,
  canonicalHeight:number
):ReconstructionLineSegment[]{
  const groups:ReconstructionElement[][]=[];
  let current:ReconstructionElement[]=[];
  const gapThreshold=Math.max(canonicalHeight*1.25,pageWidth*.028);

  for(const element of elements){
    const previous=current.at(-1);
    const gap=previous?element.box.x-(previous.box.x+previous.box.width):0;
    if(previous&&gap>gapThreshold){groups.push(current);current=[];}
    current.push(element);
  }
  if(current.length)groups.push(current);

  return groups.map((group,index)=>{
    const x=Math.max(0,Math.min(...group.map(element=>element.box.x)));
    const right=Math.min(pageWidth,Math.max(...group.map(element=>element.box.x+element.box.width)));
    const center=(x+right)/2;
    const alignment=center>pageWidth*.68?'right':center>pageWidth*.38&&center<pageWidth*.62?'center':'left';
    return{
      id:`${lineId}-segment-${index}`,
      box:{x,y:lineY,width:Math.max(1,right-x),height:lineHeight},
      elementIds:group.map(element=>element.id),
      alignment
    };
  });
}

function sanitizeBox(box:Box,text:string,canonicalHeight:number,pageWidth:number,pageHeight:number):Box{
  const originalCenterX=box.x+box.width/2;
  const originalCenterY=box.y+box.height/2;
  const height=box.height>canonicalHeight*1.8||box.height<canonicalHeight*.35
    ? canonicalHeight
    : box.height;

  const compactLength=Math.max(1,[...text].length);
  const expectedWidth=Math.max(canonicalHeight*.45,compactLength*canonicalHeight*.58);
  const width=box.width>expectedWidth*2.4
    ? Math.min(box.width,expectedWidth*1.35)
    : box.width;

  return{
    x:clamp(originalCenterX-width/2,0,Math.max(0,pageWidth-width)),
    y:clamp(originalCenterY-height/2,0,Math.max(0,pageHeight-height)),
    width:Math.max(1,width),
    height:Math.max(1,height)
  };
}

function fromToken(token:OcrToken,pageWidth:number,pageHeight:number):ReconstructionElement{
  const text=(token.normalizedText??token.text).trim();
  const confidence=token.confidence;
  return{
    id:token.id,
    lineId:token.lineId,
    box:deriveTokenBox(token,pageWidth,pageHeight),
    originalText:token.rawText??token.text,
    normalizedText:token.normalizedText??token.text,
    text,
    confidence,
    status:statusFromConfidence(confidence,text)
  };
}

function deriveTokenBox(token:OcrToken,pageWidth:number,pageHeight:number):Box{
  const characters=(token.characters??[])
    .filter(character=>character.text.trim()&&Number.isFinite(character.box.x)&&Number.isFinite(character.box.y))
    .filter(character=>character.box.width>0&&character.box.height>0);

  if(characters.length<2)return{...token.box};

  const bodyCharacters=characters.filter(character=>/[\p{L}\p{N}]/u.test(character.text));
  const heightSource=bodyCharacters.length>=2?bodyCharacters:characters;
  const charHeight=selectDominantCharacterHeight(heightSource.map(character=>character.box.height));
  if(!charHeight)return{...token.box};

  const heightReliable=characters.filter(character=>{
    const h=character.box.height;
    const punctuation=!/[\p{L}\p{N}]/u.test(character.text);
    if(punctuation)return h>=Math.max(2,charHeight*.18)&&h<=charHeight*1.45;
    return h>=charHeight*.62&&h<=charHeight*1.42;
  });
  if(heightReliable.length<2)return{...token.box};

  const baselineModel=estimateCharacterBaseline(heightReliable,charHeight);
  const baselineReliable=heightReliable.filter(character=>{
    const predicted=baselineModel.intercept+baselineModel.slope*centerX(character.box);
    const residual=Math.abs((character.box.y+character.box.height)-predicted);
    const punctuation=!/[\p{L}\p{N}]/u.test(character.text);
    const tolerance=punctuation?charHeight*.72:charHeight*.42;
    return residual<=Math.max(4,tolerance);
  });
  const reliable=baselineReliable.length>=2?baselineReliable:heightReliable;

  const x=Math.min(...reliable.map(character=>character.box.x));
  const y=Math.min(...reliable.map(character=>character.box.y));
  const right=Math.max(...reliable.map(character=>character.box.x+character.box.width));
  const bottom=Math.max(...reliable.map(character=>character.box.y+character.box.height));
  const derived={x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};

  const wordHeight=token.box.height;
  const wordWidth=token.box.width;
  const pathological=
    wordHeight>derived.height*1.35||
    wordWidth>derived.width*1.55||
    Math.abs(centerY(token.box)-centerY(derived))>Math.max(5,charHeight*.5);

  if(!pathological)return{...token.box};
  return{
    x:clamp(derived.x,0,Math.max(0,pageWidth-derived.width)),
    y:clamp(derived.y,0,Math.max(0,pageHeight-derived.height)),
    width:Math.min(pageWidth,derived.width),
    height:Math.min(pageHeight,derived.height)
  };
}

function selectDominantCharacterHeight(heights:number[]):number{
  const sorted=heights.filter(value=>Number.isFinite(value)&&value>1).sort((a,b)=>a-b);
  if(!sorted.length)return 0;
  if(sorted.length<4)return median(sorted);

  let bestGapIndex=-1;
  let bestRatio=1;
  for(let index=1;index<sorted.length;index++){
    const previous=sorted[index-1]!;
    const current=sorted[index]!;
    const ratio=current/Math.max(1,previous);
    if(ratio>bestRatio){bestRatio=ratio;bestGapIndex=index;}
  }

  if(bestGapIndex>=2&&bestRatio>=1.45){
    const lower=sorted.slice(0,bestGapIndex);
    const upper=sorted.slice(bestGapIndex);
    if(lower.length>=2&&upper.length>=2)return median(lower);
  }
  return robustMedian(sorted);
}

function estimateCharacterBaseline(
  characters:Array<{text:string;confidence:number|null;box:Box}>,
  charHeight:number
):{slope:number;intercept:number}{
  const body=characters.filter(character=>/[\p{L}\p{N}]/u.test(character.text));
  const source=body.length>=2?body:characters;
  const slopes:number[]=[];
  for(let i=0;i<source.length;i++){
    for(let j=i+1;j<source.length;j++){
      const a=source[i]!,b=source[j]!;
      const dx=centerX(b.box)-centerX(a.box);
      if(Math.abs(dx)<Math.max(2,charHeight*.35))continue;
      const slope=((b.box.y+b.box.height)-(a.box.y+a.box.height))/dx;
      if(Number.isFinite(slope)&&Math.abs(slope)<=.35)slopes.push(slope);
    }
  }
  const slope=slopes.length?median(slopes):0;
  const intercept=median(source.map(character=>
    character.box.y+character.box.height-slope*centerX(character.box)
  ));
  return{slope,intercept};
}

function isRenderableToken(text:string):boolean{
  const trimmed=text.trim();
  if(!trimmed)return false;
  if(/[\p{L}\p{N}€$%]/u.test(trimmed))return true;
  return !/^[|_~^"'°·.\\-]+$/.test(trimmed);
}
function statusFromConfidence(confidence:number|null,text:string):ReconstructionStatus{
  if(!text)return'unreadable';
  if(confidence===null)return'uncertain';
  const normalized=confidence>1?confidence/100:confidence;
  if(normalized<.35)return'error';
  if(normalized<.75)return'uncertain';
  return'reliable';
}
function centerX(box:Box){return box.x+box.width/2;}
function centerY(box:Box){return box.y+box.height/2;}
function robustMedian(values:number[]):number{
  if(values.length<5)return median(values);
  const sorted=[...values].sort((a,b)=>a-b);
  const trim=Math.floor(sorted.length*.15);
  return median(sorted.slice(trim,sorted.length-trim));
}
function median(values:number[]):number{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]!:((sorted[middle-1]??0)+(sorted[middle]??0))/2;
}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
