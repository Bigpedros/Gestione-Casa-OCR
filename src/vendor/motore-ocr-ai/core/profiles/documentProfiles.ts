import type {StructuralClass} from '../../contracts.js';

export type CoreProfileId='generic'|'receipt'|'structured-form';

export interface OcrProfilePolicy{
  id:CoreProfileId;
  canonical:'source'|'A4';
  dewarp:'none'|'light'|'strong';
  retryLimit:number;
  enableReceiptLines:boolean;
  enableReceiptAmounts:boolean;
  enableCriticalRegions:boolean;
  enableIndependentRegional:boolean;
  enableGenericRegional:boolean;
  multipageRetryLimit:number;
  stopAggressiveness:'fast'|'balanced'|'strict';
}

export interface DocumentProfile{
  id:string;
  coreProfile:CoreProfileId;
  preprocessing:string[];
  validators:string[];
  layoutFocus:string[];
  dewarp:'none'|'light'|'strong';
  policy:OcrProfilePolicy;
}

const CORE_POLICIES:Record<CoreProfileId,OcrProfilePolicy>={
  generic:{
    id:'generic',canonical:'source',dewarp:'light',
    retryLimit:4,multipageRetryLimit:1,
    enableReceiptLines:false,enableReceiptAmounts:false,
    enableCriticalRegions:false,enableIndependentRegional:true,enableGenericRegional:true,
    stopAggressiveness:'balanced'
  },
  receipt:{
    id:'receipt',canonical:'source',dewarp:'light',
    retryLimit:8,multipageRetryLimit:2,
    enableReceiptLines:true,enableReceiptAmounts:true,
    enableCriticalRegions:true,enableIndependentRegional:true,enableGenericRegional:true,
    stopAggressiveness:'strict'
  },
  'structured-form':{
    id:'structured-form',canonical:'A4',dewarp:'strong',
    retryLimit:10,multipageRetryLimit:3,
    enableReceiptLines:false,enableReceiptAmounts:false,
    enableCriticalRegions:true,enableIndependentRegional:true,enableGenericRegional:true,
    stopAggressiveness:'strict'
  }
};

const PROFILES:Record<StructuralClass,DocumentProfile>={
  receipt:{
    id:'receipt',coreProfile:'receipt',
    preprocessing:['thermal-contrast','amount-columns','regional-reocr'],
    validators:['amount','vat','total','payment'],
    layoutFocus:['items','prices','totals'],dewarp:'light',policy:CORE_POLICIES.receipt
  },
  invoice:{
    id:'invoice',coreProfile:'structured-form',
    preprocessing:['adaptive'],validators:['vat-id','iban','amount','date','cross-field-total'],
    layoutFocus:['tables','identifiers','totals'],dewarp:'none',
    policy:{...CORE_POLICIES['structured-form'],dewarp:'none'}
  },
  'blank-form':{
    id:'form',coreProfile:'structured-form',
    preprocessing:['line-preserving'],validators:['date','tax-id','email'],
    layoutFocus:['labels','values','checkboxes','underlines'],dewarp:'none',
    policy:{...CORE_POLICIES['structured-form'],dewarp:'none'}
  },
  'filled-form':{
    id:'form',coreProfile:'structured-form',
    preprocessing:['line-preserving'],validators:['date','tax-id','email'],
    layoutFocus:['labels','values','checkboxes','handwriting'],dewarp:'light',
    policy:{...CORE_POLICIES['structured-form'],dewarp:'light'}
  },
  'book-page':{
    id:'book',coreProfile:'generic',
    preprocessing:['illumination','sauvola'],validators:['language'],
    layoutFocus:['columns','paragraphs','page-number'],dewarp:'strong',
    policy:{...CORE_POLICIES.generic,dewarp:'strong',retryLimit:5}
  },
  contract:{
    id:'contract',coreProfile:'structured-form',
    preprocessing:['grayscale'],validators:['date','tax-id'],
    layoutFocus:['paragraphs','headers','signatures','stamps'],dewarp:'none',
    policy:{...CORE_POLICIES['structured-form'],dewarp:'none',retryLimit:6}
  },
  letter:{
    id:'letter',coreProfile:'generic',
    preprocessing:['grayscale'],validators:['date','email','phone'],
    layoutFocus:['paragraphs','headers','signatures'],dewarp:'none',
    policy:{...CORE_POLICIES.generic,dewarp:'none',retryLimit:3}
  },
  'generic-document':{
    id:'generic',coreProfile:'generic',
    preprocessing:['adaptive'],validators:['generic'],
    layoutFocus:['paragraphs','tables','objects'],dewarp:'light',policy:CORE_POLICIES.generic
  },
  unknown:{
    id:'unknown',coreProfile:'generic',
    preprocessing:['adaptive'],validators:['generic'],
    layoutFocus:['text','objects'],dewarp:'light',
    policy:{...CORE_POLICIES.generic,retryLimit:2,stopAggressiveness:'fast'}
  }
};

export function coreProfilePolicy(id:CoreProfileId):OcrProfilePolicy{return CORE_POLICIES[id];}
export function profileFor(classification:StructuralClass):DocumentProfile{return PROFILES[classification];}
