import type {OcrPage} from '../../contracts.js';

export interface SemanticOcrQuality{
  rawScore:number;adjustedScore:number;receiptLike:boolean;criticalFieldGate:boolean;suspiciousRatio:number;reasons:string[];
}
export function evaluateSemanticOcrQuality(page:OcrPage,rawScore:number):SemanticOcrQuality{
  const text=page.text.normalize('NFKC'),upper=text.toUpperCase();
  const receiptSignals=[/DOCUMENTO\s+COMMERCIALE/.test(upper),/\bTOTALE\b/.test(upper),/\bIVA\b/.test(upper),/\bPAGAMENTO\b|\bBANCOMAT\b|\bCONTANTI\b|\bCARTA\b/.test(upper)].filter(Boolean).length;
  const receiptLike=receiptSignals>=2;
  const suspicious=page.tokens.filter(token=>isSuspiciousToken(token.text,token.confidence)).length;
  const suspiciousRatio=suspicious/Math.max(1,page.tokens.length);
  const reasons:string[]=[];let penalty=Math.min(24,suspiciousRatio*80);
  if(suspiciousRatio>.08)reasons.push(`suspicious-token-ratio:${suspiciousRatio.toFixed(2)}`);
  let criticalFieldGate=true;
  if(receiptLike){
    const lines=groupLines(page);
    const totalOk=lines.some(line=>/\bTOTALE(?:\s+COMPLESSIVO)?\b/i.test(line)&&hasMoney(line));
    const paymentOk=lines.some(line=>/\b(PAGAMENTO|IMPORTO\s+PAGATO|BANCOMAT|CONTANTI|CARTA)\b/i.test(line)&&hasMoney(line));
    const dateOk=/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/.test(text);
    const documentOk=/\bDOCUMENTO\b/i.test(text)&&/\b\d{2,6}[-/]?\d{2,6}\b/.test(text);
    const compact=text.replace(/\s+/g,' ');
    const vatLabelPresent=/(?:P\.?\s*IVA|PARTITA\s+IVA)/i.test(compact);
    const vatIdOk=/(?:P\.?\s*IVA|PARTITA\s+IVA)[^\d]{0,8}\d{11}/i.test(compact);
    const vatAmountLabelPresent=lines.some(line=>/\bdi\s+cui\s+IVA\b/i.test(line));
    const vatAmountOk=!vatAmountLabelPresent||lines.some(line=>/\bdi\s+cui\s+IVA\b/i.test(line)&&hasMoney(line));
    criticalFieldGate=totalOk&&paymentOk&&(dateOk||documentOk)&&(!vatLabelPresent||vatIdOk)&&vatAmountOk;
    if(!totalOk){penalty+=14;reasons.push('missing-or-invalid-total');}
    if(!paymentOk){penalty+=7;reasons.push('missing-payment-evidence');}
    if(!dateOk&&!documentOk){penalty+=8;reasons.push('missing-date-or-document-number');}
    if(vatAmountLabelPresent&&!vatAmountOk){penalty+=6;reasons.push('missing-or-invalid-vat-amount');}
    if(vatLabelPresent&&!vatIdOk){penalty+=10;reasons.push('invalid-vat-id');}
  }
  return{rawScore,adjustedScore:Math.max(0,Math.min(100,rawScore-penalty)),receiptLike,criticalFieldGate,suspiciousRatio,reasons};
}
export function shouldStopOcrCascade(q:SemanticOcrQuality,confidence:number,lowRatio:number,index:number):boolean{
  if(q.receiptLike)return q.adjustedScore>=80&&q.criticalFieldGate&&q.suspiciousRatio<.06&&confidence>=72&&lowRatio<.14;
  if(index===0)return q.adjustedScore>=84&&confidence>=76&&lowRatio<.10&&q.suspiciousRatio<.05;
  return q.adjustedScore>=80&&confidence>=72&&lowRatio<.14&&q.suspiciousRatio<.07;
}
function groupLines(page:OcrPage):string[]{const map=new Map<string,typeof page.tokens>();for(const token of page.tokens){const row=map.get(token.lineId)??[];row.push(token);map.set(token.lineId,row);}return[...map.values()].map(tokens=>[...tokens].sort((a,b)=>a.box.x-b.box.x).map(token=>token.text).join(' '));}
function hasMoney(line:string){return /(?:€\s*)?\d{1,5}[.,]\d{2}(?!\s*%)/.test(line);}
function isSuspiciousToken(value:string,confidence:number|null):boolean{
  const text=value.trim();if(!text)return true;if((confidence??100)<42)return true;
  if(/[{}\[\]\\|]/.test(text))return true;
  if(/^[A-Za-zÀ-ÿ]{1,3}\-?\d+[A-Za-zÀ-ÿ]+$/.test(text))return true;
  if(text.length<=4&&/[a-zà-ÿ]/.test(text)&&/[A-ZÀ-Ý]/.test(text))return true;
  const alnum=(text.match(/[\p{L}\p{N}]/gu)??[]).length;return alnum/Math.max(1,[...text].length)<.55;
}
