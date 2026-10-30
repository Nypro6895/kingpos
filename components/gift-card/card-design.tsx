"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { defaultGiftDesign, normalizeGiftDesign, type GiftDesign } from "@/types/gift-card";
export function CardArtwork({ design, onChange }: { design: GiftDesign; onChange?: (value: GiftDesign) => void }) {
  const ref = useRef<HTMLDivElement>(null); const drag = useRef<string | null>(null);
  const move = (event: React.PointerEvent) => {
    if (!drag.current || !onChange || !ref.current) return; const bounds = ref.current.getBoundingClientRect();
    onChange({ ...design, elements: design.elements.map(e => e.id === drag.current ? { ...e, x: Math.max(8, Math.min(92, (event.clientX-bounds.left)/bounds.width*100)), y: Math.max(10, Math.min(90, (event.clientY-bounds.top)/bounds.height*100)) } : e) });
  };
  return <div ref={ref} className="gc-card" style={{ background: design.background, color: design.color }} onPointerMove={move} onPointerUp={() => {drag.current=null;}} onPointerCancel={() => {drag.current=null;}}>
    {design.image && <img src={design.image} alt="" draggable={false} />}
    {design.elements.map(e => <div key={e.id} className="gc-element" style={{ left:`${e.x}%`,top:`${e.y}%`,fontSize:e.size,width:e.kind==="logo"?e.size:undefined,height:e.kind==="logo"?e.size:undefined,cursor:onChange?"move":undefined }} onPointerDown={event => {if(!onChange)return;drag.current=e.id;event.currentTarget.setPointerCapture(event.pointerId);}}>
      {e.kind==="logo" ? design.logo ? <img src={design.logo} alt="Salon logo" draggable={false}/> : <span aria-label="Salon logo">✦</span> : e.text}
    </div>)}
  </div>;
}
export function CardDesigner({ initial, salonName, salonLogo, onSave }: { initial?: GiftDesign; salonName: string; salonLogo?: string; onSave: (d: GiftDesign) => Promise<void> }) {
  const [design,setDesign]=useState<GiftDesign>(()=>initial?.elements?.length?normalizeGiftDesign(initial):defaultGiftDesign(salonName,salonLogo)); const [selected,setSelected]=useState(""); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
  const element=design.elements.find(e=>e.id===selected);
  const change=(fields:Record<string,unknown>)=>setDesign(d=>({...d,elements:d.elements.map(e=>e.id===selected?{...e,...fields}:e)}));
  async function upload(file: File | undefined, kind:"image"|"logo") {
    if(!file)return; if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>1500000){setMessage("Choose a PNG, JPG or WebP smaller than 1.5 MB.");return;}
    try { const bitmap=await createImageBitmap(file); const canvas=document.createElement("canvas"); const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;canvas.getContext("2d")!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();setDesign(d=>({...d,[kind]:canvas.toDataURL(kind==="logo"?"image/png":"image/jpeg",.85)}));setMessage("");}catch{setMessage("This image could not open.");}
  }
  return <div className="gc gc-grid gc-designer"><CardArtwork design={design} onChange={setDesign}/><p className="gc-help">Drag the logo or text. Position controls also work with a keyboard.</p>
    <div className="gc-row"><label>Background<input aria-label="Background color" type="color" value={design.background} onChange={e=>setDesign({...design,background:e.target.value})}/></label><label>Text color<input aria-label="Text color" type="color" value={design.color} onChange={e=>setDesign({...design,color:e.target.value})}/></label></div>
    <label>Background image<input className="gc-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void upload(e.target.files?.[0],"image")}/></label>
    <label>Salon logo<input className="gc-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void upload(e.target.files?.[0],"logo")}/></label>
    <div className="gc-row"><button onClick={()=>setDesign({...design,image:""})}>Remove image</button><button disabled={design.elements.length>=12} onClick={()=>{const id=crypto.randomUUID();setDesign({...design,elements:[...design.elements,{id,kind:"text",text:"A gift for you",x:50,y:82,size:18}]});setSelected(id);}}>Add text</button><button onClick={()=>setDesign(defaultGiftDesign(salonName,salonLogo))}>Default</button></div>
    <label>Edit element<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select logo or text</option>{design.elements.map(e=><option key={e.id} value={e.id}>{e.kind}: {e.text||"Logo"}</option>)}</select></label>
    {element&&<><label>Text<input disabled={element.kind==="logo"} value={element.text} maxLength={120} onChange={e=>change({text:e.target.value})}/></label><div className="gc-row">{(["x","y","size"] as const).map(key=><label key={key}>{key}<input aria-label={`Element ${key}`} type="number" min={key==="size"?12:8} max={key==="size"?72:92} value={element[key]} onChange={e=>change({[key]:Number(e.target.value)})}/></label>)}</div><button onClick={()=>{setDesign({...design,elements:design.elements.filter(e=>e.id!==selected)});setSelected("");}}>Remove element</button></>}
    {message&&<p role="status" className="gc-note">{message}</p>}<button className="gc-primary" disabled={busy} onClick={async()=>{setBusy(true);try{await onSave(normalizeGiftDesign(design));setMessage("Design saved for new cards. Existing cards keep their design.");}catch(e){setMessage(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}}}>{busy?"Saving…":"Save design"}</button>
  </div>;
}
