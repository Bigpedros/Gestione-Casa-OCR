export interface CameraCleanupMetrics{
  applied:boolean;
  level:number;
  backgroundVariationBefore:number;
  backgroundVariationAfter:number;
  meanPaperBrightnessBefore:number;
  meanPaperBrightnessAfter:number;
  despeckledPixels:number;
}

export interface CameraCleanupResult{
  canvas:HTMLCanvasElement;
  metrics:CameraCleanupMetrics;
}

/**
 * Camera-photo cleanup inspired by PdfCraft/ArtCraft:
 * - per-channel paper illumination map from local bright percentiles;
 * - neighbourhood lifting to avoid treating ink/stamps/photos as paper;
 * - smooth background interpolation;
 * - colour-preserving illumination division + contrast stretch;
 * - isolated dark-speck removal at stronger levels.
 */
export function cleanCameraDocument(source:HTMLCanvasElement,level=60):CameraCleanupResult{
  const strength=Math.max(0,Math.min(100,level));
  if(strength===0)return{canvas:source,metrics:emptyMetrics(0)};

  const ctx=source.getContext('2d',{willReadFrequently:true});
  if(!ctx)return{canvas:source,metrics:emptyMetrics(strength)};
  const image=ctx.getImageData(0,0,source.width,source.height);
  const before=measureBackgroundVariation(image.data,source.width,source.height);
  const cleaned=cleanRgba(image.data,source.width,source.height,strength);
  const out=document.createElement('canvas');out.width=source.width;out.height=source.height;
  const octx=out.getContext('2d',{willReadFrequently:true})!;
  const outImage=octx.createImageData(out.width,out.height);
  outImage.data.set(cleaned.data);octx.putImageData(outImage,0,0);
  const after=measureBackgroundVariation(cleaned.data,out.width,out.height);
  return{canvas:out,metrics:{
    applied:true,level:strength,
    backgroundVariationBefore:before.variation,
    backgroundVariationAfter:after.variation,
    meanPaperBrightnessBefore:before.paper,
    meanPaperBrightnessAfter:after.paper,
    despeckledPixels:cleaned.despeckled
  }};
}

export function cleanRgba(input:Uint8ClampedArray,width:number,height:number,level=60):{data:Uint8ClampedArray;despeckled:number}{
  if(width<=0||height<=0||input.length!==width*height*4)return{data:input.slice(),despeckled:0};
  const k=Math.max(0,Math.min(100,level))/100;
  if(k===0)return{data:input.slice(),despeckled:0};

  const bg=estimateBackground(input,width,height);
  const flatten=Math.min(1,2*k),white=1-.12*k,black=.30*k;
  const out=input.slice();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,b=backgroundAt(bg,x,y);
    for(let c=0;c<3;c++){
      const v=input[i+c]!/255,base=Math.max(.05,b[c]!);
      const even=Math.min(1,v/base);
      const flat=v+(even-v)*flatten;
      const stretched=Math.max(0,Math.min(1,(flat-black)/Math.max(.05,white-black)));
      out[i+c]=Math.round(stretched*255);
    }
    out[i+3]=255;
  }
  const despeckled=k>=.6?despeckle(out,width,height):0;
  return{data:out,despeckled};
}

interface BackgroundMap{cols:number;rows:number;block:number;cells:Array<[number,number,number]>}
function estimateBackground(data:Uint8ClampedArray,w:number,h:number):BackgroundMap{
  const block=Math.max(8,Math.min(128,Math.floor(Math.min(w,h)/16)));
  const cols=Math.ceil(w/block),rows=Math.ceil(h/block);
  const cells:Array<[number,number,number]>=[];

  for(let by=0;by<rows;by++)for(let bx=0;bx<cols;bx++){
    const hist=[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)];
    let n=0;
    for(let y=by*block;y<Math.min(h,(by+1)*block);y++)for(let x=bx*block;x<Math.min(w,(bx+1)*block);x++){
      const i=(y*w+x)*4;
      const r=data[i]!,g=data[i+1]!,b=data[i+2]!;
      hist[0]![r]=(hist[0]![r]??0)+1;
      hist[1]![g]=(hist[1]![g]??0)+1;
      hist[2]![b]=(hist[2]![b]??0)+1;
      n++;
    }
    const target=Math.floor(n*.9);
    cells.push([0,1,2].map(c=>percentile(hist[c]!,target)/255) as [number,number,number]);
  }

  const get=(arr:Array<[number,number,number]>,x:number,y:number)=>{
    const xx=Math.max(0,Math.min(cols-1,x)),yy=Math.max(0,Math.min(rows-1,y));
    return arr[yy*cols+xx]??[1,1,1] as [number,number,number];
  };

  const lifted:Array<[number,number,number]>=[];
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const own=get(cells,x,y);
    const channels:[number,number,number]=[0,0,0];
    for(let c=0;c<3;c++){
      const around:number[]=[];
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)around.push(get(cells,x+dx,y+dy)[c]!);
      around.sort((a,b)=>a-b);
      channels[c]=Math.max(own[c]!,around[Math.min(around.length-1,18)]??1);
    }
    lifted.push(channels);
  }

  let smooth=lifted;
  for(let pass=0;pass<2;pass++){
    const next:Array<[number,number,number]>=[];
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const sum:[number,number,number]=[0,0,0];let n=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const v=get(smooth,x+dx,y+dy);
        sum[0]+=v[0];sum[1]+=v[1];sum[2]+=v[2];n++;
      }
      next.push([sum[0]/n,sum[1]/n,sum[2]/n]);
    }
    smooth=next;
  }
  return{cols,rows,block,cells:smooth};
}
function backgroundAt(bg:BackgroundMap,x:number,y:number):[number,number,number]{
  const fx=(x+.5)/bg.block-.5,fy=(y+.5)/bg.block-.5;
  const x0=Math.floor(fx),y0=Math.floor(fy),ax=fx-x0,ay=fy-y0;
  const cell=(cx:number,cy:number)=>bg.cells[Math.max(0,Math.min(bg.rows-1,cy))*bg.cols+Math.max(0,Math.min(bg.cols-1,cx))]??[1,1,1] as [number,number,number];
  const a=cell(x0,y0),b=cell(x0+1,y0),c=cell(x0,y0+1),d=cell(x0+1,y0+1);
  return [0,1,2].map(i=>{
    const top=a[i]!*(1-ax)+b[i]!*ax,bottom=c[i]!*(1-ax)+d[i]!*ax;
    return top*(1-ay)+bottom*ay;
  }) as [number,number,number];
}
function percentile(hist:Uint32Array,target:number):number{
  let seen=0;for(let i=0;i<256;i++){seen+=hist[i]!;if(seen>target)return i;}return 255;
}
function despeckle(data:Uint8ClampedArray,w:number,h:number):number{
  const dark=new Uint8Array(w*h);
  for(let i=0,p=0;i<data.length;i+=4,p++)dark[p]=(.299*data[i]!+.587*data[i+1]!+.114*data[i+2]!)<128?1:0;
  let removed=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x;if(!dark[p])continue;let neighbours=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(dx===0&&dy===0)continue;const xx=x+dx,yy=y+dy;
      if(xx>=0&&yy>=0&&xx<w&&yy<h&&dark[yy*w+xx])neighbours++;
    }
    if(neighbours<=1){
      const i=p*4;data[i]=data[i+1]=data[i+2]=255;removed++;
    }
  }
  return removed;
}
function measureBackgroundVariation(data:Uint8ClampedArray,w:number,h:number):{variation:number;paper:number}{
  const cols=6,rows=8,values:number[]=[];
  for(let ry=0;ry<rows;ry++)for(let cx=0;cx<cols;cx++){
    const samples:number[]=[];
    const x0=Math.floor(cx*w/cols),x1=Math.floor((cx+1)*w/cols),y0=Math.floor(ry*h/rows),y1=Math.floor((ry+1)*h/rows);
    for(let y=y0;y<y1;y+=3)for(let x=x0;x<x1;x+=3){
      const i=(y*w+x)*4;samples.push(.299*data[i]!+.587*data[i+1]!+.114*data[i+2]!);
    }
    samples.sort((a,b)=>a-b);values.push(samples[Math.floor(samples.length*.9)]??255);
  }
  const mean=values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
  const variance=Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,values.length));
  return{variation:Math.round(variance*10)/10,paper:Math.round(mean*10)/10};
}
function emptyMetrics(level:number):CameraCleanupMetrics{return{applied:false,level,backgroundVariationBefore:0,backgroundVariationAfter:0,meanPaperBrightnessBefore:0,meanPaperBrightnessAfter:0,despeckledPixels:0};}
