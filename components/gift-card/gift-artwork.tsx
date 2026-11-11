"use client";
import {CardArtwork} from "./card-design";
import {hasSavedGiftDesign,normalizeGiftDesign,type GiftDesign} from "@/types/gift-card";
export function GiftArtwork({design,salonName}:{design?:GiftDesign;salonName?:string}) {
  const saved=hasSavedGiftDesign(design);
  const fallback:GiftDesign={background:"#f6f2e9",color:"#292523",image:"/gift-cards/shared-default.webp",logo:"",elements:[
    {id:"title",kind:"text",text:"A gift\nfor you",x:28,y:44,size:46,font:"serif"},
    {id:"salon",kind:"name",text:salonName||"Your Salon",x:26,y:85,size:16,font:"sans"},
    {id:"brand",kind:"text",text:"Reylumi",x:84,y:12,size:15,font:"sans"}]};
  return <div className="gc-approved-art" data-gift-artwork={saved?"saved":"default"}><CardArtwork design={saved?normalizeGiftDesign(design):fallback}/></div>;
}
export function GiftSymbol(){return <svg className="gc-approved-symbol" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="7" y="20" width="34" height="23" rx="2"/><path d="M5 14h38v9H5zM24 14v29M24 14C8 14 10 1 17 5c4 2 7 9 7 9Zm0 0C40 14 38 1 31 5c-4 2-7 9-7 9Z"/></svg>}

export function PhoneScanSymbol(){return <svg className="gc-approved-phone-symbol" viewBox="0 0 32 40" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="6" y="2" width="21" height="36" rx="3"/><path d="M12 6h9M14 34h5M11 12h4v4h-4zM19 12h4v4h-4zM11 20h4v4h-4zM20 20h3v7h-5v-3"/></svg>;}
