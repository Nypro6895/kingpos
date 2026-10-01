import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { parseAdminSearchParams } from "@/lib/platform-admin/validation";
import type {
  PlatformAdminAuditLogItem,
  PlatformAdminPageResult,
} from "@/types/platform-admin";

const FORBIDDEN_AUDIT_KEYS = new Set([
  "access_token",
  "api_key",
  "password",
  "refresh_token",
  "secret",
  "service_role_key",
]);

type JsonLike = JsonLike[] | { [key: string]: JsonLike } | boolean | null | number | string;

export function platformAdminAuditContainsForbiddenKey(value: JsonLike): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => platformAdminAuditContainsForbiddenKey(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        FORBIDDEN_AUDIT_KEYS.has(key.toLowerCase()) ||
        platformAdminAuditContainsForbiddenKey(item),
    );
  }

  return false;
}

export function assertPlatformAdminAuditPayloadSafe(value: JsonLike) {
  if (platformAdminAuditContainsForbiddenKey(value)) {
    throw new Error("Platform admin audit payload cannot include secrets.");
  }
}

export async function searchPlatformAdminAuditLogs(input: {
  action?: string | string[] | null;
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  q?: string | string[] | null;
  targetType?: string | string[] | null;
}) {
  const search = parseAdminSearchParams(input);
  const actionValue = Array.isArray(input.action) ? input.action[0] : input.action;
  const targetTypeValue = Array.isArray(input.targetType)
    ? input.targetType[0]
    : input.targetType;

  return callPlatformAdminRpc<PlatformAdminPageResult<PlatformAdminAuditLogItem>>(
    "search_platform_admin_audit_logs",
    {
      p_action: actionValue?.trim() || null,
      p_page: search.page,
      p_page_size: search.pageSize,
      p_query: search.query,
      p_target_type: targetTypeValue?.trim() || null,
    },
  );
}
