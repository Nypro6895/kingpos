"use client";
import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {giftMoney,hasSavedGiftDesign,type GiftReply,type GiftSession} from "@/types/gift-card";
import {giftPublicLink} from "@/lib/gift-public-link";
import {GiftArtwork} from "./gift-artwork";
import {GiftQr} from "./gift-qr";
import {GIFT_COMPLETION_SECONDS} from "./gift-screen-lifecycle";

export function GiftCompletion({session:s,appearance,staff,onClose}:{session:GiftSession;appearance?:GiftReply;staff?:boolean;onClose:()=>void}) {
  const [deadline]=useState(()=>{
    const completed=Date.parse(s.completedAt??"");
    return (Number.isFinite(completed)?completed:Date.now())+GIFT_COMPLETION_SECONDS*1000;
  });
  const [remaining,setRemaining]=useState(GIFT_COMPLETION_SECONDS);const close=useRef(onClose);
  useLayoutEffect(()=>{close.current=onClose;},[onClose]);
  useEffect(()=>{
    const tick=()=>{const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));setRemaining(seconds);if(seconds===0)close.current();};
    tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
  },[deadline]);
  const card=s.purchase?s.deliveryCard:s.card;
  const design=hasSavedGiftDesign(card?.design)?card!.design:appearance?.design;
  const delivery=s.delivery&&!s.collected?giftPublicLink("card",s.delivery,typeof location==="undefined"?undefined:location):undefined;
  return <div className="gc-approved-complete">
    <aside><GiftArtwork design={design} salonName={card?.salonName||appearance?.salonName}/>{hasSavedGiftDesign(card?.design)&&<p className="gc-approved-caption">Design saved when this card was issued</p>}</aside>
    <div className="gc-completion-details"><span className="gc-completion-status"><span aria-hidden="true">✓</span> {s.purchase?"Purchase complete":"Payment saved"}</span>
      <h3>{s.purchase?"Your gift card is ready":"Gift card use saved"}</h3>
      {s.ticketNumber&&<p className="gc-completion-receipt" data-gift-completion-receipt>Ticket {s.ticketNumber} · {s.purchase?`Gift card ${giftMoney(s.purchase)}`:`Paid with Gift ${giftMoney(s.amount)}`}</p>}
      {delivery?<><GiftQr value={delivery} label="Scan to receive gift card"/><p>Scan to open and save. No app required.</p>{staff&&<a className="gc-completion-link" href={delivery} target="_blank" rel="noreferrer">Open / share / save image</a>}</>:<p>{s.purchase?"Saved to your account or already collected.":`Gift card used: ${giftMoney(s.amount)}. ${staff?"Open the receipt for your payment details.":"Staff will provide your receipt."}`}</p>}
      <button className="gc-primary" type="button" onClick={onClose}>Done</button><small className="gc-completion-countdown" role="timer">Closes automatically in {remaining}s</small>
    </div>
  </div>;
}
