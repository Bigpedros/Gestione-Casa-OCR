/* eslint-disable no-useless-escape */
import type {Box,OcrPage,OcrToken} from '../../contracts.js';
import type {OcrEvidenceCandidate} from '../pipeline/checkpoints.js';

export type ReceiptItemStructureType=
  |'SINGLE_LINE'
  |'DESCRIPTION_CONTINUATION'
  |'QTY_UNIT_PREFIX'
  |'COMMERCIAL_BAND';

export type ReceiptDescriptionSource='primary'|'secondary';

export interface ReceiptItemBlock{
  id:string;
  structureType:ReceiptItemStructureType;
  description:string;
  descriptionSource:ReceiptDescriptionSource;
  alternateDescription?:string;
  vatRate:number;
  unitPrice:number;
  totalPrice:number;
  quantity:number;
  discount?:number;
  confidence:number;
  lineIds:string[];
  tokenIds:string[];
  box:Box;
}

export interface ReceiptItemBlockObservation{
  code:string;
  message:string;
  confidence:number|null;
}

export interface ReceiptItemBlockResult{
  blocks:ReceiptItemBlock[];
  observations:ReceiptItemBlockObservation[];
}

interface PhysicalLine{
  id:string;
  tokens:OcrToken[];
  text:string;
  box:Box;
  centerY:number;
}

interface ColumnModel{
  descriptionEnd:number;
  vatStart:number;
  vatEnd:number;
  priceStart:number;
}

interface CommercialAnchor{
  vatToken:OcrToken;
  priceToken:OcrToken;
  vatRate:number;
  totalPrice:number;
  centerY:number;
}

export function reconstructReceiptItemBlocks(
  page:OcrPage,
  candidates:OcrEvidenceCandidate[]=[]
):ReceiptItemBlockResult{
  const lines=reconstructPhysicalLines(page.tokens);
  const headerIndex=lines.findIndex(line=>isItemHeader(line.text));
  const header=headerIndex>=0?lines[headerIndex]:undefined;
  const columns=header
    ?inferColumns(header,page.width)
    :inferColumnsFromAnchors(page.tokens,page.width);
  if(!columns)return{blocks:[],observations:[{
    code:'RECEIPT_ITEM_COLUMNS_UNRESOLVED',
    message:'Colonne receipt non ricostruibili né da intestazione né da ancore IVA/prezzo ripetute.',
    confidence:null
  }]};

  const bodyLines=header
    ?lines.slice(headerIndex+1).filter(line=>line.centerY>header.centerY)
    :lines;
  const terminalIndex=firstTerminalIndex(bodyLines);
  const boundedLines=bodyLines.slice(0,terminalIndex);
  const boundedTokens=boundedLines.flatMap(line=>line.tokens);
  const anchors=buildCommercialAnchors(boundedTokens,columns);
  const secondaryTokens=candidates
    .filter(candidate=>candidate.source==='recognizer-b')
    .map(candidate=>candidate.token);

  const observations:ReceiptItemBlockObservation[]=[{
    code:header?'RECEIPT_ITEM_COLUMNS_FROM_HEADER':'RECEIPT_ITEM_COLUMNS_FROM_ANCHORS',
    message:header
      ?'Colonne receipt ricavate dall’intestazione.'
      :'Intestazione assente: colonne receipt ricavate dalle ancore IVA/prezzo ripetute.',
    confidence:header?.95:.88
  }];

  if(!anchors.length)return{blocks:[],observations:[...observations,{
    code:'RECEIPT_ITEM_ANCHORS_UNRESOLVED',
    message:'Nessuna coppia IVA/prezzo compatibile individuata nella zona articoli.',
    confidence:null
  }]};

  const medianHeight=medianTokenHeight(boundedTokens);
  const blocks:ReceiptItemBlock[]=[];

  for(let i=0;i<anchors.length;i++){
    const anchor=anchors[i]!;
    const previous=anchors[i-1];
    const next=anchors[i+1];
    const top=previous
      ?(previous.centerY+anchor.centerY)/2
      :Math.max(minY(boundedTokens),anchor.centerY-medianHeight*2.4);
    const bottom=next
      ?(anchor.centerY+next.centerY)/2
      :Math.min(maxY(boundedTokens),anchor.centerY+medianHeight*2.0);

    const primaryBand=boundedTokens.filter(token=>centerY(token.box)>=top&&centerY(token.box)<bottom);
    const primaryDescriptionTokens=primaryBand
      .filter(token=>centerX(token.box)<columns.vatStart)
      .filter(token=>isDescriptionToken(token))
      .filter(token=>!looksAdministrative(token.text));

    if(!primaryDescriptionTokens.length)continue;

    const quantityInfo=findQuantityPrefix(primaryBand,columns);
    const primaryDescription=descriptionFromTokens(primaryDescriptionTokens,quantityInfo?.tokens??[]);
    if(!primaryDescription)continue;

    const secondaryBand=secondaryTokens.filter(token=>centerY(token.box)>=top&&centerY(token.box)<bottom);
    const secondaryAnchorSupport=secondaryBand.some(token=>{
      const vat=parsePercent(token.text);
      return vat!==undefined&&Math.abs(vat-anchor.vatRate)<.01;
    })||secondaryBand.some(token=>{
      const money=parseMoney(token.text);
      return money!==undefined&&moneyEqual(money,anchor.totalPrice);
    });
    const secondaryDescriptionTokens=secondaryBand
      .filter(token=>centerX(token.box)<columns.vatStart)
      .filter(token=>isDescriptionToken(token))
      .filter(token=>!looksAdministrative(token.text));
    const secondaryDescription=descriptionFromTokens(secondaryDescriptionTokens,[]);
    const choice=chooseDescription(primaryDescription,secondaryDescription,secondaryAnchorSupport);

    let quantity=1;
    let unitPrice=anchor.totalPrice;
    let structureType:ReceiptItemStructureType='COMMERCIAL_BAND';
    const quantityMatches=quantityInfo&&moneyEqual(quantityInfo.quantity*quantityInfo.unitPrice,anchor.totalPrice);
    if(quantityMatches){
      quantity=quantityInfo.quantity;
      unitPrice=quantityInfo.unitPrice;
      structureType='QTY_UNIT_PREFIX';
    }else{
      const descriptionWithoutRejectedQuantity=quantityInfo
        ?primaryDescriptionTokens.filter(token=>!quantityInfo.tokens.some(q=>q.id===token.id))
        :primaryDescriptionTokens;
      const physicalRows=new Set(descriptionWithoutRejectedQuantity.map(token=>token.lineId));
      if(physicalRows.size===1&&samePhysicalBand(descriptionWithoutRejectedQuantity,anchor)){
        structureType='SINGLE_LINE';
      }else if(physicalRows.size>=1){
        structureType='DESCRIPTION_CONTINUATION';
      }
    }

    const sourceTokens=[
      ...primaryBand.filter(token=>
        primaryDescriptionTokens.includes(token)||
        token.id===anchor.vatToken.id||
        token.id===anchor.priceToken.id||
        quantityInfo?.tokens.includes(token)
      )
    ];
    const block=createBlock(
      blocks.length,
      structureType,
      choice.text,
      choice.source,
      choice.alternate,
      anchor.vatRate,
      unitPrice,
      anchor.totalPrice,
      quantity,
      sourceTokens,
      secondaryDescriptionTokens
    );
    blocks.push(block);
    observations.push({
      code:'RECEIPT_ITEM_BLOCK_RECONSTRUCTED',
      message:`${structureType}: ${block.description} | IVA ${formatPercent(anchor.vatRate)} | unitario ${formatMoney(unitPrice)} | totale ${formatMoney(anchor.totalPrice)} | fonte ${block.descriptionSource}`,
      confidence:block.confidence
    });
    if(choice.source==='secondary'){
      observations.push({
        code:'RECEIPT_ITEM_DESCRIPTION_FUSED',
        message:`Descrizione blocco ${block.id} promossa da Recognizer B all’interno della stessa fascia commerciale.`,
        confidence:block.confidence
      });
    }
  }

  return{blocks,observations};
}

export function reconstructPhysicalLines(tokens:OcrToken[]):PhysicalLine[]{
  const ordered=[...tokens].sort((a,b)=>centerY(a.box)-centerY(b.box)||a.box.x-b.box.x);
  const heights=ordered.map(token=>token.box.height).filter(value=>value>0).sort((a,b)=>a-b);
  const medianHeight=heights.length?heights[Math.floor(heights.length/2)]!:24;
  const tolerance=Math.max(8,medianHeight*.55);
  const groups:OcrToken[][]=[];

  for(const token of ordered){
    const cy=centerY(token.box);
    let best:OcrToken[]|undefined;
    let bestDistance=Infinity;
    for(const group of groups){
      const gy=group.reduce((sum,item)=>sum+centerY(item.box),0)/group.length;
      const distance=Math.abs(cy-gy);
      if(distance<=tolerance&&distance<bestDistance){best=group;bestDistance=distance;}
    }
    if(best)best.push(token);else groups.push([token]);
  }

  return groups.map((group,index)=>{
    const row=[...group].sort((a,b)=>a.box.x-b.box.x);
    const box=union(row.map(token=>token.box));
    return{
      id:`physical-${index}`,
      tokens:row,
      text:row.map(token=>token.text).join(' ').replace(/\s+/g,' ').trim(),
      box,
      centerY:centerY(box)
    };
  }).sort((a,b)=>a.centerY-b.centerY);
}

function buildCommercialAnchors(tokens:OcrToken[],columns:ColumnModel):CommercialAnchor[]{
  const vatTokens=tokens
    .filter(token=>tokenInVatColumn(token,columns)&&parsePercent(token.text)!==undefined)
    .sort((a,b)=>centerY(a.box)-centerY(b.box));
  const priceTokens=tokens
    .filter(token=>centerX(token.box)>=columns.priceStart&&parseMoney(token.text)!==undefined)
    .sort((a,b)=>centerY(a.box)-centerY(b.box));
  const medianHeight=medianTokenHeight(tokens);
  const usedPrice=new Set<string>();
  const anchors:CommercialAnchor[]=[];

  for(const vatToken of vatTokens){
    const vatRate=parsePercent(vatToken.text);
    if(vatRate===undefined)continue;
    const candidates=priceTokens
      .filter(token=>!usedPrice.has(token.id))
      .map(token=>({token,distance:Math.abs(centerY(token.box)-centerY(vatToken.box))}))
      .filter(item=>item.distance<=Math.max(55,medianHeight*2.2))
      .sort((a,b)=>a.distance-b.distance);
    const best=candidates[0]?.token;
    if(!best)continue;
    const totalPrice=parseMoney(best.text);
    if(totalPrice===undefined)continue;
    usedPrice.add(best.id);
    anchors.push({
      vatToken,
      priceToken:best,
      vatRate,
      totalPrice,
      centerY:(centerY(vatToken.box)+centerY(best.box))/2
    });
  }
  return anchors.sort((a,b)=>a.centerY-b.centerY);
}

function findQuantityPrefix(tokens:OcrToken[],columns:ColumnModel):
  {quantity:number;unitPrice:number;tokens:OcrToken[]}|undefined{
  const left=tokens.filter(token=>centerX(token.box)<columns.vatStart);
  const rows=reconstructPhysicalLines(left);
  for(const row of rows){
    const parsed=parseQuantityPrefix(row.text);
    if(parsed)return{...parsed,tokens:row.tokens};
  }
  return undefined;
}

function chooseDescription(
  primary:string,
  secondary:string,
  secondaryAnchorSupport:boolean
):{text:string;source:ReceiptDescriptionSource;alternate?:string}{
  if(!secondaryAnchorSupport||!secondary)return{text:primary,source:'primary'};
  const primaryScore=descriptionQuality(primary);
  const secondaryScore=descriptionQuality(secondary);
  if(secondaryScore>=primaryScore+1.25&&secondary.split(/\s+/).length>=2){
    return{text:secondary,source:'secondary',alternate:primary};
  }
  return{text:primary,source:'primary',alternate:secondary||undefined};
}

function descriptionQuality(value:string):number{
  const words=value.split(/\s+/).filter(Boolean);
  let score=0;
  for(const word of words){
    const letters=(word.match(/\p{L}/gu)??[]).length;
    const digits=(word.match(/\d/g)??[]).length;
    const junk=(word.match(/[|{}\[\]\\_*?]/g)??[]).length;
    if(letters>=3)score+=1.2;
    else if(letters>0)score+=.35;
    if(digits>0&&letters>0)score-=.2;
    score-=junk*.8;
  }
  return score;
}

function descriptionFromTokens(tokens:OcrToken[],excluded:OcrToken[]):string{
  const excludedIds=new Set(excluded.map(token=>token.id));
  return [...tokens]
    .filter(token=>!excludedIds.has(token.id))
    .sort((a,b)=>centerY(a.box)-centerY(b.box)||a.box.x-b.box.x)
    .map(token=>token.text)
    .join(' ')
    .replace(/^[|:;.,\-\s]+|[|:;.,\-\s]+$/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function samePhysicalBand(tokens:OcrToken[],anchor:CommercialAnchor):boolean{
  const cy=anchor.centerY;
  return tokens.every(token=>Math.abs(centerY(token.box)-cy)<=Math.max(45,token.box.height*1.6));
}

function inferColumns(header:PhysicalLine,pageWidth:number):ColumnModel{
  const desc=header.tokens.find(token=>/DESCRIZ/i.test(token.text));
  const vat=header.tokens.find(token=>/^IVA$/i.test(token.text.trim()));
  const price=header.tokens.find(token=>/PREZZO/i.test(token.text));
  const width=Math.max(1,pageWidth||union(header.tokens.map(token=>token.box)).width);
  const vatCenter=vat?centerX(vat.box):width*.62;
  const priceCenter=price?centerX(price.box):width*.82;
  const descEnd=Math.max(desc?desc.box.x+desc.box.width:width*.50,vatCenter-width*.08);
  return{
    descriptionEnd:Math.min(width*.68,descEnd),
    vatStart:Math.max(width*.45,vatCenter-width*.10),
    vatEnd:Math.min(width*.82,(vatCenter+priceCenter)/2),
    priceStart:Math.max(width*.66,priceCenter-width*.11)
  };
}

function inferColumnsFromAnchors(tokens:OcrToken[],pageWidth:number):ColumnModel|undefined{
  const width=Math.max(1,pageWidth||Math.max(...tokens.map(token=>token.box.x+token.box.width),1));
  const vatTokens=tokens.filter(token=>parsePercent(token.text)!==undefined);
  if(vatTokens.length<2)return undefined;

  const vatCenters=vatTokens.map(token=>centerX(token.box)).sort((a,b)=>a-b);
  const vatCenter=median(vatCenters);
  const moneyTokens=tokens.filter(token=>parseMoney(token.text)!==undefined&&centerX(token.box)>vatCenter+width*.10);
  if(moneyTokens.length<2)return undefined;

  const priceCenters=moneyTokens.map(token=>centerX(token.box)).sort((a,b)=>a-b);
  const priceCenter=median(priceCenters);
  if(priceCenter<=vatCenter+width*.08)return undefined;

  const midpoint=(vatCenter+priceCenter)/2;
  return{
    descriptionEnd:Math.max(width*.42,vatCenter-width*.08),
    vatStart:Math.max(width*.35,vatCenter-width*.09),
    vatEnd:Math.min(width*.86,midpoint),
    priceStart:Math.max(midpoint,width*.62)
  };
}

function firstTerminalIndex(lines:PhysicalLine[]):number{
  const index=lines.findIndex(line=>/\b(?:SUBTOTALE|TOTALE(?:\s+COMPLESSIVO)?|PAGAMENTO|IMPORTO\s+PAGATO)\b/i.test(line.text));
  return index<0?lines.length:index;
}

function isItemHeader(text:string):boolean{
  return /DESCRIZ/i.test(text)&&(/\bIVA\b/i.test(text)||/PREZZO/i.test(text));
}
function looksAdministrative(text:string):boolean{
  return /\b(?:DOCUMENTO|COMMERCIALE|P\.?(?:IVA)?|TEL\.?|VIA|CASSA|BANCOMAT|PAGAMENTO|SUBTOTALE|TOTALE|VENDITORE|IMPORTO)\b/i.test(text);
}
function isDescriptionToken(token:OcrToken):boolean{
  const text=token.text.trim();
  if(!text||parsePercent(text)!==undefined||parseMoney(text)!==undefined)return false;
  if(/^[|:;.,€%+\-]+$/.test(text))return false;
  return /\p{L}/u.test(text);
}
function parseQuantityPrefix(text:string):{quantity:number;unitPrice:number}|undefined{
  const normalized=text.replace(/×/g,'x').replace(/;/g,',');
  const match=normalized.match(/(?:^|\s)(\d{1,3})\s*x\s*(\d{1,5}[.,]\d{2})(?:\s|$)/i);
  if(!match)return undefined;
  const quantity=Number(match[1]);
  const unitPrice=Number(match[2]!.replace(',','.'));
  if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<=0)return undefined;
  return{quantity,unitPrice};
}
function tokenInVatColumn(token:OcrToken,columns:ColumnModel):boolean{
  const x=centerX(token.box);
  return x>=columns.vatStart&&x<=columns.vatEnd;
}
function parsePercent(text:string):number|undefined{
  const match=text.trim().match(/^(\d{1,3})(?:[.,](\d{1,2}))?\s*%$/);
  if(!match)return undefined;
  const value=Number(`${match[1]}.${match[2]??'0'}`);
  return Number.isFinite(value)?value:undefined;
}
function parseMoney(text:string):number|undefined{
  const match=text.trim().replace(';',',').match(/^(?:€\s*)?(\d{1,6})[.,](\d{2})$/);
  if(!match)return undefined;
  const value=Number(`${match[1]}.${match[2]}`);
  return Number.isFinite(value)?value:undefined;
}
function createBlock(
  index:number,
  structureType:ReceiptItemStructureType,
  description:string,
  descriptionSource:ReceiptDescriptionSource,
  alternateDescription:string|undefined,
  vatRate:number,
  unitPrice:number,
  totalPrice:number,
  quantity:number,
  primaryTokens:OcrToken[],
  secondaryDescriptionTokens:OcrToken[]
):ReceiptItemBlock{
  const arithmetic=moneyEqual(quantity*unitPrice,totalPrice);
  const base=structureType==='SINGLE_LINE'?.94:structureType==='QTY_UNIT_PREFIX'?.97:.91;
  const allBoxes=[
    ...primaryTokens.map(token=>token.box),
    ...(descriptionSource==='secondary'?secondaryDescriptionTokens.map(token=>token.box):[])
  ];
  return{
    id:`receipt-item-${index+1}`,
    structureType,
    description,
    descriptionSource,
    ...(alternateDescription?{alternateDescription}:{}),
    vatRate,
    unitPrice,
    totalPrice,
    quantity,
    confidence:Math.min(.99,base+(arithmetic?.02:0)+(descriptionSource==='secondary'?.01:0)),
    lineIds:[...new Set(primaryTokens.map(token=>token.lineId))],
    tokenIds:[
      ...primaryTokens.map(token=>token.id),
      ...(descriptionSource==='secondary'?secondaryDescriptionTokens.map(token=>token.id):[])
    ],
    box:union(allBoxes)
  };
}
function moneyEqual(a:number,b:number){return Math.abs(a-b)<=.011;}
function formatMoney(value:number){return value.toFixed(2).replace('.',',');}
function formatPercent(value:number){return `${value.toFixed(2).replace('.',',')}%`;}
function medianTokenHeight(tokens:OcrToken[]):number{
  const values=tokens.map(token=>token.box.height).filter(value=>value>0).sort((a,b)=>a-b);
  return values.length?values[Math.floor(values.length/2)]!:24;
}
function median(values:number[]):number{
  if(!values.length)return 0;
  const mid=Math.floor(values.length/2);
  return values.length%2?values[mid]!:(values[mid-1]!+values[mid]!)/2;
}
function minY(tokens:OcrToken[]){return Math.min(...tokens.map(token=>token.box.y),0);}
function maxY(tokens:OcrToken[]){return Math.max(...tokens.map(token=>token.box.y+token.box.height),0);}
function centerX(box:Box){return box.x+box.width/2;}
function centerY(box:Box){return box.y+box.height/2;}
function union(boxes:Box[]):Box{
  if(!boxes.length)return{x:0,y:0,width:1,height:1};
  const left=Math.min(...boxes.map(box=>box.x));
  const top=Math.min(...boxes.map(box=>box.y));
  const right=Math.max(...boxes.map(box=>box.x+box.width));
  const bottom=Math.max(...boxes.map(box=>box.y+box.height));
  return{x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
}
