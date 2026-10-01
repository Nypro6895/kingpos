import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import {
  assertPlatformAdminMembershipStatus,
  assertPlatformAdminRoleSlug,
  assertUuid,
  parseAdminSearchParams,
} from "@/lib/platform-admin/validation";
import type {
  PlatformAdminPageResult,
  PlatformAdminTeamItem,
} from "@/types/platform-admin";

export async function listPlatformAdminTeam(input: {
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  q?: string | string[] | null;
  role?: string | string[] | null;
  status?: string | string[] | null;
}) {
  const search = parseAdminSearchParams(input);
  const roleValue = Array.isArray(input.role) ? input.role[0] : input.role;
  const statusValue = Array.isArray(input.status) ? input.status[0] : input.status;
  const roleSlug = assertPlatformAdminRoleSlug(roleValue?.trim() || null);
  const status = assertPlatformAdminMembershipStatus(statusValue?.trim() || null);

  return callPlatformAdminRpc<PlatformAdminPageResult<PlatformAdminTeamItem>>(
    "list_platform_admin_team",
    {
      p_page: search.page,
      p_page_size: search.pageSize,
      p_query: search.query,
      p_role_slug: roleSlug,
      p_status: status,
    },
  );
}

export async function createPlatformAdminMembership(input: {
  reason: string;
  roleSlug: string;
  userId: string;
}) {
  const roleSlug = assertPlatformAdminRoleSlug(input.roleSlug);

  if (!roleSlug) {
    throw new Error("Platform admin role is required.");
  }

  return callPlatformAdminRpc<{
    membership_id: string;
    role_slug: string;
    status: string;
    user_id: string;
  }>("create_platform_admin_membership", {
    p_reason: input.reason,
    p_role_slug: roleSlug,
    p_user_id: assertUuid(input.userId, "User ID"),
  });
}

export async function updatePlatformAdminMembership(input: {
  membershipId: string;
  reason: string;
  roleSlug: string;
  status: string;
}) {
  const roleSlug = assertPlatformAdminRoleSlug(input.roleSlug);
  const status = assertPlatformAdminMembershipStatus(input.status);

  if (!roleSlug || !status) {
    throw new Error("Platform admin role and status are required.");
  }

  return callPlatformAdminRpc<{
    membership_id: string;
    role_slug: string;
    status: string;
  }>("update_platform_admin_membership", {
    p_membership_id: assertUuid(input.membershipId, "Membership ID"),
    p_reason: input.reason,
    p_role_slug: roleSlug,
    p_status: status,
  });
}
