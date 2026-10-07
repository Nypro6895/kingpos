import { getCurrentSalonPosDeskData } from "@/lib/pos-desk";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { OwnerPosClient } from "@/app/pos/owner-pos-client";
import { OwnerWorkspaceFrame } from "@/app/pos/owner-workspace-frame";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
export default async function OwnerWorkspaceLayout({children}:{children:React.ReactNode}) {
  const context=await requireSalonManagePageContext('/pos');
  const data=await getCurrentSalonPosDeskData({context,includeCustomers:false});
  const salon=context.currentSalon!,user=context.user!;
  const supabase=await createAuthenticatedSupabaseServerClient();
  const {data:settings}=await supabase!.from('pos_settings').select('workspace_preferences').eq('salon_id',salon.id).maybeSingle();
  // Server response timestamp is intentionally request-specific.
  // eslint-disable-next-line react-hooks/purity
  return <OwnerWorkspaceFrame salonName={salon.name} checkout={<OwnerPosClient snapshotAt={Date.now()} key={`${salon.id}:${user.id}`} scope={`owner:${salon.id}:${user.id}`} salonId={salon.id} salonName={salon.name} initial={{staff:data.staff,services:data.services,defaults:data.defaults,today:data.today}} preferences={normalizeWorkspacePreferences(settings?.workspace_preferences)}/>}>{children}</OwnerWorkspaceFrame>;
}
