"use server";
import { updateCurrentSalonProfileIdentity, getCurrentSalonProfileIdentitySettings } from "@/lib/salon-profile";
import { withSettingsTarget } from "@/lib/settings-target-context";
import { getCurrentBusinessContext, isOwnerMembership } from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { getCurrentSalonSetting } from "@/lib/salon-settings";
import { refreshCurrentSalonMapLocation } from "@/lib/location/salon-map-location";
import { updateStaffPublicTeamBatchAction, generateCurrentSalonBackupAction, type PublicTeamBatchUpdate } from "@/app/salon-settings/actions";
import { saveTodayQuickAccesses } from "@/lib/today-quick-accesses";
import { runBookingStatusAction } from "@/app/bookings/actions";
import { cancelPosTicket } from "@/app/pos-tickets/actions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function refreshSettingsMap(salonId:string){return withSettingsTarget(salonId,async()=>{try{const {context,setting}=await getCurrentSalonSetting();if(!setting)throw new Error("Salon information could not be loaded.");const map=await refreshCurrentSalonMapLocation({context,setting,reason:"manual_refresh"});if(!map.coordinates)throw new Error(map.statusDescription);revalidatePath("/explore");return {ok:true as const};}catch(e){return {ok:false as const,error:e instanceof Error?e.message:"Could not update the map location."};}},"manage");}
export async function saveSettingsPublicTeam(salonId:string,updates:PublicTeamBatchUpdate[]){return withSettingsTarget(salonId,async()=>{const result=await updateStaffPublicTeamBatchAction(updates);return result.error?{ok:false as const,error:result.error}:{ok:true as const};},"manage");}
export async function saveSettingsShortcuts(salonId:string,ids:string[]){return withSettingsTarget(salonId,async()=>{try{await saveTodayQuickAccesses(await getCurrentBusinessContext(),ids);revalidatePath("/staff/today");return {ok:true as const};}catch(e){return {ok:false as const,error:e instanceof Error?e.message:"Could not save shortcuts."};}},"manage");}
export async function downloadSettingsSalonBackup(salonId:string){return withSettingsTarget(salonId,generateCurrentSalonBackupAction,"manage");}
export async function resolveSettingsClosureRecord(salonId:string,input:{kind:"booking"|"ticket";id:string;updatedAt:string;action?:"cancel"|"complete";reason:string;confirmed:boolean}){
 return withSettingsTarget(salonId,async()=>{try{
  const context=await getCurrentBusinessContext();
  if(!isOwnerMembership(context.currentMembership)||!input.confirmed)throw new Error("Confirm this action as a salon owner.");
  if(!input.reason.trim())throw new Error("Enter a reason for this change.");
  const client=await createAuthenticatedSupabaseServerClient();if(!client)throw new Error("Your session is unavailable.");
  const record=await client.from(input.kind==="booking"?"bookings":"pos_tickets").select("id,updated_at").eq("id",input.id).eq("salon_id",salonId).maybeSingle();
  if(record.error||!record.data)throw new Error("This record is no longer available in this salon.");
  if(record.data.updated_at!==input.updatedAt)throw new Error("This record changed. Reload the panel before continuing.");
  if(input.kind==="booking"){
   const result=await runBookingStatusAction({bookingId:input.id,expectedUpdatedAt:input.updatedAt,command:input.action==="complete"?"complete":"cancel",reason:input.reason});
   if(!result.ok)throw new Error(result.message);
  }else{
   await requirePermission("tickets.manage",context);
   const form=new FormData();form.set("ticket_id",input.id);form.set("note",input.reason);form.set("expected_updated_at",input.updatedAt);await cancelPosTicket(form);
  }
  revalidatePath("/settings");return {ok:true as const};
 }catch(e){return {ok:false as const,error:e instanceof Error?e.message:"Could not resolve this record."};}},"manage");
}

export async function saveSettingsProfileIdentity(salonId:string, form:FormData){return withSettingsTarget(salonId,async()=>{try{
 const setting=await getCurrentSalonProfileIdentitySettings();
 await updateCurrentSalonProfileIdentity({salonId,businessName:setting.business_name,description:setting.business_description,phone:setting.phone,email:setting.email,website:setting.website,tagline:String(form.get('tagline')||'').trim()||null,story:String(form.get('story')||'').trim()||null,logoImagePath:String(form.get('logo_path')||'')||null,coverImagePath:String(form.get('cover_path')||'')||null,removeLogoImage:form.get('remove_logo')==='true',removeCoverImage:form.get('remove_cover')==='true'});
 revalidatePath('/salon-profile');revalidatePath(`/explore/salons/${salonId}`);return {ok:true as const};
 }catch(e){return {ok:false as const,error:e instanceof Error?e.message:'Could not save profile identity.'};}},'manage');}
