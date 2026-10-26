import {timingSafeEqual} from 'node:crypto';
import {marketServiceClient} from '@/lib/market-payments';
import {paymentConfig,paymentStripe} from '@/lib/platform-payment';
import {processCardEvent,syncCardSubscription,syncCardInvoice} from '@/lib/market-card';
import {refreshMarketTaxProvider} from '@/lib/market-tax';

export const maxDuration=300;
export async function GET(request:Request){
 const expected=process.env.CRON_SECRET?Buffer.from(`Bearer ${process.env.CRON_SECRET}`):null,actual=Buffer.from(request.headers.get('authorization')??'');
 if(!expected||actual.length!==expected.length||!timingSafeEqual(actual,expected))return Response.json({error:'Unauthorized'},{status:401});
 const config=await paymentConfig();if(!config.secretKey||config.mode!=='live')return Response.json({checked:0});
 const client=marketServiceClient(),started=Date.now();let checked=0,failed=0;
 try{await refreshMarketTaxProvider(config);}catch{failed++;}
 const {data:events,error}=await client.from('market_card_events').select('id').neq('status','processed').order('updated_at').limit(20);if(error)return Response.json({error:'Queue unavailable'},{status:503});
 for(const event of events??[]){if(Date.now()-started>240000)break;try{await processCardEvent(event.id);checked++;}catch{failed++;}}
 const {data:taxInvoices,error:taxError}=await client.from('market_tax_invoices').select('invoice_id').eq('reconciliation_required',true).order('updated_at').limit(10);
 if(taxError)failed++;
 for(const invoice of taxInvoices??[]){if(Date.now()-started>240000)break;try{await syncCardInvoice(invoice.invoice_id);checked++;}catch{failed++;}}
 const {data:purchases}=await client.from('market_card_purchases').select('id,session_id,subscription_id').not('status','in','(expired,canceled,refunded)').order('updated_at').limit(30);
 for(const purchase of purchases??[]){if(Date.now()-started>240000)break;try{let sub=purchase.subscription_id;if(!sub&&purchase.session_id){const session=await paymentStripe(`checkout/sessions/${purchase.session_id}`);sub=session.subscription;if(session.status==='expired')await client.from('market_card_purchases').update({status:'expired',updated_at:new Date().toISOString()}).eq('id',purchase.id).in('status',['creating','open']);}if(sub){await syncCardSubscription(sub);checked++;}}catch{failed++;}}
 return Response.json({checked,failed});
}
