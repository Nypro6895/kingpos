import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createAuthenticatedSupabaseServerClient } from "./supabase/server";
import { getSalonOwnerRoster } from "./owner-transfer";
export async function getSettingsOwnerHistory(salonId:string) {
 // Authorize with the owner-only database RPC before reading historical identities.
 await getSalonOwnerRoster(salonId);
 const client=await createAuthenticatedSupabaseServerClient();
 if(!client)throw new Error("Your session is unavailable.");
 const {data,error}=await client.from("salon_lifecycle_events").select("id,created_at,reason,metadata").eq("salon_id",salonId).eq("event_type","OWNER_REMOVED").order("created_at",{ascending:false});
 if(error)throw new Error(error.message);
 const events=(data??[]) as {id:string;created_at:string;reason:string|null;metadata:{removed_user_id?:string}}[];
 const ids=[...new Set(events.map(e=>e.metadata?.removed_user_id).filter((id):id is string=>Boolean(id)))];
 if(!ids.length)return [];
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const identities=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):client;
 const users=await identities.from("users").select("id,email,display_name").in("id",ids);
 if(users.error)throw new Error("Could not load the former owners' account details.");
 return events.map(e=>{const user=users.data?.find(u=>u.id===e.metadata?.removed_user_id);return {id:e.id,date:e.created_at,reason:e.reason,accountId:e.metadata?.removed_user_id??null,name:user?.display_name??null,email:user?.email??null};});
}
