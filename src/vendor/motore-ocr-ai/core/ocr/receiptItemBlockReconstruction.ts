/* eslint-disable no-useless-escape */
import type {Box,OcrPage,OcrToken} from '../../contracts.js';

export type ReceiptItemStructureType=
  |'SINGLE_LINE'
  |'DESCRIPTION_CONTINUATION'
  |'QTY_UNIT_PREFIX';

export interface ReceiptItemBlock{
  id:string;
  structureType:ReceiptItemStructureType;
  description:string;
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

export function reconstructReceiptItemBlocks(page:OcrPage):ReceiptItemBlockResult{
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

  const body=header
    ?lines.slice(headerIndex+1).filter(line=>line.centerY>header.centerY)
    :lines;
  const bounded=body.slice(0,firstTerminalIndex(body));
  const blocks:ReceiptItemBlock[]=[];
  const observations:ReceiptItemBlockObservation[]=[{
    code:header?'RECEIPT_ITEM_COLUMNS_FROM_HEADER':'RECEIPT_ITEM_COLUMNS_FROM_ANCHORS',
    message:header
      ?'Colonne receipt ricavate dall’intestazione.'
      :'Intestazione assente: colonne receipt ricavate dalle ancore IVA/prezzo ripetute.',
    confidence:header?.95:.88
  }];
  let pendingDescription:PhysicalLine|undefined;
  let pendingQuantity:PhysicalLine|undefined;

  for(const line of bounded){
    const fields=classifyLine(line,columns);

    if(fields.isQuantityPrefix){
      pendingQuantity=line;
      continue;
    }

    if(fields.description&&fields.vatRate!==undefined&&fields.totalPrice!==undefined){
      const sourceLines:PhysicalLine[]=[];
      let structureType:ReceiptItemStructureType='SINGLE_LINE';
      let quantity=1;
      let unitPrice=fields.totalPrice;

      if(pendingQuantity){
        const quantityInfo=parseQuantityPrefix(pendingQuantity.text);
        if(quantityInfo&&moneyEqual(quantityInfo.quantity*quantityInfo.unitPrice,fields.totalPrice)){
          sourceLines.push(pendingQuantity);
          quantity=quantityInfo.quantity;
          unitPrice=quantityInfo.unitPrice;
          structureType='QTY_UNIT_PREFIX';
        }
      }

      if(pendingDescription&&isDescriptionContinuation(pendingDescription,line,columns)){
        sourceLines.push(pendingDescription);
        structureType='DESCRIPTION_CONTINUATION';
      }

      sourceLines.push(line);
      const description=[pendingDescription&&structureType==='DESCRIPTION_CONTINUATION'
        ?extractDescription(pendingDescription,columns):undefined,fields.description]
        .filter((value):value is string=>!!value)
        .join(' ')
        .replace(/\s+/g,' ')
        .trim();

      if(description){
        const block=createBlock(blocks.length,structureType,description,fields.vatRate,unitPrice,fields.totalPrice,quantity,sourceLines);
        blocks.push(block);
        observations.push({
          code:'RECEIPT_ITEM_BLOCK_RECONSTRUCTED',
          message:`${structureType}: ${description} | IVA ${formatPercent(fields.vatRate)} | unitario ${formatMoney(unitPrice)} | totale ${formatMoney(fields.totalPrice)}`,
          confidence:block.confidence
        });
      }
      pendingDescription=undefined;
      pendingQuantity=undefined;
      continue;
    }

    if(fields.description&&!fields.hasVat&&!fields.hasPrice&&!looksAdministrative(line.text)){
      pendingDescription=line;
      pendingQuantity=undefined;
      continue;
    }

    if(!isIgnorable(line.text)){
      pendingDescription=undefined;
      pendingQuantity=undefined;
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

function median(values:number[]):number{
  if(!values.length)return 0;
  const mid=Math.floor(values.length/2);
  return values.length%2?values[mid]!:(values[mid-1]!+values[mid]!)/2;
}

function classifyLine(line:PhysicalLine,columns:ColumnModel){
  const vatToken=line.tokens.find(token=>tokenInVatColumn(token,columns)&&parsePercent(token.text)!==undefined);
  const priceTokens=line.tokens.filter(token=>token.box.x>=columns.priceStart&&parseMoney(token.text)!==undefined);
  const totalToken=priceTokens.at(-1);
  const description=extractDescription(line,columns);
  return{
    description,
    vatRate:vatToken?parsePercent(vatToken.text):undefined,
    totalPrice:totalToken?parseMoney(totalToken.text):undefined,
    hasVat:!!vatToken,
    hasPrice:!!totalToken,
    isQuantityPrefix:parseQuantityPrefix(line.text)!==undefined&&
      !vatToken&&line.tokens.every(token=>token.box.x<columns.vatStart)
  };
}

function extractDescription(line:PhysicalLine,columns:ColumnModel):string{
  return line.tokens
    .filter(token=>token.box.x<columns.vatStart)
    .filter(token=>!isPureQuantityToken(token.text))
    .map(token=>token.text)
    .join(' ')
    .replace(/^[|:;.,\-\s]+|[|:;.,\-\s]+$/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function isDescriptionContinuation(previous:PhysicalLine,current:PhysicalLine,columns:ColumnModel):boolean{
  const prevText=extractDescription(previous,columns);
  if(!prevText)return false;
  const gap=current.box.y-(previous.box.y+previous.box.height);
  const height=Math.max(previous.box.height,current.box.height);
  if(gap>height*1.45)return false;
  if(previous.box.x>=columns.vatStart)return false;
  return !looksAdministrative(previous.text);
}

function firstTerminalIndex(lines:PhysicalLine[]):number{
  const index=lines.findIndex(line=>/\b(?:SUBTOTALE|TOTALE(?:\s+COMPLESSIVO)?|PAGAMENTO|IMPORTO\s+PAGATO)\b/i.test(line.text));
  return index<0?lines.length:index;
}

function isItemHeader(text:string):boolean{
  return /DESCRIZ/i.test(text)&&(/\bIVA\b/i.test(text)||/PREZZO/i.test(text));
}
function looksAdministrative(text:string):boolean{
  return /\b(?:DOCUMENTO|COMMERCIALE|P\.?(?:IVA)?|TEL\.?|VIA|CASSA|BANCOMAT|PAGAMENTO|SUBTOTALE|TOTALE|VENDITORE)\b/i.test(text);
}
function isIgnorable(text:string):boolean{
  return !text.trim()||/^[|:;.,_\-]+$/.test(text.trim());
}
function isPureQuantityToken(text:string):boolean{
  return /^(?:\d+(?:[.,]\d+)?|x|×)$/i.test(text.trim());
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
  vatRate:number,
  unitPrice:number,
  totalPrice:number,
  quantity:number,
  lines:PhysicalLine[]
):ReceiptItemBlock{
  const tokens=lines.flatMap(line=>line.tokens);
  const arithmetic=moneyEqual(quantity*unitPrice,totalPrice);
  const base=structureType==='SINGLE_LINE'?.94:structureType==='QTY_UNIT_PREFIX'?.97:.91;
  return{
    id:`receipt-item-${index+1}`,
    structureType,
    description,
    vatRate,
    unitPrice,
    totalPrice,
    quantity,
    confidence:Math.min(.99,base+(arithmetic?.02:0)),
    lineIds:lines.map(line=>line.id),
    tokenIds:tokens.map(token=>token.id),
    box:union(lines.map(line=>line.box))
  };
}
function moneyEqual(a:number,b:number){return Math.abs(a-b)<=.011;}
function formatMoney(value:number){return value.toFixed(2).replace('.',',');}
function formatPercent(value:number){return `${value.toFixed(2).replace('.',',')}%`;}
function centerX(box:Box){return box.x+box.width/2;}
function centerY(box:Box){return box.y+box.height/2;}
function union(boxes:Box[]):Box{
  const left=Math.min(...boxes.map(box=>box.x));
  const top=Math.min(...boxes.map(box=>box.y));
  const right=Math.max(...boxes.map(box=>box.x+box.width));
  const bottom=Math.max(...boxes.map(box=>box.y+box.height));
  return{x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
}
