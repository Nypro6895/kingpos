import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { getSupportEmailConfig, sendSupportEmail, supportEmailReady } from "@/lib/support-email";
import { getPublicAppOrigin } from "@/lib/public-app-url";
import { assertUuid, readReason, readRequiredFormString } from "@/lib/platform-admin/validation";
import type { UserOperationResult } from "@/types/admin-users-workspace";

export function recoveryTokenDigest(token: string) { return createHash("sha256").update(token).digest("hex"); }
export async function sendRecoveryContactVerification(form: FormData): Promise<UserOperationResult> {
  const caseId=assertUuid(readRequiredFormString(form,"case_id","Recovery case"));
  const userId=assertUuid(readRequiredFormString(form,"user_id","User"));
  const requestId=assertUuid(readRequiredFormString(form,"request_id","Request"));
  const config=await getSupportEmailConfig();
  if(!supportEmailReady(config)) throw new Error("Connect support email before verifying a recovery contact.");
  const token=randomBytes(32).toString("hex");
  const target=await callPlatformAdminRpc<{email:string;user_id:string}>("admin_recovery_contact_begin",{p_case:caseId,p_request:requestId,p_digest:recoveryTokenDigest(token),p_reason:readReason(form)});
  if(target.user_id!==userId) throw new Error("The recovery case belongs to a different user.");
  const url=new URL("/account-recovery/verify-contact",getPublicAppOrigin());url.searchParams.set("token",token);
  const sent=await sendSupportEmail(config,{id:`contact-${requestId}`,to:target.email,name:"there",subject:"Verify your Reylumi recovery email",body:`Confirm that you can access this email address using the link below. The link expires in 30 minutes. Confirming your email does not sign you in or give access to an account. Our team must separately verify account ownership.\n\n${url.href}\n\nIf you did not request account recovery, ignore this email and contact support@reylumi.com.`});
  return {ok:sent.status==="sent",userId,caseId,requestStatus:sent.status==="sent"?"accepted":sent.status,message:sent.status==="sent"?"Verification email accepted by the mail server. Ask the customer to open the link; inbox delivery is not yet confirmed.":sent.reason||"Email delivery is unconfirmed. Check provider logs before retrying."};
}
