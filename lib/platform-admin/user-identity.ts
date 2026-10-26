import "server-only";
import { createClient } from "@supabase/supabase-js";
import { callPlatformAdminRpc } from "./rpc";
import { requirePlatformAdmin } from "./auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { assertUuid, readReason, readFormString, readRequiredFormString } from "./validation";
import { getPublicAppOrigin } from "@/lib/public-app-url";
import { getSupportEmailConfig, sendSupportEmail, supportEmailReady } from "@/lib/support-email";
import type { UserOperationResult } from "@/types/admin-users-workspace";

export function adminIdentityClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key) throw new Error("Authentication administration is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export function adminIdentityReady() { return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }

export async function runUserIdentity(form:FormData):Promise<UserOperationResult> {
  const operation=readRequiredFormString(form,"operation","Operation");
  const creating=operation==="create"||operation==="invite";
  await requirePlatformAdmin(creating?P.usersCreate:P.usersAuthManage);
  if(!creating) await requirePlatformAdmin(P.usersReadSensitive);
  if(["email_change","verify_email","reset_mfa","cancel_invite"].includes(operation))await requirePlatformAdmin(P.recoveryManage);
  const service=adminIdentityClient();
  const requestId=assertUuid(readRequiredFormString(form,"request_id","Request"));
  const userId=creating?null:assertUuid(readRequiredFormString(form,"user_id","User"));
  const email=readFormString(form,"email")?.toLowerCase()??null;
  const password=readFormString(form,"password");
  if(operation==="create" && (!password || password.length<12 || password.length>128)) throw new Error("Use a temporary password between 12 and 128 characters.");
  const payload:Record<string,string|null>={};
  if(creating) for(const key of ["display_name","first_name","last_name"]) payload[key]=readFormString(form,key);
  if(!creating) payload.case_id=readFormString(form,"case_id");
  const sendsEmail=["invite","resend_invite","password_reset"].includes(operation);
  const emailConfig=sendsEmail?await getSupportEmailConfig():null;
  if(emailConfig && !supportEmailReady(emailConfig)) throw new Error("Connect support email before sending authentication links.");
  const job=await callPlatformAdminRpc<{status:string;repeat:boolean;auth_user_id?:string;email?:string;user_id?:string}>("admin_user_identity_begin",{
    p_request_id:requestId,p_user_id:userId,p_operation:operation,p_email:email,p_payload:payload,p_reason:readReason(form),
  });
  if(job.repeat) return {ok:job.status==="accepted",message:job.status==="accepted"?"This request already completed.":"This request has already been recorded. Review its outcome before retrying.",userId:job.user_id,requestStatus:job.status};
  let authId=job.auth_user_id??null;
  let outcome:"accepted"|"failed"|"unknown"="unknown";
  let message="The authentication result could not be confirmed. Review provider logs before retrying.";
  try {
    if(operation==="create") {
      const response=await service.auth.admin.createUser({email:email!,password:password!,email_confirm:false,user_metadata:payload});
      if(response.error) {outcome=response.error.status && response.error.status<500?"failed":"unknown";message=response.error.message;}
      else {authId=response.data.user.id;outcome="accepted";message="User created. Email is unverified; verify ownership before confirming email.";}
    } else if(sendsEmail) {
      const targetEmail=email??job.email;
      if(!targetEmail) throw new Error("This account has no email address.");
      const type=operation==="password_reset"?"recovery":"invite";
      const redirectTo=new URL(type==="recovery"?"/reset-password":"/accept-invite",getPublicAppOrigin()).href;
      const response=await service.auth.admin.generateLink({type,email:targetEmail,options:{redirectTo,...(creating?{data:payload}:{})}});
      if(response.error) {outcome=response.error.status && response.error.status<500?"failed":"unknown";message=response.error.message;}
      else {
        authId=response.data.user.id;
        const sent=await sendSupportEmail(emailConfig!,{id:requestId,to:targetEmail,subject:type==="recovery"?"Reset your Reylumi password":"Your Reylumi invitation",name:payload.display_name||"there",body:`${type==="recovery"?"Choose a new password":"Accept your invitation and choose a password"} using this secure link:\n\n${response.data.properties.action_link}\n\nIf you did not request this, contact Reylumi Support.`});
        outcome=sent.status==="sent"?"accepted":sent.status;
        message=outcome==="accepted"?"Email accepted by the provider. Inbox delivery is not yet confirmed.":sent.reason||message;
        if(outcome==="accepted"&&operation==="resend_invite") {
          const resumed=await service.auth.admin.updateUserById(authId!,{ban_duration:"none"});
          if(resumed.error) throw resumed.error;
        }
      }
    } else if(operation==="reset_mfa") {
      const response=await service.auth.admin.mfa.listFactors({userId:authId!});
      if(response.error) throw response.error;
      for(const factor of response.data.factors) {
        const removed=await service.auth.admin.mfa.deleteFactor({userId:authId!,id:factor.id});
        if(removed.error) throw removed.error;
      }
      await callPlatformAdminRpc("admin_user_revoke_sessions",{p_user_id:userId,p_session_id:null,p_reason:readReason(form)});
      outcome="accepted";message="MFA factors removed and authentication sessions revoked. The user must enroll again.";
    } else if(["email_change","verify_email","cancel_invite"].includes(operation)) {
      const attributes=operation==="email_change"?{email:email!,email_confirm:true}:operation==="verify_email"?{email_confirm:true}:{ban_duration:"876000h"};
      const response=await service.auth.admin.updateUserById(authId!,attributes);
      if(response.error) {outcome=response.error.status && response.error.status<500?"failed":"unknown";message=response.error.message;}
      else {
        if(operation!=="verify_email") await callPlatformAdminRpc("admin_user_revoke_sessions",{p_user_id:userId,p_session_id:null,p_reason:readReason(form)});
        outcome="accepted";message=operation==="cancel_invite"?"Invitation cancelled. The authentication identity is blocked.":operation==="email_change"?"Verified recovery email applied. Sessions revoked.":"Email confirmed using the verified recovery case.";
      }
    } else throw new Error("Invalid identity operation.");
  } catch { outcome="unknown"; }
  const finished=await service.rpc("admin_user_identity_finish",{p_request_id:requestId,p_status:outcome,p_auth_user_id:authId});
  if(finished.error) return {ok:false,message:"The provider operation ran, but its local outcome could not be saved. Refresh and review before retrying.",requestStatus:"unknown"};
  return {ok:outcome==="accepted",message,userId:finished.data?.user_id??undefined,requestStatus:outcome};
}
