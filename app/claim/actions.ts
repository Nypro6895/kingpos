'use server';

import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {revalidatePath} from 'next/cache';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentKingUser} from '@/lib/users/current-user';
import {setCurrentManageSalonCookie} from '@/lib/current-context';
import {businessClaimMessagingReady,sendBusinessClaimCode,checkBusinessClaimCode} from '@/lib/business-claim-provider';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import type {BusinessClaimInput,BusinessClaimMatch,BusinessClaimRequest} from '@/lib/business-claims';

function serviceClient() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if (!url || !key) throw new Error('Phone verification and uploads are not available yet. You can still request support.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function actor() {
 const [user,client]=await Promise.all([getCurrentKingUser(),createAuthenticatedSupabaseServerClient()]);
 if (!user || user.status!=='active' || !client) throw new Error('Please sign in with an active account.');
 return {user,client};
}
const errorMessage=(error:unknown)=>error instanceof Error ? error.message : 'Could not complete your request. Please try again.';
function refreshClaim(salonId:string) {
 revalidatePath(`/claim/${salonId}`);revalidatePath(`/explore/salons/${salonId}`);revalidatePath('/salons');revalidatePath('/admin/claims');revalidatePath('/','layout');
}
export async function findBusinessClaimMatchesAction(input:BusinessClaimInput) {
 try {
 const {client}=await actor();
 const {data,error}=await client.rpc('find_business_claim_matches',{p_name:input.name,p_phone:input.phone,p_address:input.address,p_unit:input.unit,p_city:input.city,p_state:input.state});
 if (error) throw new Error('Could not check existing salons. Please try again.');
 return {matches:(data??[]) as BusinessClaimMatch[],error:null};
 } catch(error) {return {matches:[] as BusinessClaimMatch[],error:errorMessage(error)};}
}
export async function beginBusinessClaimAction(salonId:string,channel:'sms'|'call',authorized:boolean) {
 try {
 const {user}=await actor();
 if (authorized!==true || !['sms','call'].includes(channel)) throw new Error('Confirm that you own or are authorized to manage this salon.');
 if (!await businessClaimMessagingReady()) throw new Error('Phone verification is not available yet. Request support below.');
 const service=serviceClient();
 const {data,error}=await service.rpc('begin_business_claim',{p_salon:salonId,p_user:user.id,p_channel:channel});
 if (error) throw new Error(error.message);
 const reserved=data as {id:string;phone:string;last_sent_at:string};
 const sid=await sendBusinessClaimCode(reserved.phone,channel);
 const attached=await service.rpc('attach_business_claim_challenge',{p_request:reserved.id,p_user:user.id,p_sent_at:reserved.last_sent_at,p_sid:sid});
 if(attached.error || !attached.data) throw new Error('This request changed. Wait 60 seconds and request a new code.');
 refreshClaim(salonId);
 return {requestId:reserved.id,error:null};
 } catch(error) {return {requestId:null,error:errorMessage(error)};}
}
export async function confirmBusinessClaimAction(requestId:string,code:string) {
 try {
 const {user}=await actor();
 if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code.');
 const service=serviceClient();
 const reserved=await service.rpc('reserve_business_claim_check',{p_request:requestId,p_user:user.id});
 if (reserved.error) throw new Error(reserved.error.message);
 const challenge=reserved.data as {provider_sid:string;salon_id:string};
 if (!await checkBusinessClaimCode(challenge.provider_sid,code)) throw new Error('Incorrect code. Please try again.');
 const {data,error}=await service.rpc('confirm_business_claim',{p_request:requestId,p_user:user.id,p_sid:challenge.provider_sid});
 if(error) throw new Error(error.message);
 const result=data as {status:'approved'|'waiting';salon_id:string};
 if(result.status==='approved') await setCurrentManageSalonCookie(result.salon_id);
 refreshClaim(result.salon_id);
 return {status:result.status,error:null};
 } catch(error) {return {status:null,error:errorMessage(error)};}
}
export async function requestBusinessClaimSupportAction(salonId:string,form:FormData) {
 const uploaded:string[]=[];let service:ReturnType<typeof serviceClient>|null=null;
 try {
 const {user,client}=await actor();
 if(form.get('authorized')!=='yes') throw new Error('Confirm that you own or are authorized to manage this salon.');
 const files=form.getAll('attachments').filter((f):f is File=>typeof f!=='string' && f.size>0);
 if(files.length>3) throw new Error('Attach up to three files.');
 const reason=String(form.get('reason')??'').trim();
 if(reason.length<10 || reason.length>2000) throw new Error('Explain your connection to the salon and the phone issue (10–2000 characters).');
 const attachments:{path:string;name:string}[]=[];
 for(const file of files) {
 service??=serviceClient();
 if(file.size>5*1024*1024) throw new Error('Use JPG, PNG or PDF, up to 5 MB per file.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
 const png=bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10';
 const pdf=new TextDecoder().decode(bytes.slice(0,5))==='%PDF-';
 const type=jpeg?'image/jpeg':png?'image/png':pdf?'application/pdf':null;
 if(!type) throw new Error('Use JPG, PNG or PDF.');
 const path=`${user.id}/${salonId}/${randomUUID()}.${jpeg?'jpg':png?'png':'pdf'}`;
 const upload=await service.storage.from('business-claims').upload(path,bytes,{contentType:type,upsert:false});
 if(upload.error) throw new Error('Could not upload your document.');
 uploaded.push(path);attachments.push({path,name:file.name.slice(0,160)});
 }
 const {data,error}=await client.rpc('request_business_claim_support',{p_salon:salonId,p_reason:reason});
 if(error) throw new Error(error.message);
 if(attachments.length && service) {
 const updated=await service.rpc('attach_business_claim_documents',{p_request:String(data),p_user:user.id,p_documents:attachments});
 if(updated.error) throw new Error('Request saved, but documents could not be attached. Please try again.');
 }
 refreshClaim(salonId);return {error:null};
 } catch(error) {if(service && uploaded.length) await service.storage.from('business-claims').remove(uploaded);return {error:errorMessage(error)};}
}
export async function reviewBusinessClaimAction(form:FormData) {
 await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus);
 const {client}=await actor();
 const requestId=String(form.get('request_id')??'');
 const {data}=await client.rpc('get_business_claim_requests',{});
 const row=(data as BusinessClaimRequest[]|null)?.find(r=>r.id===requestId);
 const {error}=await client.rpc('review_business_claim',{p_request:requestId,p_decision:String(form.get('decision')??''),p_reason:String(form.get('reason')??'')});
 if(error)return {error:error.message};
 if(row)refreshClaim(row.salon_id);
 return {error:null};
}
export async function businessClaimAttachmentAction(requestId:string,path:string) {
 await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
 const {client}=await actor();const {data,error}=await client.rpc('get_business_claim_requests',{});
 const row=(data as BusinessClaimRequest[]|null)?.find(r=>r.id===requestId);
 if(error || !row?.attachments.some(file=>file.path===path))throw new Error('Document is unavailable.');
 const {data:link,error:linkError}=await serviceClient().storage.from('business-claims').createSignedUrl(path,60);
 if(linkError)throw new Error('Could not open document.');return link.signedUrl;
}
export async function openClaimedSalonAction(salonId:string) {
 const {user,client}=await actor();
 const {data,error}=await client.rpc('get_business_claim_requests',{p_salon:salonId});
 if(error || !(data as BusinessClaimRequest[]).some(r=>r.status==='approved' && r.applicant_user_id===user.id))return {error:'You do not have an approved claim for this salon.'};
 // Membership, not the historic claim, remains the authority for access.
 const membership=await client.from('salon_memberships').select('id').eq('salon_id',salonId).eq('user_id',user.id).eq('status','active').maybeSingle();
 if(membership.error || !membership.data)return {error:'Your management access has changed. Contact the current owner.'};
 await setCurrentManageSalonCookie(salonId);revalidatePath('/','layout');return {error:null};
}
