import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { adminIdentityClient } from "@/lib/platform-admin/user-identity";
import { assertUuid } from "@/lib/platform-admin/validation";
import type { UserWorkspace } from "@/types/admin-users-workspace";
export async function GET(request:NextRequest) {
 const actor=await getCurrentPlatformAdminContext();const headers={"Cache-Control":"private, no-store"};
 if(!actor||![P.usersReadSensitive,P.reportsRead,P.recoveryRead].every(p=>actor.permissions.includes(p)))return NextResponse.json({error:"Access denied."},{status:403,headers});
 try {
  const user=assertUuid(request.nextUrl.searchParams.get('user'));const caseId=assertUuid(request.nextUrl.searchParams.get('case'));const path=request.nextUrl.searchParams.get('path');
  const data=await callPlatformAdminRpc<UserWorkspace>('admin_user_workspace',{p_user_id:user});
  if(!path||!data.cases.find(c=>c.id===caseId)?.context.attachments?.some(a=>a.path===path))return NextResponse.json({error:'Evidence not found.'},{status:404,headers});
  const signed=await adminIdentityClient().storage.from('admin-user-evidence').createSignedUrl(path,60,{download:true});
  if(signed.error||!signed.data)return NextResponse.json({error:'Evidence is unavailable.'},{status:503,headers});
  return NextResponse.redirect(signed.data.signedUrl,{headers});
 }catch{return NextResponse.json({error:'Evidence is unavailable.'},{status:503,headers});}
}
