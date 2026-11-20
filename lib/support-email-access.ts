import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import {getPublicAppOrigin} from "@/lib/public-app-url";
import {getSupportEmailConfig,sendSupportEmail,supportEmailReady} from "@/lib/support-email";
function signature(id:string,expires:number){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error("Support unavailable.");return createHmac("sha256",key).update(`support-email-access:${id}:${expires}`).digest("hex");}
export function supportEmailAccessUrl(id:string,now=Date.now()) {
 if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error("Invalid support request.");
 const expires=Math.floor(now/1000)+86400;const url=new URL("/api/support/access",getPublicAppOrigin());url.searchParams.set("thread",id);url.searchParams.set("expires",String(expires));url.searchParams.set("signature",signature(id,expires));return url.href;
}
export function validSupportEmailAccess(id:string,expires:number,provided:string,now=Date.now()) {
 if(!/^[a-f0-9-]{36}$/i.test(id)||!Number.isSafeInteger(expires)||expires<=now/1000||expires>now/1000+86400||!/^[a-f0-9]{64}$/.test(provided))return false;
 const expected=signature(id,expires);return timingSafeEqual(Buffer.from(expected),Buffer.from(provided));
}
export async function acknowledgeSupportRequest(input:{requestId:string;email:string;name:string;reference:string}) {
 try {const config=await getSupportEmailConfig();if(!supportEmailReady(config))return "unavailable";
 const result=await sendSupportEmail(config,{id:`support-ack-${input.requestId}`,to:input.email,name:input.name,subject:`Reylumi support · ${input.reference}`,body:`We received your request. Your reference is ${input.reference}. You can reply to this email at support@reylumi.com; please keep the reference in your reply. Our team will review your information. Never send your password or verification codes.\n\nYou can also open your support conversation on another browser using this private link, valid for 24 hours:\n${supportEmailAccessUrl(input.requestId)}\n\nThis link opens only this support conversation. It does not sign in to your Reylumi account.`});return result.status;
 }catch{return "unavailable";}
}
