import type {GrayImage,ScanPoint,ScanQuadrilateral} from './photoDocumentScanner.js';

interface EdgePixel{magnitude:number;angle:number}
interface PolarLine{theta:number;rho:number;votes:number}

const MAX_WORK_SIDE=420;
const MAX_LINES=24;
const MIN_AREA_RATIO=.12;
const MIN_SIDE_SUPPORT=.50;
const OUTSIDE_MARGIN=.025;

/**
 * Independent edge-based document detector.
 * It intentionally uses a different evidence family from the luminance/component detector:
 * blur -> Sobel/NMS -> gradient-guided Hough -> supported convex quad -> line refinement.
 */
export function detectDocumentByEdges(gray:GrayImage):{corners:ScanQuadrilateral;confidence:number;reason:string}|null{
  if(gray.width<24||gray.height<24||gray.data.length!==gray.width*gray.height)return null;

  const reduced=resizeGray(gray,MAX_WORK_SIDE);
  const scaleX=gray.width/reduced.width,scaleY=gray.height/reduced.height;
  const blurred=blur3(blur3(reduced));
  const edgeMap=extractEdges(blurred);
  const lines=houghLines(edgeMap,reduced.width,reduced.height);
  const best=findBestQuad(lines,edgeMap,reduced.width,reduced.height);
  if(!best)return null;

  const refined=refineQuad(best.corners,edgeMap,reduced.width,reduced.height)??best.corners;
  const corners=scaleQuad(refined,scaleX,scaleY);
  const confidence=clamp01(.42*best.support+.34*areaRatio(refined,reduced.width,reduced.height)+.24*quadShapeScore(refined));
  return{corners,confidence,reason:'quadrilatero rilevato da bordi/linee con supporto geometrico'};
}

function resizeGray(src:GrayImage,maxSide:number):GrayImage{
  const scale=Math.min(1,maxSide/Math.max(src.width,src.height));
  if(scale===1)return{width:src.width,height:src.height,data:src.data.slice()};
  const width=Math.max(1,Math.round(src.width*scale)),height=Math.max(1,Math.round(src.height*scale));
  const data=new Uint8Array(width*height);
  for(let y=0;y<height;y++){
    const sy=Math.min(src.height-1,Math.floor((y+.5)/scale));
    for(let x=0;x<width;x++){
      const sx=Math.min(src.width-1,Math.floor((x+.5)/scale));
      data[y*width+x]=src.data[sy*src.width+sx]!;
    }
  }
  return{width,height,data};
}

function blur3(src:GrayImage):GrayImage{
  const {width:w,height:h,data}=src,out=new Uint8Array(data.length);
  const weights=[1,2,1];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0,weight=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=Math.max(0,Math.min(w-1,x+dx)),yy=Math.max(0,Math.min(h-1,y+dy));
      const ww=weights[dx+1]!*weights[dy+1]!;
      sum+=data[yy*w+xx]!*ww;weight+=ww;
    }
    out[y*w+x]=Math.round(sum/weight);
  }
  return{width:w,height:h,data:out};
}

function extractEdges(gray:GrayImage):Array<EdgePixel|null>{
  const {width:w,height:h,data}=gray;
  const raw:Array<EdgePixel>=[];
  const mags:number[]=[];
  const at=(x:number,y:number)=>data[Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x))]!;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const gx=(at(x+1,y-1)+2*at(x+1,y)+at(x+1,y+1))-(at(x-1,y-1)+2*at(x-1,y)+at(x-1,y+1));
    const gy=(at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1))-(at(x-1,y-1)+2*at(x,y-1)+at(x+1,y-1));
    const magnitude=Math.hypot(gx,gy),angle=Math.atan2(gy,gx);
    raw.push({magnitude,angle});mags.push(magnitude);
  }
  const sorted=mags.filter(Number.isFinite).sort((a,b)=>a-b);
  const p98=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.98))]??0;
  const threshold=Math.max(22,p98*.24);
  const out:Array<EdgePixel|null>=new Array(raw.length).fill(null);
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    const i=y*w+x,e=raw[i]!;
    if(e.magnitude<threshold)continue;
    const dx=Math.round(Math.cos(e.angle)),dy=Math.round(Math.sin(e.angle));
    const before=raw[(y-dy)*w+(x-dx)]!.magnitude,after=raw[(y+dy)*w+(x+dx)]!.magnitude;
    if(e.magnitude>=before&&e.magnitude>=after)out[i]=e;
  }
  return out;
}

function houghLines(edges:Array<EdgePixel|null>,w:number,h:number):PolarLine[]{
  const thetaSteps=180,diag=Math.ceil(Math.hypot(w,h)),rhoCount=2*diag+1;
  const acc=new Float64Array(thetaSteps*rhoCount);
  const cos=new Float64Array(thetaSteps),sin=new Float64Array(thetaSteps);
  for(let t=0;t<thetaSteps;t++){const a=t*Math.PI/180;cos[t]=Math.cos(a);sin[t]=Math.sin(a);}
  for(let i=0;i<edges.length;i++){
    const e=edges[i];if(!e)continue;
    const x=i%w,y=Math.floor(i/w);
    const normal=((Math.round(e.angle*180/Math.PI)%180)+180)%180;
    for(let d=-6;d<=6;d++){
      const t=(normal+d+thetaSteps)%thetaSteps;
      const rho=Math.round(x*cos[t]!+y*sin[t]!)+diag;
      if(rho>=0&&rho<rhoCount)acc[t*rhoCount+rho]!+=e.magnitude;
    }
  }
  const work=acc.slice(),lines:PolarLine[]=[];
  let first=0;for(const v of work)first=Math.max(first,v);
  while(lines.length<MAX_LINES&&first>0){
    let best=-1,bestValue=0;
    for(let i=0;i<work.length;i++)if(work[i]!>bestValue){bestValue=work[i]!;best=i;}
    if(best<0||bestValue<first*.08)break;
    const t=Math.floor(best/rhoCount),r=best%rhoCount;
    lines.push({theta:t*Math.PI/180,rho:r-diag,votes:bestValue});
    for(let dt=-6;dt<=6;dt++){
      const rawT=t+dt;
      const tt=(rawT+thetaSteps)%thetaSteps;
      const flip=rawT<0||rawT>=thetaSteps;
      const rr=flip?2*diag-r:r;
      for(let dr=-6;dr<=6;dr++){
        const q=rr+dr;if(q>=0&&q<rhoCount)work[tt*rhoCount+q]=0;
      }
    }
  }
  return lines;
}

function findBestQuad(lines:PolarLine[],edges:Array<EdgePixel|null>,w:number,h:number):{corners:ScanQuadrilateral;support:number}|null{
  const horizontal=lines.filter(l=>Math.abs(l.theta*180/Math.PI-90)<=45);
  const vertical=lines.filter(l=>Math.abs(l.theta*180/Math.PI-90)>45);
  let best:{score:number;corners:ScanQuadrilateral;support:number}|null=null;
  for(let a=0;a<horizontal.length;a++)for(let b=a+1;b<horizontal.length;b++)
    for(let c=0;c<vertical.length;c++)for(let d=c+1;d<vertical.length;d++){
      const pts=[
        intersect(horizontal[a]!,vertical[c]!),intersect(horizontal[a]!,vertical[d]!),
        intersect(horizontal[b]!,vertical[d]!),intersect(horizontal[b]!,vertical[c]!)
      ];
      if(pts.some(p=>!p))continue;
      const q=orderQuad(pts as ScanPoint[]);if(!q)continue;
      const points=quadPoints(q);
      if(points.some(p=>p.x<-w*OUTSIDE_MARGIN||p.y<-h*OUTSIDE_MARGIN||p.x>w*(1+OUTSIDE_MARGIN)||p.y>h*(1+OUTSIDE_MARGIN)))continue;
      const ar=quadArea(q)/(w*h);if(ar<MIN_AREA_RATIO)continue;
      const supports=points.map((p,i)=>sideSupport(p,points[(i+1)%4]!,edges,w,h));
      if(supports.some(s=>s<MIN_SIDE_SUPPORT))continue;
      const mean=supports.reduce((s,v)=>s+v,0)/4;
      const score=ar*mean*mean;
      if(!best||score>best.score)best={score,corners:q,support:mean};
    }
  return best?{corners:best.corners,support:best.support}:null;
}

function sideSupport(a:ScanPoint,b:ScanPoint,edges:Array<EdgePixel|null>,w:number,h:number):number{
  const len=Math.hypot(b.x-a.x,b.y-a.y);if(len<2)return 0;
  const ux=(b.x-a.x)/len,uy=(b.y-a.y)/len;
  const expected=Math.atan2(ux,-uy);
  const samples=Math.max(12,Math.min(180,Math.round(len/2))),radius=2;
  let hits=0;
  for(let i=0;i<samples;i++){
    const t=.05+.9*(i+.5)/samples,px=a.x+(b.x-a.x)*t,py=a.y+(b.y-a.y)*t;
    let hit=false;
    for(let o=-radius;o<=radius&&!hit;o++){
      const x=Math.round(px-uy*o),y=Math.round(py+ux*o);
      if(x<0||y<0||x>=w||y>=h)continue;
      const e=edges[y*w+x];if(!e)continue;
      let delta=Math.abs(wrapPi(e.angle-expected));delta=Math.min(delta,Math.PI-delta);
      if(delta<=.38)hit=true;
    }
    if(hit)hits++;
  }
  return hits/samples;
}

function refineQuad(q:ScanQuadrilateral,edges:Array<EdgePixel|null>,w:number,h:number):ScanQuadrilateral|null{
  const p=quadPoints(q),fitted:Array<{p:ScanPoint;u:ScanPoint}>=[];
  for(let k=0;k<4;k++){
    const a=p[k]!,b=p[(k+1)%4]!,len=Math.hypot(b.x-a.x,b.y-a.y);if(len<5)return null;
    const ux=(b.x-a.x)/len,uy=(b.y-a.y)/len,expected=Math.atan2(ux,-uy),pts:ScanPoint[]=[];
    const x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-4)),x1=Math.min(w-1,Math.ceil(Math.max(a.x,b.x)+4));
    const y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-4)),y1=Math.min(h-1,Math.ceil(Math.max(a.y,b.y)+4));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const e=edges[y*w+x];if(!e)continue;
      let delta=Math.abs(wrapPi(e.angle-expected));delta=Math.min(delta,Math.PI-delta);if(delta>.38)continue;
      const dx=x-a.x,dy=y-a.y,t=(dx*ux+dy*uy)/len,off=-dx*uy+dy*ux;
      if(t>=.05&&t<=.95&&Math.abs(off)<=3.5)pts.push({x,y});
    }
    if(pts.length<10)return null;
    const cx=pts.reduce((s,v)=>s+v.x,0)/pts.length,cy=pts.reduce((s,v)=>s+v.y,0)/pts.length;
    let sxx=0,sxy=0,syy=0;for(const v of pts){const dx=v.x-cx,dy=v.y-cy;sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy;}
    const angle=.5*Math.atan2(2*sxy,sxx-syy);
    fitted.push({p:{x:cx,y:cy},u:{x:Math.cos(angle),y:Math.sin(angle)}});
  }
  const corners:ScanPoint[]=[];
  for(let k=0;k<4;k++){const hit=lineIntersection(fitted[(k+3)%4]!,fitted[k]!);if(!hit)return null;corners.push(hit);}
  const ordered=orderQuad(corners);if(!ordered)return null;
  const moved=quadPoints(ordered).some((v,i)=>Math.hypot(v.x-p[i]!.x,v.y-p[i]!.y)>7);
  return moved?null:ordered;
}

function lineIntersection(a:{p:ScanPoint;u:ScanPoint},b:{p:ScanPoint;u:ScanPoint}):ScanPoint|null{
  const det=a.u.x*b.u.y-a.u.y*b.u.x;if(Math.abs(det)<1e-7)return null;
  const dx=b.p.x-a.p.x,dy=b.p.y-a.p.y,t=(dx*b.u.y-dy*b.u.x)/det;
  const p={x:a.p.x+t*a.u.x,y:a.p.y+t*a.u.y};
  return Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
}
function intersect(a:PolarLine,b:PolarLine):ScanPoint|null{
  const c1=Math.cos(a.theta),s1=Math.sin(a.theta),c2=Math.cos(b.theta),s2=Math.sin(b.theta),det=c1*s2-s1*c2;
  if(Math.abs(det)<1e-7)return null;
  const p={x:(a.rho*s2-b.rho*s1)/det,y:(c1*b.rho-c2*a.rho)/det};
  return Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
}
function orderQuad(points:ScanPoint[]):ScanQuadrilateral|null{
  if(points.length!==4||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
  const cx=points.reduce((s,p)=>s+p.x,0)/4,cy=points.reduce((s,p)=>s+p.y,0)/4;
  const q=[...points].sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
  let first=0;for(let i=1;i<4;i++)if(q[i]!.x+q[i]!.y<q[first]!.x+q[first]!.y)first=i;
  const r=[...q.slice(first),...q.slice(0,first)];
  const cross=(o:ScanPoint,a:ScanPoint,b:ScanPoint)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const turns=r.map((p,i)=>cross(p,r[(i+1)%4]!,r[(i+2)%4]!));
  if(!(turns.every(v=>v>0)||turns.every(v=>v<0)))return null;
  return{topLeft:r[0]!,topRight:r[1]!,bottomRight:r[2]!,bottomLeft:r[3]!};
}
function areaRatio(q:ScanQuadrilateral,w:number,h:number):number{return clamp01(quadArea(q)/(w*h));}
function quadShapeScore(q:ScanQuadrilateral):number{
  const p=quadPoints(q),s=p.map((a,i)=>Math.hypot(a.x-p[(i+1)%4]!.x,a.y-p[(i+1)%4]!.y));
  const w=Math.min(s[0]!,s[2]!)/Math.max(s[0]!,s[2]!),h=Math.min(s[1]!,s[3]!)/Math.max(s[1]!,s[3]!);
  return clamp01((w+h)/2);
}
function quadArea(q:ScanQuadrilateral):number{const p=quadPoints(q);let s=0;for(let i=0;i<4;i++){const a=p[i]!,b=p[(i+1)%4]!;s+=a.x*b.y-b.x*a.y;}return Math.abs(s)/2;}
function quadPoints(q:ScanQuadrilateral):ScanPoint[]{return[q.topLeft,q.topRight,q.bottomRight,q.bottomLeft];}
function scaleQuad(q:ScanQuadrilateral,sx:number,sy:number):ScanQuadrilateral{const p=(v:ScanPoint)=>({x:v.x*sx,y:v.y*sy});return{topLeft:p(q.topLeft),topRight:p(q.topRight),bottomRight:p(q.bottomRight),bottomLeft:p(q.bottomLeft)};}
function wrapPi(v:number):number{while(v<=-Math.PI)v+=2*Math.PI;while(v>Math.PI)v-=2*Math.PI;return v;}
function clamp01(v:number):number{return Math.max(0,Math.min(1,v));}
