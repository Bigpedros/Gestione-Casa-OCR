import type {EnginePageResult,OcrToken} from '../../contracts.js';

export type DocumentLineRole='item'|'total'|'vat'|'payment'|'pos'|'header'|'footer'|'text';

export interface DocumentLineRef{
  id:string;
  pageNumber:number;
  lineId:string;
  text:string;
  normalized:string;
  role:DocumentLineRole;
  tokenIds:string[];
  confidence:number;
  duplicateOf?:string;
  overlapGroup?:string;
}
export interface DocumentOverlap{
  fromPage:number;
  toPage:number;
  confidence:number;
  matchedPairs:Array<{from:string;to:string;similarity:number;role:DocumentLineRole}>;
}
export interface DocumentMergeResult{
  schema:'DOCUMENT_MERGE_V1';
  lines:DocumentLineRef[];
  mergedText:string;
  overlaps:DocumentOverlap[];
  duplicateLineCount:number;
  pageCount:number;
}

/**
 * Reconstruct a document from independently stabilized pages/images.
 * Only adjacent pages are compared. The algorithm never rewrites OCR tokens:
 * it marks duplicate line observations and emits a de-duplicated reading stream.
 */
export function mergeDocumentPages(pages:EnginePageResult[]):DocumentMergeResult{
  const pageLines=pages.map(page=>extractPageLines(page));
  const overlaps:DocumentOverlap[]=[];
  const duplicateIds=new Set<string>();

  for(let i=0;i<pageLines.length-1;i++){
    const a=pageLines[i]!,b=pageLines[i+1]!;
    const overlap=findAdjacentOverlap(a,b);
    if(!overlap)continue;
    overlaps.push(overlap);
    const group=`p${overlap.fromPage}-p${overlap.toPage}`;
    for(const pair of overlap.matchedPairs){
      const target=b.find(line=>line.id===pair.to);
      if(!target)continue;
      target.duplicateOf=pair.from;
      target.overlapGroup=group;
      duplicateIds.add(target.id);
      const source=a.find(line=>line.id===pair.from);
      if(source)source.overlapGroup=group;
    }
  }

  // Critical receipt summary lines may repeat outside the local overlap (for example a
  // re-photographed footer). Suppress only near-identical same-role observations.
  const all=pageLines.flat();
  const canonicalByKey=new Map<string,DocumentLineRef>();
  for(const line of all){
    if(line.duplicateOf)continue;
    if(!['total','vat','payment','pos'].includes(line.role))continue;
    const key=`${line.role}:${criticalValueKey(line.text)}`;
    if(!criticalValueKey(line.text))continue;
    const previous=canonicalByKey.get(key);
    if(previous&&line.pageNumber!==previous.pageNumber&&lineSimilarity(previous.normalized,line.normalized)>=.94){
      line.duplicateOf=previous.id;
      duplicateIds.add(line.id);
    }else canonicalByKey.set(key,line);
  }

  const visible=all.filter(line=>!line.duplicateOf);
  return{
    schema:'DOCUMENT_MERGE_V1',
    lines:all,
    mergedText:visible.map(line=>line.text).join('\n'),
    overlaps,
    duplicateLineCount:duplicateIds.size,
    pageCount:pages.length
  };
}

function extractPageLines(page:EnginePageResult):DocumentLineRef[]{
  const grouped=new Map<string,OcrToken[]>();
  for(const token of page.ocr.tokens){
    const row=grouped.get(token.lineId)??[];
    row.push(token);grouped.set(token.lineId,row);
  }
  return[...grouped.entries()].map(([lineId,tokens],index)=>{
    const ordered=[...tokens].sort((a,b)=>a.box.x-b.box.x);
    const text=ordered.map(token=>token.text).join(' ').replace(/\s+/g,' ').trim();
    const confidence=ordered.length?ordered.reduce((s,t)=>s+(t.confidence??0),0)/ordered.length:0;
    return{
      id:`p${page.ocr.pageNumber}:l${index}:${lineId}`,
      pageNumber:page.ocr.pageNumber,lineId,text,normalized:normalizeLine(text),
      role:classifyRole(text),tokenIds:ordered.map(t=>t.id),confidence
    };
  }).filter(line=>line.text.length>0)
    .sort((a,b)=>{
      const ta=grouped.get(a.lineId)!,tb=grouped.get(b.lineId)!;
      const ya=Math.min(...ta.map(t=>t.box.y)),yb=Math.min(...tb.map(t=>t.box.y));
      return ya-yb;
    });
}

function findAdjacentOverlap(a:DocumentLineRef[],b:DocumentLineRef[]):DocumentOverlap|null{
  if(!a.length||!b.length)return null;
  const tail=a.slice(Math.max(0,a.length-14));
  const head=b.slice(0,14);
  const pairs:Array<{from:string;to:string;similarity:number;role:DocumentLineRole}>=[];
  const usedB=new Set<string>();

  // Monotonic matching: prevents a POS footer from being matched against a product row.
  let lastB=-1;
  for(const from of tail){
    let best:{line:DocumentLineRef;index:number;similarity:number}|undefined;
    for(let j=lastB+1;j<head.length;j++){
      const to=head[j]!;
      if(usedB.has(to.id)||!rolesCompatible(from.role,to.role))continue;
      const similarity=lineSimilarity(from.normalized,to.normalized);
      const threshold=thresholdForRole(from.role,to.role);
      if(similarity<threshold)continue;
      if(!best||similarity>best.similarity)best={line:to,index:j,similarity};
    }
    if(best){
      pairs.push({from:from.id,to:best.line.id,similarity:best.similarity,role:from.role});
      usedB.add(best.line.id);lastB=best.index;
    }
  }

  if(!pairs.length)return null;
  const strong=pairs.filter(pair=>pair.similarity>=.88);
  const mean=pairs.reduce((s,p)=>s+p.similarity,0)/pairs.length;
  const continuityBonus=pairs.length>=2?.12:0;
  const confidence=Math.min(1,mean*.82+continuityBonus+(strong.length>=2?.06:0));
  const criticalOnly=pairs.every(p=>['total','vat','payment','pos'].includes(p.role));
  if(pairs.length<2&&!criticalOnly)return null;
  if(confidence<.72)return null;

  return{fromPage:a[0]!.pageNumber,toPage:b[0]!.pageNumber,confidence,matchedPairs:pairs};
}

function classifyRole(text:string):DocumentLineRole{
  const upper=text.normalize('NFKC').toUpperCase();
  if(/\b(POS|BANCOMAT|TERMINALE|TRANSAZIONE|AUTORIZZAZIONE|CARTA\s+N\.?|AID|ACQUIRER)\b/.test(upper))return'pos';
  if(/\b(TOTALE|TOTALE\s+COMPLESSIVO|IMPORTO\s+TOTALE)\b/.test(upper))return'total';
  if(/\b(IVA|DI\s+CUI\s+IVA|IMPOSTA)\b/.test(upper))return'vat';
  if(/\b(PAGAMENTO|IMPORTO\s+PAGATO|CONTANTI|CARTA|BANCOMAT)\b/.test(upper))return'payment';
  if(/\b(DOCUMENTO\s+COMMERCIALE|SCONTRINO|RICEVUTA)\b/.test(upper))return'header';
  if(/\b(GRAZIE|ARRIVEDERCI|WWW\.|TEL\.?|P\.IVA)\b/.test(upper))return'footer';
  if(/(?:€\s*)?\d{1,6}[.,]\d{2}\s*$/.test(text)&&/[\p{L}]/u.test(text))return'item';
  return'text';
}
function rolesCompatible(a:DocumentLineRole,b:DocumentLineRole):boolean{
  if(a===b)return true;
  if((a==='text'&&b==='item')||(a==='item'&&b==='text'))return true;
  if((a==='footer'&&b==='text')||(a==='text'&&b==='footer'))return true;
  return false;
}
function thresholdForRole(a:DocumentLineRole,b:DocumentLineRole):number{
  if(['total','vat','payment','pos'].includes(a)||['total','vat','payment','pos'].includes(b))return .92;
  if(a==='item'||b==='item')return .84;
  return .80;
}
function normalizeLine(value:string):string{
  return value.normalize('NFKC').toUpperCase().replace(/[€]/g,' EUR ').replace(/[^\p{L}\p{N},.%]+/gu,' ').replace(/\s+/g,' ').trim();
}
function lineSimilarity(a:string,b:string):number{
  if(!a||!b)return 0;if(a===b)return 1;
  const ta=a.split(' '),tb=b.split(' ');
  const sa=new Set(ta),sb=new Set(tb);
  const intersection=[...sa].filter(x=>sb.has(x)).length;
  const union=new Set([...sa,...sb]).size;
  const tokenScore=union?intersection/union:0;
  const charScore=1-levenshtein(a,b)/Math.max(a.length,b.length,1);
  return Math.max(0,Math.min(1,.55*charScore+.45*tokenScore));
}
function levenshtein(a:string,b:string):number{
  const prev=Array.from({length:b.length+1},(_,i)=>i),curr=new Array<number>(b.length+1);
  for(let i=1;i<=a.length;i++){
    curr[0]=i;
    for(let j=1;j<=b.length;j++)curr[j]=Math.min(curr[j-1]!+1,prev[j]!+1,prev[j-1]!+(a[i-1]===b[j-1]?0:1));
    for(let j=0;j<=b.length;j++)prev[j]=curr[j]!;
  }
  return prev[b.length]!;
}
function criticalValueKey(text:string):string{
  return (text.match(/\d{1,6}[.,]\d{2}/g)??[]).map(v=>v.replace('.',',')).join('|');
}
