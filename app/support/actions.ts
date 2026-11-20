"use server";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {supportServiceClient} from "@/lib/support-server";
import {randomUUID} from "node:crypto";
import {requireGuestSupport,getGuestSupport} from "@/lib/guest-support";
import {getRequestBusinessContext} from "@/lib/request-business-context";
import {sanitizeAuthReturnPath} from "@/lib/auth-routing";

async function rpc<T>(name:string,args:Record<string,unknown>={}) {
 const client=await createAuthenticatedSupabaseServerClient();
 if(!client) throw new Error("Please sign in to contact support.");
 const {data,error}=await client.rpc(name,args);
 if(error) throw new Error(error.message);
 return data as T;
}
export async function createSupportRequest(input:{requestId:string;category:string;summary:string;message:string;context:Record<string,string>}) {
 const context:Record<string,string>={};
 for(const key of ["path","module","expected","observed"]) if(input.context[key]) context[key]=input.context[key].slice(0,1000);
 if(context.path && (!context.path.startsWith("/")||context.path.startsWith("//"))) delete context.path;
 if(context.path)context.path=sanitizeAuthReturnPath(context.path);
 const workspace=await getRequestBusinessContext();
 context.workspace=workspace.workspaceType;
 if(workspace.currentSalon){context.salon_id=workspace.currentSalon.id;context.salon_name=workspace.currentSalon.name.slice(0,200);}
 const id=await rpc<string>("submit_user_support_case",{p_request_id:input.requestId,p_category:input.category,p_summary:input.summary,p_message:input.message,p_context:context});
 revalidatePath("/support"); revalidatePath("/admin/reports");
 return id;
}
export async function sendSupportMessage(id:string,body:string,reopen=false,requestId:string=randomUUID()) {
 await rpc("send_support_case_message_once",{p_report_id:id,p_body:body,p_reopen:reopen,p_request_id:requestId});
 revalidatePath(`/support/${id}`);revalidatePath(`/admin/reports/${id}`);revalidatePath("/support");revalidatePath("/admin/reports");
}
export async function reopenContentReportReview(caseId:string) {
 await rpc("reopen_content_report_review",{p_case_id:caseId});
 revalidatePath("/admin/post-safety");revalidatePath("/admin/reports");revalidatePath("/support","layout");
}
export async function sendGuestSupportMessage(id:string,body:string,reopen=false) {
 await requireGuestSupport(id);
 const {error}=await supportServiceClient().rpc("send_guest_support_message",{p_thread_id:id,p_body:body,p_reopen:reopen});
 if(error)throw new Error(error.message);
 revalidatePath(`/support/guest/${id}`);revalidatePath("/admin/reports");
}
export async function uploadSupportEvidence(form:FormData) {
 const id=String(form.get("caseId")||"");
 const guestId=String(form.get("guestThreadId")||"");
 if(guestId){const c=await getGuestSupport(guestId);if(c.id!==id)throw new Error("Request unavailable.");}else await rpc("get_support_conversation",{p_report_id:id});
 const file=form.get("file");
 if(!(file instanceof File)||file.size===0||file.size>5*1024*1024||!["image/png","image/jpeg","image/webp","application/pdf"].includes(file.type))throw new Error("Choose a PNG, JPG, WebP or PDF file up to 5 MB.");
 const bytes=new Uint8Array(await file.arrayBuffer());
 const valid=file.type==="image/png"?bytes[0]===137&&bytes[1]===80:file.type==="image/jpeg"?bytes[0]===255&&bytes[1]===216:file.type==="application/pdf"?new TextDecoder().decode(bytes.slice(0,5))==="%PDF-":new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
 if(!valid)throw new Error("The file format does not match its type.");
 const path=`${id}/${randomUUID()}`;const service=supportServiceClient();
 const {error}=await service.storage.from("support-evidence").upload(path,bytes,{contentType:file.type});if(error)throw new Error("Unable to upload evidence.");
 try{if(guestId){const {error}=await service.rpc("add_guest_support_attachment",{p_thread_id:guestId,p_path:path,p_name:file.name.slice(0,200)});if(error)throw new Error(error.message);}else await rpc("add_support_case_attachment",{p_report_id:id,p_path:path,p_name:file.name.slice(0,200)});}catch(e){await service.storage.from("support-evidence").remove([path]);throw e;}
 revalidatePath(`/support/${id}`);revalidatePath(`/admin/reports/${id}`);if(guestId)revalidatePath(`/support/guest/${guestId}`);
}
