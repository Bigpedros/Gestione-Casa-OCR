import {describe,it,expect} from 'vitest';
import {collectReceiptEvidence} from '../vendor/motore-ocr-ai/core/ocr/receiptFinalizer';
import {addEvidenceTokens,createEvidenceSet,createRawOcrSnapshot} from '../vendor/motore-ocr-ai/core/pipeline/checkpoints';
import {stabilizeOcrPage} from '../vendor/motore-ocr-ai/core/pipeline/decisionEngine';
import type {OcrPage,OcrToken} from '../vendor/motore-ocr-ai/contracts';

function token(id:string,text:string,lineId:string,x:number,y:number,confidence=85,width=80):OcrToken{
  return{id,text,lineId,confidence,box:{x,y,width,height:28},provenance:'ocr'};
}
function page(tokens:OcrToken[]):OcrPage{
  return{pageNumber:1,width:1000,height:1400,text:tokens.map(t=>t.text).join(' '),tokens,warnings:[]};
}

describe('MOTORE Receipt Line Fusion donation',()=>{
  it('uses row-level OCRS evidence to improve FILODE -> FILO without mutating raw OCR',()=>{
    const rawPage=page([
      token('p1','FILODE','l1',100,300,74,110),
      token('p2','LEGACCI','l1',260,300,87,120),
      token('p3','22,00%','l1',600,300,90,90),
      token('p4','1,80','l1',820,300,95,70)
    ]);
    const raw=createRawOcrSnapshot(rawPage);
    const evidence=createEvidenceSet(raw);

    addEvidenceTokens(evidence,'recognizer-b',[
      token('b1','FILO','b-l1',102,302,91,75),
      token('b2','LEGACCI','b-l1',262,302,94,120),
      token('b3','22,00%','b-l1',602,302,96,90),
      token('b4','1,80','b-l1',822,302,96,70)
    ],'recognizer-b:ocrs-rten-wasm; score=90');

    const receipt=collectReceiptEvidence(rawPage,evidence.candidates);
    addEvidenceTokens(evidence,'receipt-finalizer',receipt.tokens,'receipt line fusion');
    const stabilized=stabilizeOcrPage(evidence);

    expect(raw.page.tokens[0]?.text).toBe('FILODE');
    expect(stabilized.page.tokens.some(t=>t.text==='FILO')).toBe(true);
    expect(stabilized.decisions.some(d=>d.primaryText==='FILODE'&&d.secondaryText==='FILO'&&d.changed)).toBe(true);
  });

  it('does not fuse a matching economic row that is vertically remote',()=>{
    const rawPage=page([
      token('p1','FILODE','l1',100,300,74,110),
      token('p2','22,00%','l1',600,300,90,90),
      token('p3','1,80','l1',820,300,95,70)
    ]);
    const raw=createRawOcrSnapshot(rawPage);
    const evidence=createEvidenceSet(raw);

    addEvidenceTokens(evidence,'recognizer-b',[
      token('b1','FILO','b-l9',102,620,93,75),
      token('b2','22,00%','b-l9',602,620,96,90),
      token('b3','1,80','b-l9',822,620,96,70)
    ],'recognizer-b:ocrs-rten-wasm; score=90');

    const receipt=collectReceiptEvidence(rawPage,evidence.candidates);
    expect(receipt.tokens.some(t=>t.correctionReason==='receipt-evidence:LINE_FUSION')).toBe(false);
  });
});
