"use client";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import { SalonReportDialog } from "@/components/salon-report-dialog";
import type { SalonReportTarget } from "@/lib/salon-report";
import { PostSafetyDialog } from "@/components/post-safety";
import { postModerationAction } from "@/app/post-moderation/actions";
import type { PostCommentTarget } from "@/types/post-comments";
type ExtraAction = {label:string;action:()=>void|Promise<unknown>;icon?:ReactNode};
export function PostActions({plain=false,extraActions=[],onOpen,onShare,onFeature,onArchive,onDelete,isFeatured=false,disabled=false,target,salon,viewerId,onHidden,onChanged}: {plain?:boolean;extraActions?:ExtraAction[];onOpen?:()=>void;onShare?:()=>void;onFeature?:()=>void;onArchive?:()=>void;onDelete?:()=>void;isFeatured?:boolean;disabled?:boolean;target?:PostCommentTarget;salon?:SalonReportTarget;viewerId?:string|null;onHidden?:()=>void;onChanged?:()=>void}) {
  const __vt = useWorkspaceTranslation();

 const [mode,setMode]=useState<"report"|"edit"|"archive"|"delete"|"promote"|"block"|null>(null);
 const [salonReportOpen,setSalonReportOpen]=useState(false);
 const [canBlock,setCanBlock]=useState(false);
 const [canManage,setCanManage]=useState(false);
 const [canPromote,setCanPromote]=useState(false);
 const [canFeature,setCanFeature]=useState(false);
 const [message,setMessage]=useState("");
 const ref=useRef<HTMLDetailsElement>(null);
 const summaryRef=useRef<HTMLElement>(null);
 // This menu is portalled; its own listeners handle dismissal across both elements.
 const menuRef=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [position,setPosition]=useState({left:8,top:8});
 useEffect(()=>{if(!open)return;function close(event:Event){if(event.target instanceof Node && !ref.current?.contains(event.target) && !menuRef.current?.contains(event.target))ref.current?.removeAttribute("open");}function escape(event:KeyboardEvent){if(event.key === "Escape"){event.stopPropagation();ref.current?.removeAttribute("open");ref.current?.querySelector<HTMLElement>("summary")?.focus();}}document.addEventListener("pointerdown",close,true);document.addEventListener("focusin",close,true);document.addEventListener("keydown",escape,true);const navigation=()=>ref.current?.removeAttribute("open");document.addEventListener("reylumi:overlay-navigation",navigation);return()=>{document.removeEventListener("pointerdown",close,true);document.removeEventListener("focusin",close,true);document.removeEventListener("keydown",escape,true);document.removeEventListener("reylumi:overlay-navigation",navigation);};},[open]);
 useEffect(()=>{
   if(!open || !target)return;
   let active=true;
   void postModerationAction(target,"permissions").then(result=>{
     if(active){setCanBlock(Boolean(result.data?.canBlock));setCanManage(Boolean(result.data?.canManage));setCanFeature(Boolean(result.data?.canFeature));setCanPromote(Boolean(result.data?.canPromote));}
   }).catch(()=>{
     // Report remains available when permission lookup is offline; privileged actions need a successful response.
     if(active){setCanBlock(false);setCanManage(false);setCanFeature(false);setCanPromote(false);}
   });
   return()=>{active=false;};
 },[open,target]);
 const owner=canManage || Boolean(onArchive || onDelete);
 const actions: Array<{label:string;action?:()=>void|Promise<unknown>;icon?:ReactNode}>=[
 ...extraActions,
 {label:"Report salon",action:salon?()=>setSalonReportOpen(true):undefined},
 {label:"Report post",action:target?()=>setMode("report"):undefined},
 {label:"Block user",action:target && viewerId && canBlock?()=>setMode("block"):undefined},
 {label:"Edit post",action:target && owner?()=>setMode("edit"):undefined},
 {label:"View post",action:target?undefined:onOpen},{label:isFeatured?"Remove featured selection":"Use as featured photo",action:onFeature ?? (target && canFeature?async()=>{const result=await postModerationAction(target,"feature");if(result.error)setMessage(result.error);else onChanged?.();}:undefined)},{label:"Let more people see it",action:target && canPromote?()=>window.dispatchEvent(new CustomEvent("reylumi:promote-post", {detail:target})):undefined},{label:"Share post",action:target?undefined:onShare},{label:"Archive post",action:target && owner?()=>setMode("archive"):onArchive},{label:"Delete post",action:target && owner?()=>setMode("delete"):onDelete}].filter(item=>item.action);
 return <><details ref={ref} onToggle={event=>{const expanded=event.currentTarget.open;if(expanded){const box=event.currentTarget.querySelector("summary")!.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(box.right-208,window.innerWidth-216)),top:Math.max(8,Math.min(box.bottom+4,window.innerHeight-actions.length*44-28))});}setOpen(expanded);}} className="relative" style={{position:"relative",zIndex:open?45:2}}><summary ref={summaryRef} aria-label={__vt(salon && !target ? "Salon actions" : "Post actions")} aria-haspopup="menu" aria-expanded={open} className={`${plain?"!bg-transparent !shadow-none ":""}grid size-9 cursor-pointer list-none place-items-center rounded-full bg-white/95 text-zinc-700 shadow-sm hover:bg-white [&::-webkit-details-marker]:hidden`} style={{display:"grid",placeItems:"center",width:36,height:36,borderRadius:18,background:plain?"transparent":"rgba(255,255,255,.95)",cursor:"pointer",listStyle:"none"}}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></summary>{open?createPortal(<div ref={menuRef} role="menu" className="absolute right-0 top-10 grid w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg" style={{position:"fixed",left:position.left,top:position.top,zIndex:100,width:208,maxHeight:"80dvh",overflowY:"auto",background:"white",padding:6,borderRadius:12,boxShadow:"0 8px 24px #0002",border:"1px solid #e7e5e4"}}>{actions.map(item=><button key={item.label} role="menuitem" type="button" disabled={disabled || busy} className="min-h-11 rounded-lg px-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50" style={{display:"block",width:"100%",minHeight:44,textAlign:"left",padding:"8px 12px",fontSize:13,color:item.label.startsWith("Report")?"#b42318":undefined}} onClick={async()=>{ref.current?.removeAttribute("open");setBusy(true);try{await item.action?.();}finally{setBusy(false);}}}><span className="flex items-center gap-3">{item.icon ?? (item.label.startsWith("Report") ? <ReylumiIcon name="flag"/> : null)}<WorkspaceText text={item.label} /></span></button>)}</div>,document.body):null}</details>{message?<span role="alert" className="text-xs text-red-600"><WorkspaceText text={message} /></span>:null}{target && mode?<PostSafetyDialog target={target} mode={mode} viewerId={viewerId} onClose={()=>setMode(null)} onHidden={onHidden} onChanged={onChanged}/>:null}{salon && salonReportOpen?<SalonReportDialog salon={salon} returnFocusRef={summaryRef} onClose={()=>setSalonReportOpen(false)}/>:null}</>;
}
