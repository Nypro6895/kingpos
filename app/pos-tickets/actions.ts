"use server";
import { getCurrentBusinessContext, isOwnerMembership, isSalonManageContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
const value = (form:FormData,key:string) => typeof form.get(key)==="string" ? String(form.get(key)).trim() : "";
const number = (form:FormData,key:string) => Number(value(form,key));
const uuid = (input:string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input) ? input : null;
function returnPath(form:FormData) {
 const path=value(form,"return_to");
 return /^\/pos-tickets(?:\/|\?|$)/.test(path) ? path : "/pos-tickets";
}
function fail(form:FormData,message:string):never {
 const path=returnPath(form);redirect(path+(path.includes("?")?"&":"?")+"error="+encodeURIComponent(message));
}
async function owner(form:FormData) {
 const context=await getCurrentBusinessContext();
 if(!context.user) redirect("/login");
 if(!context.currentSalon||!isSalonManageContext(context)||!isOwnerMembership(context.currentMembership)) fail(form,"Only the Owner can edit ticket inputs.");
 const supabase=await createAuthenticatedSupabaseServerClient();
 if(!supabase) fail(form,"This feature is temporarily unavailable.");
 return {context,salon:context.currentSalon,supabase};
}
function refreshed(form:FormData,salonId:string):never {
 for(const path of ["/pos-tickets","/reports","/payroll","/staff/today","/staff/my-work",returnPath(form)]) revalidatePath(path);
 after(()=>broadcastPosStaffChange(salonId,"pos"));redirect(returnPath(form));
}
async function mutate(form:FormData,operation:string,values:Record<string,unknown>,source?:"item"|"payment") {
 const {salon,supabase}=await owner(form);let ticketId=uuid(value(form,"ticket_id"));
 if(source&&!ticketId) {
  const id=uuid(value(form,source==="item"?"item_id":"payment_id"));
  if(!id) fail(form,"Reload the ticket before editing it.");
  if(source==="item") {
   const {data,error}=await supabase.from("pos_ticket_items").select("pos_ticket_id").eq("id",id).eq("salon_id",salon.id).maybeSingle();
   if(error||!data) fail(form,"Ticket item was not found in this salon.");ticketId=data.pos_ticket_id;
  } else {
   const {data,error}=await supabase.from("pos_payments").select("ticket_id").eq("id",id).eq("salon_id",salon.id).maybeSingle();
   if(error||!data) fail(form,"Payment was not found in this salon.");ticketId=data.ticket_id;
  }
 }
 const rawRevision=value(form,"expected_revision"),request=uuid(value(form,"request_id"));
 if(!ticketId||!request||!rawRevision||!Number.isSafeInteger(Number(rawRevision))||Number(rawRevision)<0) fail(form,"Reload this ticket before saving.");
 const note=value(form,"correction_reason")||value(form,"note");if(!note) fail(form,"Enter an edit note.");
 const {error}=await supabase.rpc("mutate_owner_ticket_inputs",{
  p_salon:salon.id,p_ticket:ticketId,p_expected:Number(rawRevision),p_request:request,p_operation:operation,p_values:values,p_note:note,
 });
 if(error) fail(form,error.message);refreshed(form,salon.id);
}
export async function createPosTicket(form:FormData) {
 const {salon,supabase}=await owner(form),request=uuid(value(form,"request_id"));
 if(!request) fail(form,"Reload this ticket form before creating it.");
 const {error}=await supabase.rpc("create_owner_open_ticket",{p_salon:salon.id,p_customer:uuid(value(form,"customer_id")),
  p_opened_at:value(form,"opened_at")||null,p_notes:value(form,"notes")||null,p_request:request});
 if(error) fail(form,error.message);refreshed(form,salon.id);
}
export async function updatePosTicketNotes(form:FormData) { return mutate(form,"notes",{notes:value(form,"notes")}); }
export async function updatePosTicketDiscount(form:FormData) { return mutate(form,"discount",{discount_type:value(form,"discount_type"),discount_value:number(form,"discount_value")}); }
export async function updatePosTicketTaxRate(form:FormData) { return mutate(form,"tax",{tax_rate:number(form,"tax_rate")}); }
export async function updatePosTicketTip(form:FormData) { return mutate(form,"tip",{tip_type:value(form,"tip_type"),tip_value:number(form,"tip_value")}); }
export async function closePosTicket(form:FormData) { return mutate(form,"checkout",{}); }
export async function cancelPosTicket(form:FormData) { return mutate(form,"cancel",{}); }
export async function voidPosTicket(form:FormData) { return mutate(form,"void",{}); }
export async function reopenPosTicket(form:FormData) { return mutate(form,"reopen",{}); }
export async function addPosTicketItem(form:FormData) { return mutate(form,"item_add",{service_id:uuid(value(form,"service_id"))}); }
export async function updatePosTicketItem(form:FormData) { return mutate(form,"item_update",{item_id:uuid(value(form,"item_id")),quantity:number(form,"quantity"),unit_price:number(form,"unit_price"),...(form.has("notes")?{notes:value(form,"notes")}:{})},"item"); }
export async function updatePosTicketItemStaff(form:FormData) { return mutate(form,"item_staff",{item_id:uuid(value(form,"item_id")),assigned_staff_id:uuid(value(form,"assigned_staff_id"))},"item"); }
export async function deletePosTicketItem(form:FormData) { return mutate(form,"item_remove",{item_id:uuid(value(form,"item_id"))},"item"); }
export async function addPosPayment(form:FormData) { return mutate(form,"payment_add",{amount:number(form,"amount"),payment_method:value(form,"payment_method")}); }
export async function deletePosPayment(form:FormData) { return mutate(form,"payment_remove",{payment_id:uuid(value(form,"payment_id"))},"payment"); }
function jsonArray(form:FormData,key:string):unknown[] {
 const raw=value(form,key);if(!raw)return [];const parsed:unknown=JSON.parse(raw);
 if(!Array.isArray(parsed)||parsed.length>100) throw Error("Review the ticket lines before saving.");return parsed;
}
export async function correctClosedPosTicketInline(form:FormData) {
 const {salon,supabase}=await owner(form);let inputs:Record<string,unknown>;
 try {
  const request=uuid(value(form,"request_id")),revision=value(form,"expected_revision");
  if(!request||!revision||!Number.isSafeInteger(Number(revision))) throw Error("Reload this ticket before saving.");
  inputs={p_key:null,p_signature:null,p_salon:salon.id,p_ticket:uuid(value(form,"ticket_id")),p_expected:Number(revision),p_request:request,
   p_item_updates:jsonArray(form,"item_updates"),p_item_parts:jsonArray(form,"item_parts"),p_added_items:jsonArray(form,"added_items"),
   p_staff_tip_overrides:jsonArray(form,"staff_tip_overrides"),p_tip_total:number(form,"tip_total"),p_reason:value(form,"correction_reason"),
   p_discount_type:value(form,"discount_type")||null,p_discount_value:value(form,"discount_value")?number(form,"discount_value"):null};
 } catch(error) { fail(form,error instanceof Error?error.message:"Review this ticket before saving."); }
 const {data,error}=await supabase.rpc("save_pos_ticket_inputs",inputs);
 if(error||!data?.ok) fail(form,error?.message||"Unable to save this ticket.");refreshed(form,salon.id);
}
// Stale bundles must refresh rather than create another legacy financial delta.
export async function correctClosedPosTicket(form:FormData) { return correctClosedPosTicketInline(form); }
export async function submitLockedStaffFinancialCorrection(form:FormData) { return correctClosedPosTicketInline(form); }

