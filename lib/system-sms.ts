import 'server-only';
import {getTwilioSettings} from '@/lib/twilio-settings';

export type SystemSmsPurpose = 'authSms' | 'loginAlerts' | 'salonVerification';
export async function systemSmsReady(purpose: SystemSmsPurpose) {
 try {
  if(purpose==='authSms' && !process.env.SUPABASE_SEND_SMS_HOOK_SECRET) return false;
  const c = await getTwilioSettings();
  return Boolean(c.enabled && c[purpose] !== false && c.accountSid && c.authToken && (c.messagingServiceSid || c.from));
 } catch { return false; }
}
export async function sendSystemSms(purpose: SystemSmsPurpose, phone: string, message: string) {
 const c = await getTwilioSettings();
 if (!c.enabled || c[purpose] === false || !c.accountSid || !c.authToken || !(c.messagingServiceSid || c.from)) throw new Error('System SMS is disabled or not configured.');
 if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('A phone number with country code is required.');
 const body = new URLSearchParams({To:phone,Body:message});
 if(c.messagingServiceSid) body.set('MessagingServiceSid',c.messagingServiceSid); else body.set('From',c.from);
 const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
  method:'POST', body, signal:AbortSignal.timeout(4000),
  headers:{Authorization:`Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},
 });
 if(!response.ok) throw new Error('System SMS provider rejected delivery.');
 const data = await response.json() as {sid?:string};
 return data.sid ?? null;
}
