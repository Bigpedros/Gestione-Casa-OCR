import type {Box,OcrToken} from '../../contracts.js';
import type {OcrEvidenceCandidate,OcrEvidenceSet} from './checkpoints.js';

interface Reading{
  candidate:OcrEvidenceCandidate;
  text:string;
  confidence:number;
  channel:string;
}
interface ConsensusCluster{
  raw:Readonly<OcrToken>;
  text:string;
  confidence:number;
  box:Box;
  channels:string[];
  localCount:number;
  supportCount:number;
  supportScore:number;
  alternatives:string[];
}

export function withLocalEvidenceConsensus(evidence:OcrEvidenceSet):OcrEvidenceSet{
  const base=evidence.candidates.filter(candidate=>candidate.source!=='local-consensus');
  const synthesized:OcrEvidenceCandidate[]=[];
  const observations=[...evidence.observations];

  for(const raw of evidence.raw.tokens){
    const nearby=base.filter(candidate=>spatiallyRelated(raw.box,candidate.token.box));
    if(nearby.length<2)continue;

    const readings=nearby.flatMap(candidate=>expandReadings(candidate));
    const localAnchors=readings.filter(reading=>isLocalSource(reading.candidate.source));
    const clusters:ConsensusCluster[]=[];

    for(const anchor of localAnchors){
      if(normalize(anchor.text)===normalize(raw.text))continue;
      const peers=readings.filter(reading=>reading!==anchor&&supports(anchor,reading));
      const all=[anchor,...peers];
      const channels=[...new Set(all.map(reading=>reading.channel))];
      if(channels.length<2)continue;
      const localCount=[...new Set(all.filter(reading=>isLocalSource(reading.candidate.source)).map(reading=>reading.channel))].length;
      if(localCount<1)continue;

      const weighted=all.reduce((sum,reading)=>sum+reading.confidence*channelWeight(reading.candidate.source),0);
      const weight=all.reduce((sum,reading)=>sum+channelWeight(reading.candidate.source),0);
      const supportScore=Math.min(1,channels.length/3);
      const confidence=Math.min(98,Math.round(weighted/Math.max(.01,weight)+Math.min(6,(channels.length-1)*2)));
      const strongest=[...all].sort((a,b)=>readingAuthority(b)-readingAuthority(a))[0]!;
      const cluster:ConsensusCluster={
        raw,
        text:preferCanonicalText(anchor.text,strongest.text),
        confidence,
        box:{...anchor.candidate.token.box},
        channels,
        localCount,
        supportCount:all.length,
        supportScore,
        alternatives:[...new Set(all.map(reading=>reading.text))]
      };
      if(!clusters.some(existing=>normalize(existing.text)===normalize(cluster.text)))clusters.push(cluster);
    }

    const best=clusters
      .filter(cluster=>cluster.confidence>=84)
      .sort((a,b)=>clusterAuthority(b)-clusterAuthority(a))[0];
    if(!best)continue;

    synthesized.push({
      id:`local-consensus:${synthesized.length}`,
      source:'local-consensus',
      token:{
        ...cloneToken(best.raw),
        text:best.text,
        confidence:best.confidence,
        box:{...best.box},
        rawText:best.raw.rawText??best.raw.text,
        normalizedText:best.text.normalize('NFKC'),
        alternatives:[...new Set([...(best.raw.alternatives??[]),best.raw.text,...best.alternatives])],
        correctionReason:'local-evidence-consensus'
      },
      reason:`local consensus from ${best.channels.join(', ')}`,
      support:{
        channels:best.channels,
        count:best.supportCount,
        localCount:best.localCount,
        score:best.supportScore
      }
    });
    observations.push({
      source:'local-consensus',
      code:'LOCAL_EVIDENCE_CONSENSUS',
      message:`Token ${raw.id}: candidato "${best.text}" supportato da ${best.channels.join(', ')}.`,
      confidence:best.confidence/100
    });
  }

  return{
    raw:evidence.raw,
    candidates:[...base,...synthesized],
    observations
  };
}

function expandReadings(candidate:OcrEvidenceCandidate):Reading[]{
  const values=[candidate.token.text,...(candidate.token.alternatives??[])];
  const seen=new Set<string>();
  const output:Reading[]=[];
  for(const value of values){
    const text=value.trim();if(!text)continue;
    const key=normalize(text);if(seen.has(key))continue;seen.add(key);
    const confidence=Math.max(0,Math.min(100,(candidate.token.confidence??0)-(text===candidate.token.text?0:4)));
    output.push({candidate,text,confidence,channel:channelId(candidate)});
  }
  return output;
}

function supports(anchor:Reading,peer:Reading):boolean{
  if(anchor.channel===peer.channel)return false;
  if(anchor.candidate.source==='variant'&&peer.candidate.source==='variant')return false;
  if(!spatiallyRelated(anchor.candidate.token.box,peer.candidate.token.box))return false;
  const a=canonical(anchor.text),b=canonical(peer.text);
  if(a===b)return true;
  const familyA=semanticFamily(anchor.text),familyB=semanticFamily(peer.text);
  const structured=familyA==='money'||familyA==='numeric'||familyA==='date-time';
  if(structured&&(familyB==='money'||familyB==='numeric'||familyB==='date-time')){
    return normalizedSimilarity(a,b)>=.72;
  }
  if((familyA==='word'||familyA==='alnum')&&(familyB==='word'||familyB==='alnum')){
    return normalizedSimilarity(a,b)>=.82;
  }
  return false;
}

function spatiallyRelated(a:Box,b:Box):boolean{
  const ov=overlap(a,b);
  if(ov>=.18)return true;
  const vertical=verticalOverlap(a,b);
  if(vertical<.62)return false;
  const centerDistance=Math.abs(centerX(a)-centerX(b));
  const tolerance=Math.max(28,Math.max(a.width,b.width)*.72);
  return centerDistance<=tolerance;
}

function preferCanonicalText(localText:string,strongestText:string):string{
  const localFamily=semanticFamily(localText);
  if(localFamily==='money')return normalizeMoney(localText);
  if(localFamily==='date-time')return normalizeDateTime(localText);
  return readingAuthorityText(localText)>=readingAuthorityText(strongestText)?localText:strongestText;
}
function normalizeMoney(value:string):string{
  return value.trim().replace(/^€\s*/,'').replace('.',',').replace(/[;:]+$/,'');
}
function normalizeDateTime(value:string):string{
  return value.trim().replace(/[–—]/g,'-').replace(/\s+/g,' ');
}
function readingAuthority(reading:Reading):number{
  return reading.confidence/100+channelWeight(reading.candidate.source)+readingAuthorityText(reading.text)*.08;
}
function readingAuthorityText(value:string):number{
  const family=semanticFamily(value);
  if(family==='money'||family==='date-time')return 1;
  const alnum=(value.match(/[\p{L}\p{N}]/gu)??[]).length;
  return alnum/Math.max(1,[...value].length);
}
function clusterAuthority(cluster:ConsensusCluster):number{
  return cluster.confidence/100+cluster.channels.length*.05+cluster.localCount*.04+cluster.supportScore*.05;
}
function channelWeight(source:OcrEvidenceCandidate['source']):number{
  if(source==='critical-reocr')return 1.22;
  if(source==='recognizer-b-region')return 1.2;
  if(source==='recognizer-b')return 1.08;
  if(source==='targeted-reocr')return 1.15;
  if(source==='receipt-line')return 1.12;
  if(source==='receipt-amount')return 1.1;
  if(source==='variant')return .9;
  if(source==='receipt-finalizer')return .82;
  return 1.2;
}
function channelId(candidate:OcrEvidenceCandidate):string{
  if(candidate.source==='variant'){
    const match=candidate.reason.match(/ocr-variant:([^;\s]+)/i);
    return match?`variant:${match[1]}`:`variant:${candidate.reason}`;
  }
  return candidate.source;
}
function isLocalSource(source:OcrEvidenceCandidate['source']):boolean{
  return source==='receipt-line'||source==='receipt-amount'||source==='targeted-reocr'||source==='critical-reocr'||source==='recognizer-b-region';
}
function semanticFamily(value:string):'money'|'date-time'|'numeric'|'word'|'alnum'|'punctuation'|'mixed'{
  const text=value.trim();
  if(/^(?:€\s*)?\d{1,6}[.,]\d{2}[;:]?$/.test(text))return'money';
  if(/^\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?(?:\s+\d{1,2}:\d{2})?$/.test(text)||/^\d{1,2}:\d{2}$/.test(text))return'date-time';
  if(/^[\d.,:;%-]+$/.test(text))return'numeric';
  if(/^\p{L}+[\p{L}'’.!?-]*$/u.test(text))return'word';
  if(/^(?=.*\p{L})(?=.*\d)[\p{L}\d._:/-]+$/u.test(text))return'alnum';
  if(/^[^\p{L}\p{N}]+$/u.test(text))return'punctuation';
  return'mixed';
}
function canonical(value:string):string{
  const family=semanticFamily(value);
  if(family==='money')return normalizeMoney(value).replace(',','.');
  return normalize(value).replace(/[’']/g,"'").replace(/[–—]/g,'-').replace(/[.,:;!?]+$/,'');
}
function normalize(value:string){return value.normalize('NFKC').toUpperCase().replace(/\s+/g,'').trim();}
function normalizedSimilarity(a:string,b:string):number{
  const max=Math.max(a.length,b.length);if(!max)return 1;
  const prev=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i++){
    let diagonal=prev[0]!,left=i;prev[0]=i;
    for(let j=1;j<=b.length;j++){
      const up=prev[j]!;
      const value=Math.min(up+1,left+1,diagonal+(a[i-1]===b[j-1]?0:1));
      diagonal=up;prev[j]=value;left=value;
    }
  }
  return 1-prev[b.length]!/max;
}
function overlap(a:Box,b:Box):number{
  const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  if(right<=left||bottom<=top)return 0;
  return((right-left)*(bottom-top))/Math.max(1,Math.min(a.width*a.height,b.width*b.height));
}
function verticalOverlap(a:Box,b:Box):number{
  const top=Math.max(a.y,b.y),bottom=Math.min(a.y+a.height,b.y+b.height);
  return bottom<=top?0:(bottom-top)/Math.max(1,Math.min(a.height,b.height));
}
function centerX(box:Box){return box.x+box.width/2;}
function cloneToken(token:Readonly<OcrToken>):OcrToken{
  return{
    ...token,box:{...token.box},
    ...(token.normalizedBox?{normalizedBox:{...token.normalizedBox}}:{}),
    ...(token.alternatives?{alternatives:[...token.alternatives]}:{}),
    ...(token.characters?{characters:token.characters.map(character=>({...character,box:{...character.box}}))}:{})
  };
}
