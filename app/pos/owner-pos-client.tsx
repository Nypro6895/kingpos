"use client";
import { ActionFeedback } from "@/components/action-feedback";
import { OwnerCartBenefits } from "@/components/rewardlumi/owner-cart-benefits";
import type { RewardView } from "@/types/rewardlumi";
import { GiftDeliveryReceipt, type GiftCheckout } from "@/components/gift-card/pos-gift-card";
import type { GiftSession } from "@/types/gift-card";
import { DeskRelay } from "@/app/service-relay/desk-relay";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { Activity, useCallback,useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PosDeskCustomer, PosDeskService, PosDeskStaff } from "@/types/pos-desk";
import type { PosDeskDefaults } from "@/lib/pos-settings";
import { DEFAULT_WORKSPACE_PREFERENCES, type PosWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import { listPortableOperations, portableCheckpoint, savePortableOperation } from "@/lib/portable-operations";
import { PortableDraftControls } from "./portable/portable-draft-controls";
import { searchPosDeskCustomers } from "./actions";
import { PortableSyncIndicator } from "./portable/portable-sync-indicator";
import { OwnerPosNavigation } from "./owner-pos-tabs";
import { SingleWorkspaceWindow } from './single-workspace-window';
import { OwnerPosIcon } from './owner-pos-icon';
import { AdaptivePosWorkspace } from "./adaptive-pos-workspace";
import { ServiceCatalog } from "./service-catalog";
import { serviceDefaultAmount } from "@/lib/pos-service-catalog";
import { parsePosAmountInput } from '@/lib/pos-desk-amounts';
import { getStaffTurnToneLevel } from '@/lib/pos-staff-turn-tone';
import { fetchOwnerWorkspace } from '@/lib/owner-workspace-client';
import { useOwnerLocalWorkspace } from './owner-local-workspace';
import { appLocalRequestId } from '@/lib/app-local-host';
import { openOwnerCart, ownerCartStartupDiagnostic } from '@/lib/owner-cart-startup';
type Line = { id:string;staffId:string|null;staffName:string;serviceId:string|null;serviceLabel:string;total:number;amountInput:string;amountParts:number[] };
type Step = 'staff'|'services'|'amount';
type Cart = { customServiceName?:string; inputTarget?:'amount'|'tip'|'discount'; activeLineId?:string|null; step?:Step; id:string;amount:string;staffId:string|null;serviceId:string|null;customer:PosDeskCustomer|null;lines:Line[];tip:string;discount:string };
const empty = ():Cart=>({id:appLocalRequestId(),amount:"",staffId:null,serviceId:null,customer:null,lines:[],tip:"",discount:""});
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const amountPreview=(value:string)=>value.split('/').reduce((sum,part)=>sum+(Number(part)||0),0);
const amountPattern=/^\d*(\.\d{0,2})?(\/\d*(\.\d{0,2})?)*$/;
function isCart(value:unknown):value is Cart {
  if(!value||typeof value!=='object')return false;
  const row=value as Partial<Cart>,id=(value:unknown)=>value===null||typeof value==='string';
  return typeof row.id==='string'&&row.id.length>0&&typeof row.amount==='string'&&amountPattern.test(row.amount)
    &&id(row.staffId)&&id(row.serviceId)&&typeof row.tip==='string'&&typeof row.discount==='string'
    &&(row.customer===null||Boolean(row.customer&&typeof row.customer.id==='string'&&typeof row.customer.name==='string'))
    &&Array.isArray(row.lines)&&row.lines.every(line=>Boolean(line&&typeof line.id==='string'&&id(line.staffId)&&id(line.serviceId)&&typeof line.staffName==='string'&&typeof line.serviceLabel==='string'&&Number.isFinite(line.total)&&typeof line.amountInput==='string'&&Array.isArray(line.amountParts)&&line.amountParts.every(part=>Number.isFinite(part))));
}
export function OwnerPosClient({active=true,...props}:Parameters<typeof OwnerPosWorkspace>[0]&{active?:boolean}) {
  // The exclusive writer lease stays mounted while another role page is shown;
  // hidden operational effects must not read or sync under that page's scope.
  return <SingleWorkspaceWindow id={props.scope}><Activity mode={active?"visible":"hidden"}><OwnerPosWorkspace {...props}/></Activity></SingleWorkspaceWindow>;
}
function OwnerPosWorkspace({snapshotAt,scope,salonId,initial,preferences:initialPreferences=DEFAULT_WORKSPACE_PREFERENCES,showNavigation=true}:{
  snapshotAt?:number;scope:string;salonId:string;salonName:string;initial:{staff:PosDeskStaff[];services:PosDeskService[];defaults:PosDeskDefaults;today:string};preferences?:PosWorkspacePreferences;showNavigation?:boolean;
}) {
  const __vt = useWorkspaceTranslation();
  const workspace=useOwnerLocalWorkspace();

  useEffect(()=>{
    const resize=()=>{
      const element=document.querySelector<HTMLElement>('[data-pos-owner-page]');if(!element||!element.getClientRects().length)return;
      if(document.documentElement.dataset.ownerDevice==='phone'){
        const viewport=window.visualViewport;
        const nav=Array.from(document.querySelectorAll<HTMLElement>('.owner-device-nav')).find(n=>n.getClientRects().length>0);
        const bottom=nav?.getBoundingClientRect().height??62;
        element.style.setProperty('--owner-height',`${Math.max(160,(viewport?.height??window.innerHeight)+(viewport?.offsetTop??0)-element.getBoundingClientRect().top-bottom-8)}px`);
        return;
      }
      const nav=Array.from(document.querySelectorAll('nav')).find(n=>getComputedStyle(n).position==='fixed'&&n.getBoundingClientRect().bottom>=window.innerHeight-2);
      const bottom=nav?.getBoundingClientRect().height??0;
      const viewport=window.visualViewport;
      element.style.setProperty('--owner-height',`${Math.max(160,(viewport?.height??window.innerHeight)+(viewport?.offsetTop??0)-element.getBoundingClientRect().top-bottom-8)}px`);
    };
    resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};
  },[]);
  const key=`kingpos:owner-cart:v1:${scope}`;
  const [localReference,setReference]=useState(initial);
  const [localPreferences,setPreferences]=useState(initialPreferences);
  const shared=workspace?.reference?.ownerScope===scope&&workspace.reference.salonId===salonId?workspace.reference:undefined;
  const reference=shared??localReference;
  const preferences=shared?.preferences??localPreferences;
  const [cart,setCart]=useState<Cart|null>(null);
  const current=useRef<Cart|null>(null);
  const openedKey=useRef<string|null>(null);
  const [startup,setStartup]=useState<'opening'|'ready'|'failed'>('opening');
  const [startupDiagnostic,setStartupDiagnostic]=useState<string>();
  const startupFailure=useRef<unknown>(null);
  const [openAttempt,retryOpen]=useState(0);
  const [rewardView,setRewardView]=useState<RewardView|null>(null);
  const [giftSession,setGiftSession]=useState<GiftSession|null>(null);
  const [giftDelivery,setGiftDelivery]=useState<GiftSession|null>(null);
  useEffect(()=>{setGiftDelivery(null);},[scope]);
  const giftCheckout=useRef<GiftCheckout>(()=>Promise.resolve(null));
  const registerGift=useCallback((fn:GiftCheckout)=>{giftCheckout.current=fn;},[]);
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
  const [panel,setPanel]=useState<'staff'|'services'|'customer'|'ticket'|'custom'|'benefits'|null>(null);
  const [customName,setCustomName]=useState('');
  const [pickerQuery,setPickerQuery]=useState('');

  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState(''),[customers,setCustomers]=useState<PosDeskCustomer[]>([]);
  const pendingDefaults=useRef(initial.defaults);
  const [ticketDefaults,setTicketDefaults]=useState(initial.defaults);
  useEffect(()=>{if(shared)pendingDefaults.current=shared.defaults;},[shared]);
  const persist=useCallback((next:Cart)=>{
    try { const boundaryChanged=next.id!==current.current?.id||next.customer?.id!==current.current?.customer?.id;localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),cart:next}));if(boundaryChanged){setRewardView(null);setGiftSession(null);giftCheckout.current=()=>Promise.resolve(null);} current.current=next;setCart(next);setError('');return true; }
    catch {setError('Unable to save on this device. Keep this ticket open.');return false;}
  },[key]);
  useEffect(()=>{
    if(openedKey.current===key&&current.current)return;
    const controller=new AbortController();
    void (async()=>{
      try {
        const next=await openOwnerCart({key,scope,storage:{getItem:name=>localStorage.getItem(name),setItem:(name,value)=>localStorage.setItem(name,value)},checkpoint:portableCheckpoint,create:empty,isCart,signal:controller.signal});
        if(controller.signal.aborted)return;
        startupFailure.current=null;setStartupDiagnostic(undefined);
        openedKey.current=key;current.current=next;setCart(next);setStartup('ready');
      }catch(failure){if(!controller.signal.aborted){startupFailure.current=failure;setStartupDiagnostic(ownerCartStartupDiagnostic(failure));setStartup('failed');}}
    })();return()=>controller.abort();
  },[key,scope,openAttempt]);
  useEffect(()=>{if(panel)dialog.current?.showModal();else dialog.current?.close();},[panel]);
  useEffect(()=>{
    if(panel!=='customer'||query.trim().length<2)return;
    let alive=true;const timer=setTimeout(()=>{void searchPosDeskCustomers(query).then(result=>{if(alive)setCustomers(result);}).catch(()=>{if(alive)setError('Connect to search customer records. Your ticket is still here.');});},250);
    return()=>{alive=false;clearTimeout(timer);};
  },[panel,query]);
  usePosResourceRefresh(salonId,'staff',async(ids)=>{
    const next=await fetchOwnerWorkspace<{today:string;staff:PosDeskStaff[]}>(scope,'staff',ids);
    if(Array.isArray(next.staff)){const staff=ids?.length?[...reference.staff.filter(s=>!ids.includes(s.id)),...next.staff]:next.staff;setReference({...reference,today:next.today,staff});workspace?.updateReference({today:next.today,staff});}
  },{initialReconcile:false,snapshotAt});
  usePosResourceRefresh(salonId,'catalog',async()=>{
    const data=await fetchOwnerWorkspace<{services:PosDeskService[]}>(scope,'catalog');
    if(Array.isArray(data.services)){setReference(previous=>({...previous,services:data.services}));workspace?.updateReference({services:data.services});}
  },{initialReconcile:false,snapshotAt});
  usePosResourceRefresh(salonId,'settings',async()=>{
    const data=await fetchOwnerWorkspace<{salonId:string;preferences:PosWorkspacePreferences;defaults:PosDeskDefaults}>(scope,'settings');
    if(data.salonId!==salonId)return;
    setPreferences(data.preferences);pendingDefaults.current=data.defaults;
    setReference(previous=>({...previous,defaults:data.defaults}));
    workspace?.updateReference({defaults:data.defaults,preferences:data.preferences});
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
    return{id:appLocalRequestId(),staffId:member?.id??null,staffName:member?.display_name??'Unassigned',serviceId:service?.id??null,serviceLabel:service?.name??cart.customServiceName??'Service',total:amount,amountInput:cart.amount,amountParts:parsed.parts};
  };
  const add=()=>{if(!cart)return;const line=cart.amount?makeLine():null;if(cart.amount&&!line)return;replaceAmount.current=true;update({lines:line?[...cart.lines,line]:cart.lines,amount:'',staffId:null,serviceId:null,customServiceName:undefined,activeLineId:null,inputTarget:'amount',step:hasServices?'services':hasStaff?'staff':'amount'});setPickerQuery('');setPanel(hasServices?'services':hasStaff?'staff':null);};

  const reset=async()=>{if(busyRef.current)return; if(persist(empty()))setTicketDefaults(pendingDefaults.current);};
  const submit=async()=>{
    if(!cart||busyRef.current)return;
    const line=cart.amount?makeLine():null;if(cart.amount&&!line)return;
    const lines=line?[...cart.lines,line]:cart.lines;
    if(lines.some(l=>!parsePosAmountInput(l.amountInput).isValid||!Number.isFinite(l.total)||l.total<=0)){setError('Enter a valid amount for each service.');return;}
    if(!lines.length&&!(giftSession?.status==='open'&&giftSession.purchase>0)){setError('Enter an amount first.');return;}
    if(ticketDefaults.staffCheckInEnabled&&lines.some(l=>!reference.staff.some(s=>s.id===l.staffId&&s.today_status==='working'))){setError('A selected staff member is no longer checked in. Review this ticket.');return;}
    busyRef.current=true;setBusy(true);setError('');
    try{
      const gift=await giftCheckout.current();
      if(gift?.ticketId||gift?.giftSaleId){const next=empty();if(persist(next))setTicketDefaults(pendingDefaults.current);return;}
      if(rewardView?.request){
        if(!navigator.onLine)throw Error("Reconnect before using rewards.");
        const response=await fetch("/api/rewards",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope:"pos",op:"owner-submit",args:{cartId:cart.id,receipt:{...benefitReceipt,lines:lines.map(l=>({staffId:l.staffId,serviceId:l.serviceId,serviceLabel:l.serviceLabel,total:l.total,amountInput:l.amountInput,amountParts:l.amountParts}))}}})});
        const result=await response.json();if(!response.ok||!result.ticketId)throw Error(result.error??"Checkout could not be saved.");
        const next=empty();if(persist(next))setTicketDefaults(pendingDefaults.current);return;
      }
      // Use the same durable cart identity across a retry after a lost reply.
      const existing=(await listPortableOperations(scope)).find(op=>op.payload.ownerCartId===cart.id);
      if(!existing)await savePortableOperation(scope,'receipt',{ownerCartId:cart.id,localDraftKey:key,lines,customerId:cart.customer?.id??null,customerName:cart.customer?.name??null,tipAmount:Number(cart.tip||0),discountType:'fixed_amount',discountValue:Number(cart.discount||0)});
      const next=empty();if(persist(next))setTicketDefaults(pendingDefaults.current);
    }catch(e){setError(e instanceof Error?e.message:'Unable to save this ticket. Your entries have been kept.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  const subtotal=cart?.lines.reduce((sum,l)=>sum+l.total,0)??0;
  const rewardDiscount=rewardView?.request?.status==='confirmed'?rewardView.request.valueCents/100:0;
  const serviceSubtotal=subtotal+amountPreview(cart?.amount??'');
  const total=Math.max(0,serviceSubtotal-Number(cart?.discount||0)-rewardDiscount)+(serviceSubtotal>0?Number(cart?.tip||0):0);
  const giftReduction=giftSession?.status==='open'&&giftSession.total===Math.round(total*100)?giftSession.amount/100:0;
  const giftPurchase=giftSession?.status==='open'?giftSession.purchase/100:0;
  const benefitSummary=giftReduction>0||giftPurchase>0?<div data-owner-gift-summary style={{display:"block",width:"100%",minWidth:0}}>{giftPurchase>0&&<div style={{display:'flex',justifyContent:'space-between',gap:8,padding:'8px 0'}}><span>Gift card purchase</span><strong>+{money(giftPurchase)}</strong></div>}{giftReduction>0&&<div style={{display:'flex',justifyContent:'space-between',gap:8,padding:'8px 0'}}><span>Gift card</span><strong>−{money(giftReduction)}</strong></div>}<div className="owner-total"><span>Amount due</span><strong>{money(Math.max(0,total-giftReduction)+giftPurchase)}</strong></div></div>:null;
  const benefitReceipt={requestId:cart?.id,rewardQuote:rewardView?.request?.status==='confirmed'?rewardView.request.quote:null,customerId:cart?.customer?.id??null,customerName:cart?.customer?.name??null,discountType:'fixed_amount',discountValue:Number(cart?.discount||0),tipAmount:Number(cart?.tip||0),lines:[...(cart?.lines??[]).map(l=>({staffId:l.staffId,serviceId:l.serviceId,serviceLabel:l.serviceLabel,total:l.total,amountInput:l.amountInput,amountParts:l.amountParts})),...(cart?.amount&&amountPreview(cart.amount)>0?[{staffId:cart.staffId,serviceId:cart.serviceId,serviceLabel:reference.services.find(s=>s.id===cart.serviceId)?.name??'Service',total:amountPreview(cart.amount),amountInput:cart.amount,amountParts:parsePosAmountInput(cart.amount).parts}]:[])]};
  const staff = reference.staff.filter(s=>!ticketDefaults.staffCheckInEnabled||s.today_status==='working')
    .sort((a,b)=>(a.turns?.queueTurns??0)-(b.turns?.queueTurns??0)||(a.check_in_sequence??0)-(b.check_in_sequence??0));
  const hasStaff=ticketDefaults.staffCheckInEnabled||(preferences.showStaff&&staff.length>0);
  const hasServices=preferences.showServices&&reference.services.length>0;
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
    else update({inputTarget:'amount',serviceId:id,customServiceName:undefined,amount:serviceDefaultAmount(selected?.base_price),step:'amount'});
    setPickerQuery('');
    setPanel(hasStaff?'staff':null);

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
  const currentEntry=Boolean(cart?.amount||cart?.staffId||cart?.serviceId||cart?.customServiceName||!cart?.lines.length);
  const entryCount=(cart?.lines.length??0)+(currentEntry?1:0);
  const inputTarget=cart?.inputTarget??'amount';
  const inputValue=inputTarget==='amount'?amountValue:(cart?.[inputTarget]??'');
  const openCustomService=()=>{setCustomName(selectedLine?.serviceLabel??cart?.customServiceName??'');setPanel('custom');};
  const applyCustomService=()=>{
    const name=customName.trim();if(!name||name.length>100||busyRef.current)return;
    if(selectedLine&&cart)update({inputTarget:'amount',lines:cart.lines.map(line=>line.id===selectedLine.id?{...line,serviceId:null,serviceLabel:name}:line),step:'amount'});
    else update({inputTarget:'amount',serviceId:null,customServiceName:name,step:'amount'});
    setPanel(null);
  };
  const inlineRows=cart?<div ref={entries} className="owner-inline-rows" aria-label={__vt("Ticket entries")}>
    {cart.lines.map((line,index)=><div key={line.id} data-selected={inputTarget==='amount'&&selectedLine?.id===line.id}>
      <button className="owner-row-select" aria-label={__vt(`Edit entry ${index+1}`)} onClick={()=>selectLine(line.id)}/>
      <span title={__vt(line.serviceLabel)}>{line.serviceLabel}</span><span className="owner-row-dash">-</span><span title={__vt(line.staffName)}>{line.staffName}</span>
      {selectedLine?.id===line.id&&inputTarget==='amount'?<label className="owner-inline-money">$<input aria-label={__vt("Amount")} inputMode="none" value={amountValue} placeholder={__vt("0.00")} onFocus={e=>{replaceAmount.current=true;e.target.select();}} onClick={e=>e.stopPropagation()} onChange={e=>setAmount(e.target.value)}/></label>:<strong>{money(line.total)}</strong>}
    </div>)}
    {currentEntry?<div data-selected={inputTarget==='amount'&&!selectedLine}>
      <button className="owner-row-select" aria-label={__vt("Edit current entry")} onClick={()=>selectLine(null)}/>
      <span title={__vt(reference.services.find(s=>s.id===cart.serviceId)?.name)}>{reference.services.find(s=>s.id===cart.serviceId)?.name??cart.customServiceName??'Service'}</span><span className="owner-row-dash">-</span><span>{reference.staff.find(s=>s.id===cart.staffId)?.display_name??'Unassigned'}</span>
      {!selectedLine&&inputTarget==='amount'?<label className="owner-inline-money">$<input aria-label={__vt("Amount")} inputMode="none" value={cart.amount} placeholder={__vt("0.00")} onFocus={e=>{replaceAmount.current=true;e.target.select();}} onClick={e=>e.stopPropagation()} onChange={e=>setAmount(e.target.value)}/></label>:<strong>{money(amountPreview(cart.amount))}</strong>}
    </div>:null}
    {(['tip','discount'] as const).map(target=>(Number(cart[target])>0||inputTarget===target)?<div key={target} className="owner-adjustment-row" data-selected={inputTarget===target}>
      <button className="owner-row-select" aria-label={__vt(`Edit ${target}`)} onClick={()=>chooseAdjustment(target)}/>
      <span>{target==='tip'?<WorkspaceText text="Tip" />:<WorkspaceText text="Discount" />}</span><strong>{target==='discount'?'-':''}{money(Number(cart[target]||0))}</strong>
    </div>:null)}
    <button type="button" className="owner-add-line" disabled={busy} onClick={add}><WorkspaceText text="+ Add line" /></button>
  </div>:null;
  const linesView=cart?<div className="owner-lines">
    {cart.lines.map((line,index)=><div key={line.id} data-selected={inputTarget==='amount'&&selectedLine?.id===line.id}>
      <button className="owner-desktop-line" aria-label={__vt(`Edit entry ${index+1}`)} onClick={()=>selectLine(line.id)}><span><strong>{line.serviceLabel}</strong><small>{line.staffName}</small></span><strong>{money(line.total)}</strong></button>
      <button aria-label={__vt(`Remove ${line.serviceLabel}`)} onClick={()=>update({lines:cart.lines.filter(l=>l.id!==line.id),activeLineId:selectedLine?.id===line.id?null:cart.activeLineId})}>×</button>
    </div>)}
    {currentEntry?<div data-selected={inputTarget==='amount'&&!selectedLine}><button className="owner-desktop-line" aria-label={__vt("Edit current entry")} onClick={()=>selectLine(null)}><span><strong>{reference.services.find(s=>s.id===cart.serviceId)?.name??cart.customServiceName??'Service'}</strong><small>{reference.staff.find(s=>s.id===cart.staffId)?.display_name??'Unassigned'} <WorkspaceText text="· Current entry" /></small></span><strong>{money(amountPreview(cart.amount))}</strong></button></div>:null}
  </div>:null;
  return <main className="owner-checkout" data-pos-owner-page data-owner-reference="true" data-step="amount">
    {showNavigation?<OwnerPosNavigation active="pos"/>:null}
    <DeskRelay salonId={salonId}/>
    {error?<p role="alert" className="owner-error"><WorkspaceText text={error} /></p>:null}
    {cart?<>
      <div className="owner-tools">
        <button className="owner-ios-control owner-customer-shortcut" disabled={busy} onClick={add}>+ Add</button>
        <button className="owner-ios-control owner-customer-shortcut" disabled={busy} onClick={()=>void reset()}><WorkspaceText text="Reset" /></button>
        <PortableDraftControls scope={scope} active={Boolean(cart.lines.length||cart.amount)} activity={JSON.stringify(cart)} value={cart} label={cart.customer?.name??'Walk-in'} reset={reset} restore={value=>persist(value)} idleMinutes={preferences.idleMinutes} warningSeconds={preferences.idleWarningSeconds}/>
        {preferences.showCustomer?<button className="owner-customer-shortcut" onClick={()=>setPanel('customer')}>{cart.customer?.name??<><span className="owner-desktop-label"><WorkspaceText text="Customer" /></span><span className="owner-ios-label"><WorkspaceText text="Customers" /></span></>}</button>:null}
        <button className="owner-customer-shortcut" onClick={()=>setPanel('benefits')}>{rewardView?.request?.status==='confirmed'?'✓ Reward confirmed':rewardView?.request&&rewardView.request.status!=='cancelled'?'Reward requested':rewardView?.available?`${rewardView.available} pts · Rewards / Gift card`:'Rewards / Gift card'}</button>
        <div className="owner-toolbar-sync"><PortableSyncIndicator scope={scope}/></div>
      </div>
      <div className="owner-workbench">
        <section className="owner-receipt"><div className="owner-section-heading"><h2><WorkspaceText text="Receipt" /></h2><Link href="/pos-tickets"><WorkspaceText text="History" /></Link></div>{linesView}<button type="button" className="owner-add-line" disabled={busy} onClick={add}><WorkspaceText text="+ Add line" /></button>
          <div className="owner-receipt-summary">
            {Number(cart.tip)>0||Number(cart.discount)>0?<div><span><WorkspaceText text="Subtotal" /></span><strong>{money(subtotal+amountPreview(cart.amount))}</strong></div>:null}
            {(['discount','tip'] as const).map(target=>Number(cart[target])>0?<button key={target} onClick={()=>chooseAdjustment(target)}><span>{target==='tip'?<WorkspaceText text="Tip" />:<WorkspaceText text="Discount" />}</span><strong>{target==='discount'?'-':''}{money(Number(cart[target]))}</strong></button>:null)}
            <div className="owner-total"><span><WorkspaceText text="Total (" />{entryCount})</span><strong>{money(total)}</strong></div>
            {benefitSummary}
          </div>
        </section>
        <AdaptivePosWorkspace className="owner-catalog" staffCount={hasStaff?staff.length:0} serviceCount={hasServices?reference.services.length:0}>
          {hasStaff?<div className="owner-staff"><div className="owner-section-heading"><h2><WorkspaceText text="Staff Turn Board" /></h2><small><WorkspaceText text="Large turn:" /> {money(ticketDefaults.largeTurnThreshold)}</small></div><div className="owner-choice-grid">{staff.map(s=><button key={s.id} data-turn-tone={getStaffTurnToneLevel(s.turns?.queueTurns??0,staff.map(item=>item.turns?.queueTurns??0))} aria-pressed={s.id===(selectedLine?selectedLine.staffId:cart.staffId)} onClick={()=>chooseStaff(s.id)}><strong>{s.display_name}{s.service_status === "working" ? <small><WorkspaceText text="Working" />{(s.turns?.holdingTurns??0)>0?<> · <WorkspaceText text="Holding" /></>:null}</small> : null}</strong><b className="owner-turn">{s.turns?.queueTurns??0}</b><small>{s.turns?.smallTurns??0} <WorkspaceText text="small" /></small></button>)}</div>{!staff.length?<p className="owner-empty"><WorkspaceText text="No staff checked in. Check in a staff member to start." /></p>:null}{!ticketDefaults.staffCheckInEnabled?<button className="owner-skip" onClick={()=>chooseStaff(null)}><WorkspaceText text="No staff assignment" /></button>:null}</div>:null}
          {hasServices?<div className="owner-services"><div className="owner-section-heading"><h2><WorkspaceText text="Services" /></h2><button onClick={()=>openPicker('services')}><WorkspaceText text="View all" /></button></div><ServiceCatalog services={reference.services} preferences={preferences} selectedId={selectedLine?selectedLine.serviceId:cart.serviceId} disabled={busy} onSelect={chooseService}/><button className="owner-skip" onClick={()=>chooseService(null)}><WorkspaceText text="Amount only" /></button></div>:null}
        </AdaptivePosWorkspace>
        <section className="owner-amount">
          <div className="owner-mobile-ticket">{inlineRows}<div className="owner-total"><span><WorkspaceText text="Total (" />{entryCount})</span><strong>{money(total)}</strong></div>{benefitSummary}</div>
          <div className="owner-section-heading"><span className="owner-selection"><WorkspaceText text={selectedLine?.staffName??member?.display_name??'Amount'} />{selectedLine?` · ${selectedLine.serviceLabel}`:service?` · ${service.name}`:cart.customServiceName?` · ${cart.customServiceName}`:''}</span></div>
          <label className="owner-amount-field"><span>{inputTarget==='amount'?<WorkspaceText text="Amount" />:inputTarget==='tip'?<WorkspaceText text="Tip" />:<WorkspaceText text="Discount" />}</span><input aria-label={__vt(inputTarget==='amount'?'Amount':inputTarget==='tip'?'Tip amount':'Discount amount')} inputMode="none" autoComplete="off" value={inputValue} placeholder={__vt("0.00")} onFocus={e=>{replaceAmount.current=true;e.target.select();}} onChange={e=>{if(inputTarget==='amount')setAmount(e.target.value);else if(/^\d*(\.\d{0,2})?$/.test(e.target.value))update({[inputTarget]:e.target.value});}}/></label>
          <div className="owner-mode-tabs" aria-label={__vt("Keypad controls")}>
            <button className="owner-mobile-picker" aria-label={__vt("Services")} aria-haspopup="dialog" aria-pressed={inputTarget==='amount'&&panel!=='staff'} onClick={()=>openPicker('services')}><OwnerPosIcon name="services"/><span><WorkspaceText text="Services" /></span></button>
            <button className="owner-mobile-picker" aria-label={__vt("Employees")} aria-haspopup="dialog" aria-pressed={panel==='staff'} onClick={()=>openPicker('staff')}><OwnerPosIcon name="employees"/><span><WorkspaceText text="Employees" /></span></button>
            {preferences.showTip?<button aria-label={__vt("Tip")} aria-pressed={inputTarget==='tip'} onClick={()=>chooseAdjustment('tip')}><OwnerPosIcon name="tip"/><span><WorkspaceText text="Tip" /></span></button>:null}
            {preferences.showDiscount?<button aria-label={__vt("Discount")} aria-pressed={inputTarget==='discount'} onClick={()=>chooseAdjustment('discount')}><OwnerPosIcon name="discount"/><span><WorkspaceText text="Discount" /></span></button>:null}
          </div>
          <div className="owner-keypad">{['1','2','3','4','5','6','7','8','9','⌫','0','/'].map(n=><button key={n} data-key={n==='⌫'?'backspace':n} aria-label={__vt(n==='⌫'?'Backspace':n)} disabled={busy||(n==='/'&&inputTarget!=='amount')} onClick={()=>pressKey(n)}>{n==='⌫'?<OwnerPosIcon name="backspace"/>:n}</button>)}</div>
          <div className="owner-keypad-edit"><button disabled={busy} onClick={()=>void reset()}><WorkspaceText text="Reset" /></button><button disabled={busy} onClick={()=>{replaceAmount.current=true;if(inputTarget==='amount')setAmount('');else update({[inputTarget]:''});}}><WorkspaceText text="Clear" /></button><button onClick={()=>setPanel('ticket')}><WorkspaceText text="Edit line" /></button></div>
          <div className="owner-submit"><button className="owner-custom-service owner-ios-control" aria-label={__vt('Custom service')} aria-haspopup="dialog" disabled={busy} onClick={openCustomService}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/></svg><WorkspaceText text="Services" /></button><button disabled={busy} aria-busy={busy} onClick={()=>void submit()}><ActionFeedback pending={busy} pendingLabel="Saving…"><WorkspaceText text="Submit" /></ActionFeedback></button></div>

        </section>
      </div>
    </>:<section className="owner-cart-startup" data-owner-cart-state={startup} data-owner-cart-error={startup==='failed'?startupDiagnostic:undefined} aria-busy={startup==='opening'}>
      {startup==='failed'?<><p role="alert"><WorkspaceText text="Unable to open saved work on this device. Your saved work has not been changed." /></p><button type="button" onClick={()=>{setStartup('opening');retryOpen(attempt=>attempt+1);}}><WorkspaceText text="Try again" /></button></>:<p role="status"><ActionFeedback pending pendingLabel="Opening your saved workspace…">{null}</ActionFeedback></p>}
    </section>}
    <dialog ref={dialog} aria-labelledby="owner-picker-title" onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setPanel(null);}}} onCancel={()=>setPanel(null)} className="owner-picker-dialog" data-choice-picker={panel==='services'||panel==='staff'||undefined} data-long-picker={(panel==='services'?reference.services.length>8:panel==='staff'?staff.length>8:false)||undefined}>
      <header><h2 id="owner-picker-title">{panel==='custom'?<WorkspaceText text="Custom service" />:panel==='staff'?'Employees':panel==='services'?<WorkspaceText text="Services" />:panel==='customer'?<WorkspaceText text="Customer" />:panel==='benefits'?'Rewards & gift card':<WorkspaceText text="Ticket" />}</h2><button onClick={()=>setPanel(null)}><WorkspaceText text={panel==='custom'?'Cancel':'Done'} /></button></header>
      {panel==='custom'?<form onSubmit={event=>{event.preventDefault();applyCustomService();}}>
        <label htmlFor="owner-custom-service-name"><WorkspaceText text="Service name" /></label>
        <input id="owner-custom-service-name" autoFocus className="owner-picker-search" autoComplete="off" maxLength={100} value={customName} onChange={event=>setCustomName(event.target.value)} placeholder={__vt('Enter service name')} />
        <button className="owner-custom-done" type="submit" disabled={busy||!customName.trim()}><WorkspaceText text="Done" /></button>
      </form>:null}
      <div hidden={panel!=='benefits'}>{cart&&<OwnerCartBenefits key={cart.id+":"+(cart.customer?.id??"")} cartId={cart.id} receipt={benefitReceipt} onView={setRewardView} onGift={setGiftSession} onCheckout={registerGift} onDelivery={setGiftDelivery}/>}</div>
      {panel==='ticket'?<><div className="owner-ticket-actions"><button onClick={()=>openPicker('staff')}><WorkspaceText text="Employees" /></button><button onClick={()=>openPicker('services')}><WorkspaceText text="Services" /></button>{selectedLine?<button onClick={()=>{update({lines:cart!.lines.filter(l=>l.id!==selectedLine.id),activeLineId:null});setPanel(null);}}><WorkspaceText text="Remove line" /></button>:null}{preferences.showCustomer?<button onClick={()=>setPanel('customer')}><WorkspaceText text="Customer" /></button>:null}</div>{linesView}<div className="owner-total"><span><WorkspaceText text="Total" /></span><strong>{money(total)}</strong></div><Link href="/pos-tickets" className="owner-skip"><WorkspaceText text="Ticket history →" /></Link></>:null}
      {panel==='staff'||panel==='services'?<><input className="owner-picker-search" aria-label={__vt(panel==='staff'?'Search employees':'Search services')} type="search" placeholder={__vt(panel==='staff'?'Search employees':'Search services')} value={pickerQuery} onChange={e=>setPickerQuery(e.target.value)}/><div className="owner-picker-options owner-picker-choice-grid">
        {panel==='staff'?<>{!ticketDefaults.staffCheckInEnabled?<button onClick={()=>chooseStaff(null)}><WorkspaceText text="No staff assignment" /></button>:null}{staff.filter(s=>s.display_name.toLowerCase().includes(pickerQuery.toLowerCase())).map(s=><button key={s.id} aria-pressed={s.id===(selectedLine?selectedLine.staffId:cart?.staffId)} onClick={()=>chooseStaff(s.id)}><span>{s.display_name}</span><small>{s.turns?.queueTurns??0} <WorkspaceText text="turns" /></small></button>)}{!staff.length?<p><WorkspaceText text="No staff checked in. Check in a staff member to start." /></p>:null}</>:<><div className="owner-picker-shortcuts"><button onClick={()=>chooseService(null)}><WorkspaceText text="Amount only" /></button><button onClick={()=>{setCustomName('');setPanel('custom');}}><WorkspaceText text="Custom services" /></button></div><ServiceCatalog services={reference.services.filter(s=>s.name.toLowerCase().includes(pickerQuery.toLowerCase()))} preferences={preferences} selectedId={selectedLine?selectedLine.serviceId:cart?.serviceId} disabled={busy} onSelect={chooseService}/></>}
      </div></>:null}
      {panel==='customer'?<><input autoComplete="off" aria-label={__vt("Search customers")} placeholder={__vt("Name or phone")} className="owner-picker-search" value={query} onChange={e=>setQuery(e.target.value)}/><div className="owner-picker-options"><button onClick={()=>{update({customer:null});setPanel(null);}}><WorkspaceText text="Walk-in customer" /></button>{customers.map(c=><button key={c.id} onClick={()=>{update({customer:c});setPanel(null);}}>{c.name} · {c.phone?.slice(-4)}</button>)}</div></>:null}
    </dialog>
    <GiftDeliveryReceipt session={giftDelivery} onClose={()=>setGiftDelivery(null)}/>
  </main>;
}
