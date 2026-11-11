"use server";
import { recoveryTokenDigest } from "@/lib/recovery-completion";
import { supportServiceClient } from "@/lib/support-server";
export async function confirmRecoveryContact(form:FormData):Promise<{ok:boolean;message:string}> {
 const token=String(form.get("token")||"");
 if(!/^[a-f0-9]{64}$/.test(token)) return {ok:false,message:"This verification link is invalid or expired. Ask support for a new link."};
 const {data,error}=await supportServiceClient().rpc("confirm_recovery_contact",{p_digest:recoveryTokenDigest(token)});
 return {ok:!error&&data===true,message:!error&&data===true?"Your contact email is verified. Support will continue checking account ownership. This has not signed you in.":"This verification link is invalid, expired or already used. If you already confirmed it, support can check its status."};
}
