import { describe, expect, it } from 'vitest';
import {
  buildDigitalPageReconstruction,
  bindDigitalReconstructionSemantics,
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

  it('ripara token corti quando anche tutte le character-box sono patologiche',()=>{
    const p=page();
    const ao=token('short-ao','AO','l3',124,642,296);
    ao.box.height=87;
    ao.characters=[
      {text:'A',confidence:98,box:{x:124,y:642,width:93,height:87}},
      {text:'O',confidence:89,box:{x:218,y:649,width:202,height:55}},
    ];
    const wi=token('short-wi','Wi','l4',133,824,316);
    wi.box.height=86;
    wi.characters=[
      {text:'W',confidence:96,box:{x:133,y:824,width:128,height:86}},
      {text:'i',confidence:92,box:{x:261,y:829,width:188,height:62}},
    ];
    p.tokens.push(ao,wi);
    const reconstruction=buildDigitalPageReconstruction(p);
    const rebuiltAo=reconstruction.elements.find(element=>element.id==='short-ao')!;
    const rebuiltWi=reconstruction.elements.find(element=>element.id==='short-wi')!;
    expect(rebuiltAo.box.height).toBeLessThan(40);
    expect(rebuiltAo.box.width).toBeLessThan(80);
    expect(rebuiltAo.box.x).toBe(124);
    expect(rebuiltWi.box.height).toBeLessThan(40);
    expect(rebuiltWi.box.width).toBeLessThan(80);
    expect(rebuiltWi.box.x).toBe(133);
  });

  it('scarta outlier verticali e caratteri sovradimensionati nella word-box',()=>{
    const p=page();
    const bad=token('char-outliers','SUOFPERL','l3',100,480,180);
    bad.box.height=82;
    bad.characters=[
      {text:'S',confidence:98,box:{x:110,y:505,width:17,height:28}},
      {text:'U',confidence:93,box:{x:130,y:508,width:20,height:60}},
      {text:'O',confidence:94,box:{x:153,y:511,width:16,height:28}},
      {text:'F',confidence:91,box:{x:171,y:514,width:16,height:26}},
      {text:'P',confidence:93,box:{x:188,y:486,width:18,height:57}},
      {text:'E',confidence:97,box:{x:208,y:489,width:17,height:59}},
      {text:'R',confidence:97,box:{x:227,y:523,width:16,height:27}},
      {text:'L',confidence:77,box:{x:243,y:495,width:18,height:57}},
    ];
    p.tokens.push(bad);
    const reconstruction=buildDigitalPageReconstruction(p);
    const rebuilt=reconstruction.elements.find(element=>element.id==='char-outliers')!;
    expect(rebuilt.box.height).toBeLessThan(45);
    expect(rebuilt.box.y).toBeGreaterThanOrEqual(500);
    expect(rebuilt.box.width).toBeLessThanOrEqual(151);
  });

  it('scarta un carattere fuori baseline pur con altezza normale',()=>{
    const p=page();
    const bad=token('baseline-outlier','FILODE','l3',100,420,130);
    bad.box.height=62;
    bad.characters=[
      {text:'F',confidence:99,box:{x:112,y:443,width:14,height:27}},
      {text:'I',confidence:98,box:{x:131,y:446,width:14,height:29}},
      {text:'L',confidence:95,box:{x:150,y:449,width:16,height:29}},
      {text:'O',confidence:95,box:{x:168,y:453,width:16,height:28}},
      {text:'D',confidence:86,box:{x:184,y:425,width:17,height:28}},
      {text:'E',confidence:97,box:{x:204,y:443,width:18,height:29}},
    ];
    p.tokens.push(bad);
    const reconstruction=buildDigitalPageReconstruction(p);
    const rebuilt=reconstruction.elements.find(element=>element.id==='baseline-outlier')!;
    expect(rebuilt.box.height).toBeLessThan(50);
    expect(rebuilt.box.y).toBeGreaterThanOrEqual(440);
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

  it('collega in modo generico una riga geometrica alla sua entità semantica',()=>{
    const reconstruction=buildDigitalPageReconstruction(page());
    const bindings=bindDigitalReconstructionSemantics(reconstruction,[
      {id:'item-pane',text:'PANE CASERECCIO',amount:2.60},
      {id:'total',text:'TOTALE',amount:2.60},
    ]);
    expect(bindings.some(binding=>binding.targetId==='item-pane')).toBe(true);
    expect(bindings.some(binding=>binding.targetId==='total')).toBe(true);
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
