import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export type TwilioSettings = {accountSid:string;authToken:string;verifyServiceSid:string;messagingServiceSid:string;from:string;enabled:boolean;claimSms:boolean;claimVoice:boolean};
const env=(...names:string[])=>names.map(name=>process.env[name]?.trim()).find(Boolean)??'';
export function twilioSettingsClient() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key) throw new Error('Messaging settings are unavailable.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function encryptionKey() {
 const key=Buffer.from(process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY??'','base64');
 if(key.length!==32) throw new Error('The server encryption key is not configured.');
 return key;
}
export function encryptTwilioSettings(config:TwilioSettings) {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
 const body=Buffer.concat([cipher.update(JSON.stringify(config),'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join('.');
}
export function decryptTwilioSettings(value:string):TwilioSettings {
 const [version,iv,tag,body]=value.split('.');
 if(version!=='v1') throw new Error('Unsupported settings format.');
 const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64'));
 cipher.setAuthTag(Buffer.from(tag,'base64'));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(body,'base64')),cipher.final()]).toString('utf8'));
}
export async function getTwilioSettings():Promise<TwilioSettings> {
 if(process.env.SUPABASE_SERVICE_ROLE_KEY) {
 const {data,error}=await twilioSettingsClient().from('platform_twilio_settings').select('encrypted_config').eq('id',true).maybeSingle();
 if(error) throw new Error('Could not load messaging settings.');
 if(data) return decryptTwilioSettings(data.encrypted_config);
 }
 return {accountSid:env('REYLUMI_TWILIO_ACCOUNT_SID','TWILIO_ACCOUNT_SID'),authToken:env('REYLUMI_TWILIO_AUTH_TOKEN','TWILIO_AUTH_TOKEN'),verifyServiceSid:env('REYLUMI_TWILIO_VERIFY_SERVICE_SID','TWILIO_VERIFY_SERVICE_SID'),messagingServiceSid:env('REYLUMI_TWILIO_MESSAGING_SERVICE_SID','TWILIO_MESSAGING_SERVICE_SID'),from:env('REYLUMI_TWILIO_FROM','TWILIO_FROM'),enabled:true,claimSms:true,claimVoice:true};
}
export function publicTwilioSettings(config:TwilioSettings) {
 const {authToken,...safe}=config;
 return {...safe,tokenConfigured:Boolean(authToken)};
}
export async function testTwilioConnection(config:TwilioSettings) {
 const response=await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(config.verifyServiceSid)}`,{headers:{Authorization:`Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!response.ok) throw new Error('Twilio connection failed. Check the account, token and Verify service.');
 const data=await response.json() as {friendly_name:string;code_length:number;dtmf_input_required:boolean};
 if(data.code_length!==6 || (config.claimVoice && !data.dtmf_input_required)) throw new Error('Verify must use six-digit codes and require a keypad response for calls.');
 return data.friendly_name;
}
