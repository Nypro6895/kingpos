"use server";
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/types/platform-admin';
import {callPlatformAdminRpc} from '@/lib/platform-admin/rpc';
import {revalidatePath} from 'next/cache';
export async function manageCampaignAction(input:{id:string;expected:string;action:'edit'|'pause'|'resume'|'archive'|'approve'|'reject';title?:string;caption?:string;reason?:string}){
 await requirePlatformAdmin(P.advertisingReview);
 if(!/^[0-9a-f-]{36}$/i.test(input.id)||!['edit','pause','resume','archive','approve','reject'].includes(input.action)||!input.expected)return{ok:false,message:'Refresh the ad and retry.'};
 try{await callPlatformAdminRpc('admin_manage_campaign',{p_id:input.id,p_expected:input.expected,p_action:input.action,p_title:input.title??null,p_caption:input.caption??null,p_reason:input.reason??null});revalidatePath('/admin/plugins/campaigns');revalidatePath('/campaigns');revalidatePath('/admin');return{ok:true,message:input.action==='archive'?'Ad removed. Unused credits returned.':'Ad updated.'};}catch(error){return{ok:false,message:error instanceof Error?error.message:'Ad could not save.'};}
}
