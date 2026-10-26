"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import {usePathname} from "next/navigation";
import Link from "next/link";
import {useEffect,useRef} from "react";
export function ContextualSupport() {
  const __vt = useWorkspaceTranslation();

 const path=usePathname();const menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const close=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false;};const key=(e:KeyboardEvent)=>{if(e.key==="Escape"&&menu.current)menu.current.open=false;};document.addEventListener("pointerdown",close);document.addEventListener("keydown",key);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",key);};},[]);
 const visible=/^\/(payroll|reports|pos-tickets|tickets|bookings|my-bookings|staff\/my-work|services|salon-settings)(\/|$)/.test(path);
 if(!visible)return null;
 return <div className="relative flex shrink-0 items-center self-center"><details ref={menu} className="relative"><summary aria-label={__vt("More options for this screen")} className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-lg hover:bg-zinc-100">⋯</summary><nav aria-label={__vt("Screen options")} className="absolute right-0 top-full z-40 w-48 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"><Link className="block rounded-lg px-3 py-2.5 text-sm hover:bg-zinc-50" href={`/support?from=${encodeURIComponent(path)}`} onClick={()=>{if(menu.current)menu.current.open=false;}}><WorkspaceText text="Get help with this screen" /></Link></nav></details></div>;
}
