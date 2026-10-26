import 'server-only';
import {marketServiceClient} from '@/lib/market-payments';
import {marketPluginContext} from '@/lib/market-plugins';
import {decryptTwilioSettings} from '@/lib/twilio-settings';
import {EMPTY_BOOKSMS,type BookSmsState} from '@/types/booksms';

export async function bookSmsState():Promise<BookSmsState> {
 const {client,salonId}=await marketPluginContext();
 const {data,error}=await client.rpc('booksms_owner_state',{p_salon:salonId});
 if(error) throw new Error('BookSMS settings are unavailable.');
 return {...EMPTY_BOOKSMS,...data};
}
export async function bookSmsConfig(salonId:string) {
 const {data,error}=await marketServiceClient().from('booksms_subscriptions').select('installed,paid_until,encrypted_config,monthly_limit').eq('salon_id',salonId).maybeSingle();
 if(error || !data?.installed || !data.paid_until || Date.parse(data.paid_until)<=Date.now() || !data.encrypted_config || data.monthly_limit<=0) return null;
 const config=decryptTwilioSettings(data.encrypted_config);
 return config.enabled && config.accountSid && config.authToken && (config.messagingServiceSid || config.from)?config:null;
}
