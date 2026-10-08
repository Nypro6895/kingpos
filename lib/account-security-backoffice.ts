import "server-only";

import {
  isLoginSecuritySchemaMissing,
  type AccountSecurityPreferences,
} from "@/lib/account-security";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import {
  PLATFORM_ADMIN_PERMISSIONS,
  type PlatformAdminPermission,
} from "@/lib/platform-admin/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { KingUser } from "@/types/user";

export const RECOVERY_BACK_OFFICE_PATH = "/settings/recovery-back-office";
export const RECOVERY_ADMIN_PATH = "/admin/recovery";

type AuthenticatedSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type SupabaseErrorLike = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};

type RecoveryRequestSupportRow = {
  assigned_to_user_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  details: string | null;
  id: string;
  priority: string | null;
  request_type: string;
  resolution_summary: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  risk_level: string | null;
  status: string;
  updated_at: string;
  user_id: string;
};

type RecoverySupportUserRow = Pick<
  KingUser,
  | "created_at"
  | "display_name"
  | "email"
  | "id"
  | "last_login_at"
  | "phone"
  | "status"
>;

type RecoverySupportPreferencesRow = {
  login_alerts_enabled: boolean;
  recovery_email: string | null;
  recovery_phone: string | null;
  sms_login_alerts_enabled: boolean | null;
  user_id: string;
};

type RecoverySupportSessionRow = {
  created_at: string;
  device_label: string | null;
  id: string;
  last_seen_at: string;
  location_label: string | null;
  revoked_at: string | null;
  trusted_at: string | null;
  user_id: string;
};

type RecoverySupportActivityRow = {
  activity_type: string;
  created_at: string;
  device_label: string | null;
  id: string;
  location_label: string | null;
  user_id: string;
};

type RecoverySupportEventRow = {
  actor_user_id: string | null;
  created_at: string;
  event_type: string;
  from_status: string | null;
  id: string;
  metadata: unknown;
  note: string | null;
  request_id: string;
  to_status: string | null;
};

export type RecoveryBackOfficeCase = {
  activity: Array<{
    activityType: string;
    createdAt: string;
    deviceLabel: string;
    id: string;
    locationLabel: string;
  }>;
  assignedToUserId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  details: string | null;
  events: Array<{
    actorUserId: string | null;
    createdAt: string;
    eventType: string;
    fromStatus: string | null;
    id: string;
    note: string | null;
    toStatus: string | null;
  }>;
  id: string;
  preferences: AccountSecurityPreferences | null;
  priority: string;
  recoveryCodeVerified: boolean;
  requestType: string;
  resolutionSummary: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  riskLevel: string;
  sessions: Array<{
    createdAt: string;
    deviceLabel: string;
    id: string;
    lastSeenAt: string;
    locationLabel: string;
    revokedAt: string | null;
    trustedAt: string | null;
  }>;
  status: string;
  updatedAt: string;
  user: RecoverySupportUserRow | null;
  userId: string;
};

export type RecoveryBackOfficeOverview =
  | {
      authorized: false;
      reason: string;
    }
  | {
      authorized: true;
      cases: RecoveryBackOfficeCase[];
      loadWarning: string | null;
      stats: {
        open: number;
        reviewing: number;
        highRisk: number;
        total: number;
      };
      supportUser: {
        email: string | null;
        id: string;
        name: string | null;
      };
    };

function logSupabaseError(
  label: string,
  error: SupabaseErrorLike,
  metadata: Record<string, unknown> = {},
) {
  console.error(label, {
    code: error.code,
    details: error.details,
    hint: error.hint,
    message: error.message,
    ...metadata,
  });
}

function rowText(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function mapPreferences(
  row: RecoverySupportPreferencesRow | undefined,
): AccountSecurityPreferences | null {
  if (!row) {
    return null;
  }

  return {
    loginAlertsEnabled: row.login_alerts_enabled,
    recoveryEmail: row.recovery_email,
    recoveryPhone: row.recovery_phone,
    smsLoginAlertsEnabled: row.sms_login_alerts_enabled ?? true,
    updatedAt: null,
  };
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}

function metadataFlag(value: unknown, key: string) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as Record<string, unknown>)[key] === true
  );
}

async function isCurrentUserSupportAdmin(
  supabase: AuthenticatedSupabaseClient,
) {
  const { data, error } = await supabase.rpc(
    "lifecycle_current_user_is_support_admin",
  );

  if (error) {
    if (!isLoginSecuritySchemaMissing(error)) {
      logSupabaseError("Supabase support-admin check failed", error);
    }

    return false;
  }

  return data === true;
}

async function currentUserHasPlatformRecoveryPermission(
  permission: PlatformAdminPermission,
) {
  const context = await getCurrentPlatformAdminContext();

  if (!context) {
    return false;
  }

  return (
    context.permissions.includes(permission) ||
    (permission === PLATFORM_ADMIN_PERMISSIONS.recoveryRead &&
      context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.recoveryManage))
  );
}

async function currentUserCanReadRecoveryBackOffice(
  supabase: AuthenticatedSupabaseClient,
) {
  if (await isCurrentUserSupportAdmin(supabase)) {
    return true;
  }

  return currentUserHasPlatformRecoveryPermission(
    PLATFORM_ADMIN_PERMISSIONS.recoveryRead,
  );
}

async function currentUserCanManageRecoveryBackOfficeWithClient(
  supabase: AuthenticatedSupabaseClient,
) {
  if (await isCurrentUserSupportAdmin(supabase)) {
    return true;
  }

  return currentUserHasPlatformRecoveryPermission(
    PLATFORM_ADMIN_PERMISSIONS.recoveryManage,
  );
}

export async function currentUserCanAccessRecoveryBackOffice() {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  return currentUserCanReadRecoveryBackOffice(supabase);
}

export async function currentUserCanManageRecoveryBackOffice() {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  return currentUserCanManageRecoveryBackOfficeWithClient(supabase);
}

async function safeList<T>(input: {
  fallback: T[];
  label: string;
  load: () => PromiseLike<{ data: T[] | null; error: SupabaseErrorLike | null }>;
}) {
  const { data, error } = await input.load();

  if (!error) {
    return {
      data: data ?? input.fallback,
      warning: null,
    };
  }

  if (isLoginSecuritySchemaMissing(error)) {
    return {
      data: input.fallback,
      warning:
        "Recovery support is temporarily unavailable. Please try again later.",
    };
  }

  logSupabaseError(input.label, error);
  return {
    data: input.fallback,
    warning: "Some recovery back-office data could not be loaded.",
  };
}

export async function loadRecoveryBackOfficeOverview(requestId?: string): Promise<RecoveryBackOfficeOverview | null> {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!user) {
    return null;
  }

  if (!supabase) {
    return {
      authorized: false,
      reason: "Account security is temporarily unavailable. Please try again later.",
    };
  }

  if (!(await currentUserCanReadRecoveryBackOffice(supabase))) {
    return {
      authorized: false,
      reason:
        "Recovery back office is available only to support admins or platform recovery admins.",
    };
  }

  let requestsQuery = supabase.from("account_recovery_requests").select(
    "id, user_id, request_type, status, priority, risk_level, assigned_to_user_id, reviewed_by_user_id, reviewed_at, resolved_by_user_id, resolved_at, resolution_summary, contact_email, contact_phone, details, created_at, updated_at",
  ).order("created_at", { ascending: false });
  if (requestId) requestsQuery = requestsQuery.eq("id", requestId);
  const requestsResult = await safeList<RecoveryRequestSupportRow>({
    fallback: [],
    label: "Supabase load recovery support requests failed",
    load: () => requestsQuery.limit(50).returns<RecoveryRequestSupportRow[]>(),
  });
  const requests = requestsResult.data;
  const userIds = unique(requests.map((request) => request.user_id));
  const requestIds = requests.map((request) => request.id);

  if (requests.length === 0) {
    return {
      authorized: true,
      cases: [],
      loadWarning: requestsResult.warning,
      stats: {
        highRisk: 0,
        open: 0,
        reviewing: 0,
        total: 0,
      },
      supportUser: {
        email: user.email,
        id: user.id,
        name: user.display_name,
      },
    };
  }

  const [
    usersResult,
    preferencesResult,
    sessionsResult,
    activityResult,
    eventsResult,
  ] = await Promise.all([
    safeList<RecoverySupportUserRow>({
      fallback: [],
      label: "Supabase load recovery support users failed",
      load: () =>
        supabase
          .from("users")
          .select("id, email, phone, display_name, status, last_login_at, created_at")
          .in("id", userIds)
          .returns<RecoverySupportUserRow[]>(),
    }),
    safeList<RecoverySupportPreferencesRow>({
      fallback: [],
      label: "Supabase load recovery support preferences failed",
      load: () =>
        supabase
          .from("account_security_preferences")
          .select(
            "user_id, recovery_email, recovery_phone, login_alerts_enabled, sms_login_alerts_enabled",
          )
          .in("user_id", userIds)
          .returns<RecoverySupportPreferencesRow[]>(),
    }),
    safeList<RecoverySupportSessionRow>({
      fallback: [],
      label: "Supabase load recovery support sessions failed",
      load: () =>
        supabase
          .from("account_login_sessions")
          .select(
            "id, user_id, device_label, location_label, trusted_at, revoked_at, last_seen_at, created_at",
          )
          .in("user_id", userIds)
          .order("last_seen_at", { ascending: false })
          .limit(150)
          .returns<RecoverySupportSessionRow[]>(),
    }),
    safeList<RecoverySupportActivityRow>({
      fallback: [],
      label: "Supabase load recovery support activity failed",
      load: () =>
        supabase
          .from("account_login_activity")
          .select("id, user_id, activity_type, device_label, location_label, created_at")
          .in("user_id", userIds)
          .order("created_at", { ascending: false })
          .limit(150)
          .returns<RecoverySupportActivityRow[]>(),
    }),
    safeList<RecoverySupportEventRow>({
      fallback: [],
      label: "Supabase load recovery support events failed",
      load: () =>
        supabase
          .from("account_recovery_request_events")
          .select(
            "id, request_id, actor_user_id, event_type, from_status, to_status, note, metadata, created_at",
          )
          .in("request_id", requestIds)
          .order("created_at", { ascending: false })
          .limit(200)
          .returns<RecoverySupportEventRow[]>(),
    }),
  ]);

  const usersById = Object.fromEntries(
    usersResult.data.map((item) => [item.id, item]),
  );
  const preferencesByUserId = Object.fromEntries(
    preferencesResult.data.map((item) => [item.user_id, item]),
  );
  const sessionsByUserId = groupBy(
    sessionsResult.data,
    (item) => item.user_id,
  );
  const activityByUserId = groupBy(
    activityResult.data,
    (item) => item.user_id,
  );
  const eventsByRequestId = groupBy(
    eventsResult.data,
    (item) => item.request_id,
  );
  const cases = requests.map<RecoveryBackOfficeCase>((request) => ({
    activity: (activityByUserId[request.user_id] ?? []).slice(0, 5).map((item) => ({
      activityType: item.activity_type,
      createdAt: item.created_at,
      deviceLabel: rowText(item.device_label, "Unknown device"),
      id: item.id,
      locationLabel: rowText(item.location_label, "Unknown location"),
    })),
    assignedToUserId: request.assigned_to_user_id,
    contactEmail: request.contact_email,
    contactPhone: request.contact_phone,
    createdAt: request.created_at,
    details: request.details,
    events: (eventsByRequestId[request.id] ?? []).slice(0, 6).map((item) => ({
      actorUserId: item.actor_user_id,
      createdAt: item.created_at,
      eventType: item.event_type,
      fromStatus: item.from_status,
      id: item.id,
      note: item.note,
      toStatus: item.to_status,
    })),
    id: request.id,
    preferences: mapPreferences(preferencesByUserId[request.user_id]),
    priority: request.priority ?? "normal",
    recoveryCodeVerified: (eventsByRequestId[request.id] ?? []).some((item) =>
      metadataFlag(item.metadata, "verified_recovery_code"),
    ),
    requestType: request.request_type,
    resolutionSummary: request.resolution_summary,
    resolvedAt: request.resolved_at,
    resolvedByUserId: request.resolved_by_user_id,
    reviewedAt: request.reviewed_at,
    reviewedByUserId: request.reviewed_by_user_id,
    riskLevel: request.risk_level ?? "unknown",
    sessions: (sessionsByUserId[request.user_id] ?? []).slice(0, 5).map((item) => ({
      createdAt: item.created_at,
      deviceLabel: rowText(item.device_label, "Unknown device"),
      id: item.id,
      lastSeenAt: item.last_seen_at,
      locationLabel: rowText(item.location_label, "Unknown location"),
      revokedAt: item.revoked_at,
      trustedAt: item.trusted_at,
    })),
    status: request.status,
    updatedAt: request.updated_at,
    user: usersById[request.user_id] ?? null,
    userId: request.user_id,
  }));
  const loadWarning = [
    requestsResult.warning,
    usersResult.warning,
    preferencesResult.warning,
    sessionsResult.warning,
    activityResult.warning,
    eventsResult.warning,
  ].find(Boolean) ?? null;

  return {
    authorized: true,
    cases,
    loadWarning,
    stats: {
      highRisk: cases.filter((item) =>
        ["high", "critical"].includes(item.riskLevel),
      ).length,
      open: cases.filter((item) => item.status === "open").length,
      reviewing: cases.filter((item) => item.status === "reviewing").length,
      total: cases.length,
    },
    supportUser: {
      email: user.email,
      id: user.id,
      name: user.display_name,
    },
  };
}
