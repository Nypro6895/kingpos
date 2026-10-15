import "server-only";
import {createAuthenticatedSupabaseServerClient} from "@/lib/supabase/server";
import {supportServiceClient} from "@/lib/support-server";
export type SupportCaseItem={id:string;reference:string;summary:string;status:string;updated_at:string};
export type SupportConversation={id:string;reference:string;summary:string;category:string;status:string;resolution:string|null;context:Record<string,string>;messages:{id:string;sender:"user"|"support";body:string;created_at:string}[];attachments:{id:string;path:string;name:string;url?:string}[];admin_view:boolean;can_reply?:boolean;review?:{kind:"claim"|"post_report";id:string;status:string}|null};
export async function supportRpc<T>(name:string,args:Record<string,unknown>={},signAttachments=true) {
 const client=await createAuthenticatedSupabaseServerClient();
 if(!client) return null;
 const {data,error}=await client.rpc(name,args);if(error) throw new Error(error.message);
 if(signAttachments&&name==="get_support_conversation")await signSupportAttachments(data);
 return data as T;
}
export async function signSupportAttachments(data:SupportConversation) {
 if(!data?.attachments?.length)return;
 const {data:signed,error}=await supportServiceClient().storage.from("support-evidence").createSignedUrls(data.attachments.map(a=>a.path),600);
 if(error)throw new Error("Evidence unavailable.");
 for(const a of data.attachments)a.url=signed?.find(s=>s.path===a.path)?.signedUrl??undefined;
}
