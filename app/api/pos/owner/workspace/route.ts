import { NextResponse } from "next/server";
import { getCurrentSalonPosDeskData } from "@/lib/pos-desk";
import { getCurrentSalonPosSettings, getPosDeskDefaults } from "@/lib/pos-settings";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import { getStaffProfileAvatarUrl } from "@/lib/staff-profile";
export async function GET(request: Request) {
  const responseHeaders={"Cache-Control":"private, no-store",Vary:"Cookie"};
  if(request.headers.get('x-reylumi-auth-unavailable')==='1') return new NextResponse(null,{status:503,headers:responseHeaders});
  const context=await getCurrentBusinessContext();
  if (!context.user || !context.currentSalon || !isSalonManageContext(context)) return new NextResponse(null,{status:401});
  const ownerScope=`owner:${context.currentSalon.id}:${context.user.id}`;
  const requestedScope=new URL(request.url).searchParams.get('ownerScope');
  if(requestedScope&&requestedScope!==ownerScope) return new NextResponse(null,{status:409,headers:responseHeaders});
  const identity={ownerScope,salonId:context.currentSalon.id};
  const resource=new URL(request.url).searchParams.get("resource");
  if(resource==='catalog'){
    const supabase=await createAuthenticatedSupabaseServerClient();
    const {data,error}=await supabase!.from('services').select('id,name,category,base_price,duration_minutes').eq('salon_id',context.currentSalon.id).eq('is_active',true).order('name');
    if(error)return new NextResponse(null,{status:503});return NextResponse.json({...identity,services:data},{headers:responseHeaders});
  }
  if(resource==='staff'){
    const ids=new URL(request.url).searchParams.get('ids')?.split(',').filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,100);
    const supabase=await createAuthenticatedSupabaseServerClient();
    const {data,error}=await supabase!.rpc('get_owner_workspace_staff',{p_salon:context.currentSalon.id,p_ids:ids?.length?ids:null});
    if(error)return NextResponse.json({error:'Unable to refresh staff'},{status:503});
    return NextResponse.json({...data,...identity,staff:data.staff.map((s:Record<string,unknown>)=>({...s,avatar_url:getStaffProfileAvatarUrl({staffProfilePhotoPath:s.staffProfilePhotoPath as string|null,accountAvatarUrl:s.accountAvatarUrl as string|null})}))},{headers:responseHeaders});
  }
  if (resource==="settings") {
    const settings=await getCurrentSalonPosSettings(context);
    const supabase=await createAuthenticatedSupabaseServerClient();
    const {data}=await supabase!.from("pos_settings").select("workspace_preferences").eq("salon_id",context.currentSalon.id).maybeSingle();
    return NextResponse.json({...identity,settings,defaults:getPosDeskDefaults(settings),preferences:normalizeWorkspacePreferences(data?.workspace_preferences)},{headers:responseHeaders});
  }
  const data=await getCurrentSalonPosDeskData({includeCustomers:false,context});
  // Do not serialize the account/session context or the entire customer directory.
  return NextResponse.json({...identity,staff:data.staff,services:data.services,defaults:data.defaults,today:data.today,waitingVisits:data.waitingVisits},{headers:responseHeaders});
}
