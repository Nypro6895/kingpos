"use client";
import { useCallback,useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PosDeskCustomer, PosDeskService, PosDeskStaff } from "@/types/pos-desk";
import type { PosDeskDefaults } from "@/lib/pos-settings";
import { DEFAULT_WORKSPACE_PREFERENCES, type PosWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import { listPortableOperations, portableCheckpoint, savePortableOperation } from "@/lib/portable-operations";
import { PortableSyncIndicator } from "./portable/portable-sync-indicator";
import { PortableDraftControls } from "./portable/portable-draft-controls";
import { searchPosDeskCustomers } from "./actions";
import { OwnerPosTabs } from "./owner-pos-tabs";
import { SingleWorkspaceWindow } from './single-workspace-window';
type Line = { id:string;staffId:string|null;staffName:string;serviceId:string|null;serviceLabel:string;total:number;amountInput:string;amountParts:number[] };
type Step = 'staff'|'services'|'amount';
type Cart = { inputTarget?:'amount'|'tip'|'discount'; activeLineId?:string|null; step?:Step; id:string;amount:string;staffId:string|null;serviceId:string|null;customer:PosDeskCustomer|null;lines:Line[];tip:string;discount:string };
const empty = ():Cart=>({id:crypto.randomUUID(),amount:"",staffId:null,serviceId:null,customer:null,lines:[],tip:"",discount:""});
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const button="min-h-12 rounded-xl border border-zinc-200 bg-white px-4 py-3 font-semibold shadow-sm transition hover:bg-orange-50 active:scale-[.98] disabled:opacity-50";
export function OwnerPosClient(props:Parameters<typeof OwnerPosWorkspace>[0]) {
  // The existing navigation shell mounts mobile and desktop slots together.
  // Only the visible slot may own the cart or acquire the browser window lock.
  const host=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    const element=host.current;if(!element)return;
    const desktop=element.closest('[data-testid="customer-desktop-shell"]');
    const media=window.matchMedia('(min-width: 1280px)');
    const check=()=>setVisible(document.querySelector('[data-testid="customer-desktop-shell"]')?Boolean(desktop)===media.matches:element.getBoundingClientRect().width>0);
    const observer=new ResizeObserver(check);
    observer.observe(element);media.addEventListener('change',check);window.addEventListener('resize',check);
    queueMicrotask(check);
    return()=>{observer.disconnect();media.removeEventListener('change',check);window.removeEventListener('resize',check);};
  },[]);
  return <div ref={host}>{visible?<SingleWorkspaceWindow id={props.scope}><OwnerPosWorkspace {...props}/></SingleWorkspaceWindow>:null}</div>;
}
function OwnerPosWorkspace({scope,salonId,salonName,initial,preferences:initialPreferences=DEFAULT_WORKSPACE_PREFERENCES}:{
  scope:string;salonId:string;salonName:string;initial:{staff:PosDeskStaff[];services:PosDeskService[];defaults:PosDeskDefaults;today:string};preferences?:PosWorkspacePreferences;
}) {
  useEffect(()=>{
    const resize=()=>{
      const element=document.querySelector<HTMLElement>('[data-pos-owner-page]');if(!element)return;
      const nav=Array.from(document.querySelectorAll('nav')).find(n=>getComputedStyle(n).position==='fixed'&&n.getBoundingClientRect().bottom>=window.innerHeight-2);
      const bottom=nav?.getBoundingClientRect().height??0;
      element.style.setProperty('--owner-height',`${Math.max(280,window.innerHeight-element.getBoundingClientRect().top-bottom-8)}px`);
    };
    resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};
  },[]);
  const key=`kingpos:owner-cart:v1:${scope}`;
  const [reference,setReference]=useState(initial);
  const [preferences,setPreferences]=useState(initialPreferences);
  const [cart,setCart]=useState<Cart|null>(null);
  const current=useRef<Cart|null>(null);
  const busyRef=useRef(false);
  const replaceAmount=useRef(true);
  const entries=useRef<HTMLDivElement>(null);
  useEffect(()=>{const list=entries.current;if(list)list.scrollTop=cart?.inputTarget&&cart.inputTarget!=='amount'?list.scrollHeight:0;},[cart?.inputTarget]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [panel,setPanel]=useState<'staff'|'services'|'customer'|'tip'|'discount'|'ticket'|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState(''),[customers,setCustomers]=useState<PosDeskCustomer[]>([]);
  const pendingDefaults=useRef(initial.defaults);
  const [ticketDefaults,setTicketDefaults]=useState(initial.defaults);
  const persist=useCallback((next:Cart)=>{
    try { localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),cart:next})); current.current=next;setCart(next);setError('');return true; }
    catch {setError('Unable to save on this device. Keep this ticket open.');return false;}
  },[key]);
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try {
        const raw=JSON.parse(localStorage.getItem(key)??'null');
        const checkpoint=await portableCheckpoint(scope,key);
        if(!alive)return;
        const next=raw?.savedAt>checkpoint&&Array.isArray(raw?.cart?.lines)?raw.cart:empty();
        localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),cart:next}));current.current=next;setCart(next);
      }catch{if(alive)setError('Unable to open saved work on this device. Please try again.');}
    })();return()=>{alive=false;};
  },[key,scope]);
  useEffect(()=>{if(panel)dialog.current?.showModal();else dialog.current?.close();},[panel]);
  useEffect(()=>{
    if(panel!=='customer'||query.trim().length<2)return;
    let alive=true;const timer=setTimeout(()=>{void searchPosDeskCustomers(query).then(result=>{if(alive)setCustomers(result);}).catch(()=>{if(alive)setError('Connect to search customer records. Your ticket is still here.');});},250);
    return()=>{alive=false;clearTimeout(timer);};
  },[panel,query]);
  const refresh=async()=>{
    const r=await fetch('/api/pos/owner/workspace',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return;
    const next=await r.json();if(next.salonId!==salonId||!Array.isArray(next.staff))return;
    pendingDefaults.current=next.defaults;setReference(next);
    if(!current.current?.lines.length&&!current.current?.amount)setTicketDefaults(next.defaults);
  };
  usePosResourceRefresh(salonId,'staff',async(ids)=>{
    const response=await fetch('/api/pos/owner/workspace?resource=staff'+(ids?.length?'&ids='+encodeURIComponent(ids.join(',')):''),{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return;const next=await response.json();
    if(Array.isArray(next.staff))setReference(previous=>({...previous,today:next.today,staff:ids?.length?[...previous.staff.filter(s=>!ids.includes(s.id)),...next.staff]:next.staff}));
  });
  usePosResourceRefresh(salonId,'catalog',async()=>{
    const response=await fetch('/api/pos/owner/workspace?resource=catalog',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return;const data=await response.json();if(Array.isArray(data.services))setReference(previous=>({...previous,services:data.services}));
  });
  usePosResourceRefresh(salonId,'settings',async()=>{
    const r=await fetch('/api/pos/owner/workspace?resource=settings',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return;
    const data=await r.json();setPreferences(data.preferences);await refresh();
  });
  const update=(patch:Partial<Cart>)=>{if(current.current&&!busyRef.current)persist({...current.current,...patch});};
  const makeLine=():Line|null=>{
    if(!cart)return null;const amount=Number(cart.amount);
    if(!Number.isFinite(amount)||amount<=0)return null;
    const member=reference.staff.find(s=>s.id===cart.staffId);
    if(ticketDefaults.staffCheckInEnabled&&(!member||member.today_status!=='working')){setError('Choose a staff member who is checked in.');setPanel('staff');return null;}
    if(cart.staffId&&!member){setError('This staff member is no longer available. Choose another.');return null;}
    const service=reference.services.find(s=>s.id===cart.serviceId);
    return{id:crypto.randomUUID(),staffId:member?.id??null,staffName:member?.display_name??'Unassigned',serviceId:service?.id??null,serviceLabel:service?.name??'Service',total:Math.round(amount*100)/100,amountInput:cart.amount,amountParts:[Math.round(amount*100)/100]};
  };
  const add=()=>{if(!cart)return;const line=cart.amount?makeLine():null;if(cart.amount&&!line)return;replaceAmount.current=true;update({lines:line?[...cart.lines,line]:cart.lines,amount:'',staffId:null,serviceId:null,activeLineId:null,inputTarget:'amount',step:firstStep});};
  const reset=async()=>{if(busyRef.current)return; if(persist(empty()))setTicketDefaults(pendingDefaults.current);};
  const submit=async()=>{
    if(!cart||busyRef.current)return;
    const line=cart.amount?makeLine():null;if(cart.amount&&!line)return;
    const lines=line?[...cart.lines,line]:cart.lines;
    if(lines.some(l=>!Number.isFinite(l.total)||l.total<=0)){setError('Enter an amount for each service.');return;}
    if(!lines.length){setError('Enter an amount first.');return;}
    if(ticketDefaults.staffCheckInEnabled&&lines.some(l=>!reference.staff.some(s=>s.id===l.staffId&&s.today_status==='working'))){setError('A selected staff member is no longer checked in. Review this ticket.');return;}
    busyRef.current=true;setBusy(true);setError('');
    try{
      // Use the same durable cart identity across a retry after a lost reply.
      const existing=(await listPortableOperations(scope)).find(op=>op.payload.ownerCartId===cart.id);
      if(!existing)await savePortableOperation(scope,'receipt',{ownerCartId:cart.id,localDraftKey:key,lines,customerId:cart.customer?.id??null,customerName:cart.customer?.name??null,tipAmount:Number(cart.tip||0),discountType:'fixed_amount',discountValue:Number(cart.discount||0)});
      const next=empty();if(persist(next))setTicketDefaults(pendingDefaults.current);
    }catch{setError('Unable to save this ticket. Your entries have been kept.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  const subtotal=cart?.lines.reduce((sum,l)=>sum+l.total,0)??0;
  const total=Math.max(0,subtotal+Number(cart?.amount||0)-Number(cart?.discount||0))+Number(cart?.tip||0);
  const staff = reference.staff.filter(s=>!ticketDefaults.staffCheckInEnabled||s.today_status==='working')
    .sort((a,b)=>(a.turns?.queueTurns??0)-(b.turns?.queueTurns??0)||(a.check_in_sequence??0)-(b.check_in_sequence??0));
  const hasStaff=ticketDefaults.staffCheckInEnabled||(preferences.showStaff&&staff.length>0);
  const hasServices=preferences.showServices&&reference.services.length>0;
  const firstStep:Step=hasStaff?'staff':hasServices?'services':'amount';
  const step:Step=cart?.step??(cart?.amount?'amount':cart?.serviceId?'amount':cart?.staffId?(hasServices?'services':'amount'):firstStep);
  const member=staff.find(s=>s.id===cart?.staffId),service=reference.services.find(s=>s.id===cart?.serviceId);
  const selectedLine=cart?.lines.find(l=>l.id===cart.activeLineId);
  const amountValue=selectedLine?.amountInput??cart?.amount??'';
  const setAmount=(value:string)=>{
    if(!cart||!/^\d*(\.\d{0,2})?$/.test(value))return;
    if(selectedLine)update({lines:cart.lines.map(l=>l.id===selectedLine.id?{...l,amountInput:value,total:Math.round(Number(value||0)*100)/100,amountParts:[Math.round(Number(value||0)*100)/100]}:l)});
    else update({amount:value});
  };
  const selectLine=(id:string|null)=>{replaceAmount.current=true;update({activeLineId:id,inputTarget:'amount',step:'amount'});};
  const chooseStaff=(id:string|null)=>{
    update({inputTarget:'amount'});
    if(selectedLine&&cart)update({lines:cart.lines.map(l=>l.id===selectedLine.id?{...l,staffId:id,staffName:staff.find(s=>s.id===id)?.display_name??'Unassigned'}:l),step:hasServices?'services':'amount'});
    else update({staffId:id,step:hasServices?'services':'amount'});
  };
  const chooseService=(id:string|null)=>{
    const selected=reference.services.find(s=>s.id===id);replaceAmount.current=true;update({inputTarget:'amount'});
    if(selectedLine&&cart)update({lines:cart.lines.map(l=>l.id===selectedLine.id?{...l,serviceId:id,serviceLabel:selected?.name??'Service'}:l),step:'amount'});
    else update({serviceId:id,amount:cart?.amount||String(selected?.base_price??''),step:'amount'});
  };
  const chooseAdjustment=(target:'tip'|'discount')=>{
    if(!window.matchMedia('(max-width:767px)').matches){setPanel(target);return;}
    replaceAmount.current=true;setPanel(null);update({inputTarget:target,step:'amount'});
  };
  const pressKey=(n:string)=>{
    const target=window.matchMedia('(max-width:767px)').matches?(cart?.inputTarget??'amount'):'amount';
    const value=target==='amount'?amountValue:(cart?.[target]??'');
    const next=n==='⌫'?value.slice(0,-1):(replaceAmount.current?'':value)+n;
    const normalized=next==='.'?'0.':next;
    if(!/^\d*(\.\d{0,2})?$/.test(normalized))return;
    replaceAmount.current=false;
    if(target==='amount')setAmount(normalized);else update({[target]:normalized});
  };
  const inlineRows=cart?<div ref={entries} className="owner-inline-rows" aria-label="Ticket entries">
    {cart.lines.map((line,index)=><div key={line.id} data-selected={(!cart.inputTarget||cart.inputTarget==='amount')&&selectedLine?.id===line.id}><button className="owner-row-select" aria-label={`Edit entry ${index+1}`} onClick={()=>selectLine(line.id)}/><span>{cart.customer?.name??'Walk-in'}</span><span>{line.serviceLabel}</span><span>{line.staffName}</span>{selectedLine?.id===line.id?<label className="owner-inline-money">$<input aria-label="Amount" inputMode="none" value={amountValue} placeholder="0.00" onFocus={e=>{replaceAmount.current=true;update({inputTarget:'amount'});e.target.select();}} onClick={e=>e.stopPropagation()} onChange={e=>setAmount(e.target.value)}/></label>:<strong>{money(line.total)}</strong>}</div>)}
    {(!cart.activeLineId||cart.amount||cart.staffId||cart.serviceId)?<div data-selected={(!cart.inputTarget||cart.inputTarget==='amount')&&!selectedLine}><button className="owner-row-select" aria-label="Edit current entry" onClick={()=>selectLine(null)}/><span>{cart.customer?.name??'Walk-in'}</span><span>{service?.name??'Service'}</span><span>{member?.display_name??'—'}</span>{!selectedLine?<label className="owner-inline-money">$<input aria-label="Amount" inputMode="none" value={cart.amount} placeholder="0.00" onFocus={e=>{replaceAmount.current=true;update({inputTarget:'amount'});e.target.select();}} onClick={e=>e.stopPropagation()} onChange={e=>setAmount(e.target.value)}/></label>:<strong>{money(Number(cart.amount||0))}</strong>}</div>:null}
    {(['tip','discount'] as const).map(target=>(Number(cart[target])>0||cart.inputTarget===target)?<div key={target} className="owner-adjustment-row" data-selected={cart.inputTarget===target}>
      <button className="owner-row-select" aria-label={`Edit ${target}`} onClick={()=>chooseAdjustment(target)}/>
      <span>{target==='tip'?'Tip':'Discount'}</span><strong>{target==='discount'?'-':''}{money(Number(cart[target]||0))}</strong>
    </div>:null)}
  </div>:null;
  const linesView=cart?<div className="owner-lines">{cart.lines.map(line=><div key={line.id}><span><strong>{line.serviceLabel}</strong><small>{line.staffName}</small></span><strong>{money(line.total)}</strong><button aria-label={`Remove ${line.serviceLabel}`} onClick={()=>update({lines:cart.lines.filter(l=>l.id!==line.id)})}>×</button></div>)}{cart.amount?<div><span><strong>{service?.name??'Service'}</strong><small>{member?.display_name??'Unassigned'} · Current entry</small></span><strong>{money(Number(cart.amount))}</strong></div>:null}{!cart.lines.length&&!cart.amount?<p>Select staff and a service to begin.</p>:null}</div>:null;
  return <main className="owner-checkout" data-pos-owner-page data-step={step}>
    <header className="owner-heading"><h1>{salonName}</h1><div><OwnerPosTabs active="pos"/><PortableSyncIndicator scope={scope}/></div></header>
    {error?<p role="alert" className="owner-error">{error}</p>:null}
    {cart?<>
      <div className="owner-tools">
        <PortableDraftControls scope={scope} active={Boolean(cart.lines.length||cart.amount)} activity={JSON.stringify(cart)} value={cart} label={cart.customer?.name??'Walk-in'} reset={reset} restore={value=>persist(value)} idleMinutes={preferences.idleMinutes} warningSeconds={preferences.idleWarningSeconds}/>
      </div>
      <div className="owner-workbench">
        <section className="owner-receipt"><div className="owner-section-heading"><h2>Ticket</h2><Link href="/pos-tickets">History</Link></div>{preferences.showCustomer?<button className={button} onClick={()=>setPanel('customer')}>{cart.customer?.name??'Add customer'}</button>:null}{linesView}<div className="owner-total"><span>Total</span><strong>{money(total)}</strong></div></section>
        <section className="owner-catalog">
          {hasStaff?<div className="owner-staff"><div className="owner-section-heading"><h2>Staff Turn Board</h2><small>{staff.length} available</small></div><div className="owner-choice-grid">{staff.map(s=><button key={s.id} aria-pressed={s.id===cart.staffId} onClick={()=>chooseStaff(s.id)}><span className="owner-avatar">{s.display_name.slice(0,1)}</span><strong>{s.display_name}</strong><b className="owner-turn">{s.turns?.queueTurns??0}</b></button>)}</div>{!staff.length?<p className="owner-empty">No staff checked in. Check in a staff member to start.</p>:null}{!ticketDefaults.staffCheckInEnabled?<button className="owner-skip" onClick={()=>chooseStaff(null)}>Skip staff →</button>:null}</div>:null}
          {hasServices?<div className="owner-services"><div className="owner-section-heading"><h2>Choose service</h2>{hasStaff?<button className="owner-back" onClick={()=>update({step:'staff'})}>← Back</button>:null}</div><div className="owner-choice-grid">{reference.services.map(s=><button key={s.id} aria-pressed={s.id===cart.serviceId} onClick={()=>chooseService(s.id)}><strong>{s.name}</strong><small>{money(Number(s.base_price??0))}</small></button>)}</div><button className="owner-skip" onClick={()=>chooseService(null)}>Amount only →</button></div>:null}
        </section>
        <section className="owner-amount">{inlineRows}
          <div className="owner-section-heading"><span className="owner-selection">{member?.display_name??'Amount'}{service?` · ${service.name}`:''}</span>{hasStaff||hasServices?<button className="owner-back" onClick={()=>update({step:hasServices?'services':'staff'})}>← Back</button>:null}</div>
          <label className="owner-amount-field"><span>Amount</span><input aria-label="Amount" inputMode="none" autoComplete="off" value={amountValue} placeholder="0.00" onFocus={e=>e.target.select()} onChange={e=>{if(/^\d*(\.\d{0,2})?$/.test(e.target.value))setAmount(e.target.value);}}/></label>
          <div className="owner-keypad">{['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(n=><button key={n} disabled={busy} onClick={()=>pressKey(n)}>{n}</button>)}</div>
          <div className="owner-adjustments"><button onClick={()=>setPanel('ticket')}>Edit line</button>{preferences.showCustomer?<button onClick={()=>setPanel('customer')}>Customer</button>:null}{preferences.showTip?<button aria-pressed={cart?.inputTarget==='tip'} onClick={()=>chooseAdjustment('tip')}>Tip {Number(cart.tip)>0?money(Number(cart.tip)):''}</button>:null}{preferences.showDiscount?<button aria-pressed={cart?.inputTarget==='discount'} onClick={()=>chooseAdjustment('discount')}>Discount {Number(cart.discount)>0?money(Number(cart.discount)):''}</button>:null}</div>
          <div className="owner-submit"><div className="owner-mobile-total"><small>Total</small><strong>{money(total)}</strong></div><button disabled={busy} onClick={add}>+ Add another</button><button disabled={busy} onClick={()=>void submit()}>{busy?'Saving…':'Submit'}</button></div>
        </section>
      </div>
    </>:<p>Opening your saved workspace…</p>}
    <dialog ref={dialog} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setPanel(null);}}} onCancel={()=>setPanel(null)} className="fixed inset-0 m-auto max-h-[80dvh] w-[min(30rem,calc(100vw-2rem))] overflow-auto rounded-2xl border-0 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/40">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold capitalize">{panel}</h2><button className={button} onClick={()=>setPanel(null)}>Done</button></div>
      {panel==='ticket'?<><div className="owner-adjustments"><button onClick={()=>{setPanel(null);update({step:hasStaff?'staff':hasServices?'services':'amount'});}}>Staff / service</button>{selectedLine?<button onClick={()=>{update({lines:cart!.lines.filter(l=>l.id!==selectedLine.id),activeLineId:null});setPanel(null);}}>Remove line</button>:null}</div><div className="owner-adjustments owner-review-adjustments">{preferences.showCustomer?<button onClick={()=>setPanel('customer')}>Customer</button>:null}{preferences.showTip?<button aria-pressed={cart?.inputTarget==='tip'} onClick={()=>chooseAdjustment('tip')}>Tip {Number(cart?.tip)>0?money(Number(cart?.tip)):''}</button>:null}{preferences.showDiscount?<button aria-pressed={cart?.inputTarget==='discount'} onClick={()=>chooseAdjustment('discount')}>Discount {Number(cart?.discount)>0?money(Number(cart?.discount)):''}</button>:null}</div>{linesView}<div className="owner-total"><span>Total</span><strong>{money(total)}</strong></div><Link href="/pos-tickets" className="owner-skip">Ticket history →</Link></>:null}
      {panel==='staff'?<div className="grid gap-2">{!ticketDefaults.staffCheckInEnabled?<button className={button} onClick={()=>{update({staffId:null});setPanel(null);}}>No staff assignment</button>:null}{reference.staff.filter(s=>!ticketDefaults.staffCheckInEnabled||s.today_status==='working').map(s=><button className={button} key={s.id} onClick={()=>{update({staffId:s.id});setPanel(null);}}>{s.display_name}</button>)}</div>:null}
      {panel==='services'?<div className="grid gap-2">{reference.services.map(s=><button className={button} key={s.id} onClick={()=>{update({serviceId:s.id,amount:cart?.amount||String(s.base_price??'')});setPanel(null);}}>{s.name}</button>)}</div>:null}
      {panel==='customer'?<><input autoComplete="off" aria-label="Search customers" placeholder="Name or phone" className="mb-3 min-h-12 w-full rounded-xl border p-3" value={query} onChange={e=>setQuery(e.target.value)}/><button className={button} onClick={()=>{update({customer:null});setPanel(null);}}>Walk-in customer</button><div className="mt-3 grid gap-2">{customers.map(c=><button className={button} key={c.id} onClick={()=>{update({customer:c});setPanel(null);}}>{c.name} · {c.phone?.slice(-4)}</button>)}</div></>:null}
      {panel==='tip'||panel==='discount'?<input aria-label={panel} inputMode="decimal" autoComplete="off" placeholder="0.00" className="min-h-14 w-full rounded-xl border p-3 text-2xl" value={cart?.[panel]??''} onChange={e=>{if(/^\d*(\.\d{0,2})?$/.test(e.target.value))update({[panel]:e.target.value});}}/>:null}
    </dialog>
  </main>;
}
