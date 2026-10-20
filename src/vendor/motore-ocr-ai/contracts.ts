export type Provenance = 'native-pdf'|'ocr'|'geometry'|'structure'|'ai-suggestion'|'user-confirmed';

export interface Box { x:number; y:number; width:number; height:number }

export interface OcrToken {
  id:string; text:string; confidence:number|null; box:Box; normalizedBox?:Box; lineId:string;
  provenance:'native-pdf'|'ocr';
  rawText?:string; normalizedText?:string; alternatives?:string[]; correctionReason?:string;
  characters?:Array<{text:string;confidence:number|null;box:Box}>;
}

export interface PhotoScanInfo {
  applied:boolean; confidence:number; sourceWidth:number; sourceHeight:number;
  outputWidth:number; outputHeight:number;
  corners?:{
    topLeft:{x:number;y:number}; topRight:{x:number;y:number};
    bottomRight:{x:number;y:number}; bottomLeft:{x:number;y:number};
  };
  reason:string;
}

export interface QualityReport {
  sharpness:number;contrast:number;exposure:number;coverage:number;perspective:number;
  noise:number;glare:number;shadow:number;score:number;
  estimatedTextHeightPx?:number;estimatedEffectiveDpi?:number;
  decision:'continue'|'warning'|'reacquire';warnings:string[];
}
export interface GeometryCorrectionInfo{
  orientationDegrees:0|90|180|270;deskewDegrees:number;deskewApplied:boolean;
  residualSkewDegrees?:number;
  dewarpApplied:boolean;dewarpStrength:number;
  curvatureMaxDeviationPx?:number;curvatureMeanDeviationPx?:number;residualCurvatureMaxDeviationPx?:number;
  confidence:number;
}
export interface OcrLineGeometry{
  id:string;box:Box;normalizedBox:Box;tokenIds:string[];text:string;confidence:number;
}
export interface OcrBlockGeometry{
  id:string;box:Box;normalizedBox:Box;lineIds:string[];text:string;confidence:number;
}
export interface OcrProviderVariantEvidence{
  source:string; score:number; confidence:number|null; tokens:OcrToken[];
}
export interface OcrPage {
  pageNumber:number; width:number; height:number; text:string; tokens:OcrToken[]; warnings:string[];
  lines?:OcrLineGeometry[];blocks?:OcrBlockGeometry[];
  photoScan?:PhotoScanInfo; quality?:QualityReport; geometryCorrection?:GeometryCorrectionInfo;
  detectedRegions?:StructuralRegion[];
  variantEvidence?:OcrProviderVariantEvidence[];
}

export interface GeometryTransform {
  sourceWidth:number; sourceHeight:number; targetWidth:number; targetHeight:number;
  scale:number; offsetX:number; offsetY:number; deskewDegrees:number;
  deskewApplied:boolean; canonical:'A4'|'source';
}

export type RegionKind=
  'cell'|'checkbox'|'radio'|'underline'|'whitespace'|'text-block'|'paragraph'|'title'|'header'|'footer'|
  'table'|'table-row'|'column'|'signature'|'stamp'|'image'|'form-section'|'label'|'value';

export interface StructuralRegion {
  id:string; kind:RegionKind; box:Box; normalizedBox?:Box; confidence:number; evidence:string[];
  state?:'checked'|'unchecked'|'ambiguous'; parentId?:string; groupId?:string; text?:string;
}

export interface FieldCandidate {
  id:string; pageNumber:number; box:Box; label:string|null;
  type:'text'|'textarea'|'date'|'checkbox'|'select'|'unknown';
  confidence:number; sourceRegionId?:string; semanticKey?:string;
  provenance:'structure'; evidence:string[];
}

export type StructuralClass =
  | 'blank-form'
  | 'filled-form'
  | 'receipt'
  | 'invoice'
  | 'contract'
  | 'book-page'
  | 'letter'
  | 'generic-document'
  | 'unknown';

export interface StructuralAnalysis {
  class:StructuralClass; confidence:number; regions:StructuralRegion[];
  fields:FieldCandidate[]; evidence:string[]; readingOrder?:string[];
}

export interface ValidationIssue{code:string;severity:'info'|'warning'|'error';message:string}
export interface FieldValidation{
  tokenId:string|null;kind:string;raw:string;normalized:string;valid:boolean;confidence:number;issues:ValidationIssue[];
}
export interface ConfidenceProfile{
  imageQuality:number;detection:number;recognition:number;consensus:number;semantic:number;crossField:number;
  final:number;class:'green'|'yellow'|'red';needsReview:boolean;
  lineConfidence?:Array<{lineId:string;confidence:number}>;
  regionConfidence?:Array<{regionId:string;confidence:number}>;
  calibrationSource?:'default'|'corpus';
}
export interface AuditStage{stage:string;status:string;details:Record<string,unknown>}
export interface Diagnostic {
  level:'info'|'warning'|'error'; code:string; message:string; blocking:boolean;
}

export interface EnginePageResult {
  ocr:OcrPage; transform:GeometryTransform; structure:StructuralAnalysis;
  validations?:FieldValidation[]; confidence?:ConfidenceProfile; audit?:AuditStage[];
  pipeline?:import('./core/pipeline/checkpoints.js').PagePipelineCheckpoints;
}

export interface EngineDocumentResult {
  schemaVersion:'3.0'; engineVersion:string; pages:EnginePageResult[];
  diagnostics:Diagnostic[];
  aiSuggestions:any[];
  reconstruction?:any;
  audit?:{documentHash:string;pages:Array<{pageNumber:number;stages:AuditStage[]}>};
  diagnosticBundle?:any[];
}
