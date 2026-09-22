import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import {
  assertBusinessStatus,
  assertUuid,
  parseAdminSearchParams,
} from "@/lib/platform-admin/validation";
import type {
  PlatformAdminBusinessListItem,
  PlatformAdminPageResult,
} from "@/types/platform-admin";

export type PlatformAdminBusinessDetail = {
  business: {
    id: string;
    name: string;
    legal_name: string | null;
    owner_user_id: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  locations: Array<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  members: Array<{
    id: string;
    user_id: string;
    display_name: string | null;
    role: string;
    status: string;
    joined_at: string | null;
    created_at: string;
  }>;
  owner: {
    id: string;
    display_name: string | null;
    email: string | null;
    phone: string | null;
    status: string;
  } | null;
  related_reports: Array<{
    id: string;
    report_number: string;
    summary: string;
    priority: string;
    status: string;
    created_at: string;
  }>;
};

export async function searchPlatformAdminBusinesses(input: {
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  q?: string | string[] | null;
  status?: string | string[] | null;
}) {
  const search = parseAdminSearchParams(input);
  const statusValue = Array.isArray(input.status) ? input.status[0] : input.status;
  const status = assertBusinessStatus(statusValue?.trim() || null);

  return callPlatformAdminRpc<
    PlatformAdminPageResult<PlatformAdminBusinessListItem> & {
      can_read_sensitive: boolean;
    }
  >("search_platform_admin_businesses", {
    p_page: search.page,
    p_page_size: search.pageSize,
    p_query: search.query,
    p_status: status,
  });
}

export async function getPlatformAdminBusinessDetail(businessId: string) {
  return callPlatformAdminRpc<PlatformAdminBusinessDetail>(
    "get_platform_admin_business_detail",
    {
      p_business_id: assertUuid(businessId, "Business ID"),
    },
  );
}

export async function updatePlatformAdminBusinessProfile(input: {
  businessId: string;
  legalName: string | null;
  name: string;
  reason: string;
}) {
  return callPlatformAdminRpc<{ business_id: string; status: string }>(
    "update_platform_admin_business_profile",
    {
      p_business_id: assertUuid(input.businessId, "Business ID"),
      p_legal_name: input.legalName,
      p_name: input.name,
      p_reason: input.reason,
    },
  );
}

export async function updatePlatformAdminBusinessStatus(input: {
  businessId: string;
  reason: string;
  status: string;
}) {
  const status = assertBusinessStatus(input.status);

  if (!status) {
    throw new Error("Business status is required.");
  }

  return callPlatformAdminRpc<{ business_id: string; status: string }>(
    "update_platform_admin_business_status",
    {
      p_business_id: assertUuid(input.businessId, "Business ID"),
      p_reason: input.reason,
      p_status: status,
    },
  );
}
