'use server';
import {revalidatePath} from 'next/cache';
import {marketPluginContext} from '@/lib/market-plugins';
import {getCurrentBusinessContext} from '@/lib/current-context';
import {marketServiceClient} from '@/lib/market-payments';
import {decryptTwilioSettings,encryptTwilioSettings} from '@/lib/twilio-settings';
import {bookSmsState} from '@/lib/booksms';

export async function saveBookSms(form:FormData) {
 try {
  const {salonId}=await marketPluginContext();
  const context=await getCurrentBusinessContext();
  if(!context.user) throw new Error('Please sign in again.');
  const client=marketServiceClient();
  const {data:old,error:readError}=await client.from('booksms_subscriptions').select('encrypted_config').eq('salon_id',salonId).maybeSingle();
  if(readError) throw new Error('BookSMS settings could not be loaded.');
  const value=(key:string)=>String(form.get(key)??'').trim();
  const token=value('authToken')||(old?.encrypted_config?decryptTwilioSettings(old.encrypted_config).authToken:'');
  const installed=form.has('installed'),enabled=form.has('enabled');
  const config={accountSid:value('accountSid'),authToken:token,verifyServiceSid:'',messagingServiceSid:value('messagingServiceSid'),from:value('from'),enabled,claimSms:false,claimVoice:false};
  if(enabled && (!/^AC[0-9a-f]{32}$/i.test(config.accountSid)|| !/^[0-9a-f]{32}$/i.test(token)|| !(config.messagingServiceSid || config.from))) throw new Error('Enter valid Twilio credentials and an SMS sender before enabling delivery.');
  if(config.messagingServiceSid && !/^MG[0-9a-f]{32}$/i.test(config.messagingServiceSid)) throw new Error('Enter a valid Messaging Service SID.');
  if(config.from && !/^\+[1-9]\d{7,14}$/.test(config.from)) throw new Error('Enter a sender phone with country code.');
  const {error}=await client.rpc('booksms_save',{p_actor:context.user.id,p_salon:salonId,p_installed:installed,p_encrypted:encryptTwilioSettings(config),p_public:{enabled,confirmation:form.has('confirmation'),reminders:form.has('reminders'),accountSid:config.accountSid,messagingServiceSid:config.messagingServiceSid,from:config.from,tokenConfigured:Boolean(token)}});
  if(error) throw new Error(error.message);
  revalidatePath('/market'); revalidatePath('/bookings'); revalidatePath('/settings');
  return {state:await bookSmsState(),message:'BookSMS settings saved.'};
 } catch(error) {return {error:error instanceof Error?error.message:'BookSMS settings could not be saved.'};}
}
