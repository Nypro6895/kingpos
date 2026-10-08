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
  salon_memberships?: Array<{ id: string; salon_id: string; salon_name: string; role: string; status: string; created_at: string }>;
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
    deletion_requested_at?: string | null;
    deletion_scheduled_for?: string | null;
    can_read_sensitive?: boolean;
  };
};

export async function searchPlatformAdminUsers(input: {
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  q?: string | string[] | null;
  status?: string | string[] | null;
  role?: string | string[] | null;
  businessId?: string | string[] | null;
  sort?: string | string[] | null;
}) {
  const search = parseAdminSearchParams(input);
  const statusValue = Array.isArray(input.status) ? input.status[0] : input.status;
  const status = assertUserStatus(statusValue?.trim() || null);

  return callPlatformAdminRpc<
    PlatformAdminPageResult<PlatformAdminUserListItem> & {
      can_read_sensitive: boolean;
    }
  >("search_platform_admin_users_v2", {
    p_page: search.page,
    p_page_size: search.pageSize,
    p_query: search.query,
    p_status: status,
    p_role: (Array.isArray(input.role) ? input.role[0] : input.role) || null,
    p_business_id: (Array.isArray(input.businessId) ? input.businessId[0] : input.businessId) || null,
    p_sort: (Array.isArray(input.sort) ? input.sort[0] : input.sort) || "created_desc",
  });
}

export async function getPlatformAdminUserDetail(userId: string) {
  const detail = await callPlatformAdminRpc<PlatformAdminUserDetail>(
    "get_platform_admin_user_detail",
    {
      p_user_id: assertUuid(userId, "User ID"),
    },
  );
  if (!detail?.user?.id) throw new Error("The user profile could not be loaded. Please retry.");
  return { ...detail, organization_memberships: detail.organization_memberships ?? [], related_reports: detail.related_reports ?? [] };
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
    "update_platform_admin_user_profile_v2",
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
    "admin_set_user_access",
    {
      p_reason: input.reason,
      p_suspend: true,
      p_user_id: assertUuid(input.userId, "User ID"),
    },
  );
}

export async function restorePlatformAdminUser(input: {
  reason: string;
  userId: string;
}) {
  return callPlatformAdminRpc<{ status: string; user_id: string }>(
    "admin_set_user_access",
    {
      p_reason: input.reason,
      p_suspend: false,
      p_user_id: assertUuid(input.userId, "User ID"),
    },
  );
}

export type { AdminSearchParams };
