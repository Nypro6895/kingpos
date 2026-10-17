import 'server-only';
import {marketServiceClient} from './market-payments';
import {paymentConfig,paymentStripe} from './platform-payment';
import {validCardQuote} from './market-card-rules';
import {fulfillCreditPayment,expireCreditCheckout,fulfillCampaignCardSetup} from './campaign-payments';
import {recordMarketTaxInvoice,validateMarketTaxInvoice} from './market-tax';
export async function syncCardSubscription(subscriptionId:string) {
 if(!/^sub_[A-Za-z0-9]+$/.test(subscriptionId))throw Error('Invalid subscription.');
 const observed=new Date().toISOString();
 const config=await paymentConfig();
 const sub=await paymentStripe(`subscriptions/${subscriptionId}?expand[]=latest_invoice.payment_intent.latest_charge&expand[]=items.data.price.product`,undefined,undefined,config);
 const id=sub.metadata?.market_card_purchase;if(!id)return false;
 const client=marketServiceClient();const {data:purchase,error}=await client.from('market_card_purchases').select('*').eq('id',id).single();
 if(error||!purchase||purchase.snapshot.account_id!==config.accountId||sub.livemode!==true||sub.metadata.salon_id!==purchase.salon_id||sub.metadata.plugin_id!==purchase.plugin_id||!validCardQuote(sub,purchase.amount_cents))throw Error('Subscription does not match the saved purchase.');
 const automatic=purchase.snapshot.automatic_tax?.enabled===true;
 if(automatic){const price=sub.items.data[0].price,code=typeof price.product?.tax_code==='string'?price.product.tax_code:price.product?.tax_code?.id;if(sub.automatic_tax?.enabled!==true||price.tax_behavior!==purchase.snapshot.automatic_tax.price_behavior||code!==purchase.snapshot.automatic_tax.tax_code)throw Error('Subscription tax terms do not match the saved purchase.');}
 const invoice=sub.latest_invoice,paid=invoice?.status==='paid'&&(automatic?validateMarketTaxInvoice(invoice,purchase):invoice.amount_paid===purchase.amount_cents&&invoice.payment_intent?.status==='succeeded'&&invoice.payment_intent?.amount_received===purchase.amount_cents&&invoice.payment_intent?.currency==='usd');
 if(invoice?.status==='paid'&&!paid)throw Error('The invoice needs reconciliation with a successful card payment.');
 const charge=invoice?.payment_intent?.latest_charge;
 const refunded=charge?.amount_refunded??0;
 const end=sub.current_period_end;
 if(paid&&(!Number.isSafeInteger(end)||end<=0))throw Error('Invalid paid period.');
 if(paid&&automatic)await recordMarketTaxInvoice(invoice,purchase,config);
 const {error:applyError}=await client.rpc('market_card_apply',{p_id:id,p_subscription:sub.id,p_customer:typeof sub.customer==='string'?sub.customer:sub.customer.id,p_status:sub.status==='incomplete_expired'?'expired':sub.status,p_invoice:invoice?.id??null,p_amount:paid?invoice.amount_paid:null,p_refunded:paid?refunded:0,p_intent:invoice?.payment_intent?.id??null,p_until:paid?new Date(end*1000).toISOString():null,p_observed:observed});
 if(applyError)throw Error('Payment recorded by Stripe; access update needs retry.');return Boolean(paid&&refunded<invoice.amount_paid&&end*1000>Date.now());
}
export async function syncCardInvoice(invoiceId:string){
 if(!/^in_[A-Za-z0-9]+$/.test(invoiceId))throw Error('Invalid invoice.');
 const config=await paymentConfig(),invoice=await paymentStripe(`invoices/${invoiceId}?expand[]=payment_intent.latest_charge`,undefined,undefined,config);
 if(typeof invoice.subscription!=='string')return;
 if(invoice.status!=='paid')return invoice.subscription as string;
 const client=marketServiceClient(),{data:purchase,error}=await client.from('market_card_purchases').select('*').eq('subscription_id',invoice.subscription).maybeSingle();
 if(error)throw Error('Invoice purchase could not load.');if(!purchase)return;
 if(invoice.livemode!==true||purchase.snapshot.account_id!==config.accountId)throw Error('Invoice belongs to a different payment account.');
 if(purchase.snapshot.automatic_tax?.enabled===true)await recordMarketTaxInvoice(invoice,purchase,config);
 const refunded=invoice.payment_intent?.latest_charge?.amount_refunded??0;
 const {error:updateError}=await client.from('market_card_invoices').update({refunded_cents:refunded,status:refunded>=invoice.amount_paid?'refunded':refunded>0?'partially_refunded':'paid',updated_at:new Date().toISOString()}).eq('id',invoice.id).lte('refunded_cents',refunded);
 if(updateError)throw Error('Refund record needs retry.');return invoice.subscription as string;
}
export async function processCardEvent(eventId:string) {
 if(!/^evt_[A-Za-z0-9]+$/.test(eventId))throw Error('Invalid event.');
 const client=marketServiceClient();const {data:prior}=await client.from('market_card_events').select('attempts,status').eq('id',eventId).maybeSingle();
 if(prior?.status==='processed')return;
 const event=await paymentStripe(`events/${eventId}`);const obj=event.data?.object;
 if(event.livemode!==true)return;
 const {error:logError}=await client.from('market_card_events').upsert({id:eventId,type:event.type,object_id:obj?.id??null,status:'pending',attempts:(prior?.attempts??0)+1,updated_at:new Date().toISOString()});if(logError)throw Error('Event could not be recorded.');
 try {
 if(event.type==='payment_intent.succeeded'&&obj.metadata?.campaign_credit_order)await fulfillCreditPayment(obj.id);
 if(event.type==='checkout.session.completed'&&obj.metadata?.campaign_card_setup)await fulfillCampaignCardSetup(obj.id);
 if(event.type==='checkout.session.expired'&&obj.metadata?.campaign_credit_order)await expireCreditCheckout(obj.metadata.campaign_credit_order);
 let subscription=event.type.startsWith('customer.subscription.')?obj.id:obj.subscription;
 if((event.type==='charge.refunded'||event.type.startsWith('credit_note.'))&&obj.invoice)subscription=await syncCardInvoice(obj.invoice);
 if(typeof subscription==='string')await syncCardSubscription(subscription);
 else if(event.type==='checkout.session.expired'&&obj.metadata?.market_card_purchase){const {error}=await client.from('market_card_purchases').update({status:'expired',updated_at:new Date().toISOString()}).eq('id',obj.metadata.market_card_purchase).in('status',['creating','open']);if(error)throw Error('Expired checkout could not be recorded.');}
 const {error}=await client.from('market_card_events').update({status:'processed',last_error:null,updated_at:new Date().toISOString()}).eq('id',eventId);if(error)throw Error('Event confirmation failed.');
 }catch(error){await client.from('market_card_events').update({status:'failed',last_error:'Provider state could not be applied. Retry reconciliation.',updated_at:new Date().toISOString()}).eq('id',eventId);throw error;}
}
