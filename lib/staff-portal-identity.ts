import "server-only";
import { cache } from "react";
import { getCurrentStaffBusinessContext, type CurrentBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { resolveStaffAccountForSalon, CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE } from "@/lib/staff-account";

// React cache is scoped to this server render, never shared between users or
// retained across POS refreshes. All Today tabs use the same verified identity.
export const getStaffPortalIdentity = cache(async (targetContext?: CurrentBusinessContext) => {
  const context = targetContext ?? await getCurrentStaffBusinessContext();
  if (!context.user || !context.currentSalon || !context.currentAccount) return { context, staff: null, supabase: null };
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) throw new Error("Staff session unavailable.");
  const resolved = await resolveStaffAccountForSalon({ context, supabase });
  if (resolved.status === "multiple") throw new Error(CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE);
  return { context, staff: resolved.staff, supabase };
});
