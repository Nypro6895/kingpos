import "server-only";
import { withStaffPersonalLegalName } from "@/lib/staff-legal-name";
import { cache } from "react";
import { scopedBusinessContext } from "./scoped-business-context";
import { getCurrentStaffBusinessContext, type CurrentBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient, getAuthenticatedReadAuthority } from "@/lib/supabase/server";
import { resolveStaffAccountForSalon, CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE } from "@/lib/staff-account";
import { getExperienceContext } from "@/lib/experience-context";
import { getReadAbortSignal, getReadContextToken, getReadRequestTiming, runWithFreshReadValidation, memoizeReadValidation } from "@/lib/read-context-scope";

type StaffPortalIdentity = Awaited<ReturnType<typeof readStaffPortalIdentity>>;
type ReadCapability = { token: object; context: CurrentBusinessContext; staff: StaffPortalIdentity["staff"]; supabase: StaffPortalIdentity["supabase"]; fingerprint: string; authority: string };
const readCapabilities = new WeakMap<object, ReadCapability>();

function fingerprint(identity: StaffPortalIdentity) {
  const { context, staff } = identity;
  return JSON.stringify([getExperienceContext(context).scope, context.user?.id, context.user?.auth_user_id,
    context.currentAccount?.id, context.currentSalon?.id, context.currentSalon?.account_id,
    staff?.id, staff?.salon_id, staff?.account_user_id, staff?.user_id, staff?.is_active]);
}

async function readStaffPortalIdentity(targetContext?: CurrentBusinessContext, strict = false) {
  const context = targetContext ?? await getCurrentStaffBusinessContext();
  if (!context.user || !context.currentSalon || !context.currentAccount) return { context, staff: null, supabase: null };
  const supabase = await createAuthenticatedSupabaseServerClient({ throwOnRejected: true, ...(strict ? { throwOnUnavailable: true } : {}) });
  if (!supabase) throw new Error("Staff session unavailable.");
  const resolveStaff = () => resolveStaffAccountForSalon({ context, supabase });
  const resolved = await (getReadRequestTiming()?.measure("staff_resolve", resolveStaff) ?? resolveStaff());
  if (resolved.status === "multiple") throw new Error(CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE);
  const identity = { context, staff: resolved.staff ? withStaffPersonalLegalName(resolved.staff, context.user) : null, supabase };
  const token = getReadContextToken(), authority = getAuthenticatedReadAuthority(supabase);
  if (token && authority && identity.staff?.is_active === true && identity.staff.salon_id === context.currentSalon.id) {
    readCapabilities.set(identity, { token, authority, context, staff: identity.staff, supabase, fingerprint: fingerprint(identity) });
  }
  return identity;
}

// React cache is scoped to this server render, never shared between users or
// retained across POS refreshes. All Today tabs use the same verified identity.
const cachedStaffPortalIdentity = cache(readStaffPortalIdentity);
const staffIdentityReadKeys = new WeakMap<CurrentBusinessContext,symbol>();
export async function getStaffPortalIdentity(targetContext?: CurrentBusinessContext, strict = false) {
  const selected = targetContext ?? scopedBusinessContext();
  if (!getReadContextToken()) return cachedStaffPortalIdentity(selected, strict);
  const context = selected ?? await getCurrentStaffBusinessContext();
  let key = staffIdentityReadKeys.get(context);
  if(!key) { key = Symbol("staff-portal-identity"); staffIdentityReadKeys.set(context,key); }
  return memoizeReadValidation(key,strict ? "strict" : "ordinary",()=>readStaffPortalIdentity(context,strict));
}
export type { StaffPortalIdentity };

export function canReuseStaffPortalReadIdentity(identity: StaffPortalIdentity, context: CurrentBusinessContext): boolean {
  const capability = readCapabilities.get(identity);
  return Boolean(capability && capability.token === getReadContextToken() && capability.context === context
    && identity.context === context && capability.staff === identity.staff && capability.supabase === identity.supabase
    && identity.supabase && getAuthenticatedReadAuthority(identity.supabase) === capability.authority
    && !getReadAbortSignal()?.aborted && fingerprint(identity) === capability.fingerprint);
}

export function requireStaffPortalReadIdentity(identity: StaffPortalIdentity, context = identity.context): StaffPortalIdentity {
  if (!canReuseStaffPortalReadIdentity(identity, context)) throw new Error("Staff read identity could not be verified.");
  return identity;
}

/** No result memoization: repeat auth/session/status and unique-active-Staff gates
 * immediately before the complete DTO is returned. Membership/permission context
 * remains this request's admitted snapshot, as in the existing helper contract. */
export async function revalidateStaffPortalReadIdentity(identity: StaffPortalIdentity): Promise<void> {
  requireStaffPortalReadIdentity(identity);
  const capability = readCapabilities.get(identity)!;
  const fresh = await runWithFreshReadValidation(() => readStaffPortalIdentity(identity.context, true));
  requireStaffPortalReadIdentity(identity);
  if (!fresh.supabase || !fresh.staff || getAuthenticatedReadAuthority(fresh.supabase) !== capability.authority
    || fingerprint(fresh) !== capability.fingerprint) throw new Error("Staff read identity changed.");
}
