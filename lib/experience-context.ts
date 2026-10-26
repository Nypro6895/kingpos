import "server-only";
import { createHash } from "node:crypto";
import type { CurrentBusinessContext } from "@/lib/current-context";

const scopeFingerprint = (value: unknown) => `v3:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export type ExperienceContext = {
  scope: string;
  viewerId: string | null;
  workspaceId: string;
  salonId: string | null;
  permissionRevision: string;
  authenticated: boolean;
  admin?: boolean;
};

/** Identity and grants are part of the key, never inferred from a URL alone. */
export function getExperienceContext(context: CurrentBusinessContext): ExperienceContext {
  const viewerId = context.user?.id ?? null;
  const workspaceId = context.currentWorkspace?.id ?? `${context.workspaceType}:${context.accountId ?? "personal"}`;
  const salonId = context.salonMode === "staff" ? context.currentStaffSalon?.id ?? null : context.currentSalon?.id ?? null;
  const permissionRevision = JSON.stringify([
    context.activeRole?.code ?? context.salonRole ?? context.accountRole ?? null,
    [...new Set([...context.permissionCodes, ...context.permissions])].sort(),
    context.currentMembership?.updated_at ?? null,
    context.currentMembership?.status ?? null,
    context.currentAccount?.status ?? null,
    context.currentSalon?.status ?? null,
    context.user?.status ?? null,
  ]);
  return {
    scope: scopeFingerprint([viewerId, workspaceId, context.accountId, salonId, context.salonMode, context.user?.language ?? "en", permissionRevision]),
    viewerId, workspaceId, salonId, permissionRevision, authenticated: Boolean(viewerId),
  };
}

export function getAdminExperienceContext(base: ExperienceContext, admin: { userId: string; membershipId: string; roleId: string; permissions: string[] }): ExperienceContext {
  const permissionRevision = JSON.stringify([base.permissionRevision, admin.membershipId, admin.roleId, [...admin.permissions].sort()]);
  return { ...base, admin: true, permissionRevision, scope: scopeFingerprint([base.scope, "admin", admin.userId, permissionRevision]) };
}
