import { getCurrentSalonPosDeskData } from "@/lib/pos-desk";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { OwnerPosClient } from "@/app/pos/owner-pos-client";
import { OwnerWorkspaceFrame } from "@/app/pos/owner-workspace-frame";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import { Suspense } from "react";
import { OwnerPosTabs } from "@/app/pos/owner-pos-tabs";
import { PosTabPlaceholder } from "@/app/pos/pos-tab-placeholder";
import { getExperienceContext } from "@/lib/experience-context";
import { getContextBusinessTimezone } from "@/lib/salon-business-clock";
import { OwnerReferenceSeed } from "@/app/pos/owner-local-workspace";
import { OwnerLocalPanelsOutlet } from "@/app/pos/owner-local-panels";

async function Checkout({context}:{context:Awaited<ReturnType<typeof requireSalonManagePageContext>>}) {
  const salon=context.currentSalon!,user=context.user!;
  const [data,settings,timezone]=await Promise.all([
    // Checkout never consumes the waiting queue or the customer directory.
    getCurrentSalonPosDeskData({context,includeCustomers:false,includeWaitingVisits:false}),
    (async()=>{
      const supabase=await createAuthenticatedSupabaseServerClient();
      const {data:settings}=await supabase!.from('pos_settings').select('workspace_preferences').eq('salon_id',salon.id).maybeSingle();
      return settings;
    })(),
    getContextBusinessTimezone(context),
  ]);
  // Server response timestamp is intentionally request-specific.
  // eslint-disable-next-line react-hooks/purity
  const snapshotAt=Date.now(),preferences=normalizeWorkspacePreferences(settings?.workspace_preferences);
  return <><OwnerReferenceSeed updatedAt={snapshotAt} data={{ownerScope:`owner:${salon.id}:${user.id}`,salonId:salon.id,salonName:salon.name,timezone,staff:data.staff,services:data.services,defaults:data.defaults,today:data.today,preferences}}/><OwnerPosClient snapshotAt={snapshotAt} key={`${salon.id}:${user.id}`} scope={`owner:${salon.id}:${user.id}`} salonId={salon.id} salonName={salon.name} initial={{staff:data.staff,services:data.services,defaults:data.defaults,today:data.today}} preferences={preferences}/></>;
}

export default async function OwnerWorkspaceLayout({children}:{children:React.ReactNode}) {
  const context=await requireSalonManagePageContext('/pos');
  return <OwnerWorkspaceFrame owner={{scope:getExperienceContext(context).scope,ownerScope:`owner:${context.currentSalon.id}:${context.user.id}`,salonId:context.currentSalon.id}} localPanels={<OwnerLocalPanelsOutlet scope={getExperienceContext(context).scope} salonId={context.currentSalon.id}/>} salonName={context.currentSalon!.name} checkout={
    <Suspense fallback={<><OwnerPosTabs active="pos"/><PosTabPlaceholder tab="pos"/></>}>
      <Checkout context={context}/>
    </Suspense>
  }>{children}</OwnerWorkspaceFrame>;
}
