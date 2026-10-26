"use client";
import {openMarketPayment} from "@/lib/open-market-payment";
import { ActionFeedback } from "@/components/action-feedback";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BOOKING_POLICY_TEMPLATE, type BookingPolicyState } from "@/types/booking-policy";
import { saveBookingPolicy, bookingPolicyPaymentAction } from "./booking-policy-actions";
import styles from "./market.module.css";
export function BookingPolicyPanel({ state, paymentsAvailable = true, bankCheckout = false, monthlyPrice = "$0.99 / month" }: { state: BookingPolicyState; paymentsAvailable?: boolean; bankCheckout?: boolean; monthlyPrice?: string }) {
 const [content,setContent]=useState(state.content || BOOKING_POLICY_TEMPLATE);
 const [published,setPublished]=useState(state.published);
 const [message,setMessage]=useState("");
 const [busy,startTransition]=useTransition();
 const [operation,setOperation]=useState<"save"|"payment"|null>(null);
 const router=useRouter();
 return <section aria-label="Edit booking rules">
  <h3>Your salon&apos;s booking rules</h3>
  <p>{monthlyPrice} USD per salon. Edit the suggested rules to match your salon before publishing.</p>
  <fieldset disabled={busy} className={styles.languageOptions}>
   <label htmlFor="booking-policy-content">Booking rules</label>
   <textarea id="booking-policy-content" value={content} onChange={event=>setContent(event.target.value)} maxLength={6000} rows={12} style={{width:"100%",padding:12,border:"1px solid #ccc",borderRadius:12}} />
   <span>{content.length} / 6000 characters</span>
   <button type="button" className={styles.secondary} onClick={()=>setContent(BOOKING_POLICY_TEMPLATE)}>Use suggested rules</button>
   <label><input type="checkbox" checked={published} onChange={event=>setPublished(event.target.checked)} />Show rules on the salon&apos;s booking page</label>
  </fieldset>
  <p>{state.active ? "Subscription active. Saved rules appear when publication is enabled." : "Save your draft now. Rules become visible after your subscription is active and publication is enabled."}</p>
  {!bankCheckout && !paymentsAvailable && !state.subscribed && <p>Subscription checkout is currently unavailable. You can still save your draft. Bank transfer is not available yet.</p>}
  {state.subscribed && !state.active && <p>Payment needs attention. Open Manage subscription to review your invoice or payment method.</p>}
  {state.active && !state.subscribed && <p>Your paid access remains available until the end of this period. Subscribe again after it ends.</p>}
  <p role="status">{message}</p>
  <div className={styles.languageActions}>
   <button className={styles.primary} disabled={busy || (published && !content.trim())} aria-busy={busy&&operation==="save"} onClick={()=>{setOperation("save");setMessage("");startTransition(async()=>{try{const result=await saveBookingPolicy(content,published);setMessage(result.error??"Booking rules saved.");if(!result.error)router.refresh();}catch{setMessage("Your changes could not be confirmed. Your draft is still here. Review the current rules before retrying.");}finally{setOperation(null);}});}}><ActionFeedback pending={busy&&operation==="save"} pendingLabel="Saving…">Save rules</ActionFeedback></button>
   {(!bankCheckout || state.subscribed) && <button className={styles.secondary} disabled={busy || (!state.subscribed && (!paymentsAvailable || state.active))} aria-busy={busy&&operation==="payment"} onClick={()=>{setOperation("payment");setMessage("");startTransition(async()=>{try{const result=await bookingPolicyPaymentAction(state.subscribed);if(result.url)openMarketPayment(result.url);else setMessage(result.error??"Checkout could not open.");}catch{setMessage("Checkout could not be confirmed. Check your subscription before trying again.");}finally{setOperation(null);}});}}><ActionFeedback pending={busy&&operation==="payment"} pendingLabel="Opening…">{state.subscribed?"Manage subscription":"Subscribe · $0.99 / month"}</ActionFeedback></button>}
  </div>
  <h3>Customer preview</h3><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{content || "Your booking rules will appear here."}</p>
 </section>;
}
