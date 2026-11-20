import "server-only";
import {createAuthenticatedSupabaseServerClient,createSafetySupabaseServerClient} from "./supabase/server";
/** Same live viewer RPC used by moderation; no durable or cross-viewer cache. */
export async function readHiddenPostIdentities(){
 const client=await createAuthenticatedSupabaseServerClient() ?? await createSafetySupabaseServerClient();
 if(!client)throw Error("Unable to load hidden posts.");
 const {data,error}=await client.rpc("get_my_hidden_posts");
 if(error)throw Error("Unable to load hidden posts.");
 return(data??[]).map((row:{source_type:string;source_id:string})=>`${row.source_type}:${row.source_id}`);
}
