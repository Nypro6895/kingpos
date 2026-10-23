'use server';
import {notFound} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/lib/platform-admin/permissions';
import {marketServiceClient} from '@/lib/market-payments';
import {encryptPayment,paymentConfig,paymentStripe,publicPayment,PAYMENT_WEBHOOK} from '@/lib/platform-payment';
import {processCardEvent,syncCardSubscription,syncCardInvoice} from '@/lib/market-card';
import type {AdminActionResult} from '../_components/action-form';
async function owner(){const actor=await requirePlatformAdmin(P.teamManage);if(actor.roleSlug!=='platform_owner')notFound();return actor;}
function refresh(){revalidatePath('/admin/market');revalidatePath('/admin/settings');revalidatePath('/market');}
export async function savePaymentConnection(form:FormData):Promise<AdminActionResult>{
 const actor=await owner();
 try{
 const old=await paymentConfig(),client=marketServiceClient();if(String(old.version)!==form.get('version'))throw Error('Settings changed. Refresh before saving.');
 const secretKey=String(form.get('secret_key')??'').trim()||old.secretKey,publishableKey=String(form.get('publishable_key')??'').trim()||old.publishableKey;
 const keyMatch=/^(?:sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/.exec(secretKey);
 if(!keyMatch)throw Error('Enter a valid Stripe secret or restricted API key.');
 const mode=keyMatch[1] as 'live'|'test';
 if(!new RegExp(`^pk_${mode}_[A-Za-z0-9]{16,}$`).test(publishableKey))throw Error('Enter a publishable key from the same Stripe account and test/live mode as the API key.');
 const config={...old,secretKey,publishableKey,mode,enabled:form.has('enabled')};
 const account=await paymentStripe('account',undefined,undefined,config);
 const {count,error:countError}=await client.from('market_card_purchases').select('id',{count:'exact',head:true});if(countError)throw Error('Existing purchases could not be checked.');
 if(count&&old.accountId&&(old.accountId!==account.id||old.mode!==mode))throw Error('Existing purchases belong to this Stripe account and mode. Keep that account to manage renewals and refunds.');
 config.accountId=account.id;
 if(config.enabled&&(mode!=='live'||!account.charges_enabled))throw Error('Live payments require a live Stripe account ready to accept charges.');
 if(form.get('intent')==='test')return {ok:true,message:`${mode==='live'?'Live':'Test'} account connection verified. No charge was made. Save to configure the webhook.`};
 if(!old.webhookId||old.accountId!==account.id||old.mode!==mode){
 const webhook=await paymentStripe('webhook_endpoints',new URLSearchParams({url:PAYMENT_WEBHOOK,api_version:'2024-06-20','enabled_events[0]':'checkout.session.completed','enabled_events[1]':'checkout.session.expired','enabled_events[2]':'invoice.paid','enabled_events[3]':'invoice.payment_failed','enabled_events[4]':'customer.subscription.updated','enabled_events[5]':'customer.subscription.deleted','enabled_events[6]':'charge.refunded','enabled_events[7]':'payment_intent.succeeded','enabled_events[8]':'credit_note.created','enabled_events[9]':'credit_note.voided','metadata[reylumi]':'market-system'}),`market-webhook:${account.id}:${mode}:${old.version}`,config);
 if(!webhook.secret||!webhook.id)throw Error('Webhook could not be created.');config.webhookId=webhook.id;config.webhookSecret=webhook.secret;
 }else{const hook=await paymentStripe(`webhook_endpoints/${old.webhookId}`,undefined,undefined,config);if(hook.status!=='enabled'||hook.url!==PAYMENT_WEBHOOK)throw Error('Restore the configured Stripe webhook before saving.');if(!hook.enabled_events?.includes('*')){const events=[...new Set<string>([...(hook.enabled_events??[]),'credit_note.created','credit_note.voided'])];if(events.length!==(hook.enabled_events??[]).length){const eventForm=new URLSearchParams();events.forEach((event,index)=>eventForm.set(`enabled_events[${index}]`,event));await paymentStripe(`webhook_endpoints/${old.webhookId}`,eventForm,`market-tax-webhook:${account.id}:${old.version}`,config);}}}
 if(!old.portalConfigurationId||old.accountId!==account.id||old.mode!==mode){const portal=await paymentStripe('billing_portal/configurations',new URLSearchParams({'business_profile[headline]':'Manage your Reylumi subscription','features[subscription_cancel][enabled]':'true','features[subscription_cancel][mode]':'at_period_end','features[payment_method_update][enabled]':'true','features[invoice_history][enabled]':'true'}),`market-portal:${account.id}:${mode}:${old.version}`,config);if(!portal.id)throw Error('Subscription management could not be configured.');config.portalConfigurationId=portal.id;}
 const payload={encrypted_config:encryptPayment(config),public_config:publicPayment(config),version:old.version+1,updated_at:new Date().toISOString()};
 const result=old.version?await client.from('platform_payment_settings').update(payload).eq('id',true).eq('version',old.version).select('version').single():await client.from('platform_payment_settings').insert({id:true,...payload}).select('version').single();
 if(result.error)throw Error('Settings changed or could not save. Refresh before retrying.');
 await client.from('market_system_audit').insert({actor_id:actor.userId,action:'payment.settings.saved',details:{mode,enabled:config.enabled,version:old.version+1}});refresh();return {ok:true,message:'Payment connection saved. Webhook configured automatically.'};
 }catch(error){return {ok:false,message:error instanceof Error?error.message:'Payment settings could not save.'};}
}
export async function reconcileCardPayment(form:FormData):Promise<AdminActionResult>{const actor=await owner();try{const id=String(form.get('purchase_id')??'');const client=marketServiceClient();const {data,error}=await client.from('market_card_purchases').select('id,subscription_id,session_id').eq('id',id).single();if(error||!data)throw Error('Purchase not found.');let sub=data.subscription_id;if(!sub&&data.session_id){const session=await paymentStripe(`checkout/sessions/${data.session_id}`);sub=session.subscription;}if(!sub)throw Error('No completed payment to activate.');await syncCardSubscription(sub);await client.from('market_system_audit').insert({actor_id:actor.userId,action:'payment.reconcile',details:{purchase_id:id}});refresh();return {ok:true,message:'Payment and access synchronized. No new charge was created.'};}catch(error){return {ok:false,message:error instanceof Error?error.message:'Reconciliation failed.'};}}
export async function retryCardEvent(form:FormData):Promise<AdminActionResult>{await owner();try{await processCardEvent(String(form.get('event_id')??''));refresh();return {ok:true,message:'Event synchronized.'};}catch{return {ok:false,message:'Event still needs attention. Check the provider connection.'};}}
export async function refundCardInvoice(form:FormData):Promise<AdminActionResult>{const actor=await owner();try{const id=String(form.get('invoice_id')??''),reason=String(form.get('reason')??'').trim();if(!/^in_[A-Za-z0-9]+$/.test(id)||reason.length<3||reason.length>500)throw Error('Enter a refund reason.');const client=marketServiceClient();const {data,error}=await client.from('market_card_invoices').select('*,market_card_purchases(subscription_id,snapshot)').eq('id',id).single();if(error||!data?.payment_intent||data.status!=='paid')throw Error('Only a settled, unrefunded invoice can be refunded here.');
 const automatic=data.market_card_purchases.snapshot?.automatic_tax?.enabled===true;
 const refund=automatic?await paymentStripe('credit_notes',new URLSearchParams({invoice:id,amount:String(data.amount_cents),refund_amount:String(data.amount_cents),reason:'order_change',memo:reason,'metadata[admin_reason]':reason}),`market-full-credit:${id}`):await paymentStripe('refunds',new URLSearchParams({payment_intent:data.payment_intent,amount:String(data.amount_cents),'metadata[admin_reason]':reason}),`market-full-refund:${id}`);
 const sub=data.market_card_purchases.subscription_id;await paymentStripe(`subscriptions/${sub}`,new URLSearchParams({cancel_at_period_end:'true'}),`market-refund-cancel:${id}`);await syncCardInvoice(id);await syncCardSubscription(sub);
 await client.from('market_system_audit').insert({actor_id:actor.userId,action:'payment.refund',details:{invoice:id,refund:refund.id,reason}});refresh();return {ok:true,message:automatic?'Invoice credit issued and refund submitted; future renewal canceled.':refund.status==='succeeded'?'Refund completed; future renewal canceled.':'Refund submitted; provider confirmation pending.'};
 }catch(error){return {ok:false,message:error instanceof Error?error.message:'Refund needs reconciliation. Do not create a second refund.'};}}
