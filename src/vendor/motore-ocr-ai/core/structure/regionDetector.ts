import type {Box,OcrToken,StructuralRegion} from '../../contracts.js';

interface Segment{pos:number;start:number;end:number}

export function detectStructuralRegions(canvas:HTMLCanvasElement,tokens:OcrToken[]):StructuralRegion[]{
  if(typeof document==='undefined')return[];
  const scale=Math.min(1,1200/canvas.width);
  const width=Math.max(1,Math.round(canvas.width*scale));
  const height=Math.max(1,Math.round(canvas.height*scale));
  const small=document.createElement('canvas');
  small.width=width;small.height=height;
  const context=small.getContext('2d');
  if(!context)return[];
  context.drawImage(canvas,0,0,width,height);
  const rgba=context.getImageData(0,0,width,height).data;
  const ink=new Uint8Array(width*height);
  for(let index=0;index<ink.length;index++){
    const r=rgba[index*4]??255,g=rgba[index*4+1]??255,b=rgba[index*4+2]??255;
    ink[index]=(.299*r+.587*g+.114*b)<115?1:0;
  }

  const scan=(vertical:boolean):Segment[]=>{
    const rows=vertical?width:height,cols=vertical?height:width;
    const segments:Segment[]=[];
    for(let pos=0;pos<rows;pos++){
      let start=-1,last=-1;
      for(let cursor=0;cursor<=cols;cursor++){
        const dark=cursor<cols&&ink[vertical?cursor*width+pos:pos*width+cursor];
        if(dark){if(start<0)start=cursor;last=cursor;}
        if(start>=0&&(!dark&&(cursor-last>2||cursor===cols))){
          if(last-start>=8)segments.push({pos,start,end:last});
          start=-1;
        }
      }
    }
    const merged:Segment[]=[];
    for(const segment of segments){
      const previous=[...merged].reverse().find(item=>
        Math.abs(item.pos-segment.pos)<=3&&
        Math.abs(item.start-segment.start)<=4&&
        Math.abs(item.end-segment.end)<=4
      );
      if(!previous)merged.push({...segment});
      else{
        previous.pos=(previous.pos+segment.pos)/2;
        previous.start=Math.min(previous.start,segment.start);
        previous.end=Math.max(previous.end,segment.end);
      }
    }
    return merged
      .sort((a,b)=>(b.end-b.start)-(a.end-a.start))
      .slice(0,300)
      .sort((a,b)=>a.pos-b.pos);
  };

  const horizontals=scan(false),verticals=scan(true);
  const regions:StructuralRegion[]=[];
  const seen=new Set<string>();

  for(const top of horizontals){
    const bottoms=horizontals.filter(bottom=>
      bottom.pos-top.pos>=8&&
      bottom.pos-top.pos<=height*.4&&
      Math.min(bottom.end,top.end)-Math.max(bottom.start,top.start)>=
        Math.max(8,Math.max(bottom.end-bottom.start,top.end-top.start)*.5)
    );
    for(const bottom of bottoms.slice(0,12)){
      const left=Math.max(top.start,bottom.start),right=Math.min(top.end,bottom.end);
      const sides=verticals
        .filter(side=>side.pos>=left-4&&side.pos<=right+4&&side.start<=top.pos+4&&side.end>=bottom.pos-4)
        .sort((a,b)=>a.pos-b.pos);
      const unique:Segment[]=[];
      for(const side of sides){
        const previous=unique[unique.length-1];
        if(!previous||side.pos-previous.pos>4)unique.push(side);
      }
      for(let index=0;index<unique.length-1;index++){
        const a=unique[index],b=unique[index+1];
        if(!a||!b)continue;
        const x=a.pos,y=top.pos,regionWidth=b.pos-x,regionHeight=bottom.pos-y;
        if(regionWidth<8||regionHeight<8)continue;
        if(horizontals.some(line=>line.pos>y+4&&line.pos<bottom.pos-4&&line.start<=x+4&&line.end>=x+regionWidth-4))continue;
        const key=[x,y,regionWidth,regionHeight].map(value=>Math.round(value/4)).join(':');
        if(seen.has(key))continue;
        seen.add(key);
        const box:Box={x:x/scale,y:y/scale,width:regionWidth/scale,height:regionHeight/scale};
        const checkbox=regionWidth>=18&&regionHeight>=18&&regionWidth<=35&&regionHeight<=35&&regionWidth/regionHeight>.65&&regionWidth/regionHeight<1.5;
        if(!checkbox&&(regionWidth<80||regionHeight<24))continue;
        const inside=tokens.filter(token=>intersectionRatio(token.box,box)>.6);
        const areaRatio=(box.width*box.height)/Math.max(1,canvas.width*canvas.height);
        if(!checkbox&&!inside.length&&areaRatio<.0015)continue;
        regions.push({
          id:`r-${regions.length}`,
          kind:checkbox?'checkbox':'cell',
          box,
          confidence:inside.length?.92:.78,
          evidence:[
            checkbox?'square-outline':'closed-cell',
            ...(inside.length?[`tokens-inside:${inside.length}`]:[])
          ]
        });
        if(regions.length>=120)return consolidateRegions(regions,tokens.length);
      }
    }
  }
  // Linee di campo / underline non chiuse in celle.
  for(const line of horizontals){
    const length=line.end-line.start;
    if(length<width*.12)continue;
    const hasParallel=horizontals.some(other=>other!==line&&Math.abs(other.pos-line.pos)>=8&&Math.abs(other.pos-line.pos)<=height*.08&&Math.min(other.end,line.end)-Math.max(other.start,line.start)>=length*.65);
    if(hasParallel)continue;
    const box:Box={x:line.start/scale,y:(line.pos-2)/scale,width:length/scale,height:4/scale};
    if(regions.some(region=>intersectionRatio(box,region.box)>.6))continue;
    regions.push({id:`r-${regions.length}`,kind:'underline',box,confidence:.72,evidence:['long-horizontal-separator']});
  }
  return consolidateRegions(regions,tokens.length).sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
}

function consolidateRegions(regions:StructuralRegion[],tokenCount=0):StructuralRegion[]{
  const ordered=[...regions].sort((a,b)=>b.confidence-a.confidence||boxArea(b.box)-boxArea(a.box));
  const kept:StructuralRegion[]=[];
  for(const region of ordered){
    const duplicate=kept.some(existing=>
      existing.kind===region.kind&&
      (intersectionOverUnion(existing.box,region.box)>.72||containsBox(existing.box,region.box,.86)||containsBox(region.box,existing.box,.86))
    );
    if(!duplicate)kept.push(region);
  }
  const budget=tokenCount>700?52:tokenCount>350?60:tokenCount>150?72:84;
  const priority=(region:StructuralRegion)=>region.kind==='checkbox'?0:region.kind==='cell'?1:2;
  return kept.sort((a,b)=>priority(a)-priority(b)||b.confidence-a.confidence||boxArea(b.box)-boxArea(a.box)).slice(0,budget).map((region,index)=>({...region,id:`r-${index}`}));
}
function boxArea(box:Box){return Math.max(0,box.width)*Math.max(0,box.height)}
function intersectionOverUnion(a:Box,b:Box):number{
  const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  if(right<=left||bottom<=top)return 0;
  const intersection=(right-left)*(bottom-top);
  return intersection/Math.max(1,boxArea(a)+boxArea(b)-intersection);
}
function containsBox(outer:Box,inner:Box,threshold:number):boolean{
  const left=Math.max(outer.x,inner.x),top=Math.max(outer.y,inner.y),right=Math.min(outer.x+outer.width,inner.x+inner.width),bottom=Math.min(outer.y+outer.height,inner.y+inner.height);
  if(right<=left||bottom<=top)return false;
  return((right-left)*(bottom-top))/Math.max(1,boxArea(inner))>=threshold;
}

function intersectionRatio(a:Box,b:Box):number{
  const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y);
  const right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  if(right<=left||bottom<=top)return 0;
  const intersection=(right-left)*(bottom-top);
  const area=Math.max(1,a.width*a.height);
  return intersection/area;
}
