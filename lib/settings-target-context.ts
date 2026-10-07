import "server-only";
import { getCurrentBusinessContext, isOwnerMembership, getCurrentRolePermissionCodesForMembership, type CurrentBusinessContext, type SalonMode } from "./current-context";
import { runInBusinessContext } from "./scoped-business-context";

export async function resolveSettingsTarget(salonId: string, mode: SalonMode | "auto" = "auto"): Promise<CurrentBusinessContext> {
  const context = await getCurrentBusinessContext();
  if (!context.user) throw new Error("Sign in to edit settings.");
  const resolvedMode = mode === "auto"
    ? context.workspaceOptions.some(w => w.salonId === salonId && w.salonMode === "manage") ? "manage" : "staff"
    : mode;
  const workspace = context.workspaceOptions.find(w => w.salonId === salonId && w.salonMode === resolvedMode);
  const salon = (resolvedMode === "manage" ? context.availableManageSalons : context.availableStaffSalons).find(s => s.id === salonId);
  const account = context.availableAccounts.find(a => a.id === salon?.account_id);
  if (!workspace || !salon || !account) throw new Error("You no longer have access to this salon. Reload your salon list.");
  const directMembership=context.salonMemberships.find(m=>m.salon_id===salonId&&m.status==='active');
  const accountMembership=context.accountMemberships.find(m=>m.account_id===salon.account_id&&m.status==='active');
  const membership=resolvedMode==='manage'?(isOwnerMembership(directMembership??null)?directMembership:isOwnerMembership(accountMembership??null)?accountMembership:directMembership??accountMembership)??null:null;
  if (resolvedMode === "manage" && !membership) throw new Error("You do not have management access to this salon.");
  const permissionCodes = membership ? await getCurrentRolePermissionCodesForMembership(membership) : [];
  return {
    ...context, accountId: account.id, accountName: account.name, currentAccount: account,
    salonId: salon.id, salonName: salon.name, currentSalon: salon,
    currentStaffSalon: resolvedMode === "staff" ? salon : context.currentStaffSalon,
    businessId: salon.id, businessName: salon.name, currentBusiness: {...salon, account_id: account.id},
    currentMembership: membership, currentWorkspace: workspace, workspaceType: "salon",
    salonMode: resolvedMode, businessMode: resolvedMode, permissionCodes, permissions: permissionCodes,
    salonRole: workspace.roleLabel,
  };
}

export async function withSettingsTarget<T>(salonId: string | undefined, action: () => Promise<T>, mode: SalonMode | "auto" = "auto"): Promise<T> {
  if (!salonId) return action();
  return runInBusinessContext(await resolveSettingsTarget(salonId, mode), action);
}
