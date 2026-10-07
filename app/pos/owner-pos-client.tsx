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
import { OwnerPosIcon } from './owner-pos-icon';
import { parsePosAmountInput } from '@/lib/pos-desk-amounts';
import { getStaffTurnToneLevel } from '@/lib/pos-staff-turn-tone';
type Line = { id:string;staffId:string|null;staffName:string;serviceId:string|null;serviceLabel:string;total:number;amountInput:string;amountParts:number[] };
type Step = 'staff'|'services'|'amount';
type Cart = { inputTarget?:'amount'|'tip'|'discount'; activeLineId?:string|null; step?:Step; id:string;amount:string;staffId:string|null;serviceId:string|null;customer:PosDeskCustomer|null;lines:Line[];tip:string;discount:string };
const empty = ():Cart=>({id:crypto.randomUUID(),amount:"",staffId:null,serviceId:null,customer:null,lines:[],tip:"",discount:""});
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const amountPreview=(value:string)=>value.split('/').reduce((sum,part)=>sum+(Number(part)||0),0);
const amountPattern=/^\d*(\.\d{0,2})?(\/\d*(\.\d{0,2})?)*$/;
export function OwnerPosClient(props:Parameters<typeof OwnerPosWorkspace>[0]) {
  return <SingleWorkspaceWindow id={props.scope}><OwnerPosWorkspace {...props}/></SingleWorkspaceWindow>;
}
function OwnerPosWorkspace({snapshotAt,scope,salonId,initial,preferences:initialPreferences=DEFAULT_WORKSPACE_PREFERENCES}:{
  snapshotAt?:number;scope:string;salonId:string;salonName:string;initial:{staff:PosDeskStaff[];services:PosDeskService[];defaults:PosDeskDefaults;today:string};preferences?:PosWorkspacePreferences;
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
  useEffect(()=>{
    const list=entries.current;
    const selected=list?.querySelector<HTMLElement>('[data-selected="true"]');
    if(!list||!selected)return;
    const bounds=list.getBoundingClientRect(),row=selected.getBoundingClientRect();
    if(!bounds.height)return;
    if(row.bottom>bounds.bottom)list.scrollTop+=row.bottom-bounds.bottom;
    else if(row.top<bounds.top)list.scrollTop+=row.top-bounds.top;
  },[cart?.inputTarget,cart?.activeLineId]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [panel,setPanel]=useState<'staff'|'services'|'customer'|'ticket'|null>(null);
  const [pickerQuery,setPickerQuery]=useState('');
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
  usePosResourceRefresh(salonId,'staff',async(ids)=>{
    const response=await fetch('/api/pos/owner/workspace?resource=staff'+(ids?.length?'&ids='+encodeURIComponent(ids.join(',')):''),{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return;const next=await response.json();
    if(Array.isArray(next.staff))setReference(previous=>({...previous,today:next.today,staff:ids?.length?[...previous.staff.filter(s=>!ids.includes(s.id)),...next.staff]:next.staff}));
  },{initialReconcile:false,snapshotAt});
  usePosResourceRefresh(salonId,'catalog',async()=>{
    const response=await fetch('/api/pos/owner/workspace?resource=catalog',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return;const data=await response.json();if(Array.isArray(data.services))setReference(previous=>({...previous,services:data.services}));
  },{initialReconcile:false,snapshotAt});
  usePosResourceRefresh(salonId,'settings',async()=>{
    const r=await fetch('/api/pos/owner/workspace?resource=settings',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return;
    const data=await r.json();if(data.salonId!==salonId)return;
    setPreferences(data.preferences);pendingDefaults.current=data.defaults;
    setReference(previous=>({...previous,defaults:data.defaults}));
    if(!current.current?.lines.length&&!current.current?.amount)setTicketDefaults(data.defaults);
  },{initialReconcile:false,snapshotAt});
  const update=(patch:Partial<Cart>)=>{if(current.current&&!busyRef.current)persist({...current.current,...patch});};
  const makeLine=():Line|null=>{
    if(!cart)return null;const parsed=parsePosAmountInput(cart.amount);
    if(!parsed.isValid){setError(parsed.error);return null;}const amount=parsed.total;
    const member=reference.staff.find(s=>s.id===cart.staffId);
    if(ticketDefaults.staffCheckInEnabled&&(!member||member.today_status!=='working')){setError('Choose a staff member who is checked in.');setPanel('staff');return null;}
    if(cart.staffId&&!member){setError('This staff member is no longer available. Choose another.');return null;}
    const service=reference.services.find(s=>s.id===cart.serviceId);
    return{id:crypto.randomUUID(),staffId:member?.id??null,staffName:member?.display_name??'Unassigned',serviceId:service?.id??null,serviceLabel:service?.name??'Service',total:amount,amountInput:cart.amount,amountParts:parsed.parts};
  };
  const add=()=>{if(!cart)return;const line=cart.amount?makeLine():null;if(cart.amount&&!line)return;replaceAmount.current=true;update({lines:line?[...cart.lines,line]:cart.lines,amount:'',staffId:null,serviceId:null,activeLineId:null,inputTarget:'amount',step:firstStep});};
  const reset=async()=>{if(busyRef.current)return; if(persist(empty()))setTicketDefaults(pendingDefaults.current);};
  const submit=async()=>{
    if(!cart||busyRef.current)return;
    const line=cart.amount?makeLine():null;if(cart.amount&&!line)return;
    const lines=line?[...cart.lines,line]:cart.lines;
    if(lines.some(l=>!parsePosAmountInput(l.amountInput).isValid||!Number.isFinite(l.total)||l.total<=0)){setError('Enter a valid amount for each service.');return;}
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
  const total=Math.max(0,subtotal+amountPreview(cart?.amount??'')-Number(cart?.discount||0))+Number(cart?.tip||0);
  const staff = reference.staff.filter(s=>!ticketDefaults.staffCheckInEnabled||s.today_status==='working')
    .sort((a,b)=>(a.turns?.queueTurns??0)-(b.turns?.queueTurns??0)||(a.check_in_sequence??0)-(b.check_in_sequence??0));
  const hasStaff=ticketDefaults.staffCheckInEnabled||(preferences.showStaff&&staff.length>0);
  const hasServices=preferences.showServices&&reference.services.length>0;
  const firstStep:Step=hasStaff?'staff':hasServices?'services':'amount';
  const selectedLine=cart?.lines.find(l=>l.id===cart.activeLineId);
  const member=staff.find(s=>s.id===(selectedLine?selectedLine.staffId:cart?.staffId)),service=reference.services.find(s=>s.id===(selectedLine?selectedLine.serviceId:cart?.serviceId));
  const amountValue=selectedLine?.amountInput??cart?.amount??'';
  const setAmount=(value:string)=>{
    if(!cart||!amountPattern.test(value))return;
    const parsed=parsePosAmountInput(value);
    if(selectedLine)update({lines:cart.lines.map(l=>l.id===selectedLine.id?{...l,amountInput:value,total:amountPreview(value),amountParts:parsed.isValid?parsed.parts:[]}:l)});
    else update({amount:value});
  };
  const selectLine=(id:string|null)=>{replaceAmount.current=true;update({activeLineId:id,inputTarget:'amount',step:'amount'});};
  const chooseStaff=(id:string|null)=>{
    if(selectedLine&&cart)update({inputTarget:'amount',lines:cart.lines.map(l=>l.id===selectedLine.id?{...l,staffId:id,staffName:staff.find(s=>s.id===id)?.display_name??'Unassigned'}:l),step:'amount'});
    else update({inputTarget:'amount',staffId:id,step:'amount'});
    setPanel(null);
  };
  const chooseService=(id:string|null)=>{
    const selected=reference.services.find(s=>s.id===id);replaceAmount.current=true;
    if(selectedLine&&cart)update({inputTarget:'amount',lines:cart.lines.map(l=>l.id===selectedLine.id?{...l,serviceId:id,serviceLabel:selected?.name??'Service'}:l),step:'amount'});
    else update({inputTarget:'amount',serviceId:id,amount:cart?.amount||String(selected?.base_price??''),step:'amount'});
    setPanel(null);
  };
  const chooseAdjustment=(target:'tip'|'discount')=>{
    replaceAmount.current=true;setPanel(null);update({inputTarget:target,step:'amount'});
  };
  const pressKey=(n:string)=>{
    const target=cart?.inputTarget??'amount';
    const value=target==='amount'?amountValue:(cart?.[target]??'');
    if(n==='/'&&(target!=='amount'||!value||value.endsWith('/')))return;
    if(n==='/'&&replaceAmount.current)replaceAmount.current=false;
    const next=n==='⌫'?value.slice(0,-1):(replaceAmount.current?'':value)+n;
    const normalized=next==='.'?'0.':next.endsWith('/.')?next.slice(0,-1)+'0.':next;
    if(!(target==='amount'?amountPattern:/^\d*(\.\d{0,2})?$/).test(normalized))return;
    replaceAmount.current=false;
    if(target==='amount')setAmount(normalized);else update({[target]:normalized});
  };
  const openPicker=(next:'services'|'staff')=>{setPickerQuery('');setPanel(next);};
  const currentEntry=Boolean(cart?.amount||cart?.staffId||cart?.serviceId||!cart?.lines.length);
  const entryCount=(cart?.lines.length??0)+(currentEntry?1:0);
  const inputTarget=cart?.inputTarget??'amount';
  const inputValue=inputTarget==='amount'?amountValue:(cart?.[inputTarget]??'');
  const inlineRows=cart?<div ref={entries} className="owner-inline-rows" aria-label="Ticket entries">
    {cart.lines.map((line,index)=><div key={line.id} data-selected={inputTarget==='amount'&&selectedLine?.id===line.id}>
      <button className="owner-row-select" aria-label={`Edit entry ${index+1}`} onClick={()=>selectLine(line.id)}/>
      <span title={line.serviceLabel}>{line.serviceLabel}</span><span className="owner-row-dash">-</span><span title={line.staffName}>{line.staffName}</span>
      {selectedLine?.id===line.id&&inputTarget==='amount'?<label className="owner-inline-money">$<input aria-label="Amount" inputMode="none" value={amountValue} placeholder="0.00" onFocus={e=>{replaceAmount.current=true;e.target.select();}} onClick={e=>e.stopPropagation()} onChange={e=>setAmount(e.target.value)}/></label>:<strong>{money(line.total)}</strong>}
    </div>)}
    {currentEntry?<div data-selected={inputTarget==='amount'&&!selectedLine}>
      <button className="owner-row-select" aria-label="Edit current entry" onClick={()=>selectLine(null)}/>
      <span title={reference.services.find(s=>s.id===cart.serviceId)?.name}>{reference.services.find(s=>s.id===cart.serviceId)?.name??'Service'}</span><span className="owner-row-dash">-</span><span>{reference.staff.find(s=>s.id===cart.staffId)?.display_name??'Unassigned'}</span>
      {!selectedLine&&inputTarget==='amount'?<label className="owner-inline-money">$<input aria-label="Amount" inputMode="none" value={cart.amount} placeholder="0.00" onFocus={e=>{replaceAmount.current=true;e.target.select();}} onClick={e=>e.stopPropagation()} onChange={e=>setAmount(e.target.value)}/></label>:<strong>{money(amountPreview(cart.amount))}</strong>}
    </div>:null}
    {(['tip','discount'] as const).map(target=>(Number(cart[target])>0||inputTarget===target)?<div key={target} className="owner-adjustment-row" data-selected={inputTarget===target}>
      <button className="owner-row-select" aria-label={`Edit ${target}`} onClick={()=>chooseAdjustment(target)}/>
      <span>{target==='tip'?'Tip':'Discount'}</span><strong>{target==='discount'?'-':''}{money(Number(cart[target]||0))}</strong>
    </div>:null)}
  </div>:null;
  const linesView=cart?<div className="owner-lines">
    {cart.lines.map((line,index)=><div key={line.id} data-selected={inputTarget==='amount'&&selectedLine?.id===line.id}>
      <button className="owner-desktop-line" aria-label={`Edit entry ${index+1}`} onClick={()=>selectLine(line.id)}><span><strong>{line.serviceLabel}</strong><small>{line.staffName}</small></span><strong>{money(line.total)}</strong></button>
      <button aria-label={`Remove ${line.serviceLabel}`} onClick={()=>update({lines:cart.lines.filter(l=>l.id!==line.id),activeLineId:selectedLine?.id===line.id?null:cart.activeLineId})}>×</button>
    </div>)}
    {currentEntry?<div data-selected={inputTarget==='amount'&&!selectedLine}><button className="owner-desktop-line" aria-label="Edit current entry" onClick={()=>selectLine(null)}><span><strong>{reference.services.find(s=>s.id===cart.serviceId)?.name??'Service'}</strong><small>{reference.staff.find(s=>s.id===cart.staffId)?.display_name??'Unassigned'} · Current entry</small></span><strong>{money(amountPreview(cart.amount))}</strong></button></div>:null}
  </div>:null;
  return <main className="owner-checkout" data-pos-owner-page data-owner-reference="true" data-step="amount">
    <div className="owner-sync-status"><PortableSyncIndicator scope={scope}/></div>
    <OwnerPosTabs active="pos"/>
    {error?<p role="alert" className="owner-error">{error}</p>:null}
    {cart?<>
      <div className="owner-tools">
        <PortableDraftControls scope={scope} active={Boolean(cart.lines.length||cart.amount)} activity={JSON.stringify(cart)} value={cart} label={cart.customer?.name??'Walk-in'} reset={reset} restore={value=>persist(value)} idleMinutes={preferences.idleMinutes} warningSeconds={preferences.idleWarningSeconds}/>
        {preferences.showCustomer?<button className="owner-customer-shortcut" onClick={()=>setPanel('customer')}>{cart.customer?.name??'Customer'}</button>:null}
      </div>
      <div className="owner-workbench">
        <section className="owner-receipt"><div className="owner-section-heading"><h2>Receipt</h2><Link href="/pos-tickets">History</Link></div>{linesView}
          <div className="owner-receipt-summary">
            {Number(cart.tip)>0||Number(cart.discount)>0?<div><span>Subtotal</span><strong>{money(subtotal+amountPreview(cart.amount))}</strong></div>:null}
            {(['discount','tip'] as const).map(target=>Number(cart[target])>0?<button key={target} onClick={()=>chooseAdjustment(target)}><span>{target==='tip'?'Tip':'Discount'}</span><strong>{target==='discount'?'-':''}{money(Number(cart[target]))}</strong></button>:null)}
            <div className="owner-total"><span>Total ({entryCount})</span><strong>{money(total)}</strong></div>
          </div>
        </section>
        <section className="owner-catalog">
          {hasStaff?<div className="owner-staff"><div className="owner-section-heading"><h2>Staff Turn Board</h2><small>Large turn: {money(ticketDefaults.largeTurnThreshold)}</small></div><div className="owner-choice-grid">{staff.map(s=><button key={s.id} data-turn-tone={getStaffTurnToneLevel(s.turns?.queueTurns??0,staff.map(item=>item.turns?.queueTurns??0))} aria-pressed={s.id===(selectedLine?selectedLine.staffId:cart.staffId)} onClick={()=>chooseStaff(s.id)}><strong>{s.display_name}</strong><b className="owner-turn">{s.turns?.queueTurns??0}</b><small>{s.turns?.smallTurns??0} small</small></button>)}</div>{!staff.length?<p className="owner-empty">No staff checked in. Check in a staff member to start.</p>:null}{!ticketDefaults.staffCheckInEnabled?<button className="owner-skip" onClick={()=>chooseStaff(null)}>No staff assignment</button>:null}</div>:null}
          {hasServices?<div className="owner-services"><div className="owner-section-heading"><h2>Services</h2><button onClick={()=>openPicker('services')}>View all</button></div><div className="owner-choice-grid">{reference.services.map(s=><button key={s.id} aria-pressed={s.id===(selectedLine?selectedLine.serviceId:cart.serviceId)} onClick={()=>chooseService(s.id)}><strong>{s.name}</strong><small>{money(Number(s.base_price??0))}</small></button>)}</div><button className="owner-skip" onClick={()=>chooseService(null)}>Amount only</button></div>:null}
        </section>
        <section className="owner-amount">
          <div className="owner-mobile-ticket">{inlineRows}<div className="owner-total"><span>Total ({entryCount})</span><strong>{money(total)}</strong></div></div>
          <div className="owner-section-heading"><span className="owner-selection">{selectedLine?.staffName??member?.display_name??'Amount'}{selectedLine?` · ${selectedLine.serviceLabel}`:service?` · ${service.name}`:''}</span></div>
          <label className="owner-amount-field"><span>{inputTarget==='amount'?'Amount':inputTarget==='tip'?'Tip':'Discount'}</span><input aria-label={inputTarget==='amount'?'Amount':inputTarget==='tip'?'Tip amount':'Discount amount'} inputMode="none" autoComplete="off" value={inputValue} placeholder="0.00" onFocus={e=>{replaceAmount.current=true;e.target.select();}} onChange={e=>{if(inputTarget==='amount')setAmount(e.target.value);else if(/^\d*(\.\d{0,2})?$/.test(e.target.value))update({[inputTarget]:e.target.value});}}/></label>
          <div className="owner-mode-tabs" aria-label="Keypad controls">
            <button className="owner-mobile-picker" aria-label="Services" aria-haspopup="dialog" aria-pressed={inputTarget==='amount'&&panel!=='staff'} onClick={()=>openPicker('services')}><OwnerPosIcon name="services"/><span>Services</span></button>
            <button className="owner-mobile-picker" aria-label="Employees" aria-haspopup="dialog" aria-pressed={panel==='staff'} onClick={()=>openPicker('staff')}><OwnerPosIcon name="employees"/><span>Employees</span></button>
            {preferences.showTip?<button aria-label="Tip" aria-pressed={inputTarget==='tip'} onClick={()=>chooseAdjustment('tip')}><OwnerPosIcon name="tip"/><span>Tip</span></button>:null}
            {preferences.showDiscount?<button aria-label="Discount" aria-pressed={inputTarget==='discount'} onClick={()=>chooseAdjustment('discount')}><OwnerPosIcon name="discount"/><span>Discount</span></button>:null}
          </div>
          <div className="owner-keypad">{['1','2','3','4','5','6','7','8','9','⌫','0','/'].map(n=><button key={n} data-key={n==='⌫'?'backspace':n} aria-label={n==='⌫'?'Backspace':n} disabled={busy||(n==='/'&&inputTarget!=='amount')} onClick={()=>pressKey(n)}>{n}</button>)}</div>
          <div className="owner-keypad-edit"><button disabled={busy} onClick={()=>void reset()}>Reset</button><button disabled={busy} onClick={()=>{replaceAmount.current=true;if(inputTarget==='amount')setAmount('');else update({[inputTarget]:''});}}>Clear</button><button onClick={()=>setPanel('ticket')}>Edit line</button></div>
          <div className="owner-submit"><button disabled={busy} onClick={add}>+ Add another</button><button disabled={busy} onClick={()=>void submit()}>{busy?'Saving…':'Submit'}</button></div>
        </section>
      </div>
    </>:<p>Opening your saved workspace…</p>}
    <dialog ref={dialog} aria-labelledby="owner-picker-title" onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setPanel(null);}}} onCancel={()=>setPanel(null)} className="owner-picker-dialog">
      <header><h2 id="owner-picker-title">{panel==='staff'?'Employees':panel==='services'?'Services':panel==='customer'?'Customer':'Ticket'}</h2><button onClick={()=>setPanel(null)}>Done</button></header>
      {panel==='ticket'?<><div className="owner-ticket-actions"><button onClick={()=>openPicker('staff')}>Employees</button><button onClick={()=>openPicker('services')}>Services</button>{selectedLine?<button onClick={()=>{update({lines:cart!.lines.filter(l=>l.id!==selectedLine.id),activeLineId:null});setPanel(null);}}>Remove line</button>:null}{preferences.showCustomer?<button onClick={()=>setPanel('customer')}>Customer</button>:null}</div>{linesView}<div className="owner-total"><span>Total</span><strong>{money(total)}</strong></div><Link href="/pos-tickets" className="owner-skip">Ticket history →</Link></>:null}
      {panel==='staff'||panel==='services'?<><input className="owner-picker-search" aria-label={panel==='staff'?'Search employees':'Search services'} type="search" placeholder={panel==='staff'?'Search employees':'Search services'} value={pickerQuery} onChange={e=>setPickerQuery(e.target.value)}/><div className="owner-picker-options">
        {panel==='staff'?<>{!ticketDefaults.staffCheckInEnabled?<button onClick={()=>chooseStaff(null)}>No staff assignment</button>:null}{staff.filter(s=>s.display_name.toLowerCase().includes(pickerQuery.toLowerCase())).map(s=><button key={s.id} aria-pressed={s.id===(selectedLine?selectedLine.staffId:cart?.staffId)} onClick={()=>chooseStaff(s.id)}><span>{s.display_name}</span><small>{s.turns?.queueTurns??0} turns</small></button>)}{!staff.length?<p>No staff checked in. Check in a staff member to start.</p>:null}</>:<><button onClick={()=>chooseService(null)}>Amount only</button>{reference.services.filter(s=>s.name.toLowerCase().includes(pickerQuery.toLowerCase())).map(s=><button key={s.id} aria-pressed={s.id===(selectedLine?selectedLine.serviceId:cart?.serviceId)} onClick={()=>chooseService(s.id)}><span>{s.name}</span><small>{money(Number(s.base_price??0))}</small></button>)}</>}
      </div></>:null}
      {panel==='customer'?<><input autoComplete="off" aria-label="Search customers" placeholder="Name or phone" className="owner-picker-search" value={query} onChange={e=>setQuery(e.target.value)}/><div className="owner-picker-options"><button onClick={()=>{update({customer:null});setPanel(null);}}>Walk-in customer</button>{customers.map(c=><button key={c.id} onClick={()=>{update({customer:c});setPanel(null);}}>{c.name} · {c.phone?.slice(-4)}</button>)}</div></>:null}
    </dialog>
  </main>;
}
