import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import type { KingUser } from "@/types/user";
const COOKIE="account-phone-change";
const TTL=10*60;
type Proof={userId:string;authId:string|null;oldPhone:string|null;newPhone:string|null;expires:number;verified:boolean};
function signature(payload:string){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error("Phone change verification is unavailable. Please try again later.");return createHmac("sha256",key).update("account-phone-change:"+payload).digest("base64url");}
export async function writePhoneChangeProof(user:KingUser,newPhone:string|null,verified:boolean){
 const proof:Proof={userId:user.id,authId:user.auth_user_id,oldPhone:normalizePhoneForIdentity(user.phone),newPhone,expires:Date.now()+TTL*1000,verified};
 const payload=Buffer.from(JSON.stringify(proof)).toString("base64url");
 (await cookies()).set(COOKIE,payload+"."+signature(payload),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:TTL});
}
export async function readPhoneChangeProof(user:KingUser,newPhone:string|null){
 try{const value=(await cookies()).get(COOKIE)?.value||"";const [payload,sig]=value.split(".");if(!payload||!sig)return null;const expected=signature(payload);if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
 const proof:Proof=JSON.parse(Buffer.from(payload,"base64url").toString());return proof.userId===user.id&&proof.authId===user.auth_user_id&&proof.oldPhone===normalizePhoneForIdentity(user.phone)&&proof.newPhone===newPhone&&proof.expires>Date.now()?proof:null;
 }catch{return null;}
}
export async function phoneChangeAuthorized(user:KingUser,newPhone:string|null){const oldPhone=normalizePhoneForIdentity(user.phone);return !oldPhone||oldPhone===newPhone||Boolean((await readPhoneChangeProof(user,newPhone))?.verified);}
