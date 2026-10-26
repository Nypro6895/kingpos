import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { adminIdentityReady } from "@/lib/platform-admin/user-identity";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { searchPlatformAdminAuditLogs } from "@/lib/platform-admin/audit";
import { getAdminAccountActivity } from "@/lib/platform-admin/attention";
import { getAdminDeletionImpact, listAdminNotifications } from "@/lib/platform-admin/workflows";
import { assertUuid } from "@/lib/platform-admin/validation";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import type { UserWorkspace } from "@/types/admin-users-workspace";
import { parseLoginUserAgent } from "@/lib/account-security-shared";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:NextRequest) {
  const actor=await getCurrentPlatformAdminContext();
  if(!actor?.permissions.includes(P.usersRead)) return NextResponse.json({error:"Access denied."},{status:403,headers});
  let id:string;
  try {id=assertUuid(request.nextUrl.searchParams.get("id"));} catch {return NextResponse.json({error:"Invalid user ID."},{status:400,headers});}
  try {
    const result=await callPlatformAdminRpc<UserWorkspace>("admin_user_workspace",{p_user_id:id});
    result.permissions=actor.permissions;result.ownAccount=actor.userId===id;result.identityReady=adminIdentityReady();
    result.user.auth_user_id=null;
    result.sessions=result.sessions.map(session=>({...session,device_label:session.user_agent?parseLoginUserAgent(session.user_agent).deviceLabel:undefined}));
    result.notes=[];result.activity=[];result.deletion=null;result.errors=[];
    result.access_stores=null;
    const can=(p:typeof P[keyof typeof P])=>actor.permissions.includes(p);
    const optional=async(label:string,fn:()=>Promise<void>)=>{try{await fn();}catch{result.errors.push(`${label} could not load. Retry to refresh.`);}};
    await Promise.all([
      optional("Business access",async()=>{result.access_stores=await callPlatformAdminRpc("admin_user_access_stores",{p_user_id:id});}),
      can(P.notesRead)?optional("Notes",async()=>{result.notes=(await listPlatformAdminNotes({targetId:id,targetType:"user",pageSize:15})).items;}):null,
      can(P.auditRead)?optional("Audit",async()=>{result.activity.push(...(await searchPlatformAdminAuditLogs({targetId:id,pageSize:"30"})).items.map(e=>({id:e.id,title:e.action.replaceAll("platform_admin.","").replaceAll("_"," "),body:e.reason,at:e.created_at,actor:e.actor?.display_name||"System"})));}):null,
      can(P.auditRead)?optional("Login activity",async()=>{result.activity.push(...(await getAdminAccountActivity(id)).map(e=>({id:e.id,title:e.activity_type.replaceAll("_"," "),body:e.device_label,at:e.created_at,actor:null})));}):null,
      can(P.notificationsRead)?optional("Notifications",async()=>{result.activity.push(...(await listAdminNotifications({userId:id})).items.map(e=>({id:e.id,title:`Notification · ${e.title}`,body:`${e.body} · ${e.delivery_status}`,at:e.created_at,actor:e.sender_name})));}):null,
      can(P.usersDelete)?optional("Deletion impact",async()=>{result.deletion=await getAdminDeletionImpact(id);}):null,
    ]);
    result.activity.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    return NextResponse.json(result,{headers});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"Unable to load this user."},{status:503,headers});}
}
