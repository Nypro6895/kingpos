"use client";
import { useState } from "react";
import Link from "next/link";
import { setExploreSalonPreferenceAction } from "@/app/explore/social-actions";
import { WorkspaceText } from "@/components/workspace-language";
type Row = {salon_id:string;salon_name:string;saved:boolean;loved:boolean;hidden:boolean};
export function SavedSalonList({items}:{items:Row[]}) {
 const [rows,setRows]=useState(items),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState("");
 async function change(row:Row,field:"saved"|"hidden") { if(busy)return;setBusy(row.salon_id);setError("");try { const result=await setExploreSalonPreferenceAction(row.salon_id,field,false);if(result.error)setError(result.error);else setRows(current=>current.map(item=>item.salon_id===row.salon_id?{...item,[field]:false}:item)); }catch{setError("Please try again.");}finally{setBusy(null);} }
 return <section className="grid gap-3"><h2 className="text-lg font-semibold"><WorkspaceText text="Your salons"/></h2>{error?<p role="alert">{error}</p>:null}{rows.filter(row=>row.saved||row.hidden||row.loved).map(row=><article className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 py-3" key={row.salon_id}><Link href={`/explore/salons/${row.salon_id}`} className="font-semibold">{row.salon_name}</Link><div className="flex gap-3 text-xs text-brand-orange">{row.loved?<span><WorkspaceText text="Loved"/></span>:null}{row.saved?<button disabled={Boolean(busy)} onClick={()=>void change(row,"saved")}><WorkspaceText text="Unsave salon"/></button>:null}{row.hidden?<button disabled={Boolean(busy)} onClick={()=>void change(row,"hidden")}><WorkspaceText text="Show salon again"/></button>:null}</div></article>)}</section>;
}
