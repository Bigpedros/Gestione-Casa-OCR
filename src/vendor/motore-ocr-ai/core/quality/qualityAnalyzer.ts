import type {Box} from '../../contracts.js';

export interface QualityMetrics{
  sharpness:number;contrast:number;exposure:number;coverage:number;perspective:number;
  noise:number;glare:number;shadow:number;score:number;
  estimatedTextHeightPx?:number;estimatedEffectiveDpi?:number;
  decision:'continue'|'warning'|'reacquire';warnings:string[];
}
export interface RasterLike{width:number;height:number;data:Uint8ClampedArray|Uint8Array}
export function analyzeRasterQuality(image:RasterLike,pageBox?:Box):QualityMetrics{
  const {width,height,data}=image;
  if(width<4||height<4)return empty('reacquire','risoluzione insufficiente');
  const gray=new Float32Array(width*height);let mean=0,saturated=0,dark=0,ink=0,midtone=0;
  for(let i=0,p=0;i<data.length;i+=4,p++){
    const y=.299*data[i]!+.587*data[i+1]!+.114*data[i+2]!;
    gray[p]=y;mean+=y;if(y>250)saturated++;if(y<8)dark++;if(y<185)ink++;if(y>=40&&y<=235)midtone++;
  }
  mean/=gray.length;
  let variance=0,lapSum=0,lapSq=0,lapN=0,noiseSum=0,noiseN=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,v=gray[i]!;
    variance+=(v-mean)*(v-mean);
    const lap=4*v-gray[i-1]!-gray[i+1]!-gray[i-width]!-gray[i+width]!;
    lapSum+=lap;lapSq+=lap*lap;lapN++;
    const local=(gray[i-1]!+gray[i+1]!+gray[i-width]!+gray[i+width]!)/4;
    noiseSum+=Math.abs(v-local);noiseN++;
  }
  const std=Math.sqrt(variance/Math.max(1,gray.length-1));
  const lapMean=lapSum/Math.max(1,lapN),lapVar=lapSq/Math.max(1,lapN)-lapMean*lapMean;
  const sharpness=clamp01(lapVar/900);
  const contrast=clamp01(std/64);
  const whiteRatio=saturated/gray.length,blackRatio=dark/gray.length,inkRatio=ink/gray.length,midtoneRatio=midtone/gray.length;
  const blankPenalty=inkRatio<.003?.75:0;
  const burnPenalty=whiteRatio>.995?.7:whiteRatio>.985&&midtoneRatio<.02?.35:0;
  const darkPenalty=blackRatio>.65?.7:blackRatio>.35?.25:0;
  const exposure=clamp01(1-blankPenalty-burnPenalty-darkPenalty);
  const noise=clamp01(1-(noiseSum/Math.max(1,noiseN))/28);
  const coverage=pageBox?clamp01((pageBox.width*pageBox.height)/(width*height)):.85;
  const perspective=pageBox?clamp01(Math.min(pageBox.width/Math.max(1,pageBox.height),pageBox.height/Math.max(1,pageBox.width))/.55):.8;
  const tiles=tileMeans(gray,width,height,6,8),tileMean=tiles.reduce((a,b)=>a+b,0)/tiles.length;
  const tileStd=Math.sqrt(tiles.reduce((s,v)=>s+(v-tileMean)**2,0)/Math.max(1,tiles.length));
  const shadow=clamp01(1-tileStd/75);
  const glare=clamp01(inkRatio>.008?1-Math.max(0,whiteRatio-.985)*20:1-whiteRatio);
  const score=clamp01(.19*sharpness+.15*contrast+.14*exposure+.12*coverage+.10*perspective+.11*noise+.095*glare+.095*shadow);
  const warnings:string[]=[];
  if(sharpness<.35)warnings.push('blur/fuoco insufficiente');
  if(contrast<.3)warnings.push('contrasto insufficiente');
  if(exposure<.45)warnings.push('esposizione critica');
  if(coverage<.35)warnings.push('pagina poco coperta o tagliata');
  if(noise<.35)warnings.push('rumore/compressione elevati');
  if(glare<.5)warnings.push('riflessi/bruciature');
  if(shadow<.45)warnings.push('ombre/illuminazione non uniforme');
  return{sharpness,contrast,exposure,coverage,perspective,noise,glare,shadow,score,
    decision:score<.28?'reacquire':score<.52?'warning':'continue',warnings};
}
export function qualityFromCanvas(canvas:HTMLCanvasElement,pageBox?:Box):QualityMetrics{
  const max=900,scale=Math.min(1,max/Math.max(canvas.width,canvas.height));
  const w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
  const ctx=tmp.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(canvas,0,0,w,h);
  const scaledBox=pageBox?{x:pageBox.x*scale,y:pageBox.y*scale,width:pageBox.width*scale,height:pageBox.height*scale}:undefined;
  return analyzeRasterQuality({width:w,height:h,data:ctx.getImageData(0,0,w,h).data},scaledBox);
}
function tileMeans(gray:Float32Array,width:number,height:number,cols:number,rows:number):number[]{
  const out:number[]=[];for(let ry=0;ry<rows;ry++)for(let cx=0;cx<cols;cx++){
    const x0=Math.floor(cx*width/cols),x1=Math.floor((cx+1)*width/cols),y0=Math.floor(ry*height/rows),y1=Math.floor((ry+1)*height/rows);
    let sum=0,n=0;for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){sum+=gray[y*width+x]!;n++;}out.push(n?sum/n:0);
  }return out;
}
function empty(decision:QualityMetrics['decision'],warning:string):QualityMetrics{return{sharpness:0,contrast:0,exposure:0,coverage:0,perspective:0,noise:0,glare:0,shadow:0,score:0,decision,warnings:[warning]};}
function clamp01(v:number){return Math.max(0,Math.min(1,v));}
