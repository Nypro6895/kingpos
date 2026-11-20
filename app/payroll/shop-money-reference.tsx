"use client";

import {useState,type FormEvent,type ReactNode} from "react";
import {WorkspaceText as T} from "@/components/workspace-language";
import {WorkspaceNavigationIcon} from "@/components/workspace-navigation-icon";
import {money,shopMoneyTotals} from "@/lib/shop-money";
import type {ShopMoneyData,ShopExpense} from "@/types/shop-money";
import s from "./shop-money.module.css";

const usd=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
export function FinanceIcon({kind}:{kind:string}){
 if(kind==='reserve')return <svg className={s.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 10 12 3c1-1 3 0 2 3l-1 4h5c2 0 3 1 2 3l-2 7H8V10Z"/><path d="M4 10h4v10H4z"/></svg>;
 if(kind==='collected')return <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M15 8c-4-3-8 2-3 4s1 7-3 4m3-11v14" fill="none" stroke="white" strokeWidth="1.4"/></svg>;
 if(kind==='staff')return <svg className={s.icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6" r="4"/><path d="M4 22v-4a8 8 0 0 1 16 0v4Z"/></svg>;
 if(kind==='fees')return <svg className={s.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>;
 if(kind==='expense-history')return <svg className={s.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v7l4 2"/></svg>;
 if(kind==='remaining')return <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 2a10 10 0 1 0 10 11H11V2Z"/><path fill="currentColor" opacity=".6" d="M13 2v9h9a10 10 0 0 0-9-9Z"/></svg>;
 const name=kind==='rent'?'home':kind==='opening'?'gear':'cash';
 return <WorkspaceNavigationIcon name={name} className={s.icon}/>;
}
function Info({children}:{children:ReactNode}){return <details className={s.info}><summary aria-label="More information">?</summary><p>{children}</p></details>;}
export function ShopSummary({data,totals,payout}:{data:ShopMoneyData;totals:ReturnType<typeof shopMoneyTotals>;payout:{cash:number;check:number}}){
 const opening=money(Number(data.opening?.cash??0)+Number(data.opening?.bank??0)+Number(data.opening?.other??0));
 return <div className={s.summaryCard}>
  <div className={s.hero}><div className={s.heroLabel}><span><T text="Available to use (est.)"/></span><Info><T text="Based on calculated staff payout and recorded expenses. Unrecorded fees reduce available money. This is not a verified bank balance."/></Info></div><strong className={`${s.big} ${totals.available<0?s.negative:''}`}>{usd(totals.available)}</strong></div>
  <dl className={s.summaryLedger}>
   <div><dt><T text="Total collected"/></dt><dd>{usd(totals.collected)}</dd></div>
   <div><dt><T text="Staff payout"/></dt><dd>−{usd(money(payout.cash+payout.check))}</dd></div>
   <div><dt><T text="Expenses paid"/></dt><dd>−{usd(totals.operating)}</dd></div>
   {totals.taxPaid!==0&&<div><dt><T text="Tax payments"/></dt><dd>−{usd(totals.taxPaid)}</dd></div>}
   {opening!==0&&<div><dt><T text="Opening money"/></dt><dd>{usd(opening)}</dd></div>}
   <div className={s.summaryTotal}><dt><T text="Total remaining"/></dt><dd>{usd(totals.remaining)}</dd></div>
  </dl>
  <dl className={s.reserve}>
   <div><dt><FinanceIcon kind="reserve"/><T text="Tax reserved"/><Info><T text="Held for employee tax, including any opening reserve. Tax remittances reduce this amount once."/></Info></dt><dd>{usd(totals.tax)}</dd></div>
   <div><dt><FinanceIcon kind="reserve"/><T text="Unused gift"/><Info><T text="Purchased gift balance held for future use. Gift sales are already included in collected money."/></Info></dt><dd>{usd(totals.gift)}</dd></div>
   {totals.feeEstimate>0&&<div><dt><FinanceIcon kind="fees"/><T text="Estimated card fees"/></dt><dd>{usd(totals.feeEstimate)}</dd></div>}
  </dl>
  {totals.unmatchedTaxPayment>0&&<p className={s.note}><T text="Tax paid beyond this recorded reserve"/>: {usd(totals.unmatchedTaxPayment)}</p>}
 </div>;
}

export function CollectionEditor({date,cash,card,other,note,busy,unallocatedTip,onSubmit,onCancel,children}:{date:string;cash:number;card:number;other:number;note:string;busy:boolean;unallocatedTip:number;onSubmit:(event:FormEvent<HTMLFormElement>)=>void;onCancel:()=>void;children?:ReactNode}){
 const [values,setValues]=useState({cash:cash.toFixed(2),card:card.toFixed(2),other:other.toFixed(2)});
 const total=money(Number(values.cash||0)+Number(values.card||0)+Number(values.other||0));
 const day=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 return <form className={s.collectionEditor} onSubmit={onSubmit}>
  <div className={s.editorHeading}><h3><T text="Edit"/> {day}</h3>{children}</div>
  <fieldset disabled={busy}>
   <div className={s.fields}>{(['cash','card','other'] as const).map(key=><label key={key}><T text={key[0].toUpperCase()+key.slice(1)}/><span className={s.currencyInput}><span aria-hidden="true">$</span><input type="number" aria-label={key[0].toUpperCase()+key.slice(1)} name={key} min="0" step="0.01" required value={values[key]} onBlur={()=>setValues(v=>({...v,[key]:Number(v[key]||0).toFixed(2)}))} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/></span></label>)}</div>
   <label className={s.inlineNote}><T text="Note"/><input type="text" name="note" defaultValue={note}/></label>
   <p className={s.editorHelp}><T text="Include tips and gift sales once."/></p>
   {unallocatedTip!==0&&<p className={s.note}><T text="Historical tips were separate. Include them in the correct cash / card / other fields when saving this total."/> {usd(unallocatedTip)}</p>}
   <div className={s.editorTotal}><T text="Total"/><output aria-label="Collection total">{usd(total)}</output></div>
   <div className={s.editorActions}><button type="submit" aria-label="Save collection" className={`${s.button} ${s.primary}`}><T text={busy?'Saving…':'Save'}/></button><button type="button" className={s.cancel} onClick={onCancel}><T text="Cancel"/></button></div>
  </fieldset>
 </form>;
}

type OfferView='gifts'|'rewards'|'discounts';
export function GiftReconciliation({data,selected,onSelect,dateLabel}:{data:ShopMoneyData;selected:OfferView;onSelect:(v:OfferView)=>void;dateLabel:(stamp:string)=>string}){
 // A capped activity page is not a complete period aggregate. Never invent period totals from it.
 const complete=data.giftActivity.length<500;
 const sold=money(data.giftActivity.filter(x=>x.kind==='issue').reduce((n,x)=>n+x.delta,0)/100);
 const redeemed=money(data.giftActivity.filter(x=>x.kind==='redeem').reduce((n,x)=>n-x.delta,0)/100);
 const adjustments=money(Number(data.giftClosing)-Number(data.giftOpening)-sold+redeemed);
 const discounts=money(data.discounts.reduce((n,x)=>n+Number(x.total),0));
 const rewardDiscount=money(data.discounts.reduce((n,x)=>n+Number(x.reward),0));
 const dateOnly=(stamp:string)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:data.timezone}).format(new Date(stamp));
 const rewardSummary=<div className={s.offerCard}><h3><T text={selected==='gifts'?'Rewards (preview)':'Rewards'}/></h3><div className={s.rewardEquation}><div><small><T text="Opening"/></small><strong>{data.rewardOpening.toLocaleString()} pts</strong></div><span>+</span><div><small><T text="Earned"/></small><strong>{data.rewardCredits.toLocaleString()}</strong></div><span>−</span><div><small><T text="Used"/></small><strong>{data.rewardDebits.toLocaleString()}</strong></div><span>=</span><strong>{data.rewardClosing.toLocaleString()} pts</strong></div></div>;
 const discountSummary=<div className={s.offerCard}><h3><T text={selected==='gifts'?'Discounts (preview)':'Discounts'}/></h3><strong className={s.offerAmount}>{usd(discounts)}</strong><p><T text="Already included in customer payments."/></p>{data.discounts.length>=500&&<p className={s.note}><T text="Showing the latest 500 tickets. Narrow the date range for all totals."/></p>}</div>;
 return <div className={s.offers}>
  <h2><T text="Gift, rewards & discounts"/></h2>
  <nav className={s.offerTabs} aria-label="Gift and reward sections">{(['gifts','rewards','discounts'] as const).map(tab=><button type="button" key={tab} aria-pressed={selected===tab} onClick={()=>onSelect(tab)}><T text={tab==='gifts'?'Gift cards':tab==='rewards'?'Rewards':'Discounts'}/></button>)}</nav>
  {selected==='gifts'&&<>
   <div className={s.offerCard}><h3><T text="Gift cards"/></h3><dl className={s.giftMetrics}>
    <div><dt><T text="Opening"/></dt><dd>{usd(Number(data.giftOpening))}</dd></div>
    <div><dt><T text="Sold"/></dt><dd>{complete?'+'+usd(sold):'—'}</dd></div>
    <div><dt><T text="Redeemed"/></dt><dd>{complete?'−'+usd(redeemed):'—'}</dd></div>
    <div><dt><T text="Closing reserve"/></dt><dd>{usd(Number(data.giftClosing))}</dd></div>
   </dl>{complete&&adjustments!==0&&<p className={s.note}><T text="Other balance adjustments"/> {usd(adjustments)}</p>}</div>
   <table className={s.activityTable}><thead><tr><th><T text="Date"/></th><th><T text="Type"/></th><th><T text="Amount"/></th></tr></thead><tbody>{data.giftActivity.map(x=><tr key={x.id}><td>{dateOnly(x.created_at)}</td><td><T text={x.kind==='issue'?'Sold':x.kind==='redeem'?'Redeemed':x.kind}/><span className={s.srOnly}> · Gift ••••{x.last4}</span></td><td>{x.delta>0?'+':'−'}{usd(Math.abs(x.delta)/100)}</td></tr>)}</tbody></table>
   {!complete&&<p className={s.note}><T text="Showing the latest 500 events. Narrow the date range for all activity."/></p>}
   {rewardSummary}{discountSummary}
   <a href="/gift-cards/manage" className={s.subtleLink}><T text="Manage gift cards"/> →</a>
  </>}
  {selected==='rewards'&&<>{rewardSummary}<p className={s.note}><T text="Credits and debits include adjustments and returns. Points are not dollars."/></p>{data.rewardActivity.map(x=><div className={s.activity} key={x.id}><div className={s.heading}><T text={x.reason}/><strong>{x.delta>0?'+':''}{x.delta.toLocaleString()} pts</strong></div><p className={s.note}>{dateLabel(x.created_at)} · {x.customer_name??x.user_id.slice(0,8)}</p>{x.ticket_id&&<p className={s.note}>Bill {x.ticket_number??x.ticket_id.slice(0,8)}</p>}</div>)}{data.rewardActivity.length>=500&&<p className={s.note}><T text="Showing the latest 500 events. Narrow the date range for all activity."/></p>}<a href="/reward-system" className={s.subtleLink}><T text="Reward rules and activity"/> →</a></>}
  {selected==='discounts'&&<>{discountSummary}<dl className={s.summaryLedger}><div><dt><T text="Rewards used (included below)"/></dt><dd>{usd(rewardDiscount)}</dd></div><div><dt><T text="Other discounts"/></dt><dd>{usd(money(discounts-rewardDiscount))}</dd></div></dl>{data.discounts.map(x=><div className={s.activity} key={x.id}><div className={s.heading}><span>Bill {x.ticket_number??x.id.slice(0,8)}</span><strong>{usd(x.total)}</strong></div><p className={s.note}>{dateLabel(x.opened_at)} · <T text="Reward included"/> {usd(x.reward)}</p></div>)}</>}
 </div>;
}

export function ExpensePanel({data,total,open,form,onAdd,onEdit,dateLabel}:{data:ShopMoneyData;total:number;open:boolean;form:ReactNode;onAdd:()=>void;onEdit:(expense:ShopExpense)=>void;dateLabel:(stamp:string)=>string}){
 return <>
  <div className={s.expenseHero}><div><h2><T text="Expenses paid"/></h2><strong className={s.big}>{usd(total)}</strong></div><button type="button" className={`${s.button} ${s.primary}`} onClick={onAdd}><T text="+ Add"/></button></div>
  {open&&form}
  <div className={s.scroll}><table className={s.activityTable}><thead><tr><th><T text="Date / Time"/></th><th><T text="Note"/></th><th><T text="Amount"/></th><th><T text="Edit"/></th></tr></thead><tbody>{data.expenses.map(e=><tr key={e.id}><td>{dateLabel(e.paid_at)}{new Intl.DateTimeFormat('en-CA',{timeZone:data.timezone}).format(new Date(e.paid_at))!==e.business_date&&<small>{e.business_date}</small>}</td><td><span>{e.note||e.category.replaceAll('_',' ')}</span><small><T text={e.source[0].toUpperCase()+e.source.slice(1)}/>{e.revision>1?' · Edited':''}</small></td><td>{usd(e.amount)}</td><td><button type="button" className={s.editButton} aria-label={`Edit ${e.note||e.category}`} onClick={()=>onEdit(e)}><Pencil/></button></td></tr>)}</tbody><tfoot><tr><td colSpan={2}><T text="Total"/></td><td>{usd(total)}</td><td/></tr></tfoot></table></div>
  {!data.expenses.length&&<p className={s.note}><T text="No expenses recorded in this period."/></p>}
 </>;
}
export function Pencil(){return <svg viewBox="0 0 24 24" className={s.icon} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg>;}
