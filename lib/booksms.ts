import { marketAccessActive, marketPaidActive } from "@/lib/market-access";
import 'server-only';
import {marketServiceClient} from '@/lib/market-payments';
import {marketPluginContext} from '@/lib/market-plugins';
import {decryptTwilioSettings} from '@/lib/twilio-settings';
import {EMPTY_BOOKSMS,type BookSmsState} from '@/types/booksms';

export async function bookSmsState():Promise<BookSmsState> {
 const {client,salonId}=await marketPluginContext();
 const {data,error}=await client.rpc('booksms_owner_state',{p_salon:salonId});
 if(error) throw new Error('BookSMS settings are unavailable.');
 return {...EMPTY_BOOKSMS,...data,paid:marketPaidActive({paid_until:data?.paidUntil})};
}
export async function bookSmsConfig(salonId:string) {
 const {data,error}=await marketServiceClient().from('booksms_subscriptions').select('installed,paid_until,trial_ends_at,encrypted_config,monthly_limit').eq('salon_id',salonId).maybeSingle();
 if(error || !data?.installed || !marketAccessActive(data) || !data.encrypted_config || data.monthly_limit<=0) return null;
 const config=decryptTwilioSettings(data.encrypted_config);
 return config.enabled && config.accountSid && config.authToken && (config.messagingServiceSid || config.from)?config:null;
}
