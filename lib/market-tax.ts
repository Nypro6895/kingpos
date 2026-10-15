import 'server-only';
import {notFound} from 'next/navigation';
import {requirePlatformAdmin} from './platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from './platform-admin/permissions';
import {createAuthenticatedSupabaseServerClient} from './supabase/server';
import {marketServiceClient} from './market-payments';
import {paymentConfig,paymentStripe,type PaymentConfig} from './platform-payment';
import type {MarketTaxAdminState,MarketTaxProviderState,MarketTaxSettings} from '@/types/market-tax';

type TaxSnapshot={enabled?:boolean;price_behavior?:string;tax_code?:string};
type Purchase={id:string;amount_cents:number;snapshot:{account_id:string;automatic_tax?:TaxSnapshot}};
type TaxRate={id:string;country?:string;state?:string;jurisdiction?:string;display_name?:string;tax_type?:string;percentage?:number};
type TaxAmount={amount:number;tax_rate:string|TaxRate};
type TaxInvoice={id:string;status:string;livemode:boolean;currency:string;total:number;amount_paid:number;total_excluding_tax:number|null;automatic_tax?:{enabled:boolean;status:string};total_tax_amounts?:TaxAmount[];customer_address?:{country?:string;state?:string};customer_shipping?:{address?:{country?:string;state?:string}};status_transitions?:{paid_at?:number};created:number;payment_intent?:{id:string;status:string;currency:string;amount_received:number;latest_charge?:{amount:number;amount_refunded:number;refunds?:{data:{id:string;status:string;amount:number;created:number}[];has_more?:boolean}}}};
const unavailable=():MarketTaxProviderState=>({connected:false,account_id:null,mode:null,status:'unavailable',head_office:null,registrations:[],checked_at:null,error:null});
async function ownerClient(){const actor=await requirePlatformAdmin(P.teamManage);if(actor.roleSlug!=='platform_owner')notFound();const client=await createAuthenticatedSupabaseServerClient();if(!client)throw Error('Sign in again.');return client;}
export function marketTaxDateRange(input:{from?:string;to?:string}={}){
 const day=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('Choose valid report dates.');return value;};
 const from=input.from?day(input.from):'',to=input.to?day(input.to):'';
 if(from&&to&&from>to)throw Error('The end date must be on or after the start date.');
 return {filters:{from,to},p_from:from?`${from}T00:00:00.000Z`:null,p_to:to?new Date(Date.parse(to)+86400000).toISOString():null};
}
export async function marketTaxCheckoutSettings():Promise<{enabled:boolean;price_behavior:'inclusive'|'exclusive'}>{const {data,error}=await marketServiceClient().from('platform_market_tax_settings').select('enabled,price_behavior').eq('id',true).single();if(error||!data)throw Error('Tax configuration could not load.');return data;}
export async function loadMarketTaxAdminState(input:{from?:string;to?:string}={}):Promise<MarketTaxAdminState>{
 const client=await ownerClient(),range=marketTaxDateRange(input);
 const [tax,catalog]=await Promise.all([client.rpc('market_tax_admin_state',{p_from:range.p_from,p_to:range.p_to}),client.rpc('market_billing_admin_state')]);
 if(tax.error||!tax.data||catalog.error||!catalog.data)throw Error('Automatic tax settings could not load.');
 const state=tax.data,overrides=new Map((state.product_codes??[]).map((p:{plugin_id:string;tax_code:string|null;version:number})=>[p.plugin_id,p]));
 return {...state,provider:state.provider??unavailable(),products:(catalog.data.catalog??[]).map((p:{plugin_id:string;name:string})=>{const code=overrides.get(p.plugin_id) as {tax_code:string|null;version:number}|undefined;return {...p,tax_code:code?.tax_code??null,version:code?.version??null};}),filters:range.filters};
}
async function readProvider(config:PaymentConfig):Promise<MarketTaxProviderState>{
 if(!config.secretKey||!config.accountId)return {...unavailable(),checked_at:new Date().toISOString(),error:'Connect Stripe before configuring automatic tax.'};
 const [account,settings]=await Promise.all([paymentStripe('account',undefined,undefined,config),paymentStripe('tax/settings',undefined,undefined,config)]);
 if(account.id!==config.accountId||settings.livemode!==(config.mode==='live'))throw Error('Tax settings belong to a different payment account or mode.');
 const registrations:MarketTaxProviderState['registrations']=[];let cursor='';
 for(let page=0;page<20;page++){
  const list=await paymentStripe(`tax/registrations?limit=100${cursor?`&starting_after=${encodeURIComponent(cursor)}`:''}`,undefined,undefined,config);
  for(const r of list.data??[])registrations.push({id:r.id,country:r.country,state:r.country_options?.us?.state??null,status:r.status,active_from:r.active_from??null,expires_at:r.expires_at??null});
  if(!list.has_more)break;cursor=list.data?.at(-1)?.id;if(!cursor||page===19)throw Error('Tax registrations could not be loaded completely.');
 }
 const a=settings.head_office?.address;
 return {connected:true,account_id:account.id,mode:config.mode,status:settings.status==='active'?'active':'pending',head_office:a?{country:a.country,state:a.state??null,city:a.city??null,postal_code:a.postal_code??null,line1:a.line1??null}:null,registrations,checked_at:new Date().toISOString(),error:null};
}
export async function refreshMarketTaxProvider(config?:PaymentConfig):Promise<MarketTaxProviderState>{
 let provider:MarketTaxProviderState;
 try{provider=await readProvider(config??await paymentConfig());}catch{provider={...unavailable(),checked_at:new Date().toISOString(),error:'Stripe Tax could not be checked. Verify the payment connection and tax settings, then retry.'};}
 const {error}=await marketServiceClient().rpc('market_tax_sync_provider',{p_provider:provider});if(error)throw Error('The tax connection check could not be saved.');
 return provider;
}
export async function syncMarketTaxProvider():Promise<{message:string}>{
 await ownerClient();const provider=await refreshMarketTaxProvider();
 if(provider.status!=='active')return {message:provider.error??'Complete the head office address and Stripe Tax setup in Stripe. Automatic tax is not ready.'};
 return {message:`Stripe Tax checked (${provider.mode}). ${provider.registrations.filter(r=>r.status==='active').length} active registrations. Registration and filing obligations still require review.`};
}
async function verifyTaxCode(code:string|null){if(code===null)return;if(!/^txcd_\d{8}$/.test(code))throw Error('Choose a valid Stripe tax code.');const result=await paymentStripe(`tax_codes/${code}`);if(result.id!==code)throw Error('The product tax code could not be verified.');}
export async function saveMarketTaxSettings(input:Pick<MarketTaxSettings,'version'|'enabled'|'price_behavior'|'default_tax_code'>){
 const client=await ownerClient();await verifyTaxCode(input.default_tax_code);
 if(input.enabled){await syncMarketTaxProvider();const provider=await readProvider(await paymentConfig());if(provider.status!=='active'||provider.mode!=='live'||!provider.head_office)throw Error('Check a live Stripe Tax connection and head office before enabling automatic tax.');if(!provider.registrations.some(r=>r.status==='active'))throw Error('Review taxable products and required registrations before enabling tax collection.');}
 const {data,error}=await client.rpc('market_tax_save_settings',{p_version:input.version,p_values:{enabled:input.enabled,price_behavior:input.price_behavior,default_tax_code:input.default_tax_code}});if(error)throw Error(error.message);return data;
}
export async function saveMarketTaxProduct(input:{plugin_id:string;version:number|null;tax_code:string|null}){const client=await ownerClient();await verifyTaxCode(input.tax_code);const {data,error}=await client.rpc('market_tax_save_product',{p_plugin:input.plugin_id,p_tax_code:input.tax_code,p_version:input.version});if(error)throw Error(error.message);return data;}
export async function applyMarketTaxToCheckout(form:URLSearchParams,purchase:Purchase){
 const tax=purchase.snapshot.automatic_tax;if(tax?.enabled!==true)return;
 if(!/^txcd_\d{8}$/.test(tax.tax_code??'')||!['inclusive','exclusive'].includes(tax.price_behavior??''))throw Error('This purchase needs a valid product tax classification.');
 const config=await paymentConfig();if(config.accountId!==purchase.snapshot.account_id||config.mode!=='live')throw Error('The payment account changed. Contact support before paying.');
 const provider=await readProvider(config);if(provider.status!=='active'||!provider.head_office)throw Error('Automatic tax is unavailable. Please try again after the tax connection is restored.');
 form.set('automatic_tax[enabled]','true');form.set('billing_address_collection','required');
 if(form.has('customer'))form.set('customer_update[address]','auto');
 form.set('line_items[0][price_data][tax_behavior]',tax.price_behavior!);form.set('line_items[0][price_data][product_data][tax_code]',tax.tax_code!);
}
function cents(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<0)throw Error('Invalid invoice tax amount.');return Number(value);}
function unixTime(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<=0)throw Error('Invalid provider transaction date.');return Number(value);}
function taxRateId(value:string|TaxRate){return typeof value==='string'?value:value.id;}
export function validateMarketTaxInvoice(invoice:TaxInvoice,purchase:Purchase){
 const tax=purchase.snapshot.automatic_tax;if(tax?.enabled!==true)return false;
 if(!['inclusive','exclusive'].includes(tax.price_behavior??''))throw Error('Invalid saved tax behavior.');
 if(invoice.livemode!==true||invoice.status!=='paid'||invoice.currency!=='usd'||invoice.automatic_tax?.enabled!==true||invoice.automatic_tax.status!=='complete'||invoice.total_excluding_tax===null)throw Error('The paid invoice needs a completed automatic tax calculation.');
 const total=cents(invoice.total),net=cents(invoice.total_excluding_tax),amount=cents(invoice.amount_paid),taxCents=(invoice.total_tax_amounts??[]).reduce((sum,line)=>sum+cents(line.amount),0);
 unixTime(invoice.status_transitions?.paid_at??invoice.created);
 if(net+taxCents!==total||amount!==total||(tax.price_behavior==='inclusive'?total!==purchase.amount_cents:net!==purchase.amount_cents))throw Error('The invoice tax and total do not match the saved purchase.');
 const intent=invoice.payment_intent;if(intent?.status!=='succeeded'||intent.currency!=='usd'||intent.amount_received!==total)throw Error('The invoice needs reconciliation with a successful card payment.');
 return true;
}
// Only actual issued credit notes linked to successful card refunds reverse tax.
// A raw card refund is not enough evidence of a jurisdiction tax credit.
export async function recordMarketTaxInvoice(invoice:TaxInvoice,purchase:Purchase,config:PaymentConfig){
 if(!validateMarketTaxInvoice(invoice,purchase))return;
 const address=invoice.customer_shipping?.address??invoice.customer_address;if(!/^[A-Z]{2}$/.test(address?.country??''))throw Error('The tax invoice needs a verified customer country.');
 const breakdown=new Map<string,{tax_rate_id:string;tax_cents:number;country:string;state:string|null;jurisdiction:string;tax_type:string|null;rate_bps:number|null;tax_code:string|null}>();
 for(const line of invoice.total_tax_amounts??[]){
  const rate=typeof line.tax_rate==='string'?await paymentStripe(`tax_rates/${line.tax_rate}`,undefined,undefined,config):line.tax_rate;
  if(!/^txr_[A-Za-z0-9]+$/.test(rate.id))throw Error('Invoice tax jurisdiction could not be verified.');
  const prior=breakdown.get(rate.id);breakdown.set(rate.id,{tax_rate_id:rate.id,tax_cents:(prior?.tax_cents??0)+cents(line.amount),country:rate.country??address!.country!,state:rate.state??address!.state??null,jurisdiction:rate.jurisdiction||rate.display_name||rate.id,tax_type:rate.tax_type??null,rate_bps:typeof rate.percentage==='number'?Math.round(rate.percentage*100):null,tax_code:purchase.snapshot.automatic_tax?.tax_code??null});
 }
 const charge=invoice.payment_intent?.latest_charge,refunded=cents(charge?.amount_refunded??0),refundTax=new Map<string,number>(),coveredRefunds=new Map<string,number>(),creditNotes:{id:string;occurred_at:string;amount_cents:number;tax_breakdown:{tax_rate_id:string;tax_cents:number}[]}[]=[];let refundAt:number|null=null,creditVerified=false;
 if(refunded>0){
  const refunds=new Map<string,{status:string;amount:number;created:number}>();let cursor='';
  for(let page=0;page<100;page++){const list=await paymentStripe(`refunds?payment_intent=${invoice.payment_intent!.id}&limit=100${cursor?`&starting_after=${encodeURIComponent(cursor)}`:''}`,undefined,undefined,config);for(const r of list.data??[])if(r.status==='succeeded'){unixTime(r.created);cents(r.amount);refunds.set(r.id,r);}if(!list.has_more)break;cursor=list.data?.at(-1)?.id;if(!cursor||page===99)throw Error('Refund evidence could not be loaded completely.');}
  cursor='';for(let page=0;page<100;page++){
   const list=await paymentStripe(`credit_notes?invoice=${invoice.id}&limit=100${cursor?`&starting_after=${encodeURIComponent(cursor)}`:''}`,undefined,undefined,config);
   for(const note of list.data??[]){
    if(note.status!=='issued'||note.type!=='post_payment'||note.currency!=='usd'||note.invoice!==invoice.id)continue;
    const links=note.refunds??(note.refund?[{refund:note.refund,amount:note.amount}]:[]);
    if(!links.length||note.credit_amount>0||note.out_of_band_amount>0||links.reduce((sum:number,r:{amount:number})=>sum+cents(r.amount),0)!==note.amount)continue;
    if(!links.every((r:{refund:string|{id:string};amount:number})=>{const id=typeof r.refund==='string'?r.refund:r.refund?.id;return refunds.has(id)&&cents(r.amount)>0&&refunds.get(id)!.amount>=r.amount;}))continue;
    for(const r of links){const id=typeof r.refund==='string'?r.refund:r.refund.id,covered=(coveredRefunds.get(id)??0)+cents(r.amount);if(covered>refunds.get(id)!.amount)throw Error('Credit notes exceed the successful refund evidence.');coveredRefunds.set(id,covered);}
    creditVerified=true;
    const noteTax=new Map<string,number>();for(const line of note.tax_amounts??[]){const rate=taxRateId(line.tax_rate);if(!breakdown.has(rate))throw Error('Credit note tax does not match its invoice jurisdiction.');noteTax.set(rate,(noteTax.get(rate)??0)+cents(line.amount));refundTax.set(rate,(refundTax.get(rate)??0)+cents(line.amount));}
    const noteTime=unixTime(note.effective_at??note.created);refundAt=Math.max(refundAt??0,noteTime);
    if(!/^cn_[A-Za-z0-9]+$/.test(note.id))throw Error('The tax credit note needs a verified identifier.');
    creditNotes.push({id:note.id,occurred_at:new Date(noteTime*1000).toISOString(),amount_cents:cents(note.amount),tax_breakdown:[...noteTax].map(([tax_rate_id,tax_cents])=>({tax_rate_id,tax_cents}))});
   }
   if(!list.has_more)break;cursor=list.data?.at(-1)?.id;if(!cursor||page===99)throw Error('Credit notes could not be loaded completely.');
  }
 }
 const {data,error}=await marketServiceClient().rpc('market_tax_record_invoice',{p_invoice:{invoice_id:invoice.id,purchase_id:purchase.id,account_id:config.accountId,amount_cents:invoice.amount_paid,subtotal_cents:invoice.total_excluding_tax,tax_cents:[...breakdown.values()].reduce((sum,line)=>sum+line.tax_cents,0),refunded_cents:refunded,refunds_reconciled_cents:[...coveredRefunds.values()].reduce((sum,amount)=>sum+amount,0),currency:'usd',automatic_tax:true,country:address!.country,state:address!.state??null,tax_breakdown:[...breakdown.values()],occurred_at:new Date((invoice.status_transitions?.paid_at??invoice.created)*1000).toISOString(),credit_notes:creditNotes,...(creditVerified?{refund_tax_breakdown:[...refundTax].map(([tax_rate_id,tax_cents])=>({tax_rate_id,tax_cents}))}:{}),refund_occurred_at:refundAt?new Date(refundAt*1000).toISOString():null}});
 if(error)throw Error('Verified payment tax could not be recorded. Reconciliation will retry.');return data;
}
