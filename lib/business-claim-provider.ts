import 'server-only';
import {getTwilioSettings} from '@/lib/twilio-settings';

export async function businessClaimMessagingReady() {
 try {
 const c=await getTwilioSettings();
 return Boolean(c.enabled && (c.claimSms || c.claimVoice) && c.accountSid && c.authToken && c.verifyServiceSid && process.env.SUPABASE_SERVICE_ROLE_KEY);
 } catch {return false;}
}
async function verifyRequest(path: string, body: URLSearchParams) {
 const c=await getTwilioSettings();
 const {accountSid:sid,authToken:token,verifyServiceSid:service}=c;
 if(path==='Verifications' && (!c.enabled || (body.get('Channel')==='sms' ? !c.claimSms : !c.claimVoice))) throw new Error('This delivery method is disabled. Try another method or request support.');
 if (!sid || !token || !service) throw new Error('Phone verification is not available yet. You can request support below.');
 const response=await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${path}`, {
 method:'POST',body,signal:AbortSignal.timeout(15000),
 headers:{Authorization:`Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},
 });
 const data=await response.json() as {sid?: string; status?: string; code?: number};
 if (!response.ok) {
 if (data.code===60200 || data.code===21614) throw new Error('SMS is unavailable for this number. Try a phone call or request support.');
 if (data.code===60203 || data.code===60202 || response.status===429) throw new Error('Too many attempts. Wait before requesting another code.');
 if (response.status===404) throw new Error('The code expired. Request another code.');
 throw new Error('Could not verify with the phone provider. Try another delivery method or request support.');
 }
 return data;
}
export async function sendBusinessClaimCode(phone: string, channel: 'sms'|'call') {
 const data=await verifyRequest('Verifications',new URLSearchParams({To:phone,Channel:channel}));
 if (!data.sid || data.status!=='pending') throw new Error('Could not start phone verification. Request support or try again later.');
 return data.sid;
}
export async function checkBusinessClaimCode(providerSid: string, code: string) {
 const data=await verifyRequest('VerificationCheck',new URLSearchParams({VerificationSid:providerSid,Code:code}));
 return data.status==='approved' && data.sid===providerSid;
}
