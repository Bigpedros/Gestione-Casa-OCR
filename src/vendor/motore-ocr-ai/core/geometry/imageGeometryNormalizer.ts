export interface RasterGeometryMetadata{
  orientationDegrees:0|90|180|270;
  deskewDegrees:number;
  deskewApplied:boolean;
  dewarpApplied:boolean;
  dewarpStrength:number;
  confidence:number;
}
export interface RasterGeometryResult{canvas:HTMLCanvasElement;metadata:RasterGeometryMetadata}

/**
 * Correzione geometrica conservativa dopo la rettifica prospettica.
 * - orientation: confronta energia di proiezione orizzontale/verticale;
 * - deskew: ricerca l'angolo che massimizza l'allineamento delle righe;
 * - dewarp: correzione row-wise solo se la deriva dei centroidi di inchiostro è coerente e moderata.
 */
export function normalizeRasterGeometry(source:HTMLCanvasElement,orientationDegrees:0|90|180|270=0):RasterGeometryResult{
  let canvas=source;
  // L'orientamento 0/90/180/270 viene deciso dal provider OCR confrontando
  // la leggibilità reale delle quattro rotazioni. Qui applichiamo solo deskew/dewarp.
  const orientation=orientationDegrees;
  const deskew=estimateDeskew(canvas);
  if(Math.abs(deskew.angle)>=.18&&deskew.confidence>=.45)canvas=rotateArbitrary(canvas,-deskew.angle);
  const dewarp=estimateRowCurvature(canvas);
  let dewarpApplied=false;
  if(dewarp.confidence>=.62&&dewarp.strength>=1.5&&dewarp.strength<=18){
    canvas=applyRowDewarp(canvas,dewarp.offsets);
    dewarpApplied=true;
  }
  return{canvas,metadata:{
    orientationDegrees:orientation,
    deskewDegrees:deskew.angle,
    deskewApplied:Math.abs(deskew.angle)>=.18&&deskew.confidence>=.45,
    dewarpApplied,
    dewarpStrength:dewarp.strength,
    confidence:Math.max(deskew.confidence,dewarp.confidence,orientation===0?.5:.7)
  }};
}

export function estimateDeskew(canvas:HTMLCanvasElement):{angle:number;confidence:number}{
  const gray=sampleGray(canvas,700);
  const points=darkPoints(gray,150,4);
  if(points.length<100)return{angle:0,confidence:0};
  let bestAngle=0,best=-Infinity,second=-Infinity;
  for(let a=-5;a<=5;a+=.25){
    const rad=a*Math.PI/180,s=Math.sin(rad),c=Math.cos(rad);
    const bins=new Map<number,number>();
    for(const p of points){
      const y=Math.round((p.y*c-p.x*s)/3);
      bins.set(y,(bins.get(y)??0)+1);
    }
    let score=0;for(const v of bins.values())score+=v*v;
    if(score>best){second=best;best=score;bestAngle=a;}else if(score>second)second=score;
  }
  const confidence=best>0?Math.max(0,Math.min(1,(best-second)/best*18)):0;
  return{angle:Math.round(bestAngle*100)/100,confidence};
}

export function estimateOrientation(canvas:HTMLCanvasElement):0|90|180|270{
  const gray=sampleGray(canvas,500);
  const row=projectionVariance(gray,true),col=projectionVariance(gray,false);
  const left=bandInk(gray,'left'),right=bandInk(gray,'right');
  if(col>row*1.35){
    // 90/270 possono essere suggeriti geometricamente, ma 180° non è affidabile
    // senza OCR: la densità header/footer su ricevute e moduli produce falsi positivi.
    return right>left*1.7?270:90;
  }
  return 0;
}

function estimateRowCurvature(canvas:HTMLCanvasElement):{offsets:Float32Array;strength:number;confidence:number}{
  const gray=sampleGray(canvas,700);
  const rows=Math.min(120,gray.height);
  const offsets=new Float32Array(canvas.height);
  const centers:number[]=[];
  for(let r=0;r<rows;r++){
    const y0=Math.floor(r*gray.height/rows),y1=Math.max(y0+1,Math.floor((r+1)*gray.height/rows));
    let sumX=0,n=0;
    for(let y=y0;y<y1;y++)for(let x=0;x<gray.width;x+=2)if(gray.data[y*gray.width+x]!<145){sumX+=x;n++;}
    centers.push(n>10?sumX/n:NaN);
  }
  const valid=centers.map((v,i)=>({v,i})).filter(x=>Number.isFinite(x.v));
  if(valid.length<rows*.45)return{offsets,strength:0,confidence:0};
  const xs=valid.map(x=>x.i),ys=valid.map(x=>x.v);
  const fit=quadraticFit(xs,ys);
  const mid=(gray.width-1)/2;
  let max=0,residual=0;
  for(const {i,v} of valid){
    const predicted=fit.a*i*i+fit.b*i+fit.c;
    residual+=Math.abs(v-predicted);
    max=Math.max(max,Math.abs(predicted-mid));
  }
  const scaleX=canvas.width/gray.width;
  for(let y=0;y<canvas.height;y++){
    const ri=y/canvas.height*(rows-1);
    const predicted=fit.a*ri*ri+fit.b*ri+fit.c;
    offsets[y]=(mid-predicted)*scaleX;
  }
  const avgResidual=residual/valid.length;
  const strength=max*scaleX;
  const confidence=Math.max(0,Math.min(1,(1-avgResidual/25)*Math.min(1,strength/8)));
  return{offsets,strength,confidence};
}
function applyRowDewarp(source:HTMLCanvasElement,offsets:Float32Array):HTMLCanvasElement{
  const out=document.createElement('canvas');out.width=source.width;out.height=source.height;
  const src=source.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,source.width,source.height);
  const dst=out.getContext('2d',{willReadFrequently:true})!.createImageData(out.width,out.height);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const sx=Math.max(0,Math.min(source.width-1,Math.round(x-offsets[y]!)));
    const si=(y*source.width+sx)*4,di=(y*source.width+x)*4;
    dst.data[di]=src.data[si]!;dst.data[di+1]=src.data[si+1]!;dst.data[di+2]=src.data[si+2]!;dst.data[di+3]=255;
  }
  out.getContext('2d')!.putImageData(dst,0,0);return out;
}
export function rotateRightAngle(source:HTMLCanvasElement,degrees:90|180|270):HTMLCanvasElement{
  const out=document.createElement('canvas');
  out.width=degrees===180?source.width:source.height;out.height=degrees===180?source.height:source.width;
  const ctx=out.getContext('2d')!;ctx.translate(out.width/2,out.height/2);ctx.rotate((degrees*Math.PI)/180);ctx.drawImage(source,-source.width/2,-source.height/2);return out;
}
function rotateArbitrary(source:HTMLCanvasElement,degrees:number):HTMLCanvasElement{
  const rad=degrees*Math.PI/180,c=Math.abs(Math.cos(rad)),s=Math.abs(Math.sin(rad));
  const out=document.createElement('canvas');out.width=Math.ceil(source.width*c+source.height*s);out.height=Math.ceil(source.width*s+source.height*c);
  const ctx=out.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,out.width,out.height);ctx.translate(out.width/2,out.height/2);ctx.rotate(rad);ctx.drawImage(source,-source.width/2,-source.height/2);return out;
}
interface Gray{width:number;height:number;data:Uint8Array}
function sampleGray(source:HTMLCanvasElement,max:number):Gray{
  const scale=Math.min(1,max/Math.max(source.width,source.height)),w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,w,h);
  const rgba=ctx.getImageData(0,0,w,h).data,d=new Uint8Array(w*h);for(let i=0,p=0;i<rgba.length;i+=4,p++)d[p]=Math.round(.299*rgba[i]!+.587*rgba[i+1]!+.114*rgba[i+2]!);return{width:w,height:h,data:d};
}
function darkPoints(gray:Gray,threshold:number,step:number){const pts:Array<{x:number;y:number}>=[];for(let y=0;y<gray.height;y+=step)for(let x=0;x<gray.width;x+=step)if(gray.data[y*gray.width+x]!<threshold)pts.push({x,y});return pts;}
function bandInk(gray:Gray,side:'top'|'bottom'|'left'|'right'){
  let dark=0,n=0;const x0=side==='left'?0:side==='right'?Math.floor(gray.width*.7):0,x1=side==='left'?Math.ceil(gray.width*.3):gray.width;
  const y0=side==='top'?0:side==='bottom'?Math.floor(gray.height*.7):0,y1=side==='top'?Math.ceil(gray.height*.3):gray.height;
  for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){n++;if(gray.data[y*gray.width+x]!<150)dark++;}return dark/Math.max(1,n);
}
function projectionVariance(gray:Gray,rows:boolean){const outer=rows?gray.height:gray.width,inner=rows?gray.width:gray.height,vals:number[]=[];for(let o=0;o<outer;o++){let n=0;for(let i=0;i<inner;i++){const idx=rows?o*gray.width+i:i*gray.width+o;if(gray.data[idx]!<150)n++;}vals.push(n);}const mean=vals.reduce((a,b)=>a+b,0)/vals.length;return vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length;}
function quadraticFit(xs:number[],ys:number[]):{a:number;b:number;c:number}{let n=xs.length,sx=0,sx2=0,sx3=0,sx4=0,sy=0,sxy=0,sx2y=0;for(let i=0;i<n;i++){const x=xs[i]!,y=ys[i]!,x2=x*x;sx+=x;sx2+=x2;sx3+=x2*x;sx4+=x2*x2;sy+=y;sxy+=x*y;sx2y+=x2*y;}const A=[[sx4,sx3,sx2],[sx3,sx2,sx],[sx2,sx,n]],B=[sx2y,sxy,sy];const sol=solve3(A,B);return{a:sol[0],b:sol[1],c:sol[2]};}
function solve3(A:number[][],b:number[]):[number,number,number]{const m=A.map((r,i)=>[...r,b[i]!]);for(let col=0;col<3;col++){
    let pivot=col;
    for(let row=col+1;row<3;row++)if(Math.abs(m[row]?.[col]??0)>Math.abs(m[pivot]?.[col]??0))pivot=row;
    const tmp=m[col]!;m[col]=m[pivot]!;m[pivot]=tmp;
    const pivotRow=m[col]!,div=pivotRow[col]??1e-9;
    for(let j=col;j<4;j++)pivotRow[j]=(pivotRow[j]??0)/div;
    for(let row=0;row<3;row++){
      if(row===col)continue;
      const rowData=m[row]!,factor=rowData[col]??0;
      for(let j=col;j<4;j++)rowData[j]=(rowData[j]??0)-factor*(pivotRow[j]??0);
    }
  }return[m[0]?.[3]??0,m[1]?.[3]??0,m[2]?.[3]??0];}
