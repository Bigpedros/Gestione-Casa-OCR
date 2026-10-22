import type { Box, OcrPage, OcrToken } from '../../contracts.js';

export type ReconstructionStatus='reliable'|'uncertain'|'error'|'unreadable';
export interface ReconstructionElement{
  id:string;
  lineId:string;
  box:Box;
  originalText:string;
  normalizedText:string;
  text:string;
  confidence:number|null;
  status:ReconstructionStatus;
}
export interface ReconstructionLineSegment{
  id:string;
  box:Box;
  elementIds:string[];
  alignment:'left'|'center'|'right';
}
export interface ReconstructionLine{
  id:string;
  box:Box;
  baselineY:number;
  fontSize:number;
  segments:ReconstructionLineSegment[];
}
export interface DigitalPageReconstruction{
  schemaVersion:'1.0';
  pageNumber:number;
  width:number;
  height:number;
  elements:ReconstructionElement[];
  lines:ReconstructionLine[];
}

/**
 * Donazione MOTORE -> Gestione Casa della ricostruzione geometrica general-purpose.
 * Usa esclusivamente token OCR + coordinate fisiche: nessuna dipendenza dal parser
 * semantico degli scontrini o da layout/merchant specifici.
 */
export function buildDigitalPageReconstruction(page:OcrPage):DigitalPageReconstruction{
  const elements=page.tokens
    .filter(token=>token.text.trim())
    .map(fromToken);
  const byId=new Map(elements.map(element=>[element.id,element]));
  const grouped=new Map<string,ReconstructionElement[]>();
  for(const element of elements){
    const list=grouped.get(element.lineId)??[];
    list.push(element);
    grouped.set(element.lineId,list);
  }

  const lines=[...grouped.entries()].map(([lineId,lineElements])=>
    buildLine(lineId,lineElements.sort((a,b)=>a.box.x-b.box.x),page.width,page.height)
  ).sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);

  // Invariante: ogni id referenziato dai segmenti deve esistere.
  for(const line of lines)for(const segment of line.segments){
    segment.elementIds=segment.elementIds.filter(id=>byId.has(id));
  }

  return{
    schemaVersion:'1.0',
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
      .slice()
      .sort((a,b)=>a.box.x-b.box.x)
      .map(segment=>segment.elementIds.map(id=>byId.get(id)?.text??'').filter(Boolean).join(' '))
      .filter(Boolean)
      .join('   ')
  ).join('\n');
}

function buildLine(
  id:string,
  elements:ReconstructionElement[],
  pageWidth:number,
  pageHeight:number
):ReconstructionLine{
  const allHeights=elements.map(element=>element.box.height).filter(value=>value>2&&Number.isFinite(value));
  const localHeight=median(allHeights)||Math.max(10,pageHeight*.018);
  const centerY=median(elements.map(element=>element.box.y+element.box.height/2));
  const lineHeight=clamp(localHeight,6,Math.max(6,pageHeight*.08));
  const y=clamp(centerY-lineHeight/2,0,Math.max(0,pageHeight-lineHeight));
  const x=Math.max(0,Math.min(...elements.map(element=>element.box.x)));
  const right=Math.min(pageWidth,Math.max(...elements.map(element=>element.box.x+element.box.width)));
  return{
    id,
    box:{x,y,width:Math.max(1,right-x),height:lineHeight},
    baselineY:y+lineHeight*.78,
    fontSize:clamp(lineHeight*.68,5,lineHeight*.92),
    segments:buildSegments(id,elements,lineHeight,pageWidth,y)
  };
}

function buildSegments(
  lineId:string,
  elements:ReconstructionElement[],
  lineHeight:number,
  pageWidth:number,
  lineY:number
):ReconstructionLineSegment[]{
  const groups:ReconstructionElement[][]=[];
  let current:ReconstructionElement[]=[];
  const gapThreshold=Math.max(lineHeight*.9,pageWidth*.035);
  for(const element of elements){
    const previous=current.at(-1);
    const gap=previous?element.box.x-(previous.box.x+previous.box.width):0;
    if(previous&&gap>gapThreshold){
      groups.push(current);
      current=[];
    }
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

function fromToken(token:OcrToken):ReconstructionElement{
  const text=(token.normalizedText??token.text).trim();
  const confidence=token.confidence;
  return{
    id:token.id,
    lineId:token.lineId,
    box:{...token.box},
    originalText:token.rawText??token.text,
    normalizedText:token.normalizedText??token.text,
    text,
    confidence,
    status:statusFromConfidence(confidence,text)
  };
}

function statusFromConfidence(confidence:number|null,text:string):ReconstructionStatus{
  if(!text)return'unreadable';
  if(confidence===null)return'uncertain';
  const normalized=confidence>1?confidence/100:confidence;
  if(normalized<.35)return'error';
  if(normalized<.75)return'uncertain';
  return'reliable';
}
function median(values:number[]):number{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]!:((sorted[middle-1]??0)+(sorted[middle]??0))/2;
}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
