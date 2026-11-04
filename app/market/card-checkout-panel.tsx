'use client';
import {refreshMarketExperience} from '@/lib/refresh-market-experience';
import {useCallback,useRef,useState,useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {ActionFeedback} from '@/components/action-feedback';
import type {StripeEmbeddedCheckout} from '@stripe/stripe-js';
import type {MarketBankBillingState} from '@/types/market-bank-billing';
import {marketQuote} from '@/lib/market-commerce';
import {cardMoney,CARD_PLUGINS} from '@/lib/market-card-rules';
import {openMarketPayment} from '@/lib/open-market-payment';
import {startCardCheckout,refreshCardPurchase,manageCardSubscription} from './card-payment-actions';
import {isReylumiIOSClient} from '@/lib/ios-client';
import {isMarketCheckoutURL} from '@/lib/market-checkout-url';
export function CardCheckoutPanel({pluginId,billingState,hasActiveSubscription,ready=false,automaticTax,experienceScope,accessRevision,onMarketRefresh}: {pluginId:string;pluginName:string;billingState:MarketBankBillingState;hasActiveSubscription:boolean;ready?:boolean;automaticTax?:{enabled:boolean;price_behavior:'inclusive'|'exclusive'};onStateChange:(state:MarketBankBillingState)=>void;experienceScope?:string;accessRevision?:string;onMarketRefresh?:()=>void}){
 const router=useRouter(),mount=useRef<HTMLDivElement>(null),checkout=useRef<StripeEmbeddedCheckout|null>(null),alive=useRef(true),generation=useRef(0),pending=useRef(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[opened,setOpened]=useState(false);
 const [checkoutUrl,setCheckoutUrl]=useState('');
 const verifiedRevision=useRef(accessRevision),retryForeground=useRef<(()=>void)|undefined>(undefined);
 const refreshMarket=useCallback(()=>refreshMarketExperience({scope:experienceScope,refresh:onMarketRefresh,fallback:()=>router.refresh()}),[experienceScope,onMarketRefresh,router]);
 useEffect(()=>{alive.current=true;const epoch=generation.current;return()=>{alive.current=false;generation.current=epoch+1;pending.current=false;checkout.current?.destroy();checkout.current=null;setBusy(false);setOpened(false);setCheckoutUrl('');};},[pluginId,billingState.salon_id,experienceScope]);
 useEffect(()=>{
  if(!checkoutUrl)return;
  const epoch=generation.current;
  let cancelled=false,waiting=false,attempts=0,attemptRevision:string|undefined;
  const nativeGeneration=window.__reylumiAppLocalContext?.generation;
  const current=()=>!cancelled&&alive.current&&generation.current===epoch&&nativeGeneration===window.__reylumiAppLocalContext?.generation;
  const check=()=>{
   if(!current()||document.visibilityState==='hidden'||pending.current)return;
   waiting=false;attempts++;attemptRevision=verifiedRevision.current;pending.current=true;
   void refreshCardPurchase(pluginId).then(result=>{if(current()){retryForeground.current=undefined;setMessage(result.message);refreshMarket();}}).catch(()=>{
    if(!current())return;
    // Foreground can precede native admission. Only a later verified page read
    // may trigger one retry of this status read; Checkout is never restarted.
    if(attempts<2){waiting=true;setMessage('Checking your account before checking payment status…');}
    else{retryForeground.current=undefined;setMessage('Payment status could not be checked. Please retry.');}
   }).finally(()=>{if(current()){pending.current=false;retry();}});
  };
  const retry=()=>{if(waiting&&verifiedRevision.current&&verifiedRevision.current!==attemptRevision)check();};
  const refresh=()=>{if(waiting){retry();return;}if(pending.current)return;attempts=0;retryForeground.current=retry;check();};
  window.addEventListener('focus',refresh);window.addEventListener('reylumi:foreground',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{cancelled=true;retryForeground.current=undefined;window.removeEventListener('focus',refresh);window.removeEventListener('reylumi:foreground',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[checkoutUrl,pluginId,billingState.salon_id,experienceScope,refreshMarket]);
 useEffect(()=>{verifiedRevision.current=accessRevision;retryForeground.current?.();},[accessRevision]);
 const item=billingState.catalog.find(item=>item.plugin_id===pluginId);
 if(hasActiveSubscription&&pluginId!=='booksms')return null;
 if(hasActiveSubscription)return <section aria-label="Manage card subscription"><button type="button" disabled={busy} onClick={async()=>{if(pending.current)return;const attempt=generation.current;const current=()=>alive.current&&generation.current===attempt;pending.current=true;setBusy(true);try{const result=await manageCardSubscription(pluginId);if(current()){if(result.url)openMarketPayment(result.url);else setMessage(result.error??'Billing portal could not open.');}}catch{if(current())setMessage('Billing portal could not open.');}finally{if(current()){pending.current=false;setBusy(false);}}}}>Manage subscription</button><p role="status">{message}</p></section>;
 if(!item)return null;
 const supported=CARD_PLUGINS.some(id=>id===pluginId)&&item.fulfillment_ready&&item.published;
 const quote=supported?marketQuote(item.price_cents,automaticTax?.enabled?0:billingState.settings.tax_bps,billingState.settings.fee_bps,billingState.settings.fixed_fee_cents):null;
 async function buy(){
  if(busy||opened||pending.current||!alive.current)return;
  const attempt=generation.current,current=()=>alive.current&&generation.current===attempt;
  pending.current=true;setBusy(true);setMessage('');
  try{
   const external=isReylumiIOSClient(navigator.userAgent);
   const result=await startCardCheckout(pluginId,external);
   if(!current())return;
   if(result.complete){setMessage(result.message??'Payment confirmed.');refreshMarket();return;}
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
    if(current()){setMessage(done.message);refreshMarket();}
   }});
   if(!current()||!mount.current){embedded.destroy();return;}
   checkout.current=embedded;setOpened(true);embedded.mount(mount.current);
  }catch(error){if(current())setMessage(error instanceof Error?error.message:'Payment could not start.');}
  finally{if(current()){pending.current=false;setBusy(false);}}
 }
 async function checkPaymentStatus(){
  if(busy||pending.current||!alive.current)return;
  const attempt=generation.current,current=()=>alive.current&&generation.current===attempt;
  retryForeground.current=undefined;pending.current=true;setBusy(true);
  try{const result=await refreshCardPurchase(pluginId);if(current()){setMessage(result.message);refreshMarket();}}
  catch(error){if(current())setMessage(error instanceof Error?error.message:'Payment status could not be checked. Please retry.');}
  finally{if(current()){pending.current=false;setBusy(false);}}
 }
 return <section aria-label="Card payment" style={{margin:'16px 0'}}>{quote?<><p><strong>{cardMoney(quote.totalCents)} / month{automaticTax?.enabled&&automaticTax.price_behavior==='exclusive'?' + applicable tax':''}</strong> · renews monthly until canceled</p>{automaticTax?.enabled?<p>Price {cardMoney(quote.baseCents)} · Fees {cardMoney(quote.feeCents)} · {automaticTax.price_behavior==='inclusive'?'Applicable tax is included.':'Tax is added based on your location.'} Your final total is shown in the card form before you confirm.</p>:quote.taxCents+quote.feeCents>0&&<p>Price {cardMoney(quote.baseCents)} · Tax {cardMoney(quote.taxCents)} · Fees {cardMoney(quote.feeCents)}</p>}</>:<p>Paid purchases are being prepared and are not available yet. Free trial access remains available.</p>}<div ref={mount}/>{!opened&&supported&&<button type="button" disabled={busy||!ready} onClick={buy}>{busy?'Preparing secure payment…':ready?'Buy with card':'Card payments not available yet'}</button>}<p role="status">{message}</p>{checkoutUrl&&<a href={checkoutUrl} rel="noreferrer" className="my-3 inline-flex min-h-11 items-center rounded-lg bg-zinc-950 px-4 text-white">Continue to secure checkout</a>}{opened&&<button type="button" disabled={busy} aria-busy={busy} onClick={checkPaymentStatus}><ActionFeedback pending={busy} pendingLabel="Checking…">Check payment status</ActionFeedback></button>}</section>;
}
