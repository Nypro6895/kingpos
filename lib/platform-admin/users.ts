import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import {
  assertUserStatus,
  assertUuid,
  parseAdminSearchParams,
  type AdminSearchParams,
} from "@/lib/platform-admin/validation";
import type {
  PlatformAdminPageResult,
  PlatformAdminUserListItem,
} from "@/types/platform-admin";

export type PlatformAdminUserDetail = {
  organization_memberships: Array<{
    id: string;
    organization_id: string;
    organization_name: string;
    role: string;
    status: string;
    joined_at: string | null;
    created_at: string;
  }>;
  platform_membership: {
    id: string;
    role_name: string;
    role_slug: string;
    status: string;
    created_at: string;
    updated_at: string;
  } | null;
  related_reports: Array<{
    id: string;
    report_number: string;
    summary: string;
    priority: string;
    status: string;
    created_at: string;
  }>;
  user: PlatformAdminUserListItem & {
    auth_user_id: string | null;
    avatar_url: string | null;
    language: string;
    last_login_at: string | null;
    timezone: string;
  };
};

export async function searchPlatformAdminUsers(input: {
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  q?: string | string[] | null;
  status?: string | string[] | null;
}) {
  const search = parseAdminSearchParams(input);
  const statusValue = Array.isArray(input.status) ? input.status[0] : input.status;
  const status = assertUserStatus(statusValue?.trim() || null);

  return callPlatformAdminRpc<
    PlatformAdminPageResult<PlatformAdminUserListItem> & {
      can_read_sensitive: boolean;
    }
  >("search_platform_admin_users", {
    p_page: search.page,
    p_page_size: search.pageSize,
    p_query: search.query,
    p_status: status,
  });
}

export async function getPlatformAdminUserDetail(userId: string) {
  return callPlatformAdminRpc<PlatformAdminUserDetail>(
    "get_platform_admin_user_detail",
    {
      p_user_id: assertUuid(userId, "User ID"),
    },
  );
}

export async function updatePlatformAdminUserProfile(input: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  reason: string;
  userId: string;
}) {
  return callPlatformAdminRpc<{ status: string; user_id: string }>(
    "update_platform_admin_user_profile",
    {
      p_display_name: input.displayName,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_phone: input.phone,
      p_reason: input.reason,
      p_user_id: assertUuid(input.userId, "User ID"),
    },
  );
}

export async function suspendPlatformAdminUser(input: {
  reason: string;
  userId: string;
}) {
  return callPlatformAdminRpc<{ status: string; user_id: string }>(
    "suspend_platform_user",
    {
      p_reason: input.reason,
      p_user_id: assertUuid(input.userId, "User ID"),
    },
  );
}

export async function restorePlatformAdminUser(input: {
  reason: string;
  userId: string;
}) {
  return callPlatformAdminRpc<{ status: string; user_id: string }>(
    "restore_platform_user",
    {
      p_reason: input.reason,
      p_user_id: assertUuid(input.userId, "User ID"),
    },
  );
}

export type { AdminSearchParams };
