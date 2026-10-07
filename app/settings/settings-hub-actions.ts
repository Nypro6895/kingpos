"use server";
import { getCurrentBusinessContext, isOwnerMembership } from "@/lib/current-context";
import { resolveSettingsTarget } from "@/lib/settings-target-context";
import { hasPermission } from "@/lib/permissions";
import { getSalonOwnerRoster } from "@/lib/owner-transfer";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { currentUserCanAccessRecoveryBackOffice } from "@/lib/account-security-backoffice";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { getTwilioSettings, publicTwilioSettings } from "@/lib/twilio-settings";

export async function loadSettingsHub() {
  const context = await getCurrentBusinessContext();
  if (!context.user) throw new Error("Sign in to open Settings.");
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Your session is unavailable.");
  const ids = [...new Set([...context.availableManageSalons, ...context.availableStaffSalons].map(s => s.id))];
  const result = ids.length ? await client.from("salon_settings").select("salon_id,business_name,address_line1,city,state").in("salon_id", ids) : {data:[],error:null};
  if (result.error) throw new Error(result.error.message);
  const identity = (id: string, fallback: string) => {
    const row = result.data?.find(r => r.salon_id === id);
    return {name:row?.business_name || fallback,address:[row?.address_line1,row?.city,row?.state].filter(Boolean).join(", ")};
  };
  const managed = await Promise.all(context.availableManageSalons.map(async salon => {
    const target = await resolveSettingsTarget(salon.id,"manage");
    const owner = isOwnerMembership(target.currentMembership);
    const permissions = await Promise.all(["salon_settings.view","salon_profile.view","services.view","booking.view","staff.view","payroll.view","tickets.view"].map(async code=>[code,await hasPermission(code,target)] as const));
    let owners: Awaited<ReturnType<typeof getSalonOwnerRoster>>["owners"] = [], ownersError: string | null = null;
    if (owner) try { owners = (await getSalonOwnerRoster(salon.id)).owners; } catch(e) { ownersError=e instanceof Error?e.message:"Could not load owners."; }
    return {id:salon.id,accountId:salon.account_id,...identity(salon.id,salon.name),status:salon.status,owner,role:target.currentWorkspace?.roleLabel ?? "Manager",permissions:Object.fromEntries(permissions),owners,ownersError};
  }));
  const staff = context.availableStaffSalons.map(s=>({id:s.id,accountId:s.account_id,...identity(s.id,s.name),status:s.status}));
  const [support,admin] = await Promise.all([currentUserCanAccessRecoveryBackOffice(),getCurrentPlatformAdminContext()]);
  return {managed,staff,accounts:context.availableAccounts.map(a=>({id:a.id,name:a.name,canCreate:context.accountMemberships.some(m=>m.account_id===a.id && m.status==="active" && isOwnerMembership(m))})),support,twilio:admin?.roleSlug==="platform_owner"?publicTwilioSettings(await getTwilioSettings()):null};
}
export type SettingsHubIndex = Awaited<ReturnType<typeof loadSettingsHub>>;
