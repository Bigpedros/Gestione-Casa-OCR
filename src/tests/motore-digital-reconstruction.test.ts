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

  it('ricostruisce una word-box patologica dalle box dei caratteri',()=>{
    const p=page();
    const bad=token('charbox','PAROLA','l3',100,400,220);
    bad.box.height=90;
    bad.characters=[
      {text:'P',confidence:99,box:{x:110,y:430,width:14,height:27}},
      {text:'A',confidence:99,box:{x:128,y:432,width:15,height:27}},
      {text:'R',confidence:99,box:{x:146,y:434,width:15,height:27}},
      {text:'O',confidence:99,box:{x:164,y:436,width:15,height:27}},
      {text:'L',confidence:99,box:{x:182,y:438,width:14,height:27}},
      {text:'A',confidence:99,box:{x:200,y:440,width:15,height:27}},
    ];
    p.tokens.push(bad);
    const reconstruction=buildDigitalPageReconstruction(p);
    const rebuilt=reconstruction.elements.find(element=>element.id==='charbox')!;
    expect(rebuilt.box.height).toBeLessThan(40);
    expect(rebuilt.box.width).toBeLessThan(130);
    expect(rebuilt.box.y).toBeGreaterThanOrEqual(425);
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

  it('riunisce un prezzo con lineId diverso seguendo la baseline locale',()=>{
    const p=page();
    p.tokens=[
      token('a','ARTICOLO','ocr-l1',110,425,150),
      token('b','22,00%','ocr-l1',560,432,95),
      token('c','1,80','ocr-l2',810,469,60),
      token('d','RIGA2','ocr-l3',120,486,100),
      token('e','2,60','ocr-l3',810,524,60),
    ];
    const reconstruction=buildDigitalPageReconstruction(p);
    const rows=getDigitalPageText(reconstruction).split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('ARTICOLO');
    expect(rows[0]).toContain('22,00%');
    expect(rows[0]).toContain('1,80');
    expect(rows[1]).toContain('RIGA2');
    expect(rows[1]).toContain('2,60');
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
