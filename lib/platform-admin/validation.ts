import "server-only";

import {
  PLATFORM_ADMIN_MEMBERSHIP_STATUSES,
  PLATFORM_ADMIN_ROLE_SLUGS,
  PLATFORM_REPORT_PRIORITIES,
  PLATFORM_REPORT_STATUSES,
  type PlatformAdminMembershipStatus,
  type PlatformAdminRoleSlug,
  type PlatformReportPriority,
  type PlatformReportStatus,
} from "@/types/platform-admin";
import type { AccountStatus } from "@/types/account";
import type { KingUserStatus } from "@/types/user";
import type { LocationStatus } from "@/types/location";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USER_STATUSES = ["active", "inactive", "suspended", "pending_deletion", "deleted"] as const;
const BUSINESS_STATUSES = ["active", "inactive", "suspended", "archived"] as const;
const LOCATION_STATUSES = ["active", "inactive"] as const;

export type AdminSearchParams = {
  page: number;
  pageSize: number;
  query: string | null;
};

function readStringValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue || null;
}

export function readFormString(formData: FormData, key: string) {
  return readStringValue(formData.get(key));
}

export function readRequiredFormString(
  formData: FormData,
  key: string,
  label: string,
) {
  const value = readFormString(formData, key);

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

export function assertUuid(value: string | null | undefined, label = "ID") {
  if (!value || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }

  return value;
}

export function parseAdminSearchParams(input: {
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  q?: string | string[] | null;
}): AdminSearchParams {
  const pageValue = Array.isArray(input.page) ? input.page[0] : input.page;
  const pageSizeValue = Array.isArray(input.pageSize)
    ? input.pageSize[0]
    : input.pageSize;
  const queryValue = Array.isArray(input.q) ? input.q[0] : input.q;
  const parsedPage = Number.parseInt(pageValue ?? "1", 10);
  const parsedPageSize = Number.parseInt(pageSizeValue ?? "25", 10);
  const cleanQuery = queryValue?.trim() || null;

  if (cleanQuery && cleanQuery.length > 100) {
    throw new Error("Search query must be 100 characters or fewer.");
  }

  return {
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize:
      Number.isFinite(parsedPageSize) && parsedPageSize > 0
        ? Math.min(parsedPageSize, 100)
        : 25,
    query: cleanQuery,
  };
}

function assertOneOf<TValue extends string>(
  value: string | null,
  allowedValues: readonly TValue[],
  label: string,
) {
  if (!value) {
    return null;
  }

  if (!allowedValues.includes(value as TValue)) {
    throw new Error(`Invalid ${label}.`);
  }

  return value as TValue;
}

export function assertUserStatus(value: string | null) {
  return assertOneOf(value, USER_STATUSES, "user status") as KingUserStatus | null;
}

export function assertBusinessStatus(value: string | null) {
  return assertOneOf(
    value,
    BUSINESS_STATUSES,
    "business status",
  ) as AccountStatus | null;
}

export function assertLocationStatus(value: string | null) {
  return assertOneOf(
    value,
    LOCATION_STATUSES,
    "location status",
  ) as LocationStatus | null;
}

export function assertReportStatus(value: string | null) {
  return assertOneOf(
    value,
    PLATFORM_REPORT_STATUSES,
    "report status",
  ) as PlatformReportStatus | null;
}

export function assertReportPriority(value: string | null) {
  return assertOneOf(
    value,
    PLATFORM_REPORT_PRIORITIES,
    "report priority",
  ) as PlatformReportPriority | null;
}

export function assertPlatformAdminRoleSlug(value: string | null) {
  return assertOneOf(
    value,
    PLATFORM_ADMIN_ROLE_SLUGS,
    "platform admin role",
  ) as PlatformAdminRoleSlug | null;
}

export function assertPlatformAdminMembershipStatus(value: string | null) {
  return assertOneOf(
    value,
    PLATFORM_ADMIN_MEMBERSHIP_STATUSES,
    "platform admin membership status",
  ) as PlatformAdminMembershipStatus | null;
}

export function readReason(formData: FormData) {
  const reason = readRequiredFormString(formData, "reason", "Reason");

  if (reason.length < 3 || reason.length > 1000) {
    throw new Error("Reason must be between 3 and 1000 characters.");
  }

  return reason;
}
