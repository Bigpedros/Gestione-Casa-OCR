import { describe, it, expect } from 'vitest';
import {
  reconstructPhysicalLines,
  reconstructReceiptItemBlocks,
} from '../vendor/motore-ocr-ai/core/ocr/receiptItemBlockReconstruction';
import type { OcrPage, OcrToken } from '../vendor/motore-ocr-ai/contracts';

function token(id:string,text:string,lineId:string,x:number,y:number,width=80,confidence=92):OcrToken{
  return{id,text,lineId,confidence,box:{x,y,width,height:28},provenance:'ocr'};
}
function page(tokens:OcrToken[]):OcrPage{
  return{pageNumber:1,width:1000,height:1400,text:tokens.map(t=>t.text).join(' '),tokens,warnings:[]};
}
function header(y=100):OcrToken[]{
  return[
    token('h1','DESCRIZIONE','h-a',40,y,180),
    token('h2','IVA','h-b',540,y+2,55),
    token('h3','Prezzo(€)','h-c',760,y+1,160)
  ];
}

describe('Receipt Item Block Reconstruction donation',()=>{
  it('reconstructs one physical row despite inconsistent OCR lineIds',()=>{
    const lines=reconstructPhysicalLines([
      token('a','TOVAGLIOLI','ocr-a',50,300,150),
      token('b','22,00%','ocr-b',540,302,90),
      token('c','1,80','ocr-c',800,301,70)
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('TOVAGLIOLI 22,00% 1,80');
  });

  it('keeps Gruppo Caffe as SINGLE_LINE',()=>{
    const result=reconstructReceiptItemBlocks(page([
      ...header(),
      token('a1','ILLY','l1',50,160,60),
      token('a2','IPERESPRESSO','l1',125,160,180),
      token('a3','GINSENG','l1',320,160,105),
      token('a4','10,00%','l1',540,161,90),
      token('a5','8,50','l1',800,160,70),
      token('t1','TOTALE','l2',500,240,90),
      token('t2','21,50','l2',800,240,80)
    ]));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      structureType:'SINGLE_LINE',
      description:'ILLY IPERESPRESSO GINSENG',
      vatRate:10,
      quantity:1,
      unitPrice:8.5,
      totalPrice:8.5
    });
  });

  it('reconstructs Orizzonte multiline description',()=>{
    const result=reconstructReceiptItemBlocks(page([
      ...header(),
      token('a1','TOVAGLIOLI','l1',50,160,150),
      token('a2','2V','l1',215,160,40),
      token('a3','50PZ','l1',270,160,70),
      token('a4','NICKY','l1',355,160,85),
      token('b1','PIEGATO','l2',50,198,110),
      token('b2','22,00%','wrong-vat',540,199,90),
      token('b3','1,80','wrong-price',800,200,70),
      token('t1','TOTALE','l3',500,280,90),
      token('t2','20,25','l3',800,280,80)
    ]));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      structureType:'DESCRIPTION_CONTINUATION',
      description:'TOVAGLIOLI 2V 50PZ NICKY PIEGATO',
      vatRate:22,
      unitPrice:1.8,
      totalPrice:1.8
    });
  });

  it('reconstructs TODIS quantity x unit price by arithmetic',()=>{
    const result=reconstructReceiptItemBlocks(page([
      ...header(),
      token('q1','2','q1',50,160,20),
      token('q2','x','q1',88,160,18),
      token('q3','2,99','q1',125,160,65),
      token('a1','GAMBERI','a1',50,198,110),
      token('a2','MARI','a1',175,198,65),
      token('a3','CALDI','a1',255,198,70),
      token('a4','10,00%','a1',540,199,90),
      token('a5','5,98','a1',800,199,70),
      token('t1','SUBTOTALE','l3',500,280,120),
      token('t2','17,89','l3',800,280,80)
    ]));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      structureType:'QTY_UNIT_PREFIX',
      description:'GAMBERI MARI CALDI',
      vatRate:10,
      quantity:2,
      unitPrice:2.99,
      totalPrice:5.98,
      confidence:0.99
    });
  });

  it('does not attach a quantity prefix when arithmetic disagrees',()=>{
    const result=reconstructReceiptItemBlocks(page([
      ...header(),
      token('q1','2','q1',50,160,20),
      token('q2','x','q1',88,160,18),
      token('q3','2,99','q1',125,160,65),
      token('a1','GAMBERI','a1',50,198,110),
      token('a2','MARI','a1',175,198,65),
      token('a3','CALDI','a1',255,198,70),
      token('a4','10,00%','a1',540,199,90),
      token('a5','5,89','a1',800,199,70),
      token('t1','TOTALE','l3',500,280,90),
      token('t2','5,89','l3',800,280,70)
    ]));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.structureType).toBe('SINGLE_LINE');
    expect(result.blocks[0]?.quantity).toBe(1);
  });
});
