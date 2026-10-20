import type {OcrPage,OcrToken} from '../../contracts.js';
import type {OcrEvidenceCandidate} from '../pipeline/checkpoints.js';
import {collectReceiptLineFusionEvidence} from './receiptLineFusion.js';

export interface ReceiptEvidenceObservation{
  code:string;
  message:string;
  confidence:number|null;
}

export interface ReceiptEvidenceResult{
  tokens:OcrToken[];
  observations:ReceiptEvidenceObservation[];
}

/**
 * Fase 3: il finalizer non costruisce più una pagina modificata.
 * Produce esclusivamente evidenze/candidati da sottoporre al Decision Engine.
 */
export function collectReceiptEvidence(page:OcrPage,candidates:OcrEvidenceCandidate[]=[]):ReceiptEvidenceResult{
  const tokens:OcrToken[]=[];
  const observations:ReceiptEvidenceObservation[]=[];

  tokens.push(...collectConservativeAlternativeEvidence(page.tokens));
  observations.push(...collectDateTimeObservations(page));

  const lineFusion=collectReceiptLineFusionEvidence(page,candidates);
  tokens.push(...lineFusion.tokens);
  observations.push(...lineFusion.observations);

  const monetary=collectMonetaryReconciliationEvidence(page,candidates);
  tokens.push(...monetary.tokens);
  observations.push(...monetary.observations);
  return{tokens,observations};
}


function collectMonetaryReconciliationEvidence(page:OcrPage,candidates:OcrEvidenceCandidate[]):ReceiptEvidenceResult{
  const tokens:OcrToken[]=[];
  const observations:ReceiptEvidenceObservation[]=[];
  const lines=[...group(page.tokens).values()].map(row=>{
    const ordered=[...row].sort((a,b)=>a.box.x-b.box.x);
    return{tokens:ordered,text:ordered.map(token=>token.text).join(' ')};
  });

  const itemLines=lines.filter(line=>
    /\b\d{1,2}[.,]\d{2}\s*%/.test(line.text)&&
    !/\b(?:TOTALE|IVA|PAGAMENTO|IMPORTO\s+PAGATO|BANCOMAT|CONTANTI|CARTA)\b/i.test(line.text)
  );
  const itemAmounts=itemLines.map(line=>lastExplicitMoney(line.tokens)).filter((value):value is number=>value!==undefined);
  const itemSum=itemAmounts.length>=2?roundMoney(itemAmounts.reduce((sum,value)=>sum+value,0)):undefined;

  const paymentLines=lines.filter(line=>/\b(?:PAGAMENTO|IMPORTO\s+PAGATO|BANCOMAT|CONTANTI|CARTA)\b/i.test(line.text));
  const paymentAmounts=paymentLines.map(line=>lastExplicitMoney(line.tokens)).filter((value):value is number=>value!==undefined);
  const paymentConsensus=modeMoney(paymentAmounts);

  const totalLine=lines.find(line=>/\bTOTALE(?:\s+COMPLESSIVO)?\b/i.test(line.text));
  const totalToken=totalLine?rightmostMoneyLikeToken(totalLine.tokens):undefined;
  if(totalToken&&itemSum!==undefined&&paymentConsensus!==undefined&&moneyEqual(itemSum,paymentConsensus)){
    const current=parseMoneyLoose(totalToken.text);
    const sameIntegral=current!==undefined&&Math.trunc(current)===Math.trunc(itemSum);
    const paymentSupport=paymentAmounts.filter(value=>moneyEqual(value,itemSum)).length;
    if(sameIntegral&&paymentSupport>=1&&!moneyEqual(current!,itemSum)){
      const value=formatMoney(itemSum);
      tokens.push({
        ...cloneToken(totalToken),text:value,confidence:96,
        rawText:totalToken.rawText??totalToken.text,normalizedText:value,
        alternatives:[...new Set([...(totalToken.alternatives??[]),totalToken.text,value])],
        correctionReason:'receipt-evidence:TOTAL_SUM_RECONCILIATION'
      });
      observations.push({
        code:'RECEIPT_TOTAL_RESOLVED',
        message:`Totale candidato ${value}: somma articoli ${formatMoney(itemSum)} e pagamento ottico concordano.`,
        confidence:.97
      });
    }
  }

  let expectedVat=0,vatItems=0;
  for(const line of itemLines){
    const rateMatch=line.text.match(/\b(\d{1,2}[.,]\d{2})\s*%/);
    const gross=lastExplicitMoney(line.tokens);
    if(!rateMatch||gross===undefined)continue;
    const rate=Number(rateMatch[1]!.replace(',','.'));
    if(!Number.isFinite(rate)||rate<=0)continue;
    expectedVat+=gross*rate/(100+rate);vatItems++;
  }
  if(vatItems){
    expectedVat=roundMoney(expectedVat);
    const vatLine=lines.find(line=>/\bdi\s+cui\s+IVA\b/i.test(line.text));
    const vatToken=vatLine?rightmostMoneyLikeToken(vatLine.tokens):undefined;
    if(vatToken){
      const current=parseMoneyLoose(vatToken.text);
      if(current!==undefined&&!moneyEqual(current,expectedVat)){
        const optical=findOpticalMoneyCandidate(vatToken,expectedVat,candidates);
        if(optical){
          const value=formatMoney(expectedVat);
          tokens.push({
            ...cloneToken(vatToken),text:value,
            confidence:Math.min(97,Math.max(92,optical.token.confidence??0)),
            rawText:vatToken.rawText??vatToken.text,normalizedText:value,
            alternatives:[...new Set([...(vatToken.alternatives??[]),vatToken.text,optical.token.text,value])],
            correctionReason:'receipt-evidence:VAT_RECONCILIATION'
          });
          observations.push({
            code:'RECEIPT_VAT_RESOLVED',
            message:`IVA candidata ${value}: evidenza ottica locale + aliquote/importi coerenti.`,
            confidence:.95
          });
        }else{
          observations.push({
            code:'RECEIPT_VAT_RECONCILIATION_UNSUPPORTED',
            message:`IVA matematica attesa ${formatMoney(expectedVat)}, ma nessun candidato ottico locale compatibile: valore non modificato.`,
            confidence:.82
          });
        }
      }
    }
  }
  return{tokens,observations};
}

function findOpticalMoneyCandidate(raw:OcrToken,expected:number,candidates:OcrEvidenceCandidate[]):OcrEvidenceCandidate|undefined{
  return candidates
    .filter(candidate=>candidate.source!=='receipt-finalizer'&&candidate.source!=='local-consensus')
    .filter(candidate=>{
      const value=parseMoneyStrict(candidate.token.text);
      return value!==undefined&&moneyEqual(value,expected)&&spatiallyRelated(raw,candidate.token);
    })
    .sort((a,b)=>(b.token.confidence??0)-(a.token.confidence??0))[0];
}
function spatiallyRelated(a:OcrToken,b:OcrToken):boolean{
  const left=Math.max(a.box.x,b.box.x),top=Math.max(a.box.y,b.box.y);
  const right=Math.min(a.box.x+a.box.width,b.box.x+b.box.width),bottom=Math.min(a.box.y+a.box.height,b.box.y+b.box.height);
  const overlap=right>left&&bottom>top?((right-left)*(bottom-top))/Math.max(1,Math.min(a.box.width*a.box.height,b.box.width*b.box.height)):0;
  const acy=a.box.y+a.box.height/2,bcy=b.box.y+b.box.height/2;
  return overlap>.28||Math.abs(acy-bcy)<=Math.max(a.box.height,b.box.height)*.6;
}
function rightmostMoneyLikeToken(tokens:OcrToken[]):OcrToken|undefined{
  return [...tokens].filter(token=>parseMoneyLoose(token.text)!==undefined).sort((a,b)=>b.box.x-a.box.x)[0];
}
function lastExplicitMoney(tokens:OcrToken[]):number|undefined{
  const values=[...tokens].sort((a,b)=>a.box.x-b.box.x).map(token=>parseMoneyStrict(token.text)).filter((value):value is number=>value!==undefined);
  return values.at(-1);
}
function parseMoneyStrict(value:string):number|undefined{
  const match=value.trim().match(/^(?:€\s*)?(\d{1,6})[.,](\d{2})$/);
  if(!match)return undefined;
  const number=Number(`${match[1]}.${match[2]}`);
  return Number.isFinite(number)?number:undefined;
}
function parseMoneyLoose(value:string):number|undefined{
  const match=value.trim().match(/^(?:€\s*)?(\d{1,6})[.,](\d{1,2})$/);
  if(!match)return undefined;
  const number=Number(`${match[1]}.${match[2]}`);
  return Number.isFinite(number)?number:undefined;
}
function modeMoney(values:number[]):number|undefined{
  const counts=new Map<number,number>();
  for(const value of values){const key=roundMoney(value);counts.set(key,(counts.get(key)??0)+1);}
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];
}
function moneyEqual(a:number,b:number){return Math.abs(a-b)<=.01;}
function roundMoney(value:number){return Math.round(value*100)/100;}
function formatMoney(value:number){return roundMoney(value).toFixed(2).replace('.',',');}

function collectConservativeAlternativeEvidence(tokens:OcrToken[]):OcrToken[]{
  const output:OcrToken[]=[];
  for(const token of tokens){
    const alternatives=token.alternatives??[];
    if(!alternatives.length)continue;
    const current=token.text.trim();
    const currentCore=current.replace(/[^\p{L}\p{N}]/gu,'').toUpperCase();
    if(!currentCore)continue;
    const better=alternatives.find(candidate=>{
      const value=candidate.trim();
      if(!value||value===current)return false;
      const core=value.replace(/[^\p{L}\p{N}]/gu,'').toUpperCase();
      if(core!==currentCore)return false;
      if(/[!|{}\[\]\\]/.test(current)&&!/[!|{}\[\]\\]/.test(value))return true;
      if(/\p{L}[!?]$/u.test(current)&&/[\p{L}'’.]$/u.test(value))return true;
      return false;
    });
    if(!better)continue;
    output.push({
      ...cloneToken(token),
      text:better,
      normalizedText:better.normalize('NFKC'),
      confidence:Math.min(90,Math.max(token.confidence??0,76)),
      correctionReason:'receipt-evidence:conservative-alternative'
    });
  }
  return output;
}

function collectDateTimeObservations(page:OcrPage):ReceiptEvidenceObservation[]{
  const observations:ReceiptEvidenceObservation[]=[];
  for(const line of group(page.tokens).values()){
    const ordered=[...line].sort((a,b)=>a.box.x-b.box.x);
    if(ordered.length<3||ordered.length>10)continue;
    const joined=ordered.map(token=>token.text.trim()).join('')
      .replace(/[–—]/g,'-').replace(/-{2,}/g,'-').replace(/:{2,}/g,':');
    const match=joined.match(/(\d{2}-\d{2}-\d{4})(\d{2}:\d{2})/);
    if(!match)continue;
    observations.push({
      code:'RECEIPT_DATETIME_CANDIDATE',
      message:`Data/ora candidata: ${match[1]} ${match[2]}`,
      confidence:averageConfidence(ordered)
    });
  }
  return observations;
}

function group(tokens:OcrToken[]){
  const map=new Map<string,OcrToken[]>();
  for(const token of tokens){const row=map.get(token.lineId)??[];row.push(token);map.set(token.lineId,row);}
  return map;
}
function averageConfidence(tokens:OcrToken[]):number|null{
  const values=tokens.map(token=>token.confidence).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  if(!values.length)return null;
  return values.reduce((sum,value)=>sum+value,0)/values.length/100;
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
