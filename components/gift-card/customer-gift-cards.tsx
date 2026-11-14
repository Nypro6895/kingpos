"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { giftApi } from "./gift-api";
import { CardArtwork } from "./card-design";
import { giftLink } from "./pos-gift-card";
import { defaultGiftDesign, giftCents, giftMoney, normalizeGiftDesign, type GiftCardView, type GiftReply, type GiftSession, type GiftTransport } from "@/types/gift-card";
import { GiftQr as QrCodeTile } from "./gift-qr";
import { createQrCode } from "@/components/qr-code-tile";
import { GiftModalLayer } from "./gift-modal-layer";
import "./gift-card.css";
import "./customer-wallet.css";

async function saveCardImage(card: GiftCardView, token: string, code: string, pin: string) {
  const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=1000;const ctx=canvas.getContext("2d")!;const d=card.design?.elements?.length?normalizeGiftDesign(card.design):defaultGiftDesign(card.salonName);ctx.fillStyle="#fff";ctx.fillRect(0,0,1200,1000);ctx.fillStyle=d.background;ctx.fillRect(40,40,1120,680);
  async function drawImage(src:string,x:number,y:number,w:number,h:number){if(!src)return;const img=new Image();img.crossOrigin="anonymous";img.src=src;await img.decode();ctx.drawImage(img,x,y,w,h);}
  try{await drawImage(d.image,40,40,1120,680);}catch{/* Keep solid design background if an external image is unavailable. */}
  for(const e of d.elements){const x=40+e.x/100*1120,y=40+e.y/100*680;ctx.fillStyle=d.color;ctx.textAlign="center";ctx.textBaseline="middle";if(e.kind==="logo"){try{await drawImage(d.logo,x-e.size,y-e.size,e.size*2,e.size*2);}catch{/* Text and credentials remain printable. */}}else{ctx.font=`${e.font==="serif"?400:e.font==="sans"?500:600} ${e.size*2}px ${e.font==="serif"?"Georgia":"Arial"}`;ctx.fillText(e.text,x,y,1040);}}
  ctx.textAlign="left";ctx.fillStyle="#222";ctx.font="bold 32px Arial";ctx.fillText(`${card.salonName} • ${giftMoney(card.balance)}`,50,780);ctx.font="28px monospace";ctx.fillText(`Code: ${code.match(/.{1,4}/g)?.join(" ")}`,50,835);ctx.fillText(`PIN: ${pin}`,50,880);ctx.font="20px Arial";ctx.fillText("Use at this salon. Balance is checked at checkout. Keep this image private.",50,930,840);
  const qr=createQrCode(giftLink("card",token));if(qr){ctx.fillStyle="#fff";ctx.fillRect(920,740,250,250);const unit=220/(qr.size+8);ctx.fillStyle="#111";qr.cells.forEach((row,y)=>row.forEach((filled,x)=>{if(filled)ctx.fillRect(935+(x+4)*unit,755+(y+4)*unit,Math.ceil(unit),Math.ceil(unit));}));}
  const link=document.createElement("a");link.download="reylumi-gift-card.png";link.href=canvas.toDataURL("image/png");link.click();
}
export function GiftDelivery({ reply, onTransfer, onClaim }: { reply:GiftReply; onTransfer?:()=>Promise<GiftReply>; onClaim?:()=>Promise<void> }) {
  const [status,setStatus]=useState("");const [email,setEmail]=useState("");const [busy,setBusy]=useState(false);const card=reply.card;
  if(!card||!reply.token)return null;const link=giftLink("card",reply.token);
  const execute=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}};
  const fresh=async()=>onTransfer?await onTransfer():reply;
  return <article className="gc gc-panel gc-grid gc-print"><CardArtwork design={card.design?.elements?normalizeGiftDesign(card.design):defaultGiftDesign(card.salonName)}/><div className="gc-card-meta"><span>{card.salonName}</span><strong>{giftMoney(card.balance)}</strong></div><p>Valid at this salon only.</p><div className="gc-qr"><QrCodeTile value={link} label="Gift card"/><code>{reply.code?.match(/.{1,4}/g)?.join(" ")}</code><code>PIN: {reply.pin}</code></div>
    <p className="gc-help">Each Share, Save image or email action creates a new secure transfer and replaces the previous code. Anyone holding the latest code and PIN can spend the card. Copies of that same image share the same balance.</p>
    <div className="gc-row"><button disabled={busy} onClick={()=>void execute(async()=>{const r=await fresh();const url=giftLink("card",r.token!);if(navigator.share){await navigator.share({title:`Gift card • ${card.salonName}`,url});}else{await navigator.clipboard.writeText(url);setStatus("New link copied. Previous codes are no longer valid.");}})}>Share link</button><button disabled={busy} onClick={()=>void execute(async()=>{const r=await fresh();await saveCardImage(r.card!,r.token!,r.code!,r.pin!);})}>Save image</button><button disabled={busy} onClick={()=>void execute(async()=>{await fresh();setStatus("New code ready. Use Print current card to print it.");})}>Prepare print</button></div><button onClick={()=>window.print()}>Print current card</button>
    <label>Send using your email app<input aria-label="Recipient email" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy} onClick={()=>void execute(async()=>{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Enter a recipient email.");const r=await fresh();location.href=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`A gift card for ${card.salonName}`)}&body=${encodeURIComponent(`A gift for you!\n${giftLink("card",r.token!)}\nUse at ${card.salonName}.`)}`;})}>Create transfer & open email draft</button>
    {onClaim&&<button className="gc-primary" disabled={busy} onClick={()=>void execute(onClaim)}>Add to my Reylumi wallet</button>}
    {onTransfer&&<button disabled={busy} onClick={()=>void execute(async()=>{await onTransfer();setStatus("New code created. Old codes are no longer valid.");})}>Create new transfer — replace old code</button>}
    {status&&<p role="status" className="gc-note">{status}</p>}
  </article>;
}

type WalletAction = {kind:"use"|"transfer"|"history";card:GiftCardView};
type WalletTransferDraft = {card:GiftCardView;requestId:string;started?:boolean;initial?:GiftReply;current?:GiftReply;attempt?:{token:string;requestId:string};notice?:string};

function WalletActionDialog({action,wallet,transport,draft,onUpdate,onRefresh,onClose}:{action:WalletAction;wallet:GiftTransport;transport?:GiftTransport;draft?:WalletTransferDraft;onUpdate:(next:WalletTransferDraft)=>void;onRefresh:()=>Promise<void>;onClose:()=>void}){
  const [read,setRead]=useState<GiftReply>();const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [method,setMethod]=useState<"share"|"save"|"email">("share");const [email,setEmail]=useState("");
  const [deadline,setDeadline]=useState<number>();const [now,setNow]=useState(Date.now);const locked=useRef(false);
  const {kind,card}=action;const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{close.current?.focus();},[]);
  useEffect(()=>{
    if(kind==="transfer")return;let active=true;const started=Date.now();
    void wallet(kind==="use"?"present":"history",{cardId:card.id}).then(result=>{if(active){setRead(result);if(kind==="use")setDeadline(started+120000);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Unable to open this card.");});
    return()=>{active=false;};
  },[kind,card.id,wallet]);
  useEffect(()=>{if(!deadline)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[deadline]);
  const dismiss=()=>{if(!locked.current)onClose();};
  const shown=draft?.current?.card??card;
  async function transfer(){
    if(!draft||locked.current)return;
    if(method==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setError("Enter a recipient email.");return;}
    const progress={...draft};const update=()=>onUpdate({...progress});
    locked.current=true;setBusy(true);setError("");progress.started=true;progress.notice="Creating a secure transfer…";update();
    try{
      // Keep both identities stable when a response is lost. A completed export
      // starts a new public transfer on the next explicit outgoing action.
      if(!progress.initial){const initial=await wallet("transfer",{cardId:card.id,requestId:progress.requestId});if(!initial.token||!initial.card||!initial.code||!initial.pin)throw new Error("The transfer code could not be confirmed. Retry safely.");progress.initial=initial;progress.current=initial;update();}
      if(!progress.current?.token)throw new Error("The transfer code could not be loaded. Retry to recover it.");
      progress.attempt??={token:progress.current.token,requestId:crypto.randomUUID()};update();
      const result=await (transport??giftApi("public",progress.attempt.token))("transfer",{requestId:progress.attempt.requestId});
      if(!result.token||!result.card||!result.code||!result.pin)throw new Error("The transfer code could not be confirmed. Retry safely.");
      progress.current=result;progress.attempt=undefined;progress.notice="New transfer ready. Previous codes no longer work.";update();
      const url=giftLink("card",result.token);
      if(method==="share"){
        const canShare=typeof navigator.share==="function";
        if(canShare)await navigator.share({title:`Gift card • ${result.card.salonName}`,url});
        else await navigator.clipboard.writeText(url);
        progress.notice=canShare?"Share completed. Only this latest code is valid.":"New link copied. Only this latest code is valid.";
      }else if(method==="save"){
        await saveCardImage(result.card,result.token,result.code,result.pin);progress.notice="New card image saved. Only this latest code is valid.";
      }else{
        const link=document.createElement("a");link.href=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`A gift card for ${result.card.salonName}`)}&body=${encodeURIComponent(`A gift for you!\n${url}\nUse at ${result.card.salonName}.`)}`;link.click();progress.notice="Email draft opened. Send it from your email app. Only this latest code is valid.";
      }
    }catch(e){
      const canceled=e instanceof Error&&e.name==="AbortError";
      setError(canceled?"Sharing canceled. Your previous code has already changed. The current transfer is kept below; you can retry.":e instanceof Error?e.message:"Unable to complete this transfer.");
      progress.notice=progress.attempt||!progress.current?"The transfer may already have changed your code. Retry to confirm the same request safely.":"Your code has changed. The current transfer is kept here even though sending did not finish.";
    }finally{
      update();await onRefresh().catch(()=>{});locked.current=false;setBusy(false);
    }
  }
  const current=draft?.current;const confirmed=current?.token&&!draft?.attempt;
  const title=kind==="use"?"Show at checkout":kind==="history"?"Card history":"Transfer gift card";
  return <GiftModalLayer onClose={dismiss}><div className="gc gc-overlay gw-overlay"><section className="gc-modal gw-sheet" role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2><button ref={close} type="button" className="gc-text-action" disabled={busy} aria-label={`Close ${title.toLowerCase()}`} onClick={dismiss}>×</button></header>
    <div className="gw-mini"><div className="gw-art"><CardArtwork design={shown.design?.elements?normalizeGiftDesign(shown.design):defaultGiftDesign(shown.salonName)}/></div><div><strong>{shown.salonName}</strong><small>•••• {shown.last4}</small><span className="gw-mini-balance">{giftMoney(shown.balance)}</span></div></div>
    {kind==="use"&&(!read&&!error?<p role="status">Opening checkout code…</p>:read&&<div className="gw-checkout">{deadline&&now>=deadline?<p role="status">Checkout code expired. Close and tap Use at salon for a new code.</p>:<><p>Show this code and PIN to the salon.</p><strong className="gw-code">{read.code?.match(/.{1,4}/g)?.join(" ")}</strong><code>PIN: {read.pin}</code><p className="gc-help">{read.message||"One checkout only. Code expires in 2 minutes."}</p></>}</div>)}
    {kind==="history"&&(!read&&!error?<p role="status">Loading card history…</p>:<div className="gw-history">{read?.ledger?.length?read.ledger.map(entry=><div key={entry.id}><span>{entry.kind}<small>{new Date(entry.at).toLocaleString()}</small></span><strong>{giftMoney(entry.delta)}</strong></div>):read&&<p>No card activity yet.</p>}</div>)}
    {kind==="transfer"&&draft&&<><p className="gw-warning"><strong>Transfer the full remaining {giftMoney(shown.balance)} balance.</strong> Creating a transfer replaces previous codes. Anyone with the latest code and PIN can spend or claim the card.</p><div className="gw-methods" role="group" aria-label="Transfer method">{([['share','Share'],['save','Save image'],['email','Email']] as const).map(([value,label])=><button type="button" className="gc-text-action" key={value} disabled={busy} aria-pressed={method===value} onClick={()=>setMethod(value)}>{label}</button>)}</div>{method==="email"&&<label>Recipient email<input type="email" value={email} disabled={busy} autoComplete="off" placeholder="recipient@example.com" onChange={event=>setEmail(event.target.value)}/></label>}<button type="button" className="gc-primary gw-confirm" disabled={busy} onClick={()=>void transfer()}>{busy?"Preparing transfer…":`Create transfer & ${method==="save"?"save image":method}`}</button>{draft?.notice&&<p className="gc-note" role="status">{draft.notice}</p>}{confirmed&&<div className="gw-current"><h3>Current transfer code</h3><QrCodeTile value={giftLink("card",current.token!)} label="Current gift transfer"/><strong className="gw-code">{current.code?.match(/.{1,4}/g)?.join(" ")}</strong><code>PIN: {current.pin}</code><p className="gc-help">Keep this code private. Another outgoing action creates a new code and replaces this one.</p></div>}</>}
    {error&&<p className="gc-note gc-error" role="alert">{error}</p>}
    {kind==="transfer"&&!draft&&<p role="status">This card is back in your wallet. Close this panel to use its current code.</p>}
    <button type="button" className="gc-text-action" disabled={busy} onClick={dismiss}>{kind==="transfer"&&draft&&!draft.started?"Keep my card":"Done"}</button>
  </section></div></GiftModalLayer>;
}

export function CustomerGiftCards({ salonId, transport }: { salonId?:string; transport?:GiftTransport }) {
  const [catalog,setCatalog]=useState<GiftReply>();const [fragment,setFragment]=useState({kind:"",token:""});const [cards,setCards]=useState<GiftCardView[]>([]);const [reply,setReply]=useState<GiftReply>({});const [error,setError]=useState("");const [amount,setAmount]=useState("100");const [busy,setBusy]=useState(false);const [session,setSession]=useState<GiftSession>();const [code,setCode]=useState("");const [pin,setPin]=useState("");const request=useRef(crypto.randomUUID());
  const [action,setAction]=useState<WalletAction>();const [transfers,setTransfers]=useState(()=>new Map<string,WalletTransferDraft>());const heading=useRef<HTMLHeadingElement>(null);
  const [walletLoaded,setWalletLoaded]=useState(false);
  const wallet=useMemo(()=>transport??giftApi("wallet"),[transport]);const online=useMemo(()=>transport??giftApi("online"),[transport]);const publicApi=useMemo(()=>transport??giftApi("public",fragment.token),[transport,fragment.token]);
  const perform=useCallback(async(fn:()=>Promise<void>)=>{setBusy(true);setError("");try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[]);
  useEffect(()=>{const read=()=>{const h=new URLSearchParams(location.hash.slice(1));const kind=h.has("card")?"card":h.has("mobile")?"mobile":"";setFragment({kind,token:h.get(kind)||""});};read();window.addEventListener("hashchange",read);return()=>window.removeEventListener("hashchange",read);},[]);
  useEffect(()=>{queueMicrotask(()=>{if(fragment.kind==="card")void perform(async()=>{setReply(await publicApi("receive"));});else if(fragment.kind==="mobile")void perform(async()=>{const r=await publicApi("mobile");if(r.session?.qrVisible){const next=await publicApi("scan",{revision:r.session.revision});setSession(next.session);}else setSession(r.session);try{setCards((await wallet("list")).cards??[]);}catch{/* Guests may enter a bearer code without signing in. */}});else if(!salonId)void perform(async()=>{
    setWalletLoaded(false);
    const order=new URLSearchParams(location.search).get("order");
    // Status can finish the verified purchase; read the wallet after fulfillment.
    // Keep the receipt visible even if the subsequent wallet read needs sign-in.
    if(order)setReply(await (transport??giftApi("online",order))("status",{}));
    setCards((await wallet("list")).cards??[]);
    setWalletLoaded(true);
  });});},[fragment.kind,publicApi,wallet,online,salonId,perform,transport]);
  async function reloadMobile(){const r=await publicApi("mobile");setSession(r.session);}
  useEffect(()=>{if(salonId)queueMicrotask(()=>void perform(async()=>setCatalog(await online('catalog',{salonId}))));},[salonId,online,perform]);
  const retained=!fragment.kind&&!salonId?[...transfers.values()].filter(d=>d.started&&!cards.some(c=>c.id===d.card.id)).map(d=>d.current?.card??d.card):[];
  const owned=fragment.kind==='card'?[]:[...cards,...retained].filter(c=>!session||c.salonId===session.card?.salonId||!session.card);
  function openAction(kind:WalletAction["kind"],card:GiftCardView){if(kind==="transfer"&&!transfers.has(card.id))setTransfers(previous=>new Map(previous).set(card.id,{card,requestId:crypto.randomUUID()}));setAction({kind,card});}
  function closeAction(){const cardId=action?.card.id;setAction(undefined);requestAnimationFrame(()=>{if(document.activeElement===document.body||!document.activeElement?.isConnected){const card=[...document.querySelectorAll<HTMLElement>("[data-wallet-card]")].find(element=>element.dataset.walletCard===cardId);(card?.querySelector<HTMLButtonElement>("button")??heading.current)?.focus();}});}
  async function refreshWallet(){const next=(await wallet("list")).cards??[];setCards(next);setTransfers(previous=>new Map([...previous].filter(([id,draft])=>{const owned=next.find(c=>c.id===id);return !owned||!draft.current?.card||owned.pendingTransfer||owned.generation===draft.current.card.generation;})));}
  return <main className="gc gc-shell gw-wallet"><header><div><h1>Gift cards</h1><small>Created by Reylumi</small></div><a className="gc-button gc-text-action" href="/gift-cards">My wallet</a></header>
    {error&&<div className="gc-note gc-error" role="alert">{error} {error.toLowerCase().includes("sign in")&&<a href={`/login?next=${encodeURIComponent("/gift-cards")}`}>Sign in</a>}</div>}
    {salonId&&!fragment.kind&&<section className="gc gc-panel gc-grid"><h2>Buy a gift card · {catalog?.salonName??"Salon"}</h2><p>Keep it in your account, save it as an image, or share it later.</p><CardArtwork design={catalog?.design?.elements?normalizeGiftDesign(catalog.design):defaultGiftDesign(catalog?.salonName??"A gift for you")}/><div className="gc-row">{[25,50,100].map(v=><button key={v} aria-pressed={amount===String(v)} onClick={()=>setAmount(String(v))}>${v}</button>)}</div><label>Amount<input value={amount} onChange={e=>{setAmount(e.target.value);request.current=crypto.randomUUID();}} inputMode="decimal"/></label><button className="gc-primary" disabled={busy||!catalog?.installed} onClick={()=>void perform(async()=>{const r=await online("buy",{salonId,amount:giftCents(amount),requestId:request.current});if(r.url)location.assign(r.url);else if(r.order)location.assign(`/gift-cards?order=${r.order}`);})}>Continue to secure payment</button>{catalog&&!catalog.installed&&<p>Online gift card sales are not enabled at this salon.</p>}</section>}
    {reply.message&&<p className="gc-note">{reply.message}</p>}
    <GiftDelivery reply={reply} onClaim={fragment.kind==="card"?async()=>{await wallet("claim",{token:fragment.token});setReply({message:"Added to your wallet. Previous image/link codes are no longer valid."});location.hash="";setCards((await wallet("list")).cards??[]);}:undefined} onTransfer={reply.token?async()=>{const r=await (transport??giftApi("public",reply.token))("transfer",{requestId:request.current});request.current=crypto.randomUUID();setReply(r);if(fragment.kind==="card")location.hash=`card=${r.token}`;return r;}:undefined}/>
    {fragment.kind==="mobile"&&session&&<section className="gc-panel gc-grid"><h2>Use a gift card</h2><p>Ticket total {giftMoney(session.total)} · {session.status}</p>{session.approved?<p className="gc-note gc-ok">Gift card authorized. Staff will finish your payment.</p>:<><label>Card code<input aria-label="Card code" value={code} onChange={e=>setCode(e.target.value)}/></label><label>Security PIN<input aria-label="Security PIN" type="password" value={pin} onChange={e=>setPin(e.target.value)}/></label><button disabled={busy} className="gc-primary" onClick={()=>void perform(async()=>{const r=await publicApi("code",{revision:session.revision,code,pin});setSession(r.session);if(r.message)setError(r.message);setPin("");})}>Use code</button><a href={`/login?next=${encodeURIComponent("/gift-cards#mobile="+fragment.token)}`}>Sign in to choose a wallet card</a></>}<button onClick={()=>void perform(reloadMobile)}>Refresh payment status</button></section>}
    {!fragment.kind&&!salonId&&<h2 ref={heading} tabIndex={-1}>My gift cards</h2>}
    <div className="gc-cards gw-cards">{owned.map(c=>{const transfer=transfers.get(c.id);return <article className="gc-panel gw-card" key={c.id} data-wallet-card={c.id}><div className="gw-card-top"><div className="gw-art"><CardArtwork design={c.design?.elements?normalizeGiftDesign(c.design):defaultGiftDesign(c.salonName)}/></div><div><strong>{c.salonName}</strong><small>•••• {c.last4} · {c.status}</small></div></div><div className="gw-balance"><div><small>Available balance</small><strong>{giftMoney(c.balance)}</strong></div><span>{transfer?.started?transfer.current&&!transfer.attempt?"Transfer ready":"Transfer pending":c.pendingTransfer?"Transfer pending":c.status}</span></div>{fragment.kind==="mobile"?<button className="gc-primary" disabled={busy} onClick={()=>void perform(async()=>{const r=await wallet("approve",{mobile:fragment.token,cardId:c.id});setSession(r.session);})}>Confirm for this ticket</button>:<>{transfer?.started||c.pendingTransfer?<button className="gc-primary" disabled={busy||c.status!=="active"} onClick={()=>openAction("transfer",c)}>Continue transfer</button>:<button className="gc-primary" disabled={busy||c.status!=="active"} onClick={()=>openAction("use",c)}>Use at salon</button>}<div className="gw-actions">{!transfer?.started&&!c.pendingTransfer&&<button type="button" className="gc-text-action" disabled={busy||c.status!=="active"} onClick={()=>openAction("transfer",c)}>Transfer</button>}<button type="button" className="gc-text-action" onClick={()=>openAction("history",c)}>History</button></div></>}<small className="gw-valid">Valid at this salon only.</small></article>;})}</div>
    {action&&<WalletActionDialog key={`${action.card.id}:${action.kind}`} action={action} wallet={wallet} transport={transport} draft={transfers.get(action.card.id)} onUpdate={next=>setTransfers(previous=>new Map(previous).set(action.card.id,next))} onRefresh={refreshWallet} onClose={closeAction}/>}
    {walletLoaded&&!busy&&!owned.length&&!fragment.kind&&!salonId&&!error&&<p>No cards yet. Buy from a salon page or open a gift link to add one.</p>}
  </main>;
}
