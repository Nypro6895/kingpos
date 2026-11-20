'use server';
import {marketPluginContext} from '@/lib/market-plugins';
import {marketServiceClient} from '@/lib/market-payments';
import {paymentConfig,paymentStripe} from '@/lib/platform-payment';
import {syncCardSubscription} from '@/lib/market-card';
import {checkWriterSalesReady} from "@/lib/check-writer-readiness";
import {CARD_PLUGINS} from '@/lib/market-card-rules';
import {applyMarketTaxToCheckout} from '@/lib/market-tax';
import {revalidatePath} from 'next/cache';
import {isMarketCheckoutURL} from '@/lib/market-checkout-url';
type CheckoutResult={clientSecret?:string;publishableKey?:string;checkoutUrl?:string;message?:string;complete?:boolean};
export async function startCardCheckout(pluginId:string,external=false):Promise<CheckoutResult> {
 if(pluginId==="print-check"&&!checkWriterSalesReady())return {message:"Check Writer is being configured. Please try again later."};
 return prepareCardCheckout(pluginId,external===true,0);
}
async function prepareCardCheckout(pluginId:string,external:boolean,attempt:number):Promise<CheckoutResult> {
 try{
 if(attempt>=3)throw Error('Checkout changed in another window. Refresh Market before trying again.');
 if(!CARD_PLUGINS.some(id=>id===pluginId))throw Error('This plugin is not ready for card checkout.');
 const {client,salonId}=await marketPluginContext(),config=await paymentConfig();
 if(!config.enabled||config.mode!=='live'||!config.webhookSecret)throw Error('Card payments are being connected. Please try again later.');
 const {data:row,error}=await client.rpc(external?'market_card_reserve_safari':'market_card_reserve',{p_salon:salonId,p_plugin:pluginId});if(error||!row)throw Error(error?.message??'Checkout could not start.');
 if(row.subscription_id){await syncCardSubscription(row.subscription_id);revalidatePath('/market');return {complete:true,message:'Subscription refreshed.'};}
 let session;
 if(row.session_id){session=await paymentStripe(`checkout/sessions/${row.session_id}`,undefined,undefined,config);if(session.status==='expired'){const {error}=await marketServiceClient().from('market_card_purchases').update({status:'expired'}).eq('id',row.id).in('status',['creating','open']);if(error)throw Error('Checkout could not reset.');return prepareCardCheckout(pluginId,external,attempt+1);}if(session.status==='complete'){if(typeof session.subscription==='string')await syncCardSubscription(session.subscription);revalidatePath('/market');return {complete:true,message:'Payment received. Access is being updated.'};}}
 else {
 if(Date.now()-Date.parse(row.created_at)>23*60*60*1000)throw Error('This checkout needs payment reconciliation. Contact support.');
 const form=new URLSearchParams({mode:'subscription',ui_mode:'embedded',redirect_on_completion:'if_required',return_url:'https://reylumi.com/market?payment=received','payment_method_types[0]':'card','saved_payment_method_options[payment_method_save]':'enabled','line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(row.amount_cents),'line_items[0][price_data][recurring][interval]':'month','line_items[0][price_data][product_data][name]':`Reylumi ${row.snapshot.name}`,'line_items[0][price_data][product_data][description]':row.snapshot.automatic_tax?.enabled===true?'Monthly access. Final tax is calculated at checkout using your billing address. Cancel future renewal in Manage subscription.':'Monthly access. Total includes configured tax and fees. Cancel future renewal in Manage subscription.','metadata[market_card_purchase]':row.id,'subscription_data[metadata][market_card_purchase]':row.id,'subscription_data[metadata][salon_id]':salonId,'subscription_data[metadata][plugin_id]':pluginId});
 if(row.snapshot.checkout_ui_mode==='hosted'){
   form.set('ui_mode','hosted');form.delete('redirect_on_completion');form.delete('return_url');
   form.set('success_url','https://reylumi.com/market/payment-return');
   form.set('cancel_url','https://reylumi.com/market/payment-return?cancelled=1');
 }
 if(row.snapshot.customer_id)form.set('customer',row.snapshot.customer_id);
 else if(row.snapshot.customer_email)form.set('customer_email',row.snapshot.customer_email);
 await applyMarketTaxToCheckout(form,row);
 session=await paymentStripe('checkout/sessions',form,`market-card:${row.id}`,config);
 const {error}=await marketServiceClient().from('market_card_purchases').update({session_id:session.id,status:'open'}).eq('id',row.id).eq('status','creating');if(error)throw Error('Checkout is reserved. Retry to recover the same payment.');
 }
 if(row.snapshot.checkout_ui_mode==='hosted'){
   if(!isMarketCheckoutURL(session.url))throw Error('Secure checkout could not open. Please retry.');
   return {checkoutUrl:session.url};
 }
 if(external){
   // Retire the old embedded session before reserving a hosted replacement.
   // A failed expiration (including a concurrent payment) must never create a
   // second subscription. Reconciliation handles a checkout already completed.
   const expired=await paymentStripe(`checkout/sessions/${session.id}/expire`,new URLSearchParams(),undefined,config);
   if(expired.status!=='expired')throw Error('The previous checkout is being confirmed. Check payment status before trying again.');
   const {error}=await marketServiceClient().from('market_card_purchases').update({status:'expired'}).eq('id',row.id).in('status',['creating','open']);
   if(error)throw Error('Checkout could not reset. Please retry.');
   return prepareCardCheckout(pluginId,true,attempt+1);
 }
 if(typeof session.client_secret!=='string')throw Error('Card form could not load.');return {clientSecret:session.client_secret,publishableKey:config.publishableKey};
 }catch(error){return {message:error instanceof Error?error.message:'Checkout is unavailable.'};}
}
export async function refreshCardPurchase(pluginId:string){try{const {salonId}=await marketPluginContext();const {data,error}=await marketServiceClient().from('market_card_purchases').select('subscription_id,session_id').eq('salon_id',salonId).eq('plugin_id',pluginId).order('created_at',{ascending:false}).limit(1).maybeSingle();if(error||!data)throw Error('Payment could not be checked.');let subscription=data.subscription_id;if(!subscription&&data.session_id){const session=await paymentStripe(`checkout/sessions/${data.session_id}`);subscription=session.subscription;}const active=typeof subscription==='string'&&await syncCardSubscription(subscription);revalidatePath('/market');return {message:active?'Payment confirmed. Your plugin is ready.':'No active paid access confirmed yet. Check payment status or contact support.'};}catch{return {message:'Payment confirmation is pending. It will retry automatically; do not pay again.'};}}
