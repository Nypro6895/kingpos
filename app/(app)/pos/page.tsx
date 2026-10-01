import { getCurrentSalonPosDeskData } from "@/lib/pos-desk";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { OwnerPosClient } from "@/app/pos/owner-pos-client";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
export default async function PosDeskPage() {
  const context=await requireSalonManagePageContext('/pos');
  const data=await getCurrentSalonPosDeskData();
  const salon=context.currentSalon!,user=context.user!;
  const supabase=await createAuthenticatedSupabaseServerClient();
  const {data:settings}=await supabase!.from('pos_settings').select('workspace_preferences').eq('salon_id',salon.id).maybeSingle();
  return <OwnerPosClient key={`${salon.id}:${user.id}`} scope={`owner:${salon.id}:${user.id}`} salonId={salon.id} salonName={salon.name} initial={{staff:data.staff,services:data.services,defaults:data.defaults,today:data.today}} preferences={normalizeWorkspacePreferences(settings?.workspace_preferences)}/>;
}
