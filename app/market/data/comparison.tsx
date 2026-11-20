"use client";
import { WorkspaceText, useWorkspaceTranslation, useWorkspaceLocale } from "@/components/workspace-language";
import type { PublicData, PublicGroup, PublicProfile, PublicService, PublicPhoto, PublicEntry } from "@/lib/market-platform/published-contract";
const profileFields = {displayName:"Public salon name",tagline:"Tagline",businessPhone:"Business phone only",businessAddress:"Public business address only",website:"Public HTTPS website",timezone:"Salon timezone",brandColor:"Brand color",hours:"Opening hours"} as const;
const days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export function PublicationComparison({group,live,draft,unsaved=false}:{unsaved?:boolean;group:PublicGroup;live:PublicData[PublicGroup];draft:PublicData[PublicGroup]}) {
  const t=useWorkspaceTranslation(),locale=useWorkspaceLocale();
  const price=(service:PublicService)=>{if(service.priceKind==="on-request")return t("Price on request");if(service.amountCents===null)return t("Price not entered");const formatter=new Intl.NumberFormat(locale,{style:"currency",currency:service.currency});return (service.priceKind==="from"?t("From")+" ":"")+formatter.format(service.amountCents/10**(formatter.resolvedOptions().maximumFractionDigits??2));};
  const text=(value:unknown,key?:string):string=>{
    if(value===null||value===""||value===undefined)return t("Not provided");
    if(!Array.isArray(value))return String(value);
    if(key==="hours")return (value as PublicProfile["hours"]).map(h=>t(days[h.day])+": "+(h.closed?t("Closed"):h.opens+"–"+h.closes)).join("\n")||t("Not provided");
    if(group==="services")return (value as PublicService[]).map(s=>[s.name,s.category,s.description,price(s),s.durationMinutes===null?"":s.durationMinutes+" "+t("minutes")].filter(Boolean).join(" · ")).join("\n")||t("No public services listed.");
    if(group==="media")return (value as PublicPhoto[]).map(x=>[x.label,x.caption,t(x.role==="logo"?"Logo":"Gallery photo"),t(x.rights==="owner"?"Salon-owned":"Licensed")].filter(Boolean).join(" · ")).join("\n")||t("No photos shared.");
    return (value as PublicEntry[]).map(x=>x.title+"\n"+x.body).join("\n\n")||t("No public content shared.");
  };
  const a=live as unknown as Record<string,unknown>,b=draft as unknown as Record<string,unknown>;
  const keys=group==="profile"?Object.keys(profileFields):[group==="services"?"services":group==="media"?"images":"entries"];
  const changed=keys.filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));
  return <details open={changed.length>0}><summary><WorkspaceText text="Compare draft with currently shared data" /></summary>{!changed.length?<p><WorkspaceText text="No differences from the shared revision." /></p>:<dl>{changed.map(k=><div key={k} style={{padding:"12px 0",borderBottom:"1px solid #d6e3dc"}}><dt><strong><WorkspaceText text={group==="profile"?profileFields[k as keyof typeof profileFields]:group==="services"?"Services":group==="media"?"Photos":"Public content"} /></strong></dt><dd style={{margin:0,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><small><WorkspaceText text="Currently shared" /></small><p>{text(a[k],k)}</p><small><WorkspaceText text={unsaved?"Editing (not saved)":"Saved draft"} /></small><p>{text(b[k],k)}</p></dd></div>)}</dl>}</details>;
}
