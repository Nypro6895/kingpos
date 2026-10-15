'use client';
import {useRef,useState,useEffect} from 'react';
import {useRouter} from 'next/navigation';
import type {StripeEmbeddedCheckout} from '@stripe/stripe-js';
import type {MarketBankBillingState} from '@/types/market-bank-billing';
import {marketQuote} from '@/lib/market-commerce';
import {cardMoney,CARD_PLUGINS} from '@/lib/market-card-rules';
import {startCardCheckout,refreshCardPurchase} from './card-payment-actions';
import {isReylumiIOSClient} from '@/lib/ios-client';
import {isMarketCheckoutURL} from '@/lib/market-checkout-url';
export function CardCheckoutPanel({pluginId,billingState,hasActiveSubscription,ready=false,automaticTax}: {pluginId:string;pluginName:string;billingState:MarketBankBillingState;hasActiveSubscription:boolean;ready?:boolean;automaticTax?:{enabled:boolean;price_behavior:'inclusive'|'exclusive'};onStateChange:(state:MarketBankBillingState)=>void}){
 const router=useRouter(),mount=useRef<HTMLDivElement>(null),checkout=useRef<StripeEmbeddedCheckout|null>(null),alive=useRef(true),generation=useRef(0),pending=useRef(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[opened,setOpened]=useState(false);
 const [checkoutUrl,setCheckoutUrl]=useState('');
 useEffect(()=>{alive.current=true;const epoch=generation.current;return()=>{alive.current=false;generation.current=epoch+1;pending.current=false;checkout.current?.destroy();checkout.current=null;setBusy(false);setOpened(false);setCheckoutUrl('');};},[pluginId,billingState.salon_id]);
 useEffect(()=>{
  if(!checkoutUrl)return;
  const epoch=generation.current;
  const refresh=()=>{if(document.visibilityState==='hidden'||pending.current)return;pending.current=true;void refreshCardPurchase(pluginId).then(result=>{if(alive.current&&generation.current===epoch){setMessage(result.message);router.refresh();}}).catch(()=>{if(alive.current&&generation.current===epoch)setMessage('Payment status could not be checked. Please retry.');}).finally(()=>{if(generation.current===epoch)pending.current=false;});};
  window.addEventListener('focus',refresh);window.addEventListener('reylumi:foreground',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('reylumi:foreground',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[checkoutUrl,pluginId,router]);
 const item=billingState.catalog.find(item=>item.plugin_id===pluginId);
 if(hasActiveSubscription||!item)return null;
 const supported=CARD_PLUGINS.some(id=>id===pluginId)&&item.fulfillment_ready&&item.published;
 const quote=marketQuote(item.price_cents,automaticTax?.enabled?0:billingState.settings.tax_bps,billingState.settings.fee_bps,billingState.settings.fixed_fee_cents);
 async function buy(){
  if(busy||opened||pending.current||!alive.current)return;
  const attempt=generation.current,current=()=>alive.current&&generation.current===attempt;
  pending.current=true;setBusy(true);setMessage('');
  try{
   const external=isReylumiIOSClient(navigator.userAgent);
   const result=await startCardCheckout(pluginId,external);
   if(!current())return;
   if(result.complete){setMessage(result.message??'Payment confirmed.');router.refresh();return;}
   if(result.checkoutUrl){if(!isMarketCheckoutURL(result.checkoutUrl))throw Error('Invalid checkout link.');setCheckoutUrl(result.checkoutUrl);setOpened(true);setMessage(external?'Continue in Safari to review the total and complete payment. Return here to check your access.':'Continue to secure checkout to review the total and complete payment.');return;}
   if(external)throw Error(result.message??'Safari checkout is unavailable. Please retry.');
   if(!result.clientSecret||!result.publishableKey)throw Error(result.message??'Card checkout is unavailable.');
   const {loadStripe}=await import('@stripe/stripe-js/pure');
   if(!current()||!mount.current)return;
   const stripe=await loadStripe(result.publishableKey);
   if(!current()||!mount.current)return;
   if(!stripe)throw Error('Card form could not load.');
   const embedded=await stripe.createEmbeddedCheckoutPage({clientSecret:result.clientSecret,onComplete:async()=>{
    if(!current())return;
    const done=await refreshCardPurchase(pluginId);
    if(current()){setMessage(done.message);router.refresh();}
   }});
   if(!current()||!mount.current){embedded.destroy();return;}
   checkout.current=embedded;setOpened(true);embedded.mount(mount.current);
  }catch(error){if(current())setMessage(error instanceof Error?error.message:'Payment could not start.');}
  finally{if(current()){pending.current=false;setBusy(false);}}
 }
 async function checkPaymentStatus(){
  if(busy||pending.current||!alive.current)return;
  const attempt=generation.current,current=()=>alive.current&&generation.current===attempt;
  pending.current=true;setBusy(true);
  try{const result=await refreshCardPurchase(pluginId);if(current()){setMessage(result.message);router.refresh();}}
  catch(error){if(current())setMessage(error instanceof Error?error.message:'Payment status could not be checked. Please retry.');}
  finally{if(current()){pending.current=false;setBusy(false);}}
 }
 return <section aria-label="Card payment" style={{margin:'16px 0'}}><p><strong>{cardMoney(quote.totalCents)} / month{automaticTax?.enabled&&automaticTax.price_behavior==='exclusive'?' + applicable tax':''}</strong> · renews monthly until canceled</p>{automaticTax?.enabled?<p>Price {cardMoney(quote.baseCents)} · Fees {cardMoney(quote.feeCents)} · {automaticTax.price_behavior==='inclusive'?'Applicable tax is included.':'Tax is added based on your location.'} Your final total is shown in the card form before you confirm.</p>:quote.taxCents+quote.feeCents>0&&<p>Price {cardMoney(quote.baseCents)} · Tax {cardMoney(quote.taxCents)} · Fees {cardMoney(quote.feeCents)}</p>}<div ref={mount}/>{!opened&&<button type="button" disabled={busy||!ready||!supported} onClick={buy}>{busy?'Preparing secure payment…':ready&&supported?'Buy with card':'Card payments not available yet'}</button>}<p role="status">{message}</p>{checkoutUrl&&<a href={checkoutUrl} rel="noreferrer" className="my-3 inline-flex min-h-11 items-center rounded-lg bg-zinc-950 px-4 text-white">Continue to secure checkout</a>}{opened&&<button type="button" disabled={busy} onClick={checkPaymentStatus}>Check payment status</button>}</section>;
}
