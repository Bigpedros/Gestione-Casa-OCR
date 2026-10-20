import type {FieldCandidate,OcrPage,OcrToken,StructuralAnalysis,StructuralRegion} from '../../contracts.js';

export type OcrEvidenceSource='raw'|'variant'|'recognizer-b'|'recognizer-b-region'|'receipt-line'|'receipt-amount'|'targeted-reocr'|'critical-reocr'|'receipt-finalizer'|'local-consensus';

export interface NormalizedImageCheckpoint{
  pageNumber:number;
  width:number;
  height:number;
  photoRectified:boolean;
  orientationDegrees:0|90|180|270;
  deskewApplied:boolean;
  dewarpApplied:boolean;
  qualityScore:number|null;
}

export interface RawOcrSnapshot{
  pageNumber:number;
  width:number;
  height:number;
  text:string;
  tokens:ReadonlyArray<Readonly<OcrToken>>;
  warnings:ReadonlyArray<string>;
  page:Readonly<OcrPage>;
  fingerprint:string;
}

export interface OcrEvidenceSupport{
  channels:string[];
  count:number;
  localCount:number;
  score:number;
}
export interface OcrEvidenceCandidate{
  id:string;
  source:Exclude<OcrEvidenceSource,'raw'>;
  token:OcrToken;
  reason:string;
  support?:OcrEvidenceSupport;
}

export interface OcrEvidenceObservation{
  source:Exclude<OcrEvidenceSource,'raw'>;
  code:string;
  message:string;
  confidence:number|null;
}
export interface OcrEvidenceSet{
  raw:RawOcrSnapshot;
  candidates:OcrEvidenceCandidate[];
  observations:OcrEvidenceObservation[];
}

export interface OcrDecision{
  tokenId:string;
  selectedText:string;
  rawText:string;
  source:OcrEvidenceSource;
  reason:string;
  confidence:number|null;
  changed:boolean;
  primaryText?:string;
  secondaryText?:string;
  primaryConfidence?:number|null;
  secondaryConfidence?:number|null;
  decision?:string;
  tokenType?:string;
  geometryMatch?:number;
}

export interface DecisionSummary{
  total:number;
  keepPrimary:number;
  secondaryWins:number;
  consensus:number;
  unresolved:number;
  regionalRetrySuggested:number;
  changed:number;
}

export interface TokenMatchingDiagnostic{
  primaryTokenId:string;
  primaryText:string;
  primaryConfidence:number|null;
  secondaryCandidates:Array<{
    source:string;
    text:string;
    confidence:number|null;
    box:any;
    iou:number;
    verticalOverlap:number;
    horizontalDistance:number;
    acceptedAsMatch:boolean;
    rejectionReason:string;
  }>;
}

export interface StabilizedOcrCheckpoint{
  page:OcrPage;
  decisions:OcrDecision[];
  evidenceCount:number;
  observationCount:number;
  decisionSummary?:DecisionSummary;
  matchingDiagnostics?:TokenMatchingDiagnostic[];
  primaryReaderInfo?:{name:string;tokenCount:number;text:string;tokens:OcrToken[]};
  secondaryReaderInfo?:{name:string;tokenCount:number;text:string;tokens:OcrToken[]};
  variantReaderInfo?:{name:string;tokenCount:number;text:string;tokens:OcrToken[]};
}

export interface StructuredLineSnapshot{
  id:string;
  text:string;
  tokenIds:string[];
  tokens:OcrToken[];
}
export interface StructuredDocumentCheckpoint{
  pageNumber:number;
  width:number;
  height:number;
  className:StructuralAnalysis['class'];
  classConfidence:number;
  text:string;
  warnings:string[];
  nativePdfVerified:boolean;
  tokens:OcrToken[];
  lines:StructuredLineSnapshot[];
  regions:StructuralRegion[];
  fields:FieldCandidate[];
  readingOrder:string[];
  fingerprint:string;
  regionCount:number;
  fieldCount:number;
}
export interface ValidationCheckpoint{
  sourceFingerprint:string;
  resultCount:number;
  invalidCount:number;
  reviewRequired:boolean;
  issueCodes:string[];
}
export interface PagePipelineCheckpoints{
  normalizedImage:NormalizedImageCheckpoint;
  rawOcr:RawOcrSnapshot;
  stabilizedOcr:StabilizedOcrCheckpoint;
  structuredDocument:StructuredDocumentCheckpoint;
  validation?:ValidationCheckpoint;
}

export function createStructuredDocumentCheckpoint(page:OcrPage,structure:StructuralAnalysis):StructuredDocumentCheckpoint{
  const lines=new Map<string,OcrToken[]>();
  for(const token of page.tokens){
    const row=lines.get(token.lineId)??[];
    row.push(cloneToken(token));lines.set(token.lineId,row);
  }
  const lineSnapshots=[...lines.entries()].map(([id,tokens])=>{
    const ordered=[...tokens].sort((a,b)=>a.box.x-b.box.x);
    return{id,text:ordered.map(token=>token.text).join(' ').trim(),tokenIds:ordered.map(token=>token.id),tokens:ordered};
  }).sort((a,b)=>{
    const ay=Math.min(...a.tokens.map(token=>token.box.y));
    const by=Math.min(...b.tokens.map(token=>token.box.y));
    return ay-by;
  });
  return{
    pageNumber:page.pageNumber,width:page.width,height:page.height,
    className:structure.class,classConfidence:structure.confidence,
    text:page.text,warnings:[...page.warnings],
    nativePdfVerified:page.warnings.includes('NATIVE_PDF_LAYER_VERIFIED')&&page.tokens.every(token=>token.provenance==='native-pdf'),
    tokens:page.tokens.map(token=>cloneToken(token)),
    lines:lineSnapshots,
    regions:structure.regions.map(region=>({...region,box:{...region.box},evidence:[...region.evidence]})),
    fields:structure.fields.map(field=>({...field,box:{...field.box},evidence:[...field.evidence]})),
    readingOrder:[...(structure.readingOrder??[])],
    fingerprint:fingerprintOcrTokens(page.tokens),
    regionCount:structure.regions.length,fieldCount:structure.fields.length
  };
}

export function createNormalizedImageCheckpoint(page:OcrPage):NormalizedImageCheckpoint{
  return{
    pageNumber:page.pageNumber,
    width:page.width,
    height:page.height,
    photoRectified:!!page.photoScan?.applied,
    orientationDegrees:page.geometryCorrection?.orientationDegrees??0,
    deskewApplied:!!page.geometryCorrection?.deskewApplied,
    dewarpApplied:!!page.geometryCorrection?.dewarpApplied,
    qualityScore:page.quality?.score??null
  };
}

export function createRawOcrSnapshot(page:OcrPage):RawOcrSnapshot{
  const tokens=page.tokens.map(token=>freezeToken(cloneToken(token)));
  const pageClone=clonePage(page,tokens);
  const snapshot:RawOcrSnapshot={
    pageNumber:page.pageNumber,width:page.width,height:page.height,text:page.text,
    tokens:Object.freeze(tokens),
    warnings:Object.freeze([...page.warnings]),
    page:Object.freeze(pageClone),
    fingerprint:fingerprintOcrTokens(page.tokens)
  };
  return Object.freeze(snapshot);
}

export function createEvidenceSet(raw:RawOcrSnapshot):OcrEvidenceSet{
  return{raw,candidates:[],observations:[]};
}

export function addEvidenceObservation(
  evidence:OcrEvidenceSet,
  source:Exclude<OcrEvidenceSource,'raw'>,
  code:string,
  message:string,
  confidence:number|null=null
):void{
  evidence.observations.push({source,code,message,confidence});
}

export function addEvidenceTokens(
  evidence:OcrEvidenceSet,
  source:Exclude<OcrEvidenceSource,'raw'>,
  tokens:OcrToken[],
  reason:string
):void{
  for(const token of tokens){
    evidence.candidates.push({
      id:`${source}:${evidence.candidates.length}`,
      source,
      token:cloneToken(token),
      reason
    });
  }
}

function clonePage(page:OcrPage,tokens:ReadonlyArray<Readonly<OcrToken>>):OcrPage{
  return{
    ...page,
    tokens:tokens.map(token=>cloneToken(token)),
    warnings:[...page.warnings],
    ...(page.lines?{lines:page.lines.map(line=>({...line,box:{...line.box},normalizedBox:{...line.normalizedBox},tokenIds:[...line.tokenIds]}))}:{}),
    ...(page.blocks?{blocks:page.blocks.map(block=>({...block,box:{...block.box},normalizedBox:{...block.normalizedBox},lineIds:[...block.lineIds]}))}:{}),
    ...(page.photoScan?{photoScan:{...page.photoScan,corners:page.photoScan.corners?{
      topLeft:{...page.photoScan.corners.topLeft},topRight:{...page.photoScan.corners.topRight},
      bottomRight:{...page.photoScan.corners.bottomRight},bottomLeft:{...page.photoScan.corners.bottomLeft}
    }:undefined}}:{}),
    ...(page.quality?{quality:{...page.quality,warnings:[...page.quality.warnings]}}:{}),
    ...(page.geometryCorrection?{geometryCorrection:{...page.geometryCorrection}}:{}),
    ...(page.detectedRegions?{detectedRegions:page.detectedRegions.map(region=>({...region,box:{...region.box},evidence:[...region.evidence]}))}:{}),
    ...(page.variantEvidence?{variantEvidence:page.variantEvidence.map(evidence=>({...evidence,tokens:evidence.tokens.map(token=>cloneToken(token))}))}:{})
  };
}

function cloneToken(token:Readonly<OcrToken>):OcrToken{
  return{
    ...token,
    box:{...token.box},
    ...(token.normalizedBox?{normalizedBox:{...token.normalizedBox}}:{}),
    ...(token.alternatives?{alternatives:[...token.alternatives]}:{}),
    ...(token.characters?{characters:token.characters.map(character=>({...character,box:{...character.box}}))}:{})
  };
}
function freezeToken(token:OcrToken):Readonly<OcrToken>{
  Object.freeze(token.box);
  if(token.normalizedBox)Object.freeze(token.normalizedBox);
  if(token.alternatives)Object.freeze(token.alternatives);
  if(token.characters){for(const character of token.characters)Object.freeze(character.box);Object.freeze(token.characters);}
  return Object.freeze(token);
}
export function fingerprintOcrTokens(tokens:ReadonlyArray<Readonly<OcrToken>>):string{
  let hash=2166136261;
  const input=tokens.map(token=>`${token.id}|${token.text}|${token.box.x},${token.box.y},${token.box.width},${token.box.height}`).join('\n');
  for(let index=0;index<input.length;index++){hash^=input.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return(hash>>>0).toString(16).padStart(8,'0');
}

