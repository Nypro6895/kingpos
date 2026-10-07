"use server";
import { withSettingsTarget } from "@/lib/settings-target-context";

import { createHash,randomInt,randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { getCurrentBusinessContext } from '@/lib/current-context';
import { createAuthenticatedSupabaseServerClient } from '@/lib/supabase/server';
import { normalizePhoneForIdentity } from '@/lib/phone-normalization';
import { bookingMessageReadiness,sendBookingMessage } from '@/lib/booking-notifications';
import { requirePlatformAdmin } from '@/lib/platform-admin/auth';
import { PLATFORM_ADMIN_PERMISSIONS } from '@/lib/platform-admin/permissions';
import type { SalonVerificationRequest } from '@/lib/salon-identity';
function serviceClient() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if (!url || !key) throw new Error('Salon verification messaging is not configured yet.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function owner(expectedSalonId?: string) {
 const context=await getCurrentBusinessContext();
 if (!context.user || !context.currentSalon) throw new Error('Choose your salon first.');
 if (expectedSalonId && context.currentSalon.id !== expectedSalonId) throw new Error("The selected salon changed. Reload these settings before saving.");
 const client=await createAuthenticatedSupabaseServerClient();
 if (!client) throw new Error('Please sign in.');
 // Database checks the actual active owner membership, not a client-provided role.
 const {data,error}=await client.rpc('get_salon_verification_requests',{p_salon:context.currentSalon.id});
 if (error) throw new Error('Only the salon owner can request verification.');
 return {client,salonId:context.currentSalon.id,userId:context.user.id,requests:(data??[]) as SalonVerificationRequest[]};
}
function message(error:unknown) { return error instanceof Error ? error.message : 'Could not complete verification.'; }
export async function loadSalonVerificationAction(expectedSalonId?: string) {
 return withSettingsTarget(expectedSalonId, async () => {
 try { const {requests}=await owner(expectedSalonId);return {requests,error:null}; } catch(error) { return {requests:[] as SalonVerificationRequest[],error:message(error)}; }

 }, "manage");
}
export async function beginSalonVerificationAction(form:FormData,expectedSalonId?: string) {
 return withSettingsTarget(expectedSalonId, async () => {
 const uploaded:string[]=[];
 let service:ReturnType<typeof serviceClient>|null=null;
 try {
  const {salonId,userId,requests}=await owner(expectedSalonId);
  service=serviceClient();
  if (!(await bookingMessageReadiness()).sms) throw new Error('SMS delivery is not configured yet. Please try again later.');
  const name=String(form.get('name')??'').trim(),address=String(form.get('address')??'').trim(),phone=normalizePhoneForIdentity(String(form.get('phone')??''));
  if(name.length<2 || name.length>160 || address.length<5 || address.length>500 || !phone) throw new Error('Enter the salon name, full address and a valid phone number.');
  const files=form.getAll('attachments').filter((f):f is File=>typeof f!=='string' && f.size>0);
  const previous=requests[0];
  if (files.length>3 || (files.length && (!previous || previous.attempt===1 && previous.status==='otp_pending'))) throw new Error('Attachments are available when reapplying. Maximum three files.');
  const attachments:{path:string;name:string}[]=[];
  for (const file of files) {
   const bytes=new Uint8Array(await file.arrayBuffer());
   const jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
   const png=bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10';
   const pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
   const type=jpeg?'image/jpeg':png?'image/png':pdf?'application/pdf':null;
   if (!type || file.size>5*1024*1024) throw new Error('Use JPG, PNG or PDF, up to 5 MB per file.');
   const path=`${salonId}/${randomUUID()}.${jpeg?'jpg':png?'png':'pdf'}`;
   const {error}=await service.storage.from('salon-verification').upload(path,bytes,{contentType:type,upsert:false});
   if (error) throw new Error('Could not upload attachment.');
   uploaded.push(path);attachments.push({path,name:file.name.slice(0,160)});
  }
  const code=String(randomInt(0,1000000)).padStart(6,'0');
  const {data,error}=await service.rpc('begin_salon_verification',{p_salon:salonId,p_user:userId,p_name:name,p_address:address,p_phone:phone,p_hash:createHash('sha256').update(`${phone}:${code}`).digest('hex'),p_attachments:attachments});
  if (error) throw new Error(error.message);
  const delivery=await sendBookingMessage({id:String(data),channel:'sms',recipient:phone,message:`Your Reylumi salon verification code is ${code}. It expires in 10 minutes. Do not share this code.`});
  if (delivery.state!=='accepted') {
   await service.from('salon_verification_requests').update({otp_hash:null,otp_expires_at:new Date().toISOString()}).eq('id',data);
   throw new Error('Could not confirm SMS delivery. Wait 60 seconds, then request another code.');
  }
  return {requestId:String(data),error:null};
 } catch(error) {
  if (service && uploaded.length) await service.storage.from('salon-verification').remove(uploaded);
  return {requestId:null,error:message(error)};
 }

 }, "manage");
}
export async function confirmSalonVerificationAction(requestId:string,code:string,expectedSalonId?: string) {
 return withSettingsTarget(expectedSalonId, async () => {
 try { const {client}=await owner(expectedSalonId);const {data,error}=await client.rpc('confirm_salon_verification',{p_request:requestId,p_code:code});if(error) throw new Error('Could not verify code.');if(!data?.ok) throw new Error(data?.message??'Invalid code.');revalidatePath('/salon-profile');return {error:null}; } catch(error) {return {error:message(error)};}

 }, "manage");
}
export async function reviewSalonVerificationAction(form:FormData) {
 await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus);
 const client=await createAuthenticatedSupabaseServerClient();
 if (!client) return {error:'Please sign in.'};
 const requestId=String(form.get('request_id')??'');
 const {data:rows}=await client.rpc('get_salon_verification_requests',{});
 const request=(rows as SalonVerificationRequest[]|null)?.find(row=>row.id===requestId);
 const {error}=await client.rpc('review_salon_verification',{p_request:String(form.get('request_id')??''),p_decision:String(form.get('decision')??''),p_reason:String(form.get('reason')??'')});
 if(error) return {error:error.message};
 revalidatePath('/admin/verification');revalidatePath('/explore');revalidatePath('/salon-profile');
 if(request)revalidatePath(`/explore/salons/${request.salon_id}`);
 return {error:null};
}
export async function salonVerificationAttachmentAction(requestId:string,path:string) {
 await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
 const client=await createAuthenticatedSupabaseServerClient();
 const {data,error}=await client!.rpc('get_salon_verification_requests',{});
 const request=(data as SalonVerificationRequest[]|null)?.find(row=>row.id===requestId);
 if(error || !request?.attachments.some(file=>file.path===path)) throw new Error('Attachment not found.');
 const result=await serviceClient().storage.from('salon-verification').createSignedUrl(path,60);
 if(result.error) throw new Error('Could not open attachment.');
 return result.data.signedUrl;
}
