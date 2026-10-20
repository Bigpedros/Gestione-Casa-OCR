import {describe,it,expect} from 'vitest';
import {stabilizeOcrPage} from '../vendor/motore-ocr-ai/core/pipeline/decisionEngine';
import type {OcrEvidenceSet,OcrEvidenceCandidate} from '../vendor/motore-ocr-ai/core/pipeline/checkpoints';
import type {OcrPage,OcrToken} from '../vendor/motore-ocr-ai/contracts';

function createMockPage(tokens:OcrToken[]):OcrPage{
  return{
    pageNumber:1,
    width:800,
    height:1200,
    text:tokens.map(t=>t.text).join(' '),
    tokens,
    warnings:[]
  };
}

function createToken(id:string,text:string,x:number,y:number,confidence=70):OcrToken{
  return{
    id,
    text,
    confidence,
    box:{x,y,width:60,height:20},
    lineId:'line-1',
    provenance:'ocr'
  };
}

describe('MOTORE-OCR-AI Decision Engine Enhanced Tests',()=>{
  it('1. Primary 21550, Secondary 21,50 (Monetary) -> Expected 21,50',async()=>{
    const rawToken=createToken('t1','21550',100,100,65);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'21550',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const secondaryToken=createToken('t1','21,50',100,100,92);
    const candidate:OcrEvidenceCandidate={
      id:'cand-1',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'secondary OCR correction'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidate],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('21,50');
    expect(result.decisions[0].changed).toBe(true);
    expect(result.decisions[0].decision).toBe('secondary-wins');
  });

  it('2. Primary 21450, Secondary 21,50 with corroboration -> Expected 21,50',async()=>{
    const rawToken=createToken('t1','21450',100,100,60);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'21450',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const secondaryToken=createToken('t1','21,50',100,100,88);
    const candidate1:OcrEvidenceCandidate={
      id:'cand-1',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'secondary OCR correction'
    };
    const corroboratingToken=createToken('t2','21,50',300,300,90);
    const candidate2:OcrEvidenceCandidate={
      id:'cand-2',
      source:'receipt-amount',
      token:corroboratingToken,
      reason:'receipt corroboration'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidate1,candidate2],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('21,50');
    expect(result.decisions[0].changed).toBe(true);
  });

  it('3. Primary 1,%, Secondary 1,95 (Percentage/Money-like) -> Expected 1,95',async()=>{
    const rawToken=createToken('t1','1,%',100,100,50);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'1,%',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const secondaryToken=createToken('t1','1,95',100,100,91);
    const candidate:OcrEvidenceCandidate={
      id:'cand-1',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'secondary correction'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidate],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('1,95');
    expect(result.decisions[0].changed).toBe(true);
  });

  it('4. Primary CAFFE", Secondary CAFFE\' -> Expected CAFFE\'',async()=>{
    const rawToken=createToken('t1','CAFFE"',100,100,65);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'CAFFE"',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const secondaryToken=createToken('t1',"CAFFE'",100,100,92);
    const candidate:OcrEvidenceCandidate={
      id:'cand-1',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'clean punctuation'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidate],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe("CAFFE'");
    expect(result.decisions[0].changed).toBe(true);
  });

  it('5. Primary and secondary both uncertain -> Expected unresolved / regional retry suggested',async()=>{
    const rawToken=createToken('t1','123??',100,100,35);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'123??',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const secondaryToken=createToken('t1','456??',100,100,40);
    const candidate:OcrEvidenceCandidate={
      id:'cand-1',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'uncertain'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidate],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.decisions[0].decision).toBe('NEEDS_REGIONAL_RETRY');
  });

  it('6. Primary correct, secondary incorrect -> Expected keep primary',async()=>{
    const rawToken=createToken('t1','TOTAL',100,100,98);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'TOTAL',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const secondaryToken=createToken('t1','TOTALL',100,100,55);
    const candidate:OcrEvidenceCandidate={
      id:'cand-1',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'bad secondary'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidate],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('TOTAL');
    expect(result.decisions[0].changed).toBe(false);
  });

  it('7. Primary and secondary identical -> Expected consensus',async()=>{
    const rawToken=createToken('t1','21,50',100,100,95);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'21,50',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const secondaryToken=createToken('t1','21,50',100,100,96);
    const candidate:OcrEvidenceCandidate={
      id:'cand-1',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'consensus'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidate],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('21,50');
    expect(result.decisions[0].changed).toBe(false);
    expect(result.decisions[0].decision).toBe('consensus');
  });

  it('Regression Case A: Primary 21550, Variant 21550, Recognizer-B 21,50 -> No false consensus on 21550, Recognizer-B wins',async()=>{
    const rawToken=createToken('t1','21550',100,100,75);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'21550',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const variantToken=createToken('t1','21550',100,100,75);
    const candidateVariant:OcrEvidenceCandidate={
      id:'cand-v',
      source:'variant',
      token:variantToken,
      reason:'tesseract variant'
    };

    const secondaryToken=createToken('t1','21,50',100,100,87);
    const candidateB:OcrEvidenceCandidate={
      id:'cand-b',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'recognizer-b correction'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidateVariant,candidateB],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('21,50');
    expect(result.decisions[0].changed).toBe(true);
    expect(result.decisions[0].decision).toBe('secondary-wins');
  });

  it('Regression Case B: Primary 1,%, Variant 1,%, Recognizer-B 1,95 -> No false consensus on 1,%, Recognizer-B wins',async()=>{
    const rawToken=createToken('t1','1,%',100,100,60);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'1,%',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const variantToken=createToken('t1','1,%',100,100,60);
    const candidateVariant:OcrEvidenceCandidate={
      id:'cand-v',
      source:'variant',
      token:variantToken,
      reason:'tesseract variant'
    };

    const secondaryToken=createToken('t1','1,95',100,100,86);
    const candidateB:OcrEvidenceCandidate={
      id:'cand-b',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'recognizer-b percentage correction'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidateVariant,candidateB],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('1,95');
    expect(result.decisions[0].changed).toBe(true);
  });

  it('Regression Case C: Primary 21,50, Variant 21,50, Recognizer-B 21,50 -> Valid multi-reader consensus',async()=>{
    const rawToken=createToken('t1','21,50',100,100,90);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'21,50',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const variantToken=createToken('t1','21,50',100,100,90);
    const candidateVariant:OcrEvidenceCandidate={
      id:'cand-v',
      source:'variant',
      token:variantToken,
      reason:'tesseract variant'
    };

    const secondaryToken=createToken('t1','21,50',100,100,92);
    const candidateB:OcrEvidenceCandidate={
      id:'cand-b',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'recognizer-b consensus'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidateVariant,candidateB],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('21,50');
    expect(result.decisions[0].changed).toBe(false);
    expect(result.decisions[0].decision).toBe('consensus');
  });

  it('Regression Case D: Primary testo X, Variant testo X, Recognizer-B testo Y weak -> Primary wins, no consensus',async()=>{
    const rawToken=createToken('t1','TESTOX',100,100,90);
    const rawSnapshot={
      pageNumber:1,
      width:800,height:1200,
      text:'TESTOX',
      tokens:[rawToken],
      warnings:[],
      page:createMockPage([rawToken]),
      fingerprint:'test'
    };

    const variantToken=createToken('t1','TESTOX',100,100,90);
    const candidateVariant:OcrEvidenceCandidate={
      id:'cand-v',
      source:'variant',
      token:variantToken,
      reason:'tesseract variant'
    };

    const secondaryToken=createToken('t1','TESTOY',100,100,50);
    const candidateB:OcrEvidenceCandidate={
      id:'cand-b',
      source:'recognizer-b',
      token:secondaryToken,
      reason:'weak secondary'
    };

    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[candidateVariant,candidateB],
      observations:[]
    };

    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('TESTOX');
    expect(result.decisions[0].changed).toBe(false);
    expect(result.decisions[0].decision).toBe('primary-wins');
  });

  it('Regression Case E: strong primary money 20,25 cannot become time-like 20:25',()=>{
    const rawToken=createToken('t1','20,25',100,100,96);
    const rawSnapshot={
      pageNumber:1,width:800,height:1200,text:'20,25',
      tokens:[rawToken],warnings:[],page:createMockPage([rawToken]),fingerprint:'test'
    };
    const secondaryToken=createToken('t1','20:25',100,100,87);
    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[{id:'cand-b',source:'recognizer-b',token:secondaryToken,reason:'recognizer-b:ocrs-rten-wasm; score=85.2'}],
      observations:[]
    };
    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('20,25');
    expect(result.decisions[0].changed).toBe(false);
  });

  it('Regression Case F: valid percentage 20% cannot become monetary 2.70',()=>{
    const rawToken=createToken('t1','20%',100,100,78);
    const rawSnapshot={
      pageNumber:1,width:800,height:1200,text:'20%',
      tokens:[rawToken],warnings:[],page:createMockPage([rawToken]),fingerprint:'test'
    };
    const secondaryToken=createToken('t1','2.70',100,100,86);
    const evidenceSet:OcrEvidenceSet={
      raw:rawSnapshot as any,
      candidates:[{id:'cand-b',source:'recognizer-b',token:secondaryToken,reason:'recognizer-b:ocrs-rten-wasm; score=85.2'}],
      observations:[]
    };
    const result=stabilizeOcrPage(evidenceSet);
    expect(result.page.tokens[0].text).toBe('20%');
    expect(result.decisions[0].changed).toBe(false);
  });
});
