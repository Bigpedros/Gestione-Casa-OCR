import { describe, expect, it } from 'vitest';
import {
  buildDigitalPageReconstruction,
  getDigitalPageText,
} from '../vendor/motore-ocr-ai/core/reconstruction/digitalReconstruction';
import type { OcrPage, OcrToken } from '../vendor/motore-ocr-ai/contracts';

function token(id:string,text:string,lineId:string,x:number,y:number,width:number):OcrToken{
  return {
    id,
    text,
    confidence:92,
    box:{x,y,width,height:24},
    lineId,
    provenance:'ocr',
    rawText:text,
    normalizedText:text,
  };
}

function page():OcrPage{
  return {
    pageNumber:1,
    width:1000,
    height:1600,
    text:'PANE CASERECCIO 22,00% 2,60\nTOTALE 2,60',
    tokens:[
      token('t1','PANE','l1',80,200,70),
      token('t2','CASERECCIO','l1',165,200,145),
      token('t3','22,00%','l1',560,200,90),
      token('t4','2,60','l1',830,200,60),
      token('t5','TOTALE','l2',100,300,90),
      token('t6','2,60','l2',830,300,60),
    ],
    warnings:[],
  };
}

describe('donazione MOTORE - ricostruzione geometrica',()=>{
  it('mantiene colonne fisiche separate e prezzo allineato a destra',()=>{
    const reconstruction=buildDigitalPageReconstruction(page());
    expect(reconstruction.lines).toHaveLength(2);
    expect(reconstruction.lines[0].segments.length).toBeGreaterThanOrEqual(3);
    const last=reconstruction.lines[0].segments.at(-1);
    expect(last?.alignment).toBe('right');
    expect(last?.box.x).toBeGreaterThan(800);
  });

  it('mantiene dimensioni e coordinate della pagina OCR',()=>{
    const reconstruction=buildDigitalPageReconstruction(page());
    expect(reconstruction.width).toBe(1000);
    expect(reconstruction.height).toBe(1600);
    expect(reconstruction.elements.find(e=>e.id==='t4')?.box).toEqual({x:830,y:200,width:60,height:24});
  });

  it('ricostruisce il testo in ordine visuale senza passare dal parser contabile',()=>{
    const reconstruction=buildDigitalPageReconstruction(page());
    const text=getDigitalPageText(reconstruction);
    expect(text.split('\n')[0]).toContain('PANE CASERECCIO');
    expect(text.split('\n')[0]).toContain('22,00%');
    expect(text.split('\n')[0]).toContain('2,60');
    expect(text.split('\n')[1]).toContain('TOTALE');
  });
});
