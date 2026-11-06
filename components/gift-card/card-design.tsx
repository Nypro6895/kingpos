"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { defaultGiftDesign, normalizeGiftDesign, type GiftDesign } from "@/types/gift-card";
import { ImageCropper, openGiftImage } from "./image-cropper";
import { createGiftPreset, giftPresets, loadGiftPreset } from "./gift-presets";
export function CardArtwork({ design, onChange }: { design: GiftDesign; onChange?: (value: GiftDesign) => void }) {
  const ref = useRef<HTMLDivElement>(null); const drag = useRef<string | null>(null);
  const move = (event: React.PointerEvent) => {
    if (!drag.current || !onChange || !ref.current) return; const bounds = ref.current.getBoundingClientRect();
    onChange({ ...design, elements: design.elements.map(e => e.id === drag.current ? { ...e, x: Math.max(8, Math.min(92, (event.clientX-bounds.left)/bounds.width*100)), y: Math.max(10, Math.min(90, (event.clientY-bounds.top)/bounds.height*100)) } : e) });
  };
  return <div ref={ref} className="gc-card" style={{ background: design.background, color: design.color, containerType: "inline-size" }} onPointerMove={move} onPointerUp={() => {drag.current=null;}} onPointerCancel={() => {drag.current=null;}}>
    {design.image && <img src={design.image} alt="" draggable={false} />}
    {design.elements.map(e => <div key={e.id} className="gc-element" style={{ left:`${e.x}%`,top:`${e.y}%`,fontSize:e.font?`${e.size/5.6}cqw`:e.size,fontFamily:e.font==="serif"?"Georgia, Times New Roman, serif":e.font==="sans"?"Arial, Helvetica, sans-serif":undefined,fontWeight:e.font==="serif"?400:e.font==="sans"?500:undefined,letterSpacing:e.font==="sans"?".05em":undefined,width:e.kind==="logo"?(e.font?`${e.size/5.6}cqw`:e.size):undefined,height:e.kind==="logo"?(e.font?`${e.size/5.6}cqw`:e.size):undefined,cursor:onChange?"move":undefined }} onPointerDown={event => {if(!onChange)return;drag.current=e.id;event.currentTarget.setPointerCapture(event.pointerId);}}>
      {e.kind==="logo" ? design.logo ? <img src={design.logo} alt="Salon logo" draggable={false}/> : <span aria-label="Salon logo">✦</span> : e.text}
    </div>)}
  </div>;
}
export function CardDesigner({ initial, salonName, salonLogo, onSave }: { initial?: GiftDesign; salonName: string; salonLogo?: string; onSave: (d: GiftDesign) => Promise<void> }) {
  const [design,setDesign]=useState<GiftDesign>(()=>initial?.elements?.length?normalizeGiftDesign(initial):defaultGiftDesign(salonName,salonLogo)); const [selected,setSelected]=useState(""); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
  const [crop,setCrop]=useState<Awaited<ReturnType<typeof openGiftImage>>|null>(null);
  const [loading,setLoading]=useState(false);
  const [presetIndex,setPresetIndex]=useState<number|null>(null);
  async function selectPreset(index:number){setLoading(true);setMessage("");try{const image=await loadGiftPreset(index);setCrop(null);setDesign(createGiftPreset(index,image,salonName,salonLogo));setPresetIndex(index);setSelected("");}catch(e){setMessage((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>()=>{if(crop)URL.revokeObjectURL(crop.url);},[crop]);
  const element=design.elements.find(e=>e.id===selected);
  const change=(fields:Record<string,unknown>)=>setDesign(d=>({...d,elements:d.elements.map(e=>e.id===selected?{...e,...fields}:e)}));
  async function upload(file: File | undefined, kind:"image"|"logo") {
    if(!file)return;setLoading(true);setMessage("");
    try {const source=await openGiftImage(file);if(kind==="image"){setCrop(source);}else{try{const canvas=document.createElement("canvas");const scale=Math.min(1,400/Math.max(source.image.naturalWidth,source.image.naturalHeight));canvas.width=Math.round(source.image.naturalWidth*scale);canvas.height=Math.round(source.image.naturalHeight*scale);canvas.getContext("2d")!.drawImage(source.image,0,0,canvas.width,canvas.height);setDesign(d=>({...d,logo:canvas.toDataURL("image/png")}));}finally{URL.revokeObjectURL(source.url);}}}catch(e){setMessage((e as Error).message);}finally{setLoading(false);}
  }
  if(crop)return <div className="gc gc-grid gc-designer"><ImageCropper source={crop} background={design.background} onCancel={()=>setCrop(null)} onApply={image=>{setDesign(d=>({...d,image}));setCrop(null);setMessage("Image ready. Save design to use it for new cards.");}}/></div>;
  return <div className="gc gc-grid gc-designer"><div className="gc-design-preview"><CardArtwork design={design} onChange={setDesign}/></div><section className="gc-preset-section"><h2>Choose a signature design</h2><div className="gc-presets">{giftPresets.map((preset,i)=><button type="button" key={preset.name} aria-label={`Use ${preset.name}`} aria-pressed={presetIndex===i} disabled={loading||busy} onClick={()=>void selectPreset(i)}><CardArtwork design={createGiftPreset(i,preset.image,salonName,salonLogo)}/><span>{preset.name}</span></button>)}</div></section><p className="gc-help">Drag the logo or text. Position controls also work with a keyboard.</p>
    <div className="gc-row"><label>Background<input aria-label="Background color" type="color" value={design.background} onChange={e=>setDesign({...design,background:e.target.value})}/></label><label>Text color<input aria-label="Text color" type="color" value={design.color} onChange={e=>setDesign({...design,color:e.target.value})}/></label></div>
    <label>Background image<input className="gc-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={loading||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";void upload(file,"image");}}/></label>
    <label>Salon logo<input className="gc-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={loading||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";void upload(file,"logo");}}/></label>
    <div className="gc-row">{design.image&&<button type="button" disabled={loading||!!crop} onClick={async()=>{setLoading(true);try{const blob=await fetch(design.image).then(r=>r.blob());setCrop(await openGiftImage(new File([blob],"card.jpg",{type:blob.type})));}catch{setMessage("Could not reopen this image. Please upload it again.");}finally{setLoading(false);}}}>Edit image</button>}<button type="button" onClick={()=>{setCrop(null);setDesign({...design,image:""});}}>Remove image</button><button type="button" disabled={design.elements.length>=12} onClick={()=>{const id=crypto.randomUUID();setDesign({...design,elements:[...design.elements,{id,kind:"text",text:"A gift for you",x:50,y:82,size:18}]});setSelected(id);}}>Add text</button><button type="button" disabled={loading||busy} onClick={()=>void selectPreset(0)}>Default</button></div>
    <label>Edit element<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select logo or text</option>{design.elements.map(e=><option key={e.id} value={e.id}>{e.kind}: {e.text||"Logo"}</option>)}</select></label>
    {element&&<><label>Text<input disabled={element.kind==="logo"} value={element.text} maxLength={120} onChange={e=>change({text:e.target.value})}/></label><div className="gc-row">{(["x","y","size"] as const).map(key=><label key={key}>{key}<input aria-label={`Element ${key}`} type="number" min={key==="size"?12:8} max={key==="size"?72:92} value={element[key]} onChange={e=>change({[key]:Number(e.target.value)})}/></label>)}</div><button type="button" onClick={()=>{setDesign({...design,elements:design.elements.filter(e=>e.id!==selected)});setSelected("");}}>Remove element</button></>}
    {loading&&<p role="status">Preparing image…</p>}{message&&<p role="status" className="gc-note">{message}</p>}<button type="button" className="gc-primary" disabled={busy||loading||!!crop} onClick={async()=>{setBusy(true);try{await onSave(normalizeGiftDesign(design));setMessage("Design saved for new cards. Existing cards keep their design.");}catch(e){setMessage(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}}}>{busy?"Saving…":"Save design"}</button>
  </div>;
}
