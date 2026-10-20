import type {Box,OcrPage,OcrToken} from '../../contracts.js';
import type {OcrEvidenceCandidate} from '../pipeline/checkpoints.js';

export interface ReceiptLineFusionObservation{
  code:string;
  message:string;
  confidence:number|null;
}
export interface ReceiptLineFusionResult{
  tokens:OcrToken[];
  observations:ReceiptLineFusionObservation[];
}

interface ReceiptLine{
  lineId:string;
  tokens:OcrToken[];
  box:Box;
  text:string;
  description:OcrToken[];
  vat?:number;
  price?:number;
}

export function collectReceiptLineFusionEvidence(
  page:OcrPage,
  candidates:OcrEvidenceCandidate[]
):ReceiptLineFusionResult{
  const primary=buildLines(page.tokens);
  const secondary=buildLines(
    candidates
      .filter(candidate=>candidate.source==='recognizer-b')
      .map(candidate=>candidate.token)
  );
  const tokens:OcrToken[]=[];
  const observations:ReceiptLineFusionObservation[]=[];
  const usedSecondary=new Set<string>();

  for(const row of primary){
    if(!isReceiptItemLike(row))continue;
    const match=bestLineMatch(row,secondary,usedSecondary);
    if(!match)continue;
    usedSecondary.add(match.lineId);

    const replacements=alignDescription(row,match);
    if(!replacements.length)continue;

    tokens.push(...replacements);
    observations.push({
      code:'RECEIPT_LINE_FUSION_CANDIDATE',
      message:`Riga ${row.lineId}: ${replacements.length} parola/e candidate da OCRS, con ancore receipt concordanti.`,
      confidence:lineMatchConfidence(row,match)
    });
  }
  return{tokens,observations};
}

function buildLines(tokens:OcrToken[]):ReceiptLine[]{
  const grouped=new Map<string,OcrToken[]>();
  for(const token of tokens){
    const row=grouped.get(token.lineId)??[];
    row.push(token);grouped.set(token.lineId,row);
  }
  return[...grouped.entries()].map(([lineId,row])=>{
    const ordered=[...row].sort((a,b)=>a.box.x-b.box.x);
    const text=ordered.map(token=>token.text).join(' ');
    const vatToken=ordered.find(token=>parsePercentage(token.text)!==undefined);
    const moneyTokens=ordered.filter(token=>parseMoney(token.text)!==undefined);
    return{
      lineId,
      tokens:ordered,
      box:union(ordered.map(token=>token.box)),
      text,
      description:ordered.filter(isDescriptionToken),
      vat:vatToken?parsePercentage(vatToken.text):undefined,
      price:moneyTokens.length?parseMoney(moneyTokens.at(-1)!.text):undefined
    };
  }).sort((a,b)=>a.box.y-b.box.y);
}

function isReceiptItemLike(line:ReceiptLine):boolean{
  if(/\b(?:TOTALE|IVA|PAGAMENTO|IMPORTO|BANCOMAT|CONTANTI|DOCUMENTO|RT)\b/i.test(line.text))return false;
  return line.description.length>=1&&(line.vat!==undefined||line.price!==undefined);
}

function bestLineMatch(primary:ReceiptLine,secondary:ReceiptLine[],used:Set<string>):ReceiptLine|undefined{
  const ranked=secondary
    .filter(line=>!used.has(line.lineId)&&isReceiptItemLike(line))
    .map(line=>({line,score:lineMatchScore(primary,line)}))
    .filter(item=>item.score>=.66)
    .sort((a,b)=>b.score-a.score);
  return ranked[0]?.line;
}

function lineMatchScore(a:ReceiptLine,b:ReceiptLine):number{
  const v=verticalOverlap(a.box,b.box);
  const centerDistance=Math.abs(centerY(a.box)-centerY(b.box));
  const tolerance=Math.max(18,Math.max(a.box.height,b.box.height)*1.35);
  const proximity=Math.max(0,1-centerDistance/tolerance);
  const vatAgreement=a.vat!==undefined&&b.vat!==undefined&&Math.abs(a.vat-b.vat)<.01;
  const priceAgreement=a.price!==undefined&&b.price!==undefined&&Math.abs(a.price-b.price)<.011;
  if(!vatAgreement&&!priceAgreement)return 0;
  if(v<.25&&proximity<.35)return 0;
  const anchors=(vatAgreement?.34:0)+(priceAgreement?.34:0);
  return Math.min(1,anchors+v*.18+proximity*.14);
}

function lineMatchConfidence(a:ReceiptLine,b:ReceiptLine):number{
  return Math.round(lineMatchScore(a,b)*100)/100;
}

function alignDescription(primary:ReceiptLine,secondary:ReceiptLine):OcrToken[]{
  if(!primary.description.length||!secondary.description.length)return[];
  const pSpan=span(primary.description),sSpan=span(secondary.description);
  const output:OcrToken[]=[];
  let lastIndex=-1;

  for(const raw of primary.description){
    if(!isLexicalWord(raw.text))continue;
    const pPos=relativeCenter(raw.box,pSpan);
    let bestIndex=-1,bestDistance=Infinity;
    for(let i=lastIndex+1;i<secondary.description.length;i++){
      const candidate=secondary.description[i]!;
      if(!isLexicalWord(candidate.text)||!isCleanLexical(candidate.text))continue;
      const distance=Math.abs(pPos-relativeCenter(candidate.box,sSpan));
      if(distance<bestDistance){bestDistance=distance;bestIndex=i;}
    }
    if(bestIndex<0||bestDistance>.24)continue;

    const candidate=secondary.description[bestIndex]!;
    lastIndex=bestIndex;
    const rawConfidence=raw.confidence??0;
    const candidateConfidence=candidate.confidence??0;
    if(candidateConfidence<82||candidateConfidence<rawConfidence+6)continue;
    if(normalize(raw.text)===normalize(candidate.text))continue;
    if(!sameLexicalFamily(raw.text,candidate.text))continue;

    output.push({
      ...cloneToken(raw),
      text:candidate.text,
      confidence:Math.min(96,Math.max(candidateConfidence,rawConfidence+8)),
      rawText:raw.rawText??raw.text,
      normalizedText:candidate.text.normalize('NFKC'),
      alternatives:[...new Set([...(raw.alternatives??[]),raw.text,candidate.text])],
      correctionReason:'receipt-evidence:LINE_FUSION'
    });
  }
  return output;
}

function isDescriptionToken(token:OcrToken):boolean{
  const text=token.text.trim();
  if(!text||parsePercentage(text)!==undefined||parseMoney(text)!==undefined)return false;
  if(/^[|:;.,€%+\-]+$/.test(text))return false;
  return /\p{L}/u.test(text);
}
function isLexicalWord(value:string):boolean{
  return /^\p{L}[\p{L}'’.\-]{2,}$/u.test(value.trim());
}
function isCleanLexical(value:string):boolean{
  const text=value.trim();
  if(!isLexicalWord(text))return false;
  if(/[|{}\[\]\\]/.test(text))return false;
  return true;
}
function sameLexicalFamily(a:string,b:string):boolean{
  return isLexicalWord(a)&&isLexicalWord(b);
}
function parsePercentage(value:string):number|undefined{
  const match=value.trim().match(/^(\d{1,3})(?:[.,](\d{1,2}))?\s*%$/);
  if(!match)return undefined;
  const number=Number(`${match[1]}.${match[2]??'0'}`);
  return Number.isFinite(number)?number:undefined;
}
function parseMoney(value:string):number|undefined{
  const match=value.trim().match(/^(?:€\s*)?(\d{1,6})[.,](\d{2})$/);
  if(!match)return undefined;
  const number=Number(`${match[1]}.${match[2]}`);
  return Number.isFinite(number)?number:undefined;
}
function normalize(value:string){return value.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');}
function relativeCenter(box:Box,spanBox:Box):number{
  return (centerX(box)-spanBox.x)/Math.max(1,spanBox.width);
}
function centerX(box:Box){return box.x+box.width/2;}
function centerY(box:Box){return box.y+box.height/2;}
function verticalOverlap(a:Box,b:Box):number{
  const top=Math.max(a.y,b.y),bottom=Math.min(a.y+a.height,b.y+b.height);
  return bottom<=top?0:(bottom-top)/Math.max(1,Math.min(a.height,b.height));
}
function span(tokens:OcrToken[]):Box{return union(tokens.map(token=>token.box));}
function union(boxes:Box[]):Box{
  const left=Math.min(...boxes.map(box=>box.x)),top=Math.min(...boxes.map(box=>box.y));
  const right=Math.max(...boxes.map(box=>box.x+box.width)),bottom=Math.max(...boxes.map(box=>box.y+box.height));
  return{x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
}
function cloneToken(token:OcrToken):OcrToken{
  return{
    ...token,
    box:{...token.box},
    ...(token.normalizedBox?{normalizedBox:{...token.normalizedBox}}:{}),
    ...(token.alternatives?{alternatives:[...token.alternatives]}:{}),
    ...(token.characters?{characters:token.characters.map(character=>({...character,box:{...character.box}}))}:{})
  };
}
