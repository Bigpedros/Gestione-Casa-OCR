export interface RasterGeometryMetadata{
  orientationDegrees:0|90|180|270;
  deskewDegrees:number;
  deskewApplied:boolean;
  residualSkewDegrees?:number;
  dewarpApplied:boolean;
  dewarpStrength:number;
  curvatureMaxDeviationPx?:number;
  curvatureMeanDeviationPx?:number;
  residualCurvatureMaxDeviationPx?:number;
  confidence:number;
}
export interface RasterGeometryResult{canvas:HTMLCanvasElement;metadata:RasterGeometryMetadata}

interface Gray{width:number;height:number;data:Uint8Array;scaleX:number;scaleY:number}
interface LineTrace{
  points:Array<{x:number;y:number}>;
  slope:number;
  intercept:number;
  angle:number;
  maxDeviation:number;
  meanDeviation:number;
  yMean:number;
}

/**
 * Correzione geometrica conservativa dopo la rettifica prospettica.
 * 1. deskew da linee continue reali, con fallback proiettivo;
 * 2. stima della curvatura locale sulle stesse linee;
 * 3. dewarp verticale 2D smorzato;
 * 4. guardian regressivo: la trasformazione viene mantenuta solo se il residuo migliora.
 * Nessuna normalizzazione A4 è imposta nel core.
 */
export function normalizeRasterGeometry(source:HTMLCanvasElement,orientationDegrees:0|90|180|270=0):RasterGeometryResult{
  let canvas=source;
  const orientation=orientationDegrees;

  const before=analyzeCanvasGeometry(canvas);
  const deskew=estimateDeskew(canvas);
  const deskewApplied=Math.abs(deskew.angle)>=.18&&deskew.confidence>=.45;
  if(deskewApplied)canvas=rotateArbitrary(canvas,-deskew.angle);

  const afterDeskew=analyzeCanvasGeometry(canvas);
  const dewarpPlan=buildDewarpPlan(canvas,afterDeskew.lines);
  let dewarpApplied=false;
  let dewarpStrength=dewarpPlan.strength;
  let residual=afterDeskew;

  if(dewarpPlan.confidence>=.62&&dewarpPlan.strength>=2&&dewarpPlan.strength<=18&&afterDeskew.lines.length>=3){
    const candidate=applyVerticalDewarp(canvas,dewarpPlan);
    const candidateResidual=analyzeCanvasGeometry(candidate);
    const improved=afterDeskew.maxCurvature>0&&candidateResidual.maxCurvature<afterDeskew.maxCurvature*.92;
    const bounded=candidateResidual.maxCurvature<=Math.max(6,afterDeskew.maxCurvature);
    if(improved&&bounded){
      canvas=candidate;
      residual=candidateResidual;
      dewarpApplied=true;
    }else{
      dewarpStrength=0;
    }
  }

  const confidence=Math.max(
    deskew.confidence,
    dewarpApplied?dewarpPlan.confidence*.95:0,
    before.lines.length>=2?.68:0,
    orientation===0?.5:.7
  );
  return{canvas,metadata:{
    orientationDegrees:orientation,
    deskewDegrees:deskew.angle,
    deskewApplied,
    residualSkewDegrees:round2(residual.skew),
    dewarpApplied,
    dewarpStrength,
    curvatureMaxDeviationPx:round2(before.maxCurvature),
    curvatureMeanDeviationPx:round2(before.meanCurvature),
    residualCurvatureMaxDeviationPx:round2(residual.maxCurvature),
    confidence:Math.max(0,Math.min(1,confidence))
  }};
}

export function estimateDeskew(canvas:HTMLCanvasElement):{angle:number;confidence:number}{
  const analysis=analyzeCanvasGeometry(canvas);
  const angles=analysis.lines.map(line=>line.angle).filter(angle=>Math.abs(angle)<=12).sort((a,b)=>a-b);
  if(angles.length>=2){
    const median=angles[Math.floor(angles.length/2)]!;
    const mad=medianAbsoluteDeviation(angles,median);
    const support=Math.min(1,angles.length/8);
    const consistency=Math.max(0,1-mad/2.5);
    return{angle:Math.abs(median)<.05?0:round2(median),confidence:Math.min(.96,.55+.3*support+.15*consistency)};
  }

  // Fallback robusto per pagine senza righe continue: projection search sui pixel scuri.
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
  return{angle:round2(bestAngle),confidence};
}

export function estimateOrientation(canvas:HTMLCanvasElement):0|90|180|270{
  const gray=sampleGray(canvas,500);
  const row=projectionVariance(gray,true),col=projectionVariance(gray,false);
  const left=bandInk(gray,'left'),right=bandInk(gray,'right');
  if(col>row*1.35)return right>left*1.7?270:90;
  return 0;
}

export function analyzeRasterGeometryData(data:Uint8ClampedArray,width:number,height:number):{
  lineCount:number;skewDegrees:number;maxCurvaturePx:number;meanCurvaturePx:number
}{
  const gray=rgbaToGray(data,width,height);
  const lines=traceContinuousLines(gray);
  const angles=lines.map(l=>l.angle).filter(v=>Math.abs(v)<=12).sort((a,b)=>a-b);
  const skew=angles.length?angles[Math.floor(angles.length/2)]!:0;
  const maxCurvature=lines.length?Math.max(...lines.map(l=>l.maxDeviation)):0;
  const meanCurvature=lines.length?lines.reduce((s,l)=>s+l.meanDeviation,0)/lines.length:0;
  return{lineCount:lines.length,skewDegrees:round2(skew),maxCurvaturePx:round2(maxCurvature),meanCurvaturePx:round2(meanCurvature)};
}

function analyzeCanvasGeometry(canvas:HTMLCanvasElement):{lines:LineTrace[];skew:number;maxCurvature:number;meanCurvature:number;gray:Gray}{
  const gray=sampleGray(canvas,760);
  const lines=traceContinuousLines(gray);
  const angles=lines.map(l=>l.angle).filter(v=>Math.abs(v)<=12).sort((a,b)=>a-b);
  const skew=angles.length?angles[Math.floor(angles.length/2)]!:0;
  const maxCurvatureSample=lines.length?Math.max(...lines.map(l=>l.maxDeviation)):0;
  const meanCurvatureSample=lines.length?lines.reduce((s,l)=>s+l.meanDeviation,0)/lines.length:0;
  return{
    lines,
    skew:round2(skew),
    maxCurvature:maxCurvatureSample*gray.scaleY,
    meanCurvature:meanCurvatureSample*gray.scaleY,
    gray
  };
}

function traceContinuousLines(gray:Gray):LineTrace[]{
  const {width,height,data}=gray;
  const minLength=Math.max(45,Math.round(width*.12));
  const stepX=Math.max(2,Math.round(width/220));
  const seedStepX=Math.max(18,Math.round(width/44));
  const visited=new Uint8Array(width*height),lines:LineTrace[]=[];

  for(let startX=12;startX<width-minLength;startX+=seedStepX){
    for(let startY=8;startY<height-8;startY+=2){
      if(visited[startY*width+startX])continue;
      if(data[startY*width+startX]!>=165)continue;

      const points:Array<{x:number;y:number}>=[{x:startX,y:startY}];
      let currentY=startY,misses=0;
      for(let x=startX+stepX;x<width-8;x+=stepX){
        let bestY=currentY,minLum=256;
        for(let dy=-7;dy<=7;dy++){
          const y=currentY+dy;if(y<0||y>=height)continue;
          const lum=data[y*width+x]!;
          if(lum<minLum){minLum=lum;bestY=y;}
        }
        if(minLum<165){
          points.push({x,y:bestY});currentY=bestY;misses=0;
          for(let dy=-3;dy<=3;dy++){const y=bestY+dy;if(y>=0&&y<height)visited[y*width+x]=1;}
        }else if(++misses>3)break;
      }
      if(points.length<8)continue;
      if(points.at(-1)!.x-points[0]!.x<minLength)continue;
      const line=analyzeLine(points);
      // Reject obviously vertical/diagonal traces: this engine models horizontal baselines/rules.
      if(Math.abs(line.angle)<=12)lines.push(line);
    }
  }
  return dedupeLines(lines);
}

function analyzeLine(points:Array<{x:number;y:number}>):LineTrace{
  const n=points.length;
  let sx=0,sy=0,sxy=0,sxx=0;
  for(const p of points){sx+=p.x;sy+=p.y;sxy+=p.x*p.y;sxx+=p.x*p.x;}
  const denom=n*sxx-sx*sx;
  const slope=denom!==0?(n*sxy-sx*sy)/denom:0;
  const intercept=(sy-slope*sx)/n;
  let max=0,sum=0;
  for(const p of points){const d=Math.abs(p.y-(slope*p.x+intercept));max=Math.max(max,d);sum+=d;}
  return{points,slope,intercept,angle:Math.atan2(slope,1)*180/Math.PI,maxDeviation:max,meanDeviation:sum/n,yMean:sy/n};
}

function dedupeLines(lines:LineTrace[]):LineTrace[]{
  const sorted=[...lines].sort((a,b)=>a.yMean-b.yMean||b.points.length-a.points.length),kept:LineTrace[]=[];
  for(const line of sorted){
    const duplicate=kept.some(other=>Math.abs(other.yMean-line.yMean)<4&&Math.abs(other.angle-line.angle)<.45);
    if(!duplicate)kept.push(line);
  }
  return kept.slice(0,80);
}

interface DewarpPlan{
  width:number;height:number;
  sampleWidth:number;sampleHeight:number;
  gridCols:number;gridRows:number;
  grid:Float32Array;
  strength:number;confidence:number;
}
function buildDewarpPlan(canvas:HTMLCanvasElement,lines:LineTrace[]):DewarpPlan{
  const sample=sampleGray(canvas,760),gridCols=16,gridRows=24;
  const grid=new Float32Array((gridRows+1)*(gridCols+1));
  const weights=new Float32Array(grid.length);
  let systematic=0,maxDev=0;

  for(const line of lines){
    if(line.maxDeviation<1.5)continue;
    systematic++;
    for(const p of line.points){
      const expected=line.slope*p.x+line.intercept;
      const dev=p.y-expected;
      if(Math.abs(dev)<1.25)continue;
      const col=Math.max(0,Math.min(gridCols,Math.round(p.x/sample.width*gridCols)));
      const row=Math.max(0,Math.min(gridRows,Math.round(p.y/sample.height*gridRows)));
      const idx=row*(gridCols+1)+col;
      const damped=Math.max(-6,Math.min(6,dev*.35));
      grid[idx]!+=damped;weights[idx]!+=1;maxDev=Math.max(maxDev,Math.abs(damped));
    }
  }
  for(let i=0;i<grid.length;i++)if(weights[i]!>0)grid[i]!/=weights[i]!;

  // Two conservative smoothing passes. Empty cells borrow only from nearby supported geometry.
  for(let pass=0;pass<2;pass++){
    const next=grid.slice();
    for(let r=0;r<=gridRows;r++)for(let c=0;c<=gridCols;c++){
      let sum=0,n=0;
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
        const rr=r+dr,cc=c+dc;if(rr<0||cc<0||rr>gridRows||cc>gridCols)continue;
        const v=grid[rr*(gridCols+1)+cc]!;
        if(v!==0){sum+=v;n++;}
      }
      if(n)next[r*(gridCols+1)+c]=sum/n;
    }
    grid.set(next);
  }

  const scaleY=canvas.height/sample.height;
  const strength=maxDev*scaleY;
  const lineSupport=Math.min(1,systematic/6);
  const curvatureSupport=Math.min(1,strength/7);
  const confidence=Math.max(0,Math.min(1,lineSupport*.55+curvatureSupport*.45));
  return{width:canvas.width,height:canvas.height,sampleWidth:sample.width,sampleHeight:sample.height,gridCols,gridRows,grid,strength,confidence};
}

function applyVerticalDewarp(source:HTMLCanvasElement,plan:DewarpPlan):HTMLCanvasElement{
  const out=document.createElement('canvas');out.width=source.width;out.height=source.height;
  const sctx=source.getContext('2d',{willReadFrequently:true})!,src=sctx.getImageData(0,0,source.width,source.height);
  const dctx=out.getContext('2d',{willReadFrequently:true})!,dst=dctx.createImageData(out.width,out.height);
  const scaleY=source.height/plan.sampleHeight;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const gx=x/Math.max(1,source.width-1)*plan.gridCols,gy=y/Math.max(1,source.height-1)*plan.gridRows;
    const c=Math.min(plan.gridCols-1,Math.floor(gx)),r=Math.min(plan.gridRows-1,Math.floor(gy));
    const tx=gx-c,ty=gy-r,row=plan.gridCols+1;
    const a=plan.grid[r*row+c]!,b=plan.grid[r*row+c+1]!,d=plan.grid[(r+1)*row+c]!,e=plan.grid[(r+1)*row+c+1]!;
    const top=a*(1-tx)+b*tx,bottom=d*(1-tx)+e*tx;
    const dev=(top*(1-ty)+bottom*ty)*scaleY;
    const sy=Math.max(0,Math.min(source.height-1,y+dev));
    bilinearSample(src.data,source.width,source.height,x,sy,dst.data,(y*source.width+x)*4);
  }
  dctx.putImageData(dst,0,0);return out;
}

function bilinearSample(src:Uint8ClampedArray,w:number,h:number,x:number,y:number,dst:Uint8ClampedArray,di:number){
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;
  const i00=(y0*w+x0)*4,i10=(y0*w+x1)*4,i01=(y1*w+x0)*4,i11=(y1*w+x1)*4;
  for(let c=0;c<3;c++){
    const top=src[i00+c]!*(1-fx)+src[i10+c]!*fx,bottom=src[i01+c]!*(1-fx)+src[i11+c]!*fx;
    dst[di+c]=top*(1-fy)+bottom*fy;
  }
  dst[di+3]=255;
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
function sampleGray(source:HTMLCanvasElement,max:number):Gray{
  const scale=Math.min(1,max/Math.max(source.width,source.height)),w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,w,h);
  const rgba=ctx.getImageData(0,0,w,h).data;
  const gray=rgbaToGray(rgba,w,h);gray.scaleX=source.width/w;gray.scaleY=source.height/h;return gray;
}
function rgbaToGray(rgba:Uint8ClampedArray,width:number,height:number):Gray{
  const d=new Uint8Array(width*height);for(let i=0,p=0;i<rgba.length;i+=4,p++)d[p]=Math.round(.299*rgba[i]!+.587*rgba[i+1]!+.114*rgba[i+2]!);
  return{width,height,data:d,scaleX:1,scaleY:1};
}
function darkPoints(gray:Gray,threshold:number,step:number){const pts:Array<{x:number;y:number}>=[];for(let y=0;y<gray.height;y+=step)for(let x=0;x<gray.width;x+=step)if(gray.data[y*gray.width+x]!<threshold)pts.push({x,y});return pts;}
function bandInk(gray:Gray,side:'top'|'bottom'|'left'|'right'){
  let dark=0,n=0;const x0=side==='left'?0:side==='right'?Math.floor(gray.width*.7):0,x1=side==='left'?Math.ceil(gray.width*.3):gray.width;
  const y0=side==='top'?0:side==='bottom'?Math.floor(gray.height*.7):0,y1=side==='top'?Math.ceil(gray.height*.3):gray.height;
  for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){n++;if(gray.data[y*gray.width+x]!<150)dark++;}return dark/Math.max(1,n);
}
function projectionVariance(gray:Gray,rows:boolean){const outer=rows?gray.height:gray.width,inner=rows?gray.width:gray.height,vals:number[]=[];for(let o=0;o<outer;o++){let n=0;for(let i=0;i<inner;i++){const idx=rows?o*gray.width+i:i*gray.width+o;if(gray.data[idx]!<150)n++;}vals.push(n);}const mean=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);return vals.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,vals.length);}
function medianAbsoluteDeviation(values:number[],median:number){if(!values.length)return 0;const dev=values.map(v=>Math.abs(v-median)).sort((a,b)=>a-b);return dev[Math.floor(dev.length/2)]??0;}
function round2(v:number){return Math.round(v*100)/100;}
