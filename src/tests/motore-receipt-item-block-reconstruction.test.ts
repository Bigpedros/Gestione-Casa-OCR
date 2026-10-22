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
  it('infers columns without printed header from repeated VAT and price anchors',()=>{
    const result=reconstructReceiptItemBlocks(page([
      token('a1','ARTICOLO','l1',60,180,130),
      token('a2','22,00%','l1',560,180,90),
      token('a3','1,80','l1',820,180,70),
      token('b1','ALTRO','l2',60,240,110),
      token('b2','22,00%','l2',560,240,90),
      token('b3','2,60','l2',820,240,70),
      token('t1','TOTALE','l3',500,320,90),
      token('t2','4,40','l3',820,320,70)
    ]));
    expect(result.blocks).toHaveLength(2);
    expect(result.observations.some(o=>o.code==='RECEIPT_ITEM_COLUMNS_FROM_ANCHORS')).toBe(true);
    expect(result.blocks[0]).toMatchObject({description:'ARTICOLO',totalPrice:1.8});
    expect(result.blocks[1]).toMatchObject({description:'ALTRO',totalPrice:2.6});
  });
  it('pairs VAT and price across adjacent physical rows',()=>{
    const result=reconstructReceiptItemBlocks(page([
      token('d1','FILO','d1',120,420,55),
      token('d2','LEGACCI','d1',190,422,110),
      token('v1','22,00%','v1',560,432,90),
      token('d3','VERDE','d2',130,472,80),
      token('p1','1,80','p1',815,469,60),
      token('a2','ALTRO','a2',130,650,80),
      token('v2','22,00%','a2',560,650,90),
      token('p2','2,60','a2',815,650,60),
      token('t1','TOTALE','t1',500,760,90),
      token('t2','4,40','t1',815,760,60)
    ]));
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toMatchObject({vatRate:22,totalPrice:1.8});
    expect(result.blocks[0]?.description).toContain('FILO');
    expect(result.blocks[0]?.description).toContain('VERDE');
  });

  it('promotes better Recognizer B description inside same commercial band',()=>{
    const primary=page([
      token('d1','SPAZZYOTT','p1',150,710,150,72),
      token('d2','8241','p1',330,712,75,76),
      token('d3','BLU','p1',440,714,50,90),
      token('v1','22,00%','p1',575,716,90,93),
      token('p1','1,95','p1',820,718,60,94),
      token('d4','ALTRO','p2',150,820,90,90),
      token('v2','22,00%','p2',575,820,90,93),
      token('p2','2,60','p2',820,820,60,94),
      token('t1','TOTALE','t1',500,920,90),
      token('t2','4,55','t1',820,920,60)
    ]);
    const candidates:any[]=[
      {source:'recognizer-b',token:token('b1','SPAZZOLINI','b1',150,708,150,91)},
      {source:'recognizer-b',token:token('b2','PATT','b1',320,710,60,91)},
      {source:'recognizer-b',token:token('b3','52X51','b1',385,710,70,90)},
      {source:'recognizer-b',token:token('b4','BLU','b1',465,712,50,92)},
      {source:'recognizer-b',token:token('bv','22,00%','b1',575,714,90,94)},
      {source:'recognizer-b',token:token('bp','1,95','b1',820,716,60,95)}
    ];
    const result=reconstructReceiptItemBlocks(primary,candidates);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]?.descriptionSource).toBe('secondary');
    expect(result.blocks[0]?.description).toContain('SPAZZOLINI');
    expect(result.blocks[0]?.description).toContain('52X51');
    expect(result.blocks[0]?.totalPrice).toBe(1.95);
  });
});
