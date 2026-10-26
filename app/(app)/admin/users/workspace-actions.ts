"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { adminIdentityClient, runUserIdentity } from "@/lib/platform-admin/user-identity";
import { assertUuid, readFormString, readReason, readRequiredFormString } from "@/lib/platform-admin/validation";
import { createPlatformAdminNote } from "@/lib/platform-admin/notes";
import { createPlatformAdminMembership, updatePlatformAdminMembership } from "@/lib/platform-admin/team";
import type { UserOperationResult } from "@/types/admin-users-workspace";
import { validateEvidenceFile, parseUserSelection } from "@/lib/admin-users-rules";

function refresh(id?:string) {for(const path of ["/admin/users","/admin","/admin/reports","/admin/team","/admin/businesses","/admin/locations",...(id?[`/admin/users/${id}`]:[])]) revalidatePath(path);}
export async function userWorkspaceAction(form:FormData):Promise<UserOperationResult> {
  try {
    await requirePlatformAdmin(P.usersRead);
    const operation=readRequiredFormString(form,"operation","Operation");
    if(["create","invite","resend_invite","cancel_invite","password_reset","email_change","verify_email","reset_mfa"].includes(operation)) {
      const result=await runUserIdentity(form);refresh(result.userId??readFormString(form,"user_id")??undefined);return result;
    }
    const id=assertUuid(readRequiredFormString(form,"user_id","User"));
    const reason=operation==="note"?"Internal note added from user administration":readReason(form);
    const args={p_user_id:id,p_reason:reason};
    let message="Changes saved.";let caseId:string|undefined;
    if(operation==="profile") {
      await requirePlatformAdmin(P.usersUpdate);
      const profile:Record<string,string|null>={};
      for(const field of ["display_name","first_name","last_name","language","timezone"]) profile[field]=readFormString(form,field);
      if(form.has("phone")) profile.phone=readFormString(form,"phone");
      await callPlatformAdminRpc("admin_user_profile_save",{...args,p_profile:profile,p_expected:readRequiredFormString(form,"expected_updated_at","Profile version")});
    } else if(operation==="note") {
      await requirePlatformAdmin(P.notesCreate);await createPlatformAdminNote({targetType:"user",targetId:id,body:readRequiredFormString(form,"body","Note"),reason});message="Internal note added.";
    } else if(operation==="notification") {
      await requirePlatformAdmin(P.notificationsSend);
      const result=await callPlatformAdminRpc<{status:string}>("send_platform_admin_notification",{...args,p_title:readRequiredFormString(form,"title","Title"),p_body:readRequiredFormString(form,"body","Message"),p_request_id:assertUuid(readRequiredFormString(form,"request_id","Request"))});
      message=result.status==="suppressed"?"Saved; notification preferences suppressed delivery.":"Delivered to the user's in-app inbox.";
    } else if(operation==="suspend"||operation==="restore") {
      await requirePlatformAdmin(operation==="suspend"?P.usersSuspend:P.usersRestore);
      await callPlatformAdminRpc("admin_set_user_access",{...args,p_suspend:operation==="suspend"});
      message=operation==="suspend"?"Account suspended and authentication sessions revoked.":"Account access restored.";
    } else if(operation==="revoke_sessions") {
      await requirePlatformAdmin(P.recoveryManage);
      const count=await callPlatformAdminRpc<number>("admin_user_revoke_sessions",{...args,p_session_id:readFormString(form,"session_id")?assertUuid(readFormString(form,"session_id")):null});
      message=`${count} authentication session(s) revoked. Existing access tokens may remain valid until expiry.`;
    } else if(operation==="membership") {
      await requirePlatformAdmin(P.usersMembershipsManage);
      await callPlatformAdminRpc("admin_user_membership_save",{...args,p_scope:readRequiredFormString(form,"scope","Scope"),p_entity_id:assertUuid(readRequiredFormString(form,"entity_id","Business / salon")),p_role:readRequiredFormString(form,"role","Role"),p_status:readRequiredFormString(form,"status","Status"),p_remove:form.get("remove")==="true"});
    } else if(operation==="transfer") {
      await requirePlatformAdmin(P.usersMembershipsManage);await requirePlatformAdmin(P.teamManage);
      if(form.get("confirmation")!=="TRANSFER") throw new Error("Type TRANSFER to confirm ownership transfer.");
      const [scope,entity]=readRequiredFormString(form,"owner_entity","Ownership scope").split(":");
      await callPlatformAdminRpc("admin_user_transfer_owner",{...args,p_recipient:assertUuid(readRequiredFormString(form,"recipient","New owner")),p_scope:scope,p_entity_id:assertUuid(entity),p_case_id:assertUuid(readRequiredFormString(form,"case_id","Verified case"))});message="Ownership transferred and recorded in audit history.";
    } else if(operation==="platform_role") {
      await requirePlatformAdmin(P.teamManage);
      const membership=readFormString(form,"membership_id"),role=readRequiredFormString(form,"role_slug","Platform role");
      if(membership) await updatePlatformAdminMembership({membershipId:membership,roleSlug:role,status:readRequiredFormString(form,"status","Status"),reason});
      else await createPlatformAdminMembership({userId:id,roleSlug:role,reason});
    } else if(operation==="schedule_deletion") {
      await requirePlatformAdmin(P.usersDelete);
      await callPlatformAdminRpc("schedule_platform_admin_user_deletion",{...args,p_confirmation:readFormString(form,"confirmation"),p_backup_acknowledged:form.get("backup_acknowledged")==="on"});message="Deletion scheduled with the 30-day grace period.";
    } else if(operation==="cancel_deletion") {
      await requirePlatformAdmin(P.usersDelete);await callPlatformAdminRpc("cancel_platform_admin_user_deletion",args);message="Pending deletion cancelled.";
    } else if(operation==="identity_review") {
      await requirePlatformAdmin(P.teamManage);await requirePlatformAdmin(P.usersAuthManage);
      await callPlatformAdminRpc("admin_user_identity_review",{...args,p_job_id:assertUuid(readRequiredFormString(form,"job_id","Identity operation")),p_outcome:readRequiredFormString(form,"outcome","Outcome")});message="Provider outcome recorded. No external action was repeated.";
    } else if(operation==="case_link") {
      await requirePlatformAdmin(P.reportsUpdate);await requirePlatformAdmin(P.recoveryManage);await requirePlatformAdmin(P.usersReadSensitive);
      caseId=await callPlatformAdminRpc<string>("admin_user_case_link",{...args,p_report_id:assertUuid(readRequiredFormString(form,"report_id","Existing case")),p_category:readRequiredFormString(form,"category","Case type")});message="Existing case linked to user recovery.";
    } else if(operation==="case") {
      await requirePlatformAdmin(P.recoveryManage);await requirePlatformAdmin(P.reportsRead);await requirePlatformAdmin(P.usersReadSensitive);
      const caseData:Record<string,unknown>={};
      for(const key of ["category","description","priority","assigned_membership_id","recovery_contact","verification_evidence","status","resolution","expected_updated_at"]) caseData[key]=readFormString(form,key);
      for(const key of ["identity_verified","contact_verified","ownership_verified","suspend","revoke"]) caseData[key]=form.get(key)==="on";
      const existing=readFormString(form,"case_id");
      await requirePlatformAdmin(existing?P.reportsUpdate:P.reportsCreate);
      const requestId=assertUuid(readRequiredFormString(form,"request_id","Request"));
      if(existing)assertUuid(existing);
      const files=form.getAll("evidence").filter((file):file is File=>file instanceof File&&file.size>0);
      if(files.length>3) throw new Error("Attach at most three evidence files per update.");
      if(files.reduce((size,file)=>size+file.size,0)>12*1024*1024) throw new Error("Keep total evidence uploads within 12 MB.");
      const attachments:Array<{path:string;name:string}>=[];
      if(existing) {
        const detail=await callPlatformAdminRpc<{cases:Array<{id:string;context:{attachments?:Array<{path:string;name:string}>}}> }>("admin_user_workspace",{p_user_id:id});
        const previous=detail.cases.find(item=>item.id===existing);
        if(!previous)throw new Error("Related recovery case not found.");
        attachments.push(...(previous.context.attachments??[]));
      }
      if(attachments.length+files.length>15) throw new Error("This case already has the maximum of 15 evidence files.");
      const prepared=await Promise.all(files.map(async file=>{const bytes=new Uint8Array(await file.arrayBuffer());return {file,bytes,ext:validateEvidenceFile(file,bytes)};}));
      if(files.length) {
        const service=adminIdentityClient();
        const uploaded:string[]=[];
        try {for(const {file,bytes,ext} of prepared) {
          const path=`${id}/${crypto.randomUUID()}.${ext}`;
          const {error}=await service.storage.from("admin-user-evidence").upload(path,bytes,{contentType:file.type,upsert:false});
          if(error) throw new Error("Evidence upload failed. Check storage configuration and retry.");
          uploaded.push(path);
          attachments.push({path,name:file.name.slice(0,150)});
        }}catch(error){if(uploaded.length)await service.storage.from("admin-user-evidence").remove(uploaded);throw error;}
      }
      caseData.attachments=attachments;
      caseId=await callPlatformAdminRpc<string>("admin_user_case_save",{...args,p_request_id:requestId,p_case_id:existing??null,p_data:caseData});
      message=existing?"Case updated.":"Support case created and linked to this user.";
    } else throw new Error("Invalid user operation.");
    refresh(id);return {ok:true,message,userId:id,caseId};
  } catch(error) {return {ok:false,message:error instanceof Error?error.message:"Unable to complete this action."};}
}

export async function bulkUserAccessAction(form:FormData):Promise<UserOperationResult> {
  try {
    const operation=readRequiredFormString(form,"operation","Operation");
    if(operation!=="suspend"&&operation!=="restore") throw new Error("Invalid bulk operation.");
    const actor=await requirePlatformAdmin(operation==="suspend"?P.usersSuspend:P.usersRestore);
    const ids=parseUserSelection(readRequiredFormString(form,"selection","Selection"));const reason=readReason(form);
    const results=[];
    for(const id of ids) {
      if(id===actor.userId) {results.push({id,ok:false,message:"Your own account was skipped."});continue;}
      try {await callPlatformAdminRpc("admin_set_user_access",{p_user_id:id,p_reason:reason,p_suspend:operation==="suspend"});results.push({id,ok:true,message:operation==="suspend"?"Suspended":"Restored"});}
      catch(error){results.push({id,ok:false,message:error instanceof Error?error.message:"Action failed."});}
    }
    refresh();const succeeded=results.filter(r=>r.ok).length;
    return {ok:succeeded===results.length,message:`${succeeded} of ${results.length} accounts updated.`,results};
  } catch(error) {return {ok:false,message:error instanceof Error?error.message:"Bulk action failed."};}
}
