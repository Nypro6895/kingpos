"use client";
import { useEffect, useRef, useState } from "react";
type Source = { image: HTMLImageElement; url: string };
export function ImageCropper({ source, background, onApply, onCancel }: { source: Source; background: string; onApply: (image: string) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1); const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); const [move, setMove] = useState(true);
  const drag = useRef<{x:number;y:number;ox:number;oy:number}|null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = canvas.current; if (!c) return; const ctx = c.getContext("2d"); if (!ctx) return;
    const angle = rotation * Math.PI / 180, w = source.image.naturalWidth, h = source.image.naturalHeight;
    // Cover the inverse-rotated crop, so every corner stays filled at any angle.
    const scale = Math.max((Math.abs(Math.cos(angle))*990+Math.abs(Math.sin(angle))*600)/w,(Math.abs(Math.sin(angle))*990+Math.abs(Math.cos(angle))*600)/h)*zoom;
    const maxX = Math.max(0,(w*scale-(Math.abs(Math.cos(angle))*990+Math.abs(Math.sin(angle))*600))/2);
    const maxY = Math.max(0,(h*scale-(Math.abs(Math.sin(angle))*990+Math.abs(Math.cos(angle))*600))/2);
    const x = Math.max(-maxX,Math.min(maxX,offset.x)), y = Math.max(-maxY,Math.min(maxY,offset.y));
    ctx.fillStyle=background;ctx.fillRect(0,0,990,600);ctx.save();ctx.translate(495,300);ctx.rotate(angle);ctx.translate(x,y);ctx.drawImage(source.image,-w*scale/2,-h*scale/2,w*scale,h*scale);ctx.restore();
  },[source,background,zoom,rotation,offset]);
  return <section className="gc-cropper" aria-label="Crop background image"><div className="gc-row"><strong>Adjust image</strong><span>Card crop · 1.65:1</span></div>
    <canvas ref={canvas} width={990} height={600} aria-label="Card image crop preview" style={{touchAction:move?"none":"pan-y",cursor:move?"move":"default"}}
      onPointerDown={e=>{if(!move)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y};}}
      onPointerMove={e=>{if(!drag.current)return;const d=drag.current;const scale=990/e.currentTarget.getBoundingClientRect().width;const a=rotation*Math.PI/180,dx=(e.clientX-d.x)*scale,dy=(e.clientY-d.y)*scale;setOffset({x:d.ox+dx*Math.cos(a)+dy*Math.sin(a),y:d.oy-dx*Math.sin(a)+dy*Math.cos(a)});}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/>
    <div className="gc-row"><button type="button" aria-pressed={move} onClick={()=>setMove(!move)}>✥ Move</button><button type="button" onClick={()=>{setRotation((rotation+90)%360);setOffset({x:0,y:0});}}>Rotate 90°</button><button type="button" onClick={()=>{setZoom(1);setRotation(0);setOffset({x:0,y:0});}}>Reset crop</button></div>
    <label>Zoom · {zoom.toFixed(2)}×<input type="range" min="1" max="4" step="0.01" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
    <label>Rotate · {rotation}°<input type="range" min="-180" max="180" value={rotation} onChange={e=>{setRotation(Number(e.target.value));setOffset({x:0,y:0});}}/></label>
    <div className="gc-row">{(["x","y"] as const).map(axis=><label key={axis}>{axis==="x"?"Horizontal":"Vertical"}<input type="range" min="-1500" max="1500" value={offset[axis]} onChange={e=>setOffset({...offset,[axis]:Number(e.target.value)})}/></label>)}</div>
    <p className="gc-help">Zoom in, then drag to frame your image. Only the card area is saved.</p>{error&&<p role="alert">{error}</p>}
    <div className="gc-row"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="gc-primary" onClick={()=>{try{const c=canvas.current!;let data="";for(const quality of [.88,.76,.64,.5]){data=c.toDataURL("image/jpeg",quality);if(data.length<500000)break;}if(data.length>=500000)throw Error();onApply(data);}catch{setError("Could not prepare this image. Please try another photo.");}}}>Apply image</button></div>
  </section>;
}
export async function openGiftImage(file: File): Promise<Source> {
  if(file.size>20*1024*1024)throw Error("Choose an image smaller than 20 MB.");
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw Error("Choose a JPG, PNG or WebP image.");
  const url=URL.createObjectURL(file); const image=new Image();
  try{image.src=url;await image.decode();if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>50000000)throw Error();return {image,url};}catch{URL.revokeObjectURL(url);throw Error("This image could not open. Choose a JPG, PNG or WebP image.");}
}
