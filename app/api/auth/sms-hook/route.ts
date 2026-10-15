import {verifyAuthSmsHook} from '@/lib/auth-sms-hook';
import {sendSystemSms} from '@/lib/system-sms';
import {twilioSettingsClient} from '@/lib/twilio-settings';

export async function POST(request:Request) {
 const secret=process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
 const body=await request.text();
 if(!secret || body.length>65536 || !verifyAuthSmsHook(body,request.headers,secret)) return Response.json({error:{http_code:401,message:'Unauthorized SMS hook.'}},{status:401});
 try {
  const event=JSON.parse(body) as {user?:{phone?:string};sms?:{otp?:string}};
  const phone=event.user?.phone, otp=event.sms?.otp;
  if(!phone || !otp || !/^\d{4,10}$/.test(otp)) return Response.json({error:{http_code:400,message:'Invalid SMS hook payload.'}},{status:400});
  const client=twilioSettingsClient(), id=request.headers.get('webhook-id')!;
  const {error:reserveError}=await client.from('auth_sms_hook_deliveries').insert({id});
  if(reserveError) {
   if(reserveError.code!=='23505') throw new Error('Hook delivery storage unavailable.');
   const {data,error}=await client.from('auth_sms_hook_deliveries').select('state').eq('id',id).single();
   if(error || data?.state!=='accepted') throw new Error('Hook delivery cannot be retried safely.');
   return Response.json({});
  }
  try {
   await sendSystemSms('authSms',phone.startsWith('+')?phone:`+${phone}`,`Your Reylumi verification code is ${otp}. Do not share this code.`);
   const {error}=await client.from('auth_sms_hook_deliveries').update({state:'accepted'}).eq('id',id);
   if(error) throw new Error('Hook outcome could not be stored.');
  } catch {
   await client.from('auth_sms_hook_deliveries').update({state:'unknown'}).eq('id',id);
   throw new Error('Hook delivery failed or is uncertain.');
  }
  return Response.json({});
 } catch { return Response.json({error:{http_code:503,message:'System verification SMS is temporarily unavailable.'}},{status:503}); }
}
