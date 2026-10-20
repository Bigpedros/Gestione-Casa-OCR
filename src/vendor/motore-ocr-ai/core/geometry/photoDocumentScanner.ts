import {detectDocumentByEdges} from './photoDocumentEdgeDetector.js';
export interface ScanPoint{x:number;y:number}
export interface ScanQuadrilateral{topLeft:ScanPoint;topRight:ScanPoint;bottomRight:ScanPoint;bottomLeft:ScanPoint}
export interface PhotoScanMetadata{
  applied:boolean;
  confidence:number;
  sourceWidth:number;
  sourceHeight:number;
  outputWidth:number;
  outputHeight:number;
  corners?:ScanQuadrilateral;
  reason:string;
}
export interface PhotoScanResult{canvas:HTMLCanvasElement;metadata:PhotoScanMetadata}

export interface GrayImage{width:number;height:number;data:Uint8Array}

/**
 * Scanner fotografico generalista "stile Acrobat":
 * 1) riduzione per analisi;
 * 2) segmentazione luminanza documento/sfondo;
 * 3) componente principale;
 * 4) stima dei quattro angoli;
 * 5) omografia inversa e stesura prospettica.
 *
 * Fail-open: se il quadrilatero non è affidabile restituisce l'originale.
 */
export function scanPhotographedDocument(source:HTMLCanvasElement,maxOutputDimension=2600):PhotoScanResult{
  const sourceWidth=source.width,sourceHeight=source.height;
  if(sourceWidth<160||sourceHeight<160){
    return{canvas:source,metadata:{applied:false,confidence:0,sourceWidth,sourceHeight,outputWidth:sourceWidth,outputHeight:sourceHeight,reason:'immagine troppo piccola'}};
  }
  const analysis=downscaleToGray(source,900);
  const detection=detectDocumentQuadrilateral(analysis);
  if(!detection||detection.confidence<.58){
    return{canvas:source,metadata:{applied:false,confidence:detection?.confidence??0,sourceWidth,sourceHeight,outputWidth:sourceWidth,outputHeight:sourceHeight,reason:detection?.reason??'quadrilatero documento non affidabile'}};
  }

  const sx=sourceWidth/analysis.width,sy=sourceHeight/analysis.height;
  const corners=scaleQuad(detection.corners,sx,sy);
  const target=targetSize(corners,maxOutputDimension);
  if(target.width<120||target.height<120){
    return{canvas:source,metadata:{applied:false,confidence:detection.confidence,sourceWidth,sourceHeight,outputWidth:sourceWidth,outputHeight:sourceHeight,corners,reason:'dimensione rettificata non valida'}};
  }

  const canvas=warpPerspective(source,corners,target.width,target.height);
  return{
    canvas,
    metadata:{
      applied:true,
      confidence:detection.confidence,
      sourceWidth,sourceHeight,
      outputWidth:canvas.width,outputHeight:canvas.height,
      corners,
      reason:'documento rilevato e rettificato prospetticamente'
    }
  };
}

export function detectDocumentQuadrilateral(gray:GrayImage):{corners:ScanQuadrilateral;confidence:number;reason:string}|null{
  const luminance=detectDocumentByLuminance(gray);
  const edge=detectDocumentByEdges(gray);
  if(!luminance)return edge;
  if(!edge)return luminance;

  const disagreement=meanCornerDistance(luminance.corners,edge.corners)/Math.max(1,Math.hypot(gray.width,gray.height));
  if(disagreement<=.055){
    const lw=Math.max(.05,luminance.confidence),ew=Math.max(.05,edge.confidence),sum=lw+ew;
    const corners=blendQuad(luminance.corners,edge.corners,lw/sum,ew/sum);
    const agreementBonus=(.055-disagreement)/.055*.12;
    return{
      corners,
      confidence:clamp01(Math.max(luminance.confidence,edge.confidence)+agreementBonus),
      reason:'quadrilatero confermato da segmentazione luminanza e bordi indipendenti'
    };
  }

  // Strong disagreement means the two evidence families found different objects.
  // Keep the more authoritative candidate instead of averaging incompatible geometry.
  const luminanceScore=luminance.confidence+.04*quadrilateralRectangularity(luminance.corners);
  const edgeScore=edge.confidence+.06*quadrilateralRectangularity(edge.corners);
  return edgeScore>luminanceScore?{...edge,reason:`${edge.reason}; detector luminanza divergente`}:{...luminance,reason:`${luminance.reason}; detector bordi divergente`};
}

function detectDocumentByLuminance(gray:GrayImage):{corners:ScanQuadrilateral;confidence:number;reason:string}|null{
  const {width,height,data}=gray;
  if(width<20||height<20||data.length!==width*height)return null;

  const border=sampleBorder(data,width,height);
  const center=sampleCenter(data,width,height);
  const otsu=otsuThreshold(data);
  const brightDocument=center.mean>=border.mean+10;
  const threshold=brightDocument
    ?Math.min(245,Math.max(otsu,border.mean+12))
    :Math.max(12,Math.min(otsu,border.mean-12));
  const mask=new Uint8Array(width*height);
  for(let i=0;i<data.length;i++)mask[i]=brightDocument?(data[i]!>=threshold?1:0):(data[i]!<=threshold?1:0);

  smoothMask(mask,width,height);
  const component=largestCentralComponent(mask,width,height);
  if(!component||component.points.length<width*height*.08){
    return null;
  }

  const points=component.points;
  let tl=points[0]!,tr=points[0]!,br=points[0]!,bl=points[0]!;
  let minSum=Infinity,maxSum=-Infinity,maxDiff=-Infinity,minDiff=Infinity;
  for(const point of points){
    const sum=point.x+point.y,diff=point.x-point.y;
    if(sum<minSum){minSum=sum;tl=point;}
    if(sum>maxSum){maxSum=sum;br=point;}
    if(diff>maxDiff){maxDiff=diff;tr=point;}
    if(diff<minDiff){minDiff=diff;bl=point;}
  }
  const corners={topLeft:tl,topRight:tr,bottomRight:br,bottomLeft:bl};
  const area=quadArea(corners);
  const imageArea=width*height;
  const areaRatio=area/imageArea;
  const contrast=Math.min(1,Math.abs(center.mean-border.mean)/70);
  const rectangularity=quadrilateralRectangularity(corners);
  const edgeMargin=cornerSpread(corners,width,height);
  const confidence=clamp01(.34*clamp01((areaRatio-.12)/.55)+.30*contrast+.24*rectangularity+.12*edgeMargin);

  if(areaRatio<.16)return{corners,confidence:Math.min(confidence,.45),reason:'area documento troppo piccola'};
  if(rectangularity<.35)return{corners,confidence:Math.min(confidence,.5),reason:'contorno non sufficientemente quadrilatero'};
  return{corners,confidence,reason:'quadrilatero fotografico rilevato'};
}

export function computeHomography(dst:ScanQuadrilateral,src:ScanQuadrilateral):number[]{
  const d=[dst.topLeft,dst.topRight,dst.bottomRight,dst.bottomLeft];
  const s=[src.topLeft,src.topRight,src.bottomRight,src.bottomLeft];
  const a:number[][]=[],b:number[]=[];
  for(let i=0;i<4;i++){
    const x=d[i]!.x,y=d[i]!.y,u=s[i]!.x,v=s[i]!.y;
    a.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);
    a.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);
  }
  const h=solveLinearSystem(a,b);
  return[h[0]!,h[1]!,h[2]!,h[3]!,h[4]!,h[5]!,h[6]!,h[7]!,1];
}

export function projectPoint(h:number[],x:number,y:number):ScanPoint{
  const den=h[6]!*x+h[7]!*y+h[8]!;
  return{x:(h[0]!*x+h[1]!*y+h[2]!)/den,y:(h[3]!*x+h[4]!*y+h[5]!)/den};
}

function warpPerspective(source:HTMLCanvasElement,corners:ScanQuadrilateral,width:number,height:number):HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const srcCtx=source.getContext('2d',{willReadFrequently:true})!;
  const src=srcCtx.getImageData(0,0,source.width,source.height);
  const outCtx=canvas.getContext('2d',{willReadFrequently:true})!;
  const out=outCtx.createImageData(width,height);
  const dstQuad:ScanQuadrilateral={
    topLeft:{x:0,y:0},topRight:{x:width-1,y:0},
    bottomRight:{x:width-1,y:height-1},bottomLeft:{x:0,y:height-1}
  };
  const h=computeHomography(dstQuad,corners);
  const sd=src.data,od=out.data,sw=source.width,sh=source.height;
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const p=projectPoint(h,x,y);
      const sx=Math.max(0,Math.min(sw-1,p.x)),sy=Math.max(0,Math.min(sh-1,p.y));
      const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1);
      const fx=sx-x0,fy=sy-y0;
      const i00=(y0*sw+x0)*4,i10=(y0*sw+x1)*4,i01=(y1*sw+x0)*4,i11=(y1*sw+x1)*4;
      const oi=(y*width+x)*4;
      for(let c=0;c<3;c++){
        const top=sd[i00+c]!*(1-fx)+sd[i10+c]!*fx;
        const bottom=sd[i01+c]!*(1-fx)+sd[i11+c]!*fx;
        od[oi+c]=top*(1-fy)+bottom*fy;
      }
      od[oi+3]=255;
    }
  }
  outCtx.putImageData(out,0,0);
  return canvas;
}

function targetSize(corners:ScanQuadrilateral,maxDimension:number):{width:number;height:number}{
  const top=distance(corners.topLeft,corners.topRight),bottom=distance(corners.bottomLeft,corners.bottomRight);
  const left=distance(corners.topLeft,corners.bottomLeft),right=distance(corners.topRight,corners.bottomRight);
  let width=Math.max(top,bottom),height=Math.max(left,right);
  const scale=Math.min(1,maxDimension/Math.max(width,height));
  width=Math.max(1,Math.round(width*scale));height=Math.max(1,Math.round(height*scale));
  return{width,height};
}

function downscaleToGray(source:HTMLCanvasElement,maxDimension:number):GrayImage{
  const scale=Math.min(1,maxDimension/Math.max(source.width,source.height));
  const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  ctx.drawImage(source,0,0,width,height);
  const rgba=ctx.getImageData(0,0,width,height).data;
  const data=new Uint8Array(width*height);
  for(let i=0,p=0;i<rgba.length;i+=4,p++)data[p]=Math.round(rgba[i]!*.299+rgba[i+1]!*.587+rgba[i+2]!*.114);
  return{width,height,data};
}

function largestCentralComponent(mask:Uint8Array,width:number,height:number):{points:ScanPoint[]}|null{
  const visited=new Uint8Array(mask.length);
  let best:ScanPoint[]=[];
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]] as const;
  for(let y=0;y<height;y+=2)for(let x=0;x<width;x+=2){
    const start=y*width+x;if(!mask[start]||visited[start])continue;
    const queue:number[]=[start];visited[start]=1;const points:ScanPoint[]=[];
    for(let qi=0;qi<queue.length;qi++){
      const idx=queue[qi]!,px=idx%width,py=Math.floor(idx/width);points.push({x:px,y:py});
      for(const [dx,dy] of dirs){
        const nx=px+dx,ny=py+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
        const ni=ny*width+nx;if(mask[ni]&&!visited[ni]){visited[ni]=1;queue.push(ni);}
      }
    }
    if(points.length>best.length)best=points;
  }
  return best.length?{points:best}:null;
}

function smoothMask(mask:Uint8Array,width:number,height:number):void{
  const copy=mask.slice();
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    let count=0;
    for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)count+=copy[(y+yy)*width+x+xx]!;
    mask[y*width+x]=count>=5?1:0;
  }
}

function sampleBorder(data:Uint8Array,width:number,height:number):{mean:number}{
  let sum=0,count=0;const band=Math.max(2,Math.floor(Math.min(width,height)*.04));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<band||x>=width-band||y<band||y>=height-band){sum+=data[y*width+x]!;count++;}
  return{mean:count?sum/count:0};
}
function sampleCenter(data:Uint8Array,width:number,height:number):{mean:number}{
  const x0=Math.floor(width*.28),x1=Math.ceil(width*.72),y0=Math.floor(height*.18),y1=Math.ceil(height*.82);
  let sum=0,count=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){sum+=data[y*width+x]!;count++;}
  return{mean:count?sum/count:0};
}
function otsuThreshold(data:Uint8Array):number{
  const hist=new Uint32Array(256);for(const value of data)hist[value]!++;
  const total=data.length;let sum=0;for(let i=0;i<256;i++)sum+=i*(hist[i]??0);
  let sumB=0,wB=0,max=0,threshold=128;
  for(let i=0;i<256;i++){
    wB+=hist[i]??0;if(!wB)continue;const wF=total-wB;if(!wF)break;
    sumB+=i*(hist[i]??0);const mB=sumB/wB,mF=(sum-sumB)/wF;
    const between=wB*wF*(mB-mF)*(mB-mF);if(between>max){max=between;threshold=i;}
  }
  return threshold;
}
function blendQuad(a:ScanQuadrilateral,b:ScanQuadrilateral,wa:number,wb:number):ScanQuadrilateral{
  const p=(x:ScanPoint,y:ScanPoint)=>({x:x.x*wa+y.x*wb,y:x.y*wa+y.y*wb});
  return{topLeft:p(a.topLeft,b.topLeft),topRight:p(a.topRight,b.topRight),bottomRight:p(a.bottomRight,b.bottomRight),bottomLeft:p(a.bottomLeft,b.bottomLeft)};
}
function meanCornerDistance(a:ScanQuadrilateral,b:ScanQuadrilateral):number{
  return(
    distance(a.topLeft,b.topLeft)+distance(a.topRight,b.topRight)+
    distance(a.bottomRight,b.bottomRight)+distance(a.bottomLeft,b.bottomLeft)
  )/4;
}
function scaleQuad(q:ScanQuadrilateral,sx:number,sy:number):ScanQuadrilateral{
  const p=(v:ScanPoint)=>({x:v.x*sx,y:v.y*sy});
  return{topLeft:p(q.topLeft),topRight:p(q.topRight),bottomRight:p(q.bottomRight),bottomLeft:p(q.bottomLeft)};
}
function quadArea(q:ScanQuadrilateral):number{
  const p=[q.topLeft,q.topRight,q.bottomRight,q.bottomLeft];let sum=0;
  for(let i=0;i<4;i++){const a=p[i]!,b=p[(i+1)%4]!;sum+=a.x*b.y-b.x*a.y;}return Math.abs(sum)/2;
}
function quadrilateralRectangularity(q:ScanQuadrilateral):number{
  const sides=[distance(q.topLeft,q.topRight),distance(q.topRight,q.bottomRight),distance(q.bottomRight,q.bottomLeft),distance(q.bottomLeft,q.topLeft)];
  if(Math.min(...sides)<5)return 0;
  const oppW=Math.min(sides[0]!,sides[2]!)/Math.max(sides[0]!,sides[2]!);
  const oppH=Math.min(sides[1]!,sides[3]!)/Math.max(sides[1]!,sides[3]!);
  return clamp01((oppW+oppH)/2);
}
function cornerSpread(q:ScanQuadrilateral,width:number,height:number):number{
  const xs=[q.topLeft.x,q.topRight.x,q.bottomRight.x,q.bottomLeft.x],ys=[q.topLeft.y,q.topRight.y,q.bottomRight.y,q.bottomLeft.y];
  return clamp01(((Math.max(...xs)-Math.min(...xs))/width+(Math.max(...ys)-Math.min(...ys))/height)/2);
}
function distance(a:ScanPoint,b:ScanPoint):number{return Math.hypot(a.x-b.x,a.y-b.y);}
function clamp01(v:number):number{return Math.max(0,Math.min(1,v));}
function solveLinearSystem(a:number[][],b:number[]):number[]{
  const n=b.length,m=a.map((row,i)=>[...row,b[i]!]);
  for(let col=0;col<n;col++){
    let pivot=col;for(let row=col+1;row<n;row++)if(Math.abs(m[row]![col]!)>Math.abs(m[pivot]![col]!))pivot=row;
    [m[col],m[pivot]]=[m[pivot]!,m[col]!];
    const div=m[col]![col]!;if(Math.abs(div)<1e-10)throw new Error('Omografia degenerata.');
    for(let j=col;j<=n;j++)m[col]![j]!/=div;
    for(let row=0;row<n;row++){if(row===col)continue;const factor=m[row]![col]!;for(let j=col;j<=n;j++)m[row]![j]!-=factor*m[col]![j]!;}
  }
  return m.map(row=>row[n]!);
}
