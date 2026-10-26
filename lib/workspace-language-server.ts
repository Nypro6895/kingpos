import "server-only";
import { cache } from "react";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { vietnamesePluginState } from "@/lib/vietnamese-plugin";
import { translateVietnamese } from "@/lib/vietnamese-dictionary";
import { getCurrentPortablePosSession } from "@/app/pos/portable/actions";
import { marketServiceClient } from "@/lib/market-payments";

export const getWorkspaceTranslation = cache(async (portable = false) => {
  let enabled = false;
  if (portable) {
    const session = await getCurrentPortablePosSession().catch(() => null);
    if (session) {
      const { data } = await marketServiceClient().from("vietnamese_plugin_subscriptions").select("installed,portable_enabled,trial_ends_at,paid_until").eq("salon_id", session.salon_id).maybeSingle();
      enabled = Boolean(data?.installed && data.portable_enabled && Math.max(Date.parse(data.trial_ends_at), data.paid_until ? Date.parse(data.paid_until) : 0) > Date.now());
    }
  } else {
    const context = await getRequestBusinessContext();
    if (context.workspaceType === "salon") {
      const salonId = context.salonMode === "staff" ? context.currentStaffSalon?.id : context.currentSalon?.id;
      const state = await vietnamesePluginState(salonId ?? null).catch(() => null);
      enabled = Boolean(state?.active && (context.salonMode === "manage" || state.staff_enabled));
    }
  }
  return <T,>(text: T): T => typeof text === "string" ? translateVietnamese(text, enabled) as T : text;
});
