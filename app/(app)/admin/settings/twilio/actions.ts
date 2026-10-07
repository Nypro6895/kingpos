'use server';
import {notFound} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import {encryptTwilioSettings,getTwilioSettings,publicTwilioSettings,testTwilioConnection,twilioSettingsClient,type TwilioSettings} from '@/lib/twilio-settings';

export async function saveTwilioSettingsAction(_previous:{message:string;ok:boolean},form:FormData) {
 const actor=await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.teamManage);
 if(actor.roleSlug!=='platform_owner') notFound();
 try {
 const old=await getTwilioSettings();
 const field=(name:string)=>String(form.get(name)??'').trim();
 const config:TwilioSettings={accountSid:field('accountSid'),authToken:field('authToken')||old.authToken,verifyServiceSid:field('verifyServiceSid'),messagingServiceSid:field('messagingServiceSid'),from:field('from'),enabled:form.has('enabled'),claimSms:form.has('claimSms'),claimVoice:form.has('claimVoice')};
 if(!/^AC[0-9a-f]{32}$/i.test(config.accountSid) || !/^VA[0-9a-f]{32}$/i.test(config.verifyServiceSid) || !/^[0-9a-f]{32}$/i.test(config.authToken)) throw new Error('Enter valid Twilio account, token and Verify service values.');
 if(config.messagingServiceSid && !/^MG[0-9a-f]{32}$/i.test(config.messagingServiceSid)) throw new Error('Enter a valid Messaging Service SID.');
 if(config.from && !/^\+[1-9]\d{7,14}$/.test(config.from)) throw new Error('Use a sender number with its country code.');
 const name=await testTwilioConnection(config);
 if(form.get('intent')==='test') return {ok:true,message:`Connected to ${name}. No SMS or call was sent.`};
 const {error}=await twilioSettingsClient().rpc('save_platform_twilio_settings',{p_actor:actor.userId,p_encrypted:encryptTwilioSettings(config),p_public:publicTwilioSettings(config)});
 if(error) throw new Error(error.message);
 revalidatePath('/admin/settings/twilio');
 return {ok:true,message:`Saved. Connected to ${name}.`};
 } catch(error) {return {ok:false,message:error instanceof Error?error.message:'Could not save Twilio settings.'};}
}
