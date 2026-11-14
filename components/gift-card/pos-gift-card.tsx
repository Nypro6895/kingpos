"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {CustomerGiftDialog} from "./customer-gift-dialog";
import {GiftArtwork} from "./gift-artwork";
import type {GiftDesign,GiftReply,GiftSession,GiftTransport} from "@/types/gift-card";
import {giftMoney} from "@/types/gift-card";
import {giftApi} from "./gift-api";
import {giftPublicLink} from "@/lib/gift-public-link";
import {giftDismissArgs,giftScreenClosed,giftScreenPrompted,rememberGiftScreen} from "./gift-screen-lifecycle";
import "./gift-card.css";

export type GiftCheckout=()=>Promise<GiftReply|null>;
export function giftLink(kind:"card"|"mobile",token:string){return giftPublicLink(kind,token,typeof location==="undefined"?undefined:location);}

type GiftPosProps={token?:string;receipt:Record<string,unknown>;onCheckout?:(fn:GiftCheckout)=>void;onDelivery?:(session:GiftSession)=>void;onSession?:(session:GiftSession)=>void;transport?:GiftTransport};
export function GiftPosControl(props:GiftPosProps){return <GiftPosState key={props.token??"unpaired"} {...props}/>;}
function GiftPosState({token,receipt,onCheckout,onDelivery,onSession,transport}:GiftPosProps) {
  const api=useMemo(()=>transport??giftApi("pos"),[transport]);
  const [session,setSession]=useState<GiftSession>();const [available,setAvailable]=useState(false);const [installed,setInstalled]=useState(false);
  const [open,setOpen]=useState(false);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [lastDelivery,setLastDelivery]=useState<GiftSession>();const [reviewDelivery,setReviewDelivery]=useState<GiftSession>();
  const [payment,setPayment]=useState<{sessionId:string;method:string}>();
  const paymentRef=useRef(payment);
  useLayoutEffect(()=>{paymentRef.current=payment;},[payment]);
  const current=useRef(session);const lock=useRef(false);const receiptKey=JSON.stringify(receipt);
  const latestReceipt=useRef({token,key:receiptKey});
  useLayoutEffect(()=>{latestReceipt.current={token,key:receiptKey};},[token,receiptKey]);
  const setSnapshot=useCallback((next?:GiftSession,expectedSession?:string)=>{
    if(!next||current.current?.id===next.id&&current.current.revision>next.revision)return;
    if(expectedSession&&current.current&&current.current.id!==expectedSession&&next.id!==current.current.id)return;
    const previous=current.current;current.current=next;setSession(next);onSession?.(next);
    if(next.status==="completed"&&next.purchase&&next.delivery&&!next.collected){setLastDelivery(next);try{sessionStorage.setItem("kingpos:last-gift-sale",next.id);}catch{/* Optional recovery shortcut. */}}
    if(giftScreenClosed(next)||previous&&previous.id!==next.id||next.status==="completed"&&onDelivery||previous?.qrVisible&&!next.qrVisible&&next.entry==="scan")setOpen(false);
    if(giftScreenPrompted(next,previous)&&!(next.status==="completed"&&onDelivery))setOpen(true);
  },[onSession,onDelivery]);
  useEffect(()=>{
    let active=true;
    try{const id=sessionStorage.getItem("kingpos:last-gift-sale");if(id)void api("read",{sessionId:id}).then(reply=>{if(active&&reply.session?.delivery&&!reply.session.collected)setLastDelivery(reply.session);}).catch(()=>{});}catch{/* Kiosk storage can be disabled. */}
    return()=>{active=false;};
  },[api,token]);
  useEffect(()=>{
    if(!token)return;let active=true;
    const run=async()=>{try{const expected=current.current?.id;const reply=await api("sync",{token,receipt:JSON.parse(receiptKey)});if(!active)return;setAvailable(true);setInstalled(reply.installed===true);setSnapshot(reply.session,expected);}catch{if(active)setAvailable(false);}};
    const timer=setTimeout(()=>void run(),250);return()=>{active=false;clearTimeout(timer);};
  },[api,token,receiptKey,setSnapshot]);
  useEffect(()=>{
    if(!available||!session?.id)return;let active=true;let pending=false;
    const timer=setInterval(async()=>{
      if(pending||document.hidden)return;pending=true;
      try{
        const bound=latestReceipt.current;
        const expected=current.current?.id;
        const reply=current.current?.status!=="open"||Date.parse(current.current.expires)<=Date.now()
          ?await api("sync",{token:bound.token,receipt:JSON.parse(bound.key)}):await api("read",{sessionId:session.id});
        if(active&&latestReceipt.current===bound)setSnapshot(reply.session,expected);
      }catch{/* Keep the confirmed selection. A mutation still requires a live server. */}finally{pending=false;}
    },1200);
    return()=>{active=false;clearInterval(timer);};
  },[api,available,session?.id,setSnapshot]);
  useEffect(()=>{
    onCheckout?.(async()=>{
      let s=current.current;if(!s)return null;
      const hadSelection=Boolean(s.amount||s.purchase);
      if(navigator.onLine){const latest=latestReceipt.current;const bound=await api("sync",{token:latest.token,receipt:JSON.parse(latest.key)});if(latestReceipt.current.token!==latest.token||latestReceipt.current.key!==latest.key)throw new Error("Ticket changed while checking gift cards. Review and submit again.");if(bound.session){s=bound.session;setSnapshot(s);}}
      if(s.status==="completed"&&(s.amount||s.purchase)){const done=await api("submit",{sessionId:s.id,revision:s.revision});setSnapshot(done.session);if(done.session?.purchase&&done.session.delivery&&!done.session.collected)onDelivery?.(done.session);return done;}
      if(s.status!=="open"&&(s.amount||s.purchase))throw new Error("Gift card session expired. Reapply before Submit.");
      if(!s.amount&&!s.purchase){if(hadSelection)throw new Error("Ticket changed. Reapply the gift card before Submit.");return null;}
      if(!navigator.onLine)throw new Error("Connect before submitting gift cards. This payment cannot be queued offline.");
      if(s.amount&&!s.approved)throw new Error("Ask the customer to confirm their gift card first.");
      const paymentMethod=paymentRef.current?.sessionId===s.id?paymentRef.current.method:undefined;
      if(s.purchase>0&&!paymentMethod)throw new Error("Choose how the Gift sale was paid: Cash, Card or Other.");
      const result=await api("submit",{sessionId:s.id,revision:s.revision,...(paymentMethod?{paymentMethod}:{})});setSnapshot(result.session);if(result.session?.purchase&&result.session.delivery&&!result.session.collected)onDelivery?.(result.session);setOpen(!onDelivery&&Boolean(result.session?.purchase));return result;
    });
  },[api,onCheckout,onDelivery,setSnapshot]);
  async function action(op:string,args:Record<string,unknown>={}) {
    if(lock.current||!current.current)return;lock.current=true;setBusy(true);setError("");
    const bound=latestReceipt.current;
    try{
      let s=current.current;
      if(op==="open"&&(s.status!=="open"||Date.parse(s.expires)<=Date.now())){
        const latest=latestReceipt.current;const reply=await api("sync",{token:latest.token,receipt:JSON.parse(latest.key)});
        if(latestReceipt.current!==latest)throw new Error("Ticket changed. Open Gift cards again.");
        if(reply.session){s=reply.session;setSnapshot(s);}
      }
      const reply=await api(op,{sessionId:s.id,revision:s.revision,...args});if(latestReceipt.current!==bound)throw new Error("Ticket changed. Open Gift cards again.");setSnapshot(reply.session,s.id);if(reply.message)setError(reply.message);
    }catch(e){
      if(op==="open"&&latestReceipt.current===bound&&e instanceof Error&&e.message.includes("Session changed")){
        try{const fresh=await api("read",{sessionId:current.current!.id});setSnapshot(fresh.session);if(fresh.session){const retry=await api("open",{sessionId:fresh.session.id,revision:fresh.session.revision,...args});setSnapshot(retry.session);}}
        catch(retryError){setError((retryError as Error).message);}
      }else setError(e instanceof Error?e.message:"Gift card action failed");
    }finally{lock.current=false;setBusy(false);}
  }
  function dismiss(){const s=current.current;setOpen(false);if(!s)return;rememberGiftScreen(s);void api("dismiss",giftDismissArgs(s)).then(r=>setSnapshot(r.session,s.id)).catch(()=>{});}
  const loadAppearance=useCallback(()=>api("appearance"),[api]);
  if(!available)return null;
  const selection=session?.status==="open"?session:undefined;
  async function reviewLastGift(){if(!lastDelivery)return;try{const reply=await api("read",{sessionId:lastDelivery.id});if(reply.session?.delivery&&!reply.session.collected){setReviewDelivery(reply.session);}else{setLastDelivery(undefined);setError("This gift card has already been collected or its delivery link has expired.");}}catch(e){setError(e instanceof Error?e.message:"Reconnect to open the gift card.");}}
  return <div className="gc" data-gift-pos><GiftEntryCard busy={busy} canBuy={installed} onUse={()=>void action("open",{mode:"use",entry:"code"})} onBuy={()=>void action("open",{mode:"buy",entry:"code"})} summary={selection?.amount?"Applied: "+giftMoney(selection.amount):selection?.purchase?"To purchase: "+giftMoney(selection.purchase):undefined}/>
    {!!selection?.purchase&&<fieldset className="gc-sale-payment"><legend>Payment received</legend><div>{([['cash','Cash'],['credit_card','Card'],['other','Other']] as const).map(([method,label])=><button key={method} type="button" disabled={busy} aria-pressed={payment?.sessionId===selection.id&&payment.method===method} onClick={()=>setPayment({sessionId:selection.id,method})}>{label}</button>)}</div><p>Record the payment, then Submit to save this ticket.</p></fieldset>}
    {lastDelivery?.delivery&&!lastDelivery.collected&&<button className="gc-last-delivery" type="button" onClick={()=>void reviewLastGift()}>View last gift card · {giftMoney(lastDelivery.purchase)}</button>}
    {reviewDelivery&&<GiftDeliveryReceipt key={reviewDelivery.id} session={reviewDelivery} review onClose={()=>setReviewDelivery(undefined)}/>}
    {!open&&error&&<p className="gc-note gc-error" role="alert">{error}</p>}
    {open&&session&&<GiftDialog key={session.id} loadAppearance={loadAppearance} session={session} staff installed={installed} busy={busy} error={error} action={action} onClose={dismiss} wallet={async()=>{const r=await api("wallet",{sessionId:session.id});return r.cards??[];}}>
      {session.status==="open"&&(session.amount>0||session.purchase>0)&&<p className="gc-approved-help">Amount due: {giftMoney(session.total+session.purchase-session.amount)}. Close this panel, then use Submit to complete the sale.</p>}
    </GiftDialog>}
  </div>;
}

export function GiftDeliveryReceipt({session,onClose,review=false}:{session:GiftSession|null;onClose:()=>void;review?:boolean}) {
  const api=useMemo(()=>giftApi("pos"),[]);const [snapshot,setSnapshot]=useState<GiftSession>();
  const [now,setNow]=useState(Date.now);
  const sessionId=session?.id;
  const shown=snapshot?.id===session?.id?snapshot:session;const close=useRef(onClose);
  useLayoutEffect(()=>{close.current=onClose;},[onClose]);
  useEffect(()=>{
    if(!sessionId)return;let active=true;let pending=false;
    const timer=setInterval(async()=>{setNow(Date.now());if(pending||document.hidden)return;pending=true;try{const reply=await api("read",{sessionId});if(active&&reply.session)setSnapshot(previous=>previous?.id===reply.session!.id&&previous.revision>reply.session!.revision?previous:reply.session);}catch{/* The local completion deadline still closes offline. */}finally{pending=false;}},1200);
    return()=>{active=false;clearInterval(timer);};
  },[api,sessionId]);
  const closed=Boolean(shown&&(review?shown.collected||Date.parse(shown.expires)<=now||shown.status!=="completed":giftScreenClosed(shown,now)));
  useEffect(()=>{if(closed)close.current();},[closed]);
  const loadAppearance=useCallback(()=>api("appearance"),[api]);
  if(!shown||closed)return null;
  const dismiss=()=>{close.current();if(!review){rememberGiftScreen(shown);void api("dismiss",giftDismissArgs(shown)).catch(()=>{});}};
  return <GiftDialog key={shown.id} session={review?{...shown,completedAt:undefined}:shown} staff onClose={dismiss} loadAppearance={loadAppearance} action={async()=>{}}/>;
}

export function GiftCustomerControl({token,transport,checkout=false,onSession}:{token:string;transport?:GiftTransport;checkout?:boolean;onSession?:(session:GiftSession|null)=>void}) {
  const api=useMemo(()=>transport??giftApi("display",token),[transport,token]);
  const [session,setSession]=useState<GiftSession>();const [installed,setInstalled]=useState(false);const [open,setOpen]=useState(false);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const current=useRef<GiftSession|undefined>(undefined);const actionLock=useRef(false);
  const changed=useRef(onSession);useLayoutEffect(()=>{changed.current=onSession;},[onSession]);
  const [appearance,setAppearance]=useState<GiftReply>();
  const [reviewCard,setReviewCard]=useState(false);
  useEffect(()=>()=>{changed.current?.(null);},[]);
  const receive=useCallback((reply:GiftReply,expectedSession?:string)=>{
    if(typeof reply.installed==="boolean")setInstalled(reply.installed);
    const next=reply.session;if(!next||current.current?.id===next.id&&current.current.revision>next.revision)return;
    if(expectedSession&&current.current&&current.current.id!==expectedSession&&next.id!==current.current.id)return;
    const previous=current.current;current.current=next;setSession(next);changed.current?.(next);
    if(next.approved||previous?.id!==next.id)setReviewCard(false);
    else if(previous?.approved&&previous.amount>0&&next.status==="open"&&!next.approved&&next.amount===0)setReviewCard(true);
    if(giftScreenClosed(next)||previous&&previous.id!==next.id||previous?.qrVisible&&!next.qrVisible&&next.entry==="scan")setOpen(false);
    if(giftScreenPrompted(next,previous))setOpen(true);
  },[]);
  useEffect(()=>{
    let active=true;let pending=false;
    const refresh=async()=>{if(pending)return;pending=true;try{const expected=current.current?.id;const reply=await api("read");if(active)receive(reply,expected);}catch{/* Gift cards must not block check-in during a network outage. */}finally{pending=false;}};
    void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},1200);return()=>{active=false;clearInterval(timer);};
  },[api,receive]);
  async function action(op:string,args:Record<string,unknown>={}){
    if(actionLock.current||!current.current)return;actionLock.current=true;setBusy(true);setError("");
    try{const s=current.current;const reply=await api(op,{sessionId:s.id,revision:s.revision,...args});receive(reply,s.id);if(op==="cancel")setReviewCard(false);if(reply.message)setError(reply.message);}
    catch(e){setError(e instanceof Error?e.message:"Gift card action failed");}finally{actionLock.current=false;setBusy(false);}
  }
  function dismiss(){const s=current.current;setOpen(false);if(!s)return;rememberGiftScreen(s);void api("dismiss",giftDismissArgs(s)).then(reply=>receive(reply,s.id)).catch(()=>{});}
  const loadAppearance=useCallback(async()=>{const result=await api("appearance");setAppearance(result);return result;},[api]);
  useEffect(()=>{if(!checkout)return;let active=true;void api("appearance").then(result=>{if(active)setAppearance(result);}).catch(()=>{});return()=>{active=false;};},[checkout,api]);
  if(!installed&&!session)return null;
  return <div className="gc"><GiftEntryCard checkout={checkout} design={session?.status==="open"&&session.mode==="use"?session.card?.design??appearance?.design:appearance?.design} salonName={session?.status==="open"&&session.mode==="use"?session.card?.salonName??appearance?.salonName:appearance?.salonName} busy={busy||!session} canBuy={installed} onUse={()=>void action("open",{mode:"use",entry:"code"})} onBuy={()=>void action("open",{mode:"buy",entry:"code"})} summary={session?.status==="open"&&session.approved&&session.amount?"Selected: "+giftMoney(session.amount):session?.status==="open"&&session.purchase?"To purchase: "+giftMoney(session.purchase):undefined}/>
    {!open&&error&&<p className="gc-note gc-error" role="alert">{error}</p>}
    {checkout&&reviewCard&&!open&&<p className="gc-help" role="status">Please review and apply your gift card again.</p>}
    {open&&session&&<GiftDialog key={session.id} loadAppearance={loadAppearance} session={session} installed={installed} busy={busy} error={error} action={action} onClose={dismiss}/>}
  </div>;
}

function GiftIcon(){return <svg className="gc-gift-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="7" y="20" width="34" height="23" rx="2"/><path d="M5 14h38v9H5zM24 14v29M24 14C8 14 10 1 17 5c4 2 7 9 7 9Zm0 0C40 14 38 1 31 5c-4 2-7 9-7 9Z"/></svg>}
function GiftEntryCard({busy,canBuy,onUse,onBuy,summary,checkout,design,salonName}:{busy:boolean;canBuy:boolean;onUse:()=>void;onBuy:()=>void;summary?:string;checkout?:boolean;design?:GiftDesign;salonName?:string}){return <section className={`gc customer-gift-card${checkout?" customer-checkout-gift-entry":""}`} aria-label="Gift cards">{checkout?<><div className="customer-checkout-gift-preview"><GiftArtwork design={design} salonName={salonName}/></div><div><h2>Gift cards</h2><p>Use your card, or give a little beauty.</p></div></>:<div className="customer-gift-summary"><GiftIcon/><div><h2>Gift cards</h2><p>A thoughtful gift.<br/>A beautiful experience.</p></div></div>}<div className="customer-gift-actions"><button type="button" disabled={busy} onClick={onUse}>Use a card <span aria-hidden="true">→</span></button><button type="button" disabled={busy||!canBuy} onClick={onBuy}>Buy a card <span aria-hidden="true">→</span></button></div>{summary&&<p className="gc-help gc-selection-summary" role="status">{summary}</p>}</section>}
export function GiftDialog(props:Parameters<typeof CustomerGiftDialog>[0]){return <CustomerGiftDialog {...props}/>;}
