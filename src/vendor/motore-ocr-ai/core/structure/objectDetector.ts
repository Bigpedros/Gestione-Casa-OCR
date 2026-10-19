import type {Box,OcrToken,StructuralRegion} from '../../contracts.js';

export function detectNonTextObjects(canvas:HTMLCanvasElement,tokens:OcrToken[],existing:StructuralRegion[]=[]):StructuralRegion[]{
  const out=existing.map(r=>({...r,box:{...r.box},evidence:[...r.evidence]}));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return out;
  const max=900,scale=Math.min(1,max/Math.max(canvas.width,canvas.height));
  const w=Math.max(1,Math.round(canvas.width*scale)),h=Math.max(1,Math.round(canvas.height*scale));
  const small=document.createElement('canvas');small.width=w;small.height=h;small.getContext('2d')!.drawImage(canvas,0,0,w,h);
  const data=small.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,w,h).data;
  const dark=(x:number,y:number)=>{const i=(y*w+x)*4;return(.299*data[i]!+.587*data[i+1]!+.114*data[i+2]!)<120;};

  // Stato checkbox già rilevate.
  for(const region of out.filter(r=>r.kind==='checkbox')){
    const x0=Math.max(0,Math.floor(region.box.x*scale)),y0=Math.max(0,Math.floor(region.box.y*scale));
    const x1=Math.min(w,Math.ceil((region.box.x+region.box.width)*scale)),y1=Math.min(h,Math.ceil((region.box.y+region.box.height)*scale));
    let inner=0,n=0;for(let y=y0+2;y<y1-2;y++)for(let x=x0+2;x<x1-2;x++){n++;if(dark(x,y))inner++;}
    const ratio=n?inner/n:0;region.state=ratio>.22?'checked':ratio<.08?'unchecked':'ambiguous';region.evidence.push(`inner-ink:${ratio.toFixed(2)}`);
  }

  // Radio button: anello circolare piccolo fuori dai token.
  for(let y=8;y<h-8;y+=5)for(let x=8;x<w-8;x+=5){
    const box:Box={x:(x-7)/scale,y:(y-7)/scale,width:14/scale,height:14/scale};
    if(tokens.some(t=>iou(t.box,box)>.2)||out.some(r=>iou(r.box,box)>.35))continue;
    let ring=0,center=0,ringN=0,centerN=0;
    for(let yy=-6;yy<=6;yy++)for(let xx=-6;xx<=6;xx++){const d=Math.hypot(xx,yy);if(d>=4&&d<=6){ringN++;if(dark(x+xx,y+yy))ring++;}else if(d<3){centerN++;if(dark(x+xx,y+yy))center++;}}
    const rr=ring/Math.max(1,ringN),cr=center/Math.max(1,centerN);
    if(rr>.52&&rr<.9){
      const near=tokens.filter(t=>t.box.x>=box.x+box.width&&t.box.x-(box.x+box.width)<Math.max(80,box.width*5)&&Math.abs((t.box.y+t.box.height/2)-(box.y+box.height/2))<Math.max(14,box.height*.8)).sort((a,b)=>a.box.x-b.box.x)[0];
      if(!near)continue;
      const sizeRatio=Math.max(box.width,box.height)/Math.max(1,Math.min(canvas.width,canvas.height));
      if(sizeRatio>.035)continue;
      out.push({id:`obj-${out.length}`,kind:'radio',box,confidence:Math.min(.9,.58+rr*.3),state:cr>.32?'checked':'unchecked',groupId:`radio-y-${Math.round((box.y+box.height/2)/40)}`,text:near.text,evidence:[`ring:${rr.toFixed(2)}`,`center:${cr.toFixed(2)}`,`option:${near.text}`]});
    }
  }

  // Timbri / firme / immagini: criteri più conservativi per evitare che testo e piccoli simboli
  // vengano promossi a oggetti grafici.
  const cells=connectedComponents(data,w,h,scale).filter(c=>c.area>220&&c.area<Math.max(30000,w*h*.1));
  const signatureLabels=tokens.filter(token=>/firma|sottoscr|medico|operatore/i.test(token.text));
  for(const comp of cells){
    const overlapping=tokens.filter(t=>iou(t.box,comp.box)>.08).length;
    const aspect=comp.box.width/Math.max(1,comp.box.height);
    const minSide=Math.min(comp.box.width,comp.box.height);
    const areaRatio=(comp.box.width*comp.box.height)/Math.max(1,canvas.width*canvas.height);
    const nearSignatureLabel=signatureLabels.some(token=>{
      const cy=comp.box.y+comp.box.height/2,ty=token.box.y+token.box.height/2;
      return Math.abs(cy-ty)<Math.max(90,comp.box.height*2.2)&&comp.box.x>=token.box.x-token.box.width;
    });

    if(overlapping<=1&&minSide>=28&&aspect>.65&&aspect<1.65&&comp.density>.18&&comp.density<.64&&areaRatio>.00045){
      out.push({id:`obj-${out.length}`,kind:'stamp',box:comp.box,confidence:.7,evidence:[`ink-density:${comp.density.toFixed(2)}`,'compact-nontext-blob']});
      continue;
    }
    if(overlapping<=2&&comp.box.width>=55&&comp.box.height>=10&&comp.box.height<=110&&aspect>=2&&aspect<=12&&comp.density>.045&&comp.density<.48&&(nearSignatureLabel||comp.box.y>canvas.height*.58)){
      out.push({id:`obj-${out.length}`,kind:'signature',box:comp.box,confidence:nearSignatureLabel ? .76 : .64,evidence:[nearSignatureLabel?'signature-label-nearby':'signature-shape',`ink-density:${comp.density.toFixed(2)}`]});
      continue;
    }
    if(comp.box.width*comp.box.height>canvas.width*canvas.height*.012&&comp.density>.07&&overlapping<=1){
      out.push({id:`obj-${out.length}`,kind:'image',box:comp.box,confidence:.62,evidence:[comp.box.y<canvas.height*.22?'possible-logo':'non-text-image',`ink-density:${comp.density.toFixed(2)}`]});
    }
  }
  return dedupe(out);
}
function connectedComponents(rgba:Uint8ClampedArray,w:number,h:number,scale:number){const mask=new Uint8Array(w*h);for(let p=0;p<mask.length;p++){const i=p*4;mask[p]=(.299*rgba[i]!+.587*rgba[i+1]!+.114*rgba[i+2]!)<100?1:0;}const seen=new Uint8Array(mask.length),out:Array<{box:Box;area:number;density:number}>=[];for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){const s=y*w+x;if(!mask[s]||seen[s])continue;const q=[s];seen[s]=1;let minX=x,maxX=x,minY=y,maxY=y,n=0;for(let qi=0;qi<q.length;qi++){const idx=q[qi]!,px=idx%w,py=Math.floor(idx/w);n++;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const){const nx=px+dx,ny=py+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=ny*w+nx;if(mask[ni]&&!seen[ni]){seen[ni]=1;q.push(ni);}}}const area=(maxX-minX+1)*(maxY-minY+1);if(n>20)out.push({box:{x:minX/scale,y:minY/scale,width:(maxX-minX+1)/scale,height:(maxY-minY+1)/scale},area,density:n/area});}return out;}
function iou(a:Box,b:Box){const l=Math.max(a.x,b.x),t=Math.max(a.y,b.y),r=Math.min(a.x+a.width,b.x+b.width),bt=Math.min(a.y+a.height,b.y+b.height);if(r<=l||bt<=t)return 0;const i=(r-l)*(bt-t);return i/(a.width*a.height+b.width*b.height-i);}
function dedupe(regions:StructuralRegion[]){const out:StructuralRegion[]=[];for(const r of regions){if(out.some(x=>x.kind===r.kind&&iou(x.box,r.box)>.75))continue;out.push(r);}return out;}
