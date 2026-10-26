import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {supportServiceClient} from "./support-server";
import type {SupportConversation} from "./support-cases";
export function guestSupportToken(id:string) {
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error("Support unavailable.");
 return createHmac("sha256",key).update(`guest-support:${id}`).digest("hex");
}
export async function requireGuestSupport(id:string) {
 if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error("Request unavailable.");
 const token=(await cookies()).get(`support-case-${id}`)?.value;
 const expected=guestSupportToken(id);
 if(!token||token.length!==expected.length||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))throw new Error("Open this request in the browser where you submitted it.");
}
export async function getGuestSupport(id:string) {
 await requireGuestSupport(id);const {data,error}=await supportServiceClient().rpc("get_guest_support_conversation",{p_thread_id:id});
 if(error)throw new Error("Request unavailable.");
 const c=data as SupportConversation;await Promise.all(c.attachments.map(async a=>{const {data:s}=await supportServiceClient().storage.from("support-evidence").createSignedUrl(a.path,600);a.url=s?.signedUrl;}));return c;
}
