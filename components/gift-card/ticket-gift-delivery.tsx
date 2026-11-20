"use client";
import {useEffect,useRef,useState} from "react";
import type {GiftTicketDelivery} from "@/types/gift-card";
import {giftMoney} from "@/types/gift-card";
import {giftPublicLink} from "@/lib/gift-public-link";
import {GiftModalLayer} from "./gift-modal-layer";
import {GiftArtwork,GiftSymbol} from "./gift-artwork";
import {GiftQr} from "./gift-qr";
import "./gift-card.css";
import "./gift-approved-dialog.css";

const messages={collected:"This gift card has already been received or saved to the customer’s account.",transferred:"This gift card has been transferred. Use the recipient’s current card.",voided:"This gift sale was voided. Its delivery code is unavailable.",unavailable:"This gift card is unavailable for delivery. Review its current status before helping the customer."};

export function TicketGiftDelivery({ticketId,saleId,last4}:{ticketId:string;saleId:string;last4:string}){
  const [open,setOpen]=useState(false);
  return <><button type="button" className="min-h-11 text-left text-xs font-medium text-teal-800 underline underline-offset-2" aria-label={`Show gift card ${last4}`} onClick={()=>setOpen(true)}>Show / send gift card</button>{open&&<TicketGiftDeliveryDialog key={`${ticketId}:${saleId}`} ticketId={ticketId} saleId={saleId} onClose={()=>setOpen(false)}/>}</>;
}

function TicketGiftDeliveryDialog({ticketId,saleId,onClose}:{ticketId:string;saleId:string;onClose:()=>void}){
  const [reply,setReply]=useState<GiftTicketDelivery>();const [error,setError]=useState("");const [copied,setCopied]=useState(false);
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{close.current?.focus();},[]);
  useEffect(()=>{
    let active=true,pending=false;const controller=new AbortController();
    const refresh=async()=>{if(pending)return;pending=true;try{
      const response=await fetch("/api/gift-cards/ticket-delivery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticketId,saleId}),cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||"Unable to open this gift card.");
      if(active){setReply(data);setError("");}
    }catch(e){if(active){setReply(undefined);setError(e instanceof Error?e.message:"Reconnect to open the gift card.");}}finally{pending=false;}};
    void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},2000);
    return()=>{active=false;controller.abort();clearInterval(timer);};
  },[ticketId,saleId]);
  const link=reply?.deliveryStatus==="ready"&&reply.token?giftPublicLink("card",reply.token,typeof location==="undefined"?undefined:location):undefined;
  return <GiftModalLayer onClose={onClose}><div className="gc gc-overlay"><section className="gc-modal gc-approved-dialog" role="dialog" aria-modal="true" aria-label="Ticket gift card">
    <header><div className="gc-approved-heading"><GiftSymbol/><div><h2>Gift card delivery</h2><p>{reply?.ticketNumber?`Ticket ${reply.ticketNumber} · ${giftMoney(reply.purchase)}`:"Open the card sold on this ticket"}</p></div></div><button ref={close} type="button" className="gc-approved-close" aria-label="Close gift card delivery" onClick={onClose}>×</button></header>
    {error?<p className="gc-note gc-error" role="alert">{error}</p>:!reply?<p role="status">Opening gift card…</p>:<div className="gc-approved-complete">
      <aside style={{width:"100%"}}>{reply.card&&<GiftArtwork design={reply.card.design} salonName={reply.card.salonName}/>}</aside><div className="gc-completion-details">
        {link?<><h3>Scan to receive this gift card</h3><GiftQr value={link} label="Scan to receive gift card"/><p>Ask the customer to scan, or share the link with them. They can open and save their card.</p><div className="gc-row"><button type="button" className="gc-text-action" onClick={()=>{const share=navigator.share?navigator.share({title:`Gift card · ${reply.card?.salonName??"Salon"}`,url:link}):navigator.clipboard.writeText(link).then(()=>setCopied(true));void share.catch(e=>{if(!(e instanceof Error&&e.name==="AbortError"))setError("Unable to share. Try copying the link.");});}}>Share link</button><button type="button" className="gc-text-action" onClick={()=>{void navigator.clipboard.writeText(link).then(()=>setCopied(true)).catch(()=>setError("Unable to copy the link. Ask the customer to scan this code."));}}>{copied?"Link copied":"Copy link"}</button></div></>:<p role="status">{messages[reply.deliveryStatus as keyof typeof messages]??messages.unavailable}</p>}
        <button className="gc-text-action" type="button" onClick={onClose}>Done</button>
      </div>
    </div>}
  </section></div></GiftModalLayer>;
}
