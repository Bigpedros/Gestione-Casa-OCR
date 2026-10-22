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

  it('normalizza box patologiche senza creare caratteri giganti',()=>{
    const p=page();
    p.tokens.push(token('bad','AB','l3',200,420,260));
    p.tokens[p.tokens.length-1]!.box.height=120;
    const reconstruction=buildDigitalPageReconstruction(p);
    const bad=reconstruction.elements.find(element=>element.id==='bad');
    const normalHeight=reconstruction.lines[0]!.box.height;
    expect(bad?.box.height).toBeLessThanOrEqual(normalHeight*1.8);
    expect(bad?.box.width).toBeLessThan(260);
    expect(Math.max(...reconstruction.lines.map(line=>line.fontSize))).toBeLessThan(normalHeight);
  });

  it('riunisce una riga inclinata usando la baseline compensata',()=>{
    const p=page();
    p.tokens=[
      token('a','PRODOTTO','same',100,200,120),
      token('b','22,00%','same',560,226,90),
      token('c','2,60','same',830,242,60),
      token('d','RIGA2','row2',100,270,100),
      token('e','1,80','row2',830,312,60),
    ];
    const reconstruction=buildDigitalPageReconstruction(p);
    const firstText=getDigitalPageText(reconstruction).split('\n')[0]!;
    expect(firstText).toContain('PRODOTTO');
    expect(firstText).toContain('22,00%');
    expect(firstText).toContain('2,60');
    expect(reconstruction.lines).toHaveLength(2);
  });

  it('ricompone righe per prossimità geometrica anche con lineId OCR errati',()=>{
    const p=page();
    p.tokens[0]!.lineId='wrong-a';
    p.tokens[1]!.lineId='wrong-b';
    const reconstruction=buildDigitalPageReconstruction(p);
    const firstText=getDigitalPageText(reconstruction).split('\n')[0]!;
    expect(firstText).toContain('PANE CASERECCIO');
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
