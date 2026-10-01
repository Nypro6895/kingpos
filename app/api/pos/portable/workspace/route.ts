import { NextResponse } from "next/server";
import { getPortableWorkspaceCatalog, getPortableWorkspaceStaff, getPortableWorkspaceSettings, getPortableReportData } from "@/app/pos/portable/actions";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
export async function GET(request:Request) {
  try {
    const url=new URL(request.url),resource=url.searchParams.get('resource');
    if(resource==='catalog') return NextResponse.json({services:await getPortableWorkspaceCatalog()},{headers:{'Cache-Control':'no-store'}});
    if(resource==='settings') {const settings=await getPortableWorkspaceSettings();return NextResponse.json({settings,preferences:normalizeWorkspacePreferences(settings?.workspace_preferences)},{headers:{'Cache-Control':'no-store'}});}
    if(resource==='report') return NextResponse.json(await getPortableReportData(url.searchParams.get('date')??undefined),{headers:{'Cache-Control':'no-store'}});
    const ids=url.searchParams.get('ids')?.split(',').filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,100);
    return NextResponse.json(await getPortableWorkspaceStaff(ids?.length?ids:undefined),{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Unable to refresh this view'},{status:503});}
}
