import type {Box,OcrPage,OcrToken} from '../../contracts.js';
import type {OcrDecision,OcrEvidenceCandidate,OcrEvidenceSet,StabilizedOcrCheckpoint,DecisionSummary,TokenMatchingDiagnostic} from './checkpoints.js';
import {withLocalEvidenceConsensus} from './localEvidenceResolver.js';

export const DECISION_ENGINE_VERSION = "DE-RUNTIME-DIAG-2";

export function stabilizeOcrPage(evidence:OcrEvidenceSet):StabilizedOcrCheckpoint{
  const resolved=withLocalEvidenceConsensus(evidence);
  const rawTokens=resolved.raw.tokens.map(token=>cloneToken(token));
  const decisions:OcrDecision[]=[];
  const selected:OcrToken[]=[];
  const matchingDiagnostics:TokenMatchingDiagnostic[]=[];

  const secondaryCandidatesList=resolved.candidates.filter(c=>c.source==='recognizer-b'||c.source==='recognizer-b-region');
  const variantCandidatesList=resolved.candidates.filter(c=>c.source==='variant');
  const secondaryTokens=secondaryCandidatesList.map(c=>c.token);
  const variantTokens=variantCandidatesList.map(c=>c.token);

  const secondaryReaderInfo={
    name:'ocrs-rten-wasm',
    tokenCount:secondaryTokens.length,
    text:secondaryTokens.map(t=>t.text).join(' '),
    tokens:secondaryTokens
  };
  const variantReaderInfo={
    name:'tesseract-variant',
    tokenCount:variantTokens.length,
    text:variantTokens.map(t=>t.text).join(' '),
    tokens:variantTokens
  };
  const primaryReaderInfo={
    name:'tesseract-local',
    tokenCount:rawTokens.length,
    text:resolved.raw.text,
    tokens:rawTokens
  };

  for(const raw of rawTokens){
    const tokenType=classifyTokenType(raw.text);

    // Diagnostic collection for Phase 3 (Matching)
    const secondaryCandidatesDiag=resolved.candidates.map(candidate=>{
      const iou=overlap(raw.box,candidate.token.box);
      const vert=verticalOverlap(raw.box,candidate.token.box);
      const hdist=horizontalGap(raw.box,candidate.token.box);
      const isCompat=compatible(raw,candidate.token);
      let rejReason='';
      if(!isCompat){
        if(iou<=0.3&&vert<=0.75) rejReason='failed-spatial-overlap-and-vertical-threshold';
        else rejReason='failed-compatibility-gate';
      }else{
        rejReason='accepted-compatibility-passed';
      }
      return{
        source:candidate.source,
        text:candidate.token.text,
        confidence:candidate.token.confidence,
        box:candidate.token.box,
        iou,
        verticalOverlap:vert,
        horizontalDistance:hdist,
        acceptedAsMatch:isCompat,
        rejectionReason:rejReason
      };
    });

    matchingDiagnostics.push({
      primaryTokenId:raw.id,
      primaryText:raw.text,
      primaryConfidence:raw.confidence,
      secondaryCandidates:secondaryCandidatesDiag
    });

    const candidates=resolved.candidates
      .filter(candidate=>compatible(raw,candidate.token))
      .map(candidate=>({candidate,score:candidateAuthority(candidate,raw)}))
      .sort((a,b)=>b.score-a.score);

    const rawScore=rawAuthority(raw);
    const rawSuspicious=isSuspicious(raw.text)||((raw.confidence??0)<62);
    const rejectedBest=candidates[0];

    // PRINCIPIO VINCOLANTE: Il consenso deve essere possibile solamente tra fonti realmente indipendenti (es. tesseract-local vs recognizer-b), NON con una variante derivata dallo stesso reader primario.
    const consensusCandidate=candidates.find(item=>
      !isMeaninglessUncertain(raw.text)&&
      normalize(item.candidate.token.text)===normalize(raw.text)&&
      isIndependentSource(item.candidate.source)
    );

    const eligible=candidates.find(item=>replacementAllowed(raw,item.candidate,item.score,rawScore,rawSuspicious,candidates.map(entry=>entry.candidate),tokenType,resolved.candidates));

    const geomMatch=rejectedBest?overlap(raw.box,rejectedBest.candidate.token.box):0;
    const isUncertainRaw=isMeaninglessUncertain(raw.text);

    if(consensusCandidate){
      const token=consensusCandidate.candidate.token;
      selected.push({
        ...cloneToken(raw),
        text:token.text,
        confidence:Math.max(raw.confidence??0,token.confidence??0),
        rawText:raw.rawText??raw.text,
        normalizedText:token.text.normalize('NFKC'),
        alternatives:[...new Set([...(raw.alternatives??[]),raw.text,token.text])],
        correctionReason:`decision-engine:consensus`
      });
      decisions.push({
        tokenId:raw.id,
        selectedText:raw.text,
        rawText:raw.rawText??raw.text,
        source:'raw',
        reason:'consensus-between-independent-sources',
        confidence:Math.max(raw.confidence??0,token.confidence??0),
        changed:false,
        primaryText:raw.text,
        secondaryText:token.text,
        primaryConfidence:raw.confidence,
        secondaryConfidence:token.confidence,
        decision:'consensus',
        tokenType,
        geometryMatch:consensusCandidate.score
      });
    }else if(eligible){
      const token=eligible.candidate.token;
      selected.push({
        ...cloneToken(raw),
        text:token.text,
        confidence:token.confidence,
        rawText:raw.rawText??raw.text,
        normalizedText:token.text.normalize('NFKC'),
        alternatives:[...new Set([...(raw.alternatives??[]),raw.text,token.text])],
        correctionReason:`decision-engine:${eligible.candidate.source}:${eligible.candidate.reason}`
      });
      decisions.push({
        tokenId:raw.id,
        selectedText:token.text,
        rawText:raw.rawText??raw.text,
        source:eligible.candidate.source,
        reason:eligible.candidate.reason,
        confidence:token.confidence,
        changed:true,
        primaryText:raw.text,
        secondaryText:token.text,
        primaryConfidence:raw.confidence,
        secondaryConfidence:token.confidence,
        decision:'secondary-wins',
        tokenType,
        geometryMatch:eligible.score
      });
    }else{
      const rawConf=raw.confidence??0;
      const bestConf=rejectedBest?.candidate.token.confidence??0;
      const isUncertain=rawSuspicious||rawConf<55||isMalformedMoneyOrPercentage(raw.text)||isUncertainRaw;
      const isRetryNeeded=isUncertain&&(rawConf<50&&bestConf<50);
      const decisionType=isRetryNeeded?'NEEDS_REGIONAL_RETRY':(rejectedBest?'primary-wins':'unresolved');
      const rejectedDestructive=!!rejectedBest&&isDestructiveTransformation(raw.text,rejectedBest.candidate.token.text);

      selected.push(cloneToken(raw));
      decisions.push({
        tokenId:raw.id,
        selectedText:raw.text,
        rawText:raw.rawText??raw.text,
        source:'raw',
        reason:rejectedBest?(rejectedDestructive?'destructive-candidate-rejected':'candidate-below-decision-margin'):'no-candidate',
        confidence:raw.confidence,
        changed:false,
        primaryText:raw.text,
        secondaryText:rejectedBest?rejectedBest.candidate.token.text:'',
        primaryConfidence:raw.confidence,
        secondaryConfidence:rejectedBest?rejectedBest.candidate.token.confidence:null,
        decision:decisionType,
        tokenType,
        geometryMatch:geomMatch
      });
    }
  }

  // Nuova evidenza corroborata da fonti indipendenti
  const processedNovel=new Set<string>();
  for(const candidate of resolved.candidates){
    if(!isIndependentSource(candidate.source))continue;
    const novelKey=`${candidate.source}|${normalize(candidate.token.text)}|${Math.round(candidate.token.box.x/12)}|${Math.round(candidate.token.box.y/12)}`;
    if(processedNovel.has(novelKey))continue;
    processedNovel.add(novelKey);
    if(selected.some(token=>compatible(token,candidate.token)))continue;
    if((candidate.token.confidence??0)<92||isSuspicious(candidate.token.text))continue;
    const lineId=nearestLine(selected,candidate.token.box);
    if(!lineId)continue;
    if(isCriticalNovelValue(candidate.token.text)&&!hasIndependentCorroboration(candidate,resolved.candidates))continue;
    if(hasNearbyConflict(selected,candidate.token))continue;
    selected.push({...cloneToken(candidate.token),id:`p${resolved.raw.pageNumber}-stabilized-${selected.length}`,lineId});
    decisions.push({
      tokenId:selected.at(-1)!.id,
      selectedText:candidate.token.text,
      rawText:'',
      source:candidate.source,
      reason:`new-corroborated-evidence:${candidate.reason}`,
      confidence:candidate.token.confidence,
      changed:true,
      primaryText:'',
      secondaryText:candidate.token.text,
      primaryConfidence:null,
      secondaryConfidence:candidate.token.confidence,
      decision:'secondary-wins',
      tokenType:classifyTokenType(candidate.token.text),
      geometryMatch:1
    });
  }

  const compacted=suppressSupersededOverlaps(selected,decisions);
  compacted.tokens.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);

  const decisionSummary:DecisionSummary={
    total:rawTokens.length,
    keepPrimary:compacted.decisions.filter(d=>!d.changed&&d.decision==='primary-wins').length,
    secondaryWins:compacted.decisions.filter(d=>d.changed&&d.decision==='secondary-wins').length,
    consensus:compacted.decisions.filter(d=>!d.changed&&d.decision==='consensus').length,
    unresolved:compacted.decisions.filter(d=>d.decision==='unresolved'||d.decision==='NEEDS_REGIONAL_RETRY').length,
    regionalRetrySuggested:compacted.decisions.filter(d=>d.decision==='NEEDS_REGIONAL_RETRY').length,
    changed:compacted.decisions.filter(d=>d.changed).length
  };

  const problematicKeywords=['CAFFE','IVA','PAGAMENTO ELETTRONICO','IMPORTO PAGATO'];
  const problematicDecisions=compacted.decisions.filter(d=>{
    const upper=(d.primaryText??'').toUpperCase();
    return problematicKeywords.some(kw=>upper.includes(kw));
  });

  const page:OcrPage={
    ...clonePageMetadata(resolved.raw.page),
    pageNumber:resolved.raw.pageNumber,
    width:resolved.raw.width,
    height:resolved.raw.height,
    text:rebuildText(compacted.tokens),
    tokens:compacted.tokens,
    warnings:[
      ...resolved.raw.warnings,
      `DECISION_ENGINE_VERSION:${DECISION_ENGINE_VERSION}`,
      `PIPELINE_EVIDENCE:${resolved.candidates.length}`,
      `PIPELINE_DECISIONS_CHANGED:${decisionSummary.changed}`,
      `PIPELINE_SUPERSEDED_SUPPRESSED:${compacted.suppressed}`,
      `PIPELINE_LOCAL_CONSENSUS:${resolved.candidates.filter(candidate=>candidate.source==='local-consensus').length}`,
      `PIPELINE_DECISION_SUMMARY:consensus=${decisionSummary.consensus},secondary=${decisionSummary.secondaryWins},keepPrimary=${decisionSummary.keepPrimary},unresolved=${decisionSummary.unresolved}`,
      `DIAGNOSTIC_PROBLEM_POINTS_CHECKED:${problematicDecisions.length}`,
      'PIPELINE_DECISION_ENGINE:V4_7E_DUAL_RECOGNIZER_DIAG_V2'
    ]
  };
  return{page,decisions:compacted.decisions,evidenceCount:resolved.candidates.length,observationCount:resolved.observations.length,decisionSummary,matchingDiagnostics,primaryReaderInfo,secondaryReaderInfo,variantReaderInfo};
}

function isIndependentSource(source:string):boolean{
  return source==='recognizer-b'||source==='recognizer-b-region'||source==='critical-reocr'||source==='targeted-reocr'||source==='local-consensus';
}

function isMeaninglessUncertain(value:string):boolean{
  const text=value.trim();
  return text==='??'||text==='?'||text==='';
}

function replacementAllowed(
  raw:OcrToken,
  candidate:OcrEvidenceCandidate,
  score:number,
  rawScore:number,
  rawSuspicious:boolean,
  peers:OcrEvidenceCandidate[],
  tokenType:'money'|'percentage'|'numeric'|'date-time'|'word'|'alnum'|'punctuation'|'mixed',
  allCandidates:OcrEvidenceCandidate[]
):boolean{
  const changed=normalize(raw.text)!==normalize(candidate.token.text);
  if(!changed)return false;

  const reconciliation=isReceiptReconciliation(candidate);
  const lexicalRegression=isLexicalRegression(raw,candidate.token);
  if(lexicalRegression&&!reconciliation)return false;

  const isMoneyOrPercentage=tokenType==='money'||tokenType==='percentage';
  const isMalformed=isMalformedMoneyOrPercentage(raw.text)||isMoneyOrPercentage;
  const isCleanCandidate=isCleanMoneyOrPercentage(candidate.token.text);
  const coreA=raw.text.replace(/[^\p{L}\p{N}]/gu,'');
  const coreB=candidate.token.text.replace(/[^\p{L}\p{N}]/gu,'');
  const isPunctuationCleanup=coreA.length>0&&coreA===coreB;

  // Variant sources must not override primary unless supported by independent source or strict reconciliation
  const isVariantCandidate=candidate.source==='variant';

  if((isMalformed&&isCleanCandidate)||isPunctuationCleanup){
    const geom=overlap(raw.box,candidate.token.box);
    const vert=verticalOverlap(raw.box,candidate.token.box);
    if(geom>=.15||vert>=.72){
      if(isIndependentSource(candidate.source)||hasIndependentCorroboration(candidate,allCandidates)){
        return true;
      }
    }
  }

  if(isVariantCandidate&&!hasIndependentCorroboration(candidate,allCandidates))return false;

  const destructive=isDestructiveTransformation(raw.text,candidate.token.text);
  if(candidate.source==='local-consensus'){
    const support=candidate.support;
    if(!support||support.count<2||support.localCount<1)return false;
    if((candidate.token.confidence??0)<82)return false;
    if(destructive)return score>=rawScore+.03;
    if(score>=rawScore+.05)return true;
    return rawSuspicious&&score>=rawScore+.02;
  }
  if(destructive){
    if(candidate.source==='receipt-finalizer'){
      return reconciliation&&(candidate.token.confidence??0)>=90;
    }
    if(candidate.source==='variant'){
      if(!hasIndependentCorroboration(candidate,peers))return false;
      return score>=rawScore+.06&&(candidate.token.confidence??0)>=85;
    }
    if(!isLocalEvidence(candidate.source))return false;
    if(!hasIndependentCorroboration(candidate,peers))return false;
    return (candidate.token.confidence??0)>=88&&score>=rawScore+.06;
  }

  if(isIndependentSource(candidate.source)&&score>=rawScore+.08)return true;
  if(score>=rawScore+.12)return true;
  return rawSuspicious&&score>=.72&&score>=rawScore+.04;
}

function classifyTokenType(value:string):'money'|'percentage'|'numeric'|'date-time'|'word'|'alnum'|'punctuation'|'mixed'{
  const text=value.trim();
  if(/^(?:€\s*)?\d{1,6}[.,]\d{2}%?$/.test(text)||/^\d{1,6}[.,]\d{2}$/.test(text))return'money';
  if(/^\d{1,3}[.,]?\d*%$/.test(text)||text.endsWith('%'))return'percentage';
  if(/^\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?(?:\s+\d{1,2}:\d{2})?$/.test(text)||/^\d{1,2}:\d{2}$/.test(text))return'date-time';
  if(/^[\d.,:;%-]+$/.test(text))return'numeric';
  if(/^\p{L}+[\p{L}'’.!?-]*$/u.test(text))return'word';
  if(/^(?=.*\p{L})(?=.*\d)[\p{L}\d._:/-]+$/u.test(text))return'alnum';
  if(/^[^\p{L}\p{N}]+$/u.test(text))return'punctuation';
  return'mixed';
}

function isMalformedMoneyOrPercentage(value:string):boolean{
  const text=value.trim();
  if(/^\d{3,6}$/.test(text))return true;
  if(/^\d+[,.]?%$/.test(text))return true;
  if(/[O0-9]{3,}[.,][O0-9]{2}/.test(text))return true;
  return false;
}

function isCleanMoneyOrPercentage(value:string):boolean{
  const text=value.trim();
  return /^(?:€\s*)?\d{1,6}[.,]\d{2}%?$/.test(text)||/^\d{1,3}[.,]\d{2}\s*%$/.test(text);
}

function isReceiptReconciliation(candidate:OcrEvidenceCandidate):boolean{
  return candidate.source==='receipt-finalizer'&&
    /receipt-evidence:(?:TOTAL_SUM_RECONCILIATION|VAT_RECONCILIATION|PAYMENT_TOTAL_RECONCILIATION)/.test(candidate.token.correctionReason??'');
}

function isLexicalRegression(raw:OcrToken,candidate:OcrToken):boolean{
  const a=raw.text.trim(),b=candidate.text.trim();
  if(!a||!b)return false;
  const rawLetters=(a.match(/\p{L}/gu)??[]).length;
  const nextLetters=(b.match(/\p{L}/gu)??[]).length;
  const rawDigits=(a.match(/\d/g)??[]).length;
  const nextDigits=(b.match(/\d/g)??[]).length;
  const similarity=normalizedSimilarity(normalize(a),normalize(b));
  if(rawLetters>=4&&rawDigits===0&&nextDigits>0)return true;
  if(rawLetters>=5&&nextLetters<rawLetters*.68&&similarity<.72)return true;
  if((raw.confidence??0)>=80&&rawLetters>=5&&similarity<.58)return true;
  if(!/\s/.test(a)&&/\s/.test(b)&&rawLetters>=4&&nextDigits>rawDigits)return true;
  return false;
}

function isDestructiveTransformation(raw:string,candidate:string):boolean{
  const a=normalize(raw),b=normalize(candidate);
  if(!a||!b||a===b)return false;
  const familyA=semanticFamily(raw),familyB=semanticFamily(candidate);
  if(familyA!==familyB){
    const bothLexical=(familyA==='word'||familyA==='alnum')&&(familyB==='word'||familyB==='alnum');
    if(!bothLexical)return true;
  }
  const similarity=normalizedSimilarity(a,b);
  if(similarity<.45)return true;
  const rawLetters=(a.match(/[A-ZÀ-Ý]/g)??[]).length,rawDigits=(a.match(/\d/g)??[]).length;
  const nextLetters=(b.match(/[A-ZÀ-Ý]/g)??[]).length,nextDigits=(b.match(/\d/g)??[]).length;
  if(rawLetters>0&&rawDigits>0&&nextDigits>=Math.max(2,nextLetters*2)&&similarity<.7)return true;
  if(rawDigits===0&&rawLetters>0&&nextDigits>=2&&nextLetters===0)return true;
  return false;
}

function semanticFamily(value:string):'money'|'date-time'|'numeric'|'word'|'alnum'|'punctuation'|'mixed'{
  const text=value.trim();
  if(/^(?:€\s*)?\d{1,6}[.,]\d{2}%?$/.test(text))return'money';
  if(/^\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?(?:\s+\d{1,2}:\d{2})?$/.test(text)||/^\d{1,2}:\d{2}$/.test(text))return'date-time';
  if(/^[\d.,:;%-]+$/.test(text))return'numeric';
  if(/^\p{L}+[\p{L}'’.!?-]*$/u.test(text))return'word';
  if(/^(?=.*\p{L})(?=.*\d)[\p{L}\d._:/-]+$/u.test(text))return'alnum';
  if(/^[^\p{L}\p{N}]+$/u.test(text))return'punctuation';
  return'mixed';
}

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

function isLocalEvidence(source:OcrEvidenceCandidate['source']):boolean{
  return source==='receipt-line'||source==='receipt-amount'||source==='targeted-reocr'||source==='critical-reocr'||source==='recognizer-b-region'||source==='local-consensus';
}

function hasIndependentCorroboration(candidate:OcrEvidenceCandidate,peers:OcrEvidenceCandidate[]):boolean{
  return peers.some(peer=>{
    if(peer===candidate)return false;
    if(peer.source===candidate.source)return false;
    if(candidate.source==='variant'&&peer.source==='variant')return false;
    if(normalize(peer.token.text)!==normalize(candidate.token.text))return false;
    return overlap(peer.token.box,candidate.token.box)>.4||
      (verticalOverlap(peer.token.box,candidate.token.box)>.7&&horizontalGap(peer.token.box,candidate.token.box)<Math.max(20,candidate.token.box.height*.6));
  });
}

function isCriticalNovelValue(value:string):boolean{
  const family=semanticFamily(value);
  return family==='money'||family==='numeric'||family==='date-time'||family==='alnum';
}

function hasNearbyConflict(tokens:OcrToken[],candidate:OcrToken):boolean{
  return tokens.some(token=>{
    if(token.lineId!==candidate.lineId)return false;
    if(overlap(token.box,candidate.box)>.18)return true;
    const vertical=verticalOverlap(token.box,candidate.box);
    const gap=horizontalGap(token.box,candidate.box);
    return vertical>.7&&gap<Math.max(12,Math.min(token.box.height,candidate.box.height)*.3);
  });
}

function suppressSupersededOverlaps(tokens:OcrToken[],decisions:OcrDecision[]):{tokens:OcrToken[];decisions:OcrDecision[];suppressed:number}{
  const removed=new Set<string>();
  const nextDecisions=[...decisions];
  const corrected=tokens.filter(token=>token.correctionReason?.startsWith('decision-engine:'));
  for(const winner of corrected){
    if(removed.has(winner.id))continue;
    for(const candidate of tokens){
      if(candidate.id===winner.id||removed.has(candidate.id))continue;
      if(candidate.lineId!==winner.lineId)continue;
      const geometricRelation=overlap(candidate.box,winner.box)>=.3||
        (verticalOverlap(candidate.box,winner.box)>=.7&&Math.abs(centerX(candidate.box)-centerX(winner.box))<=Math.max(candidate.box.width,winner.box.width)*.6);
      if(!geometricRelation)continue;
      const same=normalize(candidate.text)===normalize(winner.text);
      const numericConflict=isNumericLike(candidate.text)&&isNumericLike(winner.text);
      const candidateDecision=nextDecisions.find(decision=>decision.tokenId===candidate.id);
      if(candidateDecision?.source!=='raw'&&!same)continue;
      if(!same&&!numericConflict)continue;
      removed.add(candidate.id);
      const index=nextDecisions.findIndex(decision=>decision.tokenId===candidate.id);
      if(index>=0)nextDecisions[index]={
        ...nextDecisions[index]!,
        selectedText:'',
        source:candidateDecision?.source??'raw',
        reason:'suppressed-overlap-conflict',
        changed:true
      };
    }
  }
  return{tokens:tokens.filter(token=>!removed.has(token.id)),decisions:nextDecisions,suppressed:removed.size};
}
function isNumericLike(value:string):boolean{
  return /^[€\s]*[\d.,:;%-]+$/.test(value.trim());
}
function centerX(box:Box){return box.x+box.width/2;}

function candidateAuthority(candidate:OcrEvidenceCandidate,raw:OcrToken):number{
  const confidence=Math.max(0,Math.min(100,candidate.token.confidence??0))/100;
  const chars=characterAuthority(candidate.token);
  const plausibility=textPlausibility(candidate.token.text);
  const geometry=Math.max(0,Math.min(1,overlap(raw.box,candidate.token.box)));
  const sourceWeight=candidate.source==='local-consensus' ? .15 : candidate.source==='critical-reocr' ? .14 : candidate.source==='recognizer-b-region' ? .13 : candidate.source==='recognizer-b' ? .12 : candidate.source==='receipt-finalizer' ? .11 : candidate.source==='targeted-reocr' ? .1 : candidate.source==='receipt-line' ? .09 : candidate.source==='receipt-amount' ? .08 : candidate.source==='variant' ? .02 : .04;
  return Math.max(0,Math.min(1,confidence*.42+chars*.18+plausibility*.18+geometry*.15+sourceWeight*.06));
}
function rawAuthority(token:OcrToken):number{
  const confidence=Math.max(0,Math.min(100,token.confidence??0))/100;
  return Math.max(0,Math.min(1,confidence*.48+characterAuthority(token)*.2+textPlausibility(token.text)*.2+.08));
}
function characterAuthority(token:OcrToken):number{
  const values=(token.characters??[]).map(character=>character.confidence).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  if(!values.length)return Math.max(0,Math.min(100,token.confidence??0))/100;
  return values.reduce((sum,value)=>sum+Math.max(0,Math.min(100,value)),0)/(values.length*100);
}
function textPlausibility(value:string):number{
  const text=value.trim();if(!text)return 0;
  const alnum=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  let score=.35+.55*(alnum/Math.max(1,[...text].length));
  if(/[{}[\]\\|]{2,}/.test(text))score-=.35;
  if(text.length<=4&&/[a-zà-ÿ]/.test(text)&&/[A-ZÀ-Ý]/.test(text))score-=.18;
  if(/^[A-Za-zÀ-ÿ]{1,3}-?\d+[A-Za-zÀ-ÿ]+$/.test(text))score-=.25;
  return Math.max(0,Math.min(1,score));
}
function isSuspicious(value:string){return textPlausibility(value)<.58;}
function compatible(a:OcrToken,b:OcrToken):boolean{
  const ov=overlap(a.box,b.box);
  if(ov>.3)return true;
  const vertical=verticalOverlap(a.box,b.box);
  const gap=horizontalGap(a.box,b.box);
  return vertical>.75&&gap<Math.max(20,Math.min(a.box.height,b.box.height)*.5);
}
function nearestLine(tokens:OcrToken[],box:Box):string|undefined{
  const grouped=new Map<string,OcrToken[]>();
  for(const token of tokens){const row=grouped.get(token.lineId)??[];row.push(token);grouped.set(token.lineId,row);}
  const cy=box.y+box.height/2;
  const ranked=[...grouped].map(([lineId,line])=>{
    const top=Math.min(...line.map(token=>token.box.y)),bottom=Math.max(...line.map(token=>token.box.y+token.box.height));
    return{lineId,distance:Math.abs((top+bottom)/2-cy)};
  }).sort((a,b)=>a.distance-b.distance);
  if(!ranked.length||ranked[0]!.distance>Math.max(50,box.height*1.2))return undefined;
  return ranked[0]!.lineId;
}
function rebuildText(tokens:OcrToken[]):string{
  const lines=new Map<string,OcrToken[]>();
  for(const token of tokens){const row=lines.get(token.lineId)??[];row.push(token);lines.set(token.lineId,row);}
  return[...lines.values()]
    .sort((a,b)=>Math.min(...a.map(token=>token.box.y))-Math.min(...b.map(token=>token.box.y)))
    .map(line=>[...line].sort((a,b)=>a.box.x-b.box.x).map(token=>token.text).join(' '))
    .join('\n');
}
function clonePageMetadata(page:Readonly<OcrPage>):OcrPage{
  return{
    ...page,
    tokens:[],
    warnings:[...page.warnings],
    ...(page.lines?{lines:page.lines.map(line=>({...line,box:{...line.box},normalizedBox:{...line.normalizedBox},tokenIds:[...line.tokenIds]}))}:{}),
    ...(page.blocks?{blocks:page.blocks.map(block=>({...block,box:{...block.box},normalizedBox:{...block.normalizedBox},lineIds:[...block.lineIds]}))}:{}),
    ...(page.photoScan?{photoScan:{...page.photoScan,corners:page.photoScan.corners?{
      topLeft:{...page.photoScan.corners.topLeft},topRight:{...page.photoScan.corners.topRight},
      bottomRight:{...page.photoScan.corners.bottomRight},bottomLeft:{...page.photoScan.corners.bottomLeft}
    }:undefined}}:{}),
    ...(page.quality?{quality:{...page.quality,warnings:[...page.quality.warnings]}}:{}),
    ...(page.geometryCorrection?{geometryCorrection:{...page.geometryCorrection}}:{}),
    ...(page.detectedRegions?{detectedRegions:page.detectedRegions.map(region=>({...region,box:{...region.box},evidence:[...region.evidence]}))}:{})
  };
}

function cloneToken(token:Readonly<OcrToken>):OcrToken{
  return{
    ...token,box:{...token.box},
    ...(token.normalizedBox?{normalizedBox:{...token.normalizedBox}}:{}),
    ...(token.alternatives?{alternatives:[...token.alternatives]}:{}),
    ...(token.characters?{characters:token.characters.map(character=>({...character,box:{...character.box}}))}:{})
  };
}
function normalize(value:string){return value.normalize('NFKC').toUpperCase().replace(/\s+/g,'').trim();}
function overlap(a:Box,b:Box):number{
  const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  if(right<=left||bottom<=top)return 0;
  return((right-left)*(bottom-top))/Math.max(1,Math.min(a.width*a.height,b.width*b.height));
}
function verticalOverlap(a:Box,b:Box):number{
  const top=Math.max(a.y,b.y),bottom=Math.min(a.y+a.height,b.y+b.height);
  return bottom<=top?0:(bottom-top)/Math.max(1,Math.min(a.height,b.height));
}
function horizontalGap(a:Box,b:Box):number{
  if(a.x<=b.x+b.width&&b.x<=a.x+a.width)return 0;
  return a.x+a.width<b.x?b.x-(a.x+a.width):a.x-(b.x+b.width);
}
