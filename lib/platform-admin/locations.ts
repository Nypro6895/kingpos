import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import {
  assertLocationStatus,
  assertUuid,
  parseAdminSearchParams,
} from "@/lib/platform-admin/validation";
import type {
  PlatformAdminLocationListItem,
  PlatformAdminPageResult,
} from "@/types/platform-admin";

export type PlatformAdminLocationDetail = {
  business: {
    id: string;
    legal_name: string | null;
    name: string;
    status: string;
  } | null;
  location: PlatformAdminLocationListItem & {
    geocoding_status: string | null;
  };
  related_reports: Array<{
    id: string;
    report_number: string;
    summary: string;
    priority: string;
    status: string;
    created_at: string;
  }>;
};

export async function searchPlatformAdminLocations(input: {
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  q?: string | string[] | null;
  status?: string | string[] | null;
}) {
  const search = parseAdminSearchParams(input);
  const statusValue = Array.isArray(input.status) ? input.status[0] : input.status;
  const status = assertLocationStatus(statusValue?.trim() || null);

  return callPlatformAdminRpc<PlatformAdminPageResult<PlatformAdminLocationListItem>>(
    "search_platform_admin_locations",
    {
      p_page: search.page,
      p_page_size: search.pageSize,
      p_query: search.query,
      p_status: status,
    },
  );
}

export async function getPlatformAdminLocationDetail(locationId: string) {
  return callPlatformAdminRpc<PlatformAdminLocationDetail>(
    "get_platform_admin_location_detail",
    {
      p_location_id: assertUuid(locationId, "Location ID"),
    },
  );
}

export async function updatePlatformAdminLocationProfile(input: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string;
  locationId: string;
  name: string;
  phone: string | null;
  postalCode: string | null;
  reason: string;
  state: string | null;
}) {
  return callPlatformAdminRpc<{ location_id: string; status: string }>(
    "update_platform_admin_location_profile",
    {
      p_address_line1: input.addressLine1,
      p_address_line2: input.addressLine2,
      p_city: input.city,
      p_country: input.country,
      p_location_id: assertUuid(input.locationId, "Location ID"),
      p_name: input.name,
      p_phone: input.phone,
      p_postal_code: input.postalCode,
      p_reason: input.reason,
      p_state: input.state,
    },
  );
}

export async function updatePlatformAdminLocationStatus(input: {
  locationId: string;
  reason: string;
  status: string;
}) {
  const status = assertLocationStatus(input.status);

  if (!status) {
    throw new Error("Location status is required.");
  }

  return callPlatformAdminRpc<{ location_id: string; status: string }>(
    "update_platform_admin_location_status",
    {
      p_location_id: assertUuid(input.locationId, "Location ID"),
      p_reason: input.reason,
      p_status: status,
    },
  );
}
