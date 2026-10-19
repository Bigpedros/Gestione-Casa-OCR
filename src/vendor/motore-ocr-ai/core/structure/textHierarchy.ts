import type {Box,OcrPage,OcrToken,OcrLineGeometry,OcrBlockGeometry} from '../../contracts.js';

export function buildTextHierarchy(page:OcrPage):{lines:OcrLineGeometry[];blocks:OcrBlockGeometry[]}{
  const lineMap=new Map<string,OcrToken[]>();
  for(const token of page.tokens){
    const bucket=lineMap.get(token.lineId)??[];
    bucket.push(token);lineMap.set(token.lineId,bucket);
  }
  const lines=[...lineMap.entries()].map(([id,tokens])=>{
    const sorted=[...tokens].sort((a,b)=>a.box.x-b.box.x);
    const box=union(sorted.map(token=>token.box));
    return{
      id,
      box,
      normalizedBox:normalize(box,page.width,page.height),
      tokenIds:sorted.map(token=>token.id),
      text:sorted.map(token=>token.text).join(' '),
      confidence:average(sorted.map(token=>(token.confidence??50)/100))
    };
  }).sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);

  const blocks:OcrBlockGeometry[]=[];
  let current:OcrLineGeometry[]=[];
  for(const line of lines){
    const previous=current.at(-1);
    const gap=previous?line.box.y-(previous.box.y+previous.box.height):0;
    const height=previous?Math.max(previous.box.height,line.box.height):line.box.height;
    if(previous&&gap>height*1.8){pushBlock(blocks,current,page);current=[];}
    current.push(line);
  }
  pushBlock(blocks,current,page);
  return{lines,blocks};
}

function pushBlock(out:OcrBlockGeometry[],lines:OcrLineGeometry[],page:OcrPage):void{
  if(!lines.length)return;
  const box=union(lines.map(line=>line.box));
  out.push({
    id:`p${page.pageNumber}-b${out.length}`,
    box,
    normalizedBox:normalize(box,page.width,page.height),
    lineIds:lines.map(line=>line.id),
    text:lines.map(line=>line.text).join('\n'),
    confidence:average(lines.map(line=>line.confidence))
  });
}
function normalize(box:Box,width:number,height:number):Box{
  return{x:box.x/Math.max(1,width),y:box.y/Math.max(1,height),width:box.width/Math.max(1,width),height:box.height/Math.max(1,height)};
}
function union(boxes:Box[]):Box{
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  const r=Math.max(...boxes.map(b=>b.x+b.width)),bt=Math.max(...boxes.map(b=>b.y+b.height));
  return{x,y,width:r-x,height:bt-y};
}
function average(values:number[]):number{return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
