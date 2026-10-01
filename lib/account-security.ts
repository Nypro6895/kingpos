import "server-only";

import {
  ACCOUNT_LOGIN_SESSION_COOKIE,
  getLoginRequestSnapshot,
  isAccountLoginSessionId,
  type LoginDeviceType,
  type LoginRequestSnapshot,
} from "@/lib/account-security-shared";
import {
  createAuthenticatedSupabaseAuthSessionServerClient,
  createAuthenticatedSupabaseServerClient,
  createUserScopedSupabaseServerClient,
} from "@/lib/supabase/server";
import {
  getLoginSmsAlertStatus,
  sendLoginSmsAlert,
} from "@/lib/login-sms-alerts";
import {
  getCurrentKingUser,
  getKingUserForAuthUser,
} from "@/lib/users/current-user";
import type { KingUser } from "@/types/user";
import { cookies, headers } from "next/headers";

type AuthenticatedSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type SupabaseErrorLike = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};

type PreferencesRow = {
  login_alerts_enabled: boolean;
  recovery_email: string | null;
  recovery_phone: string | null;
  sms_login_alerts_enabled: boolean | null;
  updated_at: string;
  user_id: string;
};

type LoginSessionRow = {
  auth_user_id: string | null;
  browser_name: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
  device_label: string | null;
  device_type: LoginDeviceType | null;
  id: string;
  last_seen_at: string;
  location_label: string | null;
  os_name: string | null;
  region: string | null;
  revoked_at: string | null;
  trusted_at: string | null;
  user_agent: string | null;
  user_id: string;
};

type TrustedDeviceRow = {
  browser_name: string | null;
  created_at: string;
  device_label: string | null;
  device_type: LoginDeviceType | null;
  id: string;
  last_seen_at: string | null;
  location_label: string | null;
  os_name: string | null;
  trusted_at: string;
};

type LoginActivityRow = {
  activity_type: string;
  browser_name: string | null;
  created_at: string;
  device_label: string | null;
  id: string;
  location_label: string | null;
  metadata: unknown;
  os_name: string | null;
};

type RecoveryCodeRow = {
  created_at: string;
  id: string;
  used_at: string | null;
};

type RecoveryRequestRow = {
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  details: string | null;
  id: string;
  request_type: string;
  status: string;
  updated_at: string;
};

export type AccountSecurityPreferences = {
  loginAlertsEnabled: boolean;
  recoveryEmail: string | null;
  recoveryPhone: string | null;
  smsLoginAlertsEnabled: boolean;
  updatedAt: string | null;
};

export type AccountLoginSession = {
  browserName: string;
  city: string | null;
  country: string | null;
  createdAt: string;
  deviceLabel: string;
  deviceType: LoginDeviceType;
  id: string | null;
  isCurrent: boolean;
  lastSeenAt: string;
  locationLabel: string;
  osName: string;
  region: string | null;
  revokedAt: string | null;
  trustedAt: string | null;
  userAgent: string | null;
};

export type AccountTrustedDevice = {
  browserName: string;
  createdAt: string;
  deviceLabel: string;
  deviceType: LoginDeviceType;
  id: string;
  isCurrent: boolean;
  lastSeenAt: string | null;
  locationLabel: string;
  osName: string;
  trustedAt: string;
};

export type AccountLoginActivity = {
  activityType: string;
  browserName: string;
  createdAt: string;
  deviceLabel: string;
  id: string;
  locationLabel: string;
  osName: string;
};

export type AccountRecoveryCodeSummary = {
  lastGeneratedAt: string | null;
  total: number;
  unused: number;
  used: number;
};

export type AccountRecoveryRequest = {
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  details: string | null;
  id: string;
  requestType: string;
  status: string;
  updatedAt: string;
};

export type AccountMfaFactor = {
  createdAt: string | null;
  factorType: "phone" | "totp";
  friendlyName: string | null;
  id: string;
  phone: string | null;
  status: string;
  updatedAt: string | null;
};

export type AccountMfaOverview = {
  currentLevel: string | null;
  factors: AccountMfaFactor[];
  nextLevel: string | null;
  unavailableReason: string | null;
};

export type AccountSmsLoginAlertStatus = {
  configured: boolean;
  provider: "twilio";
};

export type LoginSecurityOverview = {
  account: {
    email: string | null;
    id: string;
    lastLoginAt: string | null;
    phone: string | null;
    status: string;
  };
  activity: AccountLoginActivity[];
  currentRequest: LoginRequestSnapshot;
  currentSessionId: string | null;
  dataUnavailableReason: string | null;
  mfa: AccountMfaOverview;
  preferences: AccountSecurityPreferences;
  recoveryCodes: AccountRecoveryCodeSummary;
  recoveryRequests: AccountRecoveryRequest[];
  sessions: AccountLoginSession[];
  smsLoginAlerts: AccountSmsLoginAlertStatus;
  trustedDevices: AccountTrustedDevice[];
};

export const LOGIN_SECURITY_PATH = "/settings/login-security";

const PREFERENCES_SELECT =
  "user_id, recovery_email, recovery_phone, login_alerts_enabled, sms_login_alerts_enabled, updated_at";
const SESSION_SELECT =
  "id, user_id, auth_user_id, device_label, browser_name, os_name, device_type, city, region, country, location_label, user_agent, trusted_at, revoked_at, last_seen_at, created_at";
const TRUSTED_DEVICE_SELECT =
  "id, device_label, browser_name, os_name, device_type, location_label, trusted_at, last_seen_at, created_at";
const ACTIVITY_SELECT =
  "id, activity_type, device_label, browser_name, os_name, location_label, metadata, created_at";
const RECOVERY_REQUEST_SELECT =
  "id, request_type, status, contact_email, contact_phone, details, created_at, updated_at";

function fallbackPreferences(user: KingUser): AccountSecurityPreferences {
  return {
    loginAlertsEnabled: true,
    recoveryEmail: user.email,
    recoveryPhone: user.phone,
    smsLoginAlertsEnabled: Boolean(user.phone),
    updatedAt: null,
  };
}

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

export function isLoginSecuritySchemaMissing(
  error: SupabaseErrorLike | null | undefined,
) {
  const message = error?.message ?? "";

  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    (error?.code === "PGRST205" &&
      /account_(security|login|trusted|recovery)/i.test(message))
  );
}

function rowText(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function mapSession(
  row: LoginSessionRow,
  currentSessionId: string | null,
): AccountLoginSession {
  return {
    browserName: rowText(row.browser_name, "Unknown browser"),
    city: row.city,
    country: row.country,
    createdAt: row.created_at,
    deviceLabel: rowText(row.device_label, "Unknown device"),
    deviceType: row.device_type ?? "unknown",
    id: row.id,
    isCurrent: row.id === currentSessionId,
    lastSeenAt: row.last_seen_at,
    locationLabel: rowText(row.location_label, "Unknown location"),
    osName: rowText(row.os_name, "Unknown OS"),
    region: row.region,
    revokedAt: row.revoked_at,
    trustedAt: row.trusted_at,
    userAgent: row.user_agent,
  };
}

function currentSessionFallback(input: {
  currentRequest: LoginRequestSnapshot;
  currentSessionId: string | null;
}): AccountLoginSession {
  const now = new Date().toISOString();

  return {
    browserName: input.currentRequest.browserName,
    city: input.currentRequest.city,
    country: input.currentRequest.country,
    createdAt: now,
    deviceLabel: input.currentRequest.deviceLabel,
    deviceType: input.currentRequest.deviceType,
    id: input.currentSessionId,
    isCurrent: true,
    lastSeenAt: now,
    locationLabel: input.currentRequest.locationLabel,
    osName: input.currentRequest.osName,
    region: input.currentRequest.region,
    revokedAt: null,
    trustedAt: null,
    userAgent: input.currentRequest.userAgent,
  };
}

function mapTrustedDevice(
  row: TrustedDeviceRow,
  currentSessionId: string | null,
): AccountTrustedDevice {
  return {
    browserName: rowText(row.browser_name, "Unknown browser"),
    createdAt: row.created_at,
    deviceLabel: rowText(row.device_label, "Unknown device"),
    deviceType: row.device_type ?? "unknown",
    id: row.id,
    isCurrent: row.id === currentSessionId,
    lastSeenAt: row.last_seen_at,
    locationLabel: rowText(row.location_label, "Unknown location"),
    osName: rowText(row.os_name, "Unknown OS"),
    trustedAt: row.trusted_at,
  };
}

function mapActivity(row: LoginActivityRow): AccountLoginActivity {
  return {
    activityType: row.activity_type,
    browserName: rowText(row.browser_name, "Unknown browser"),
    createdAt: row.created_at,
    deviceLabel: rowText(row.device_label, "Unknown device"),
    id: row.id,
    locationLabel: rowText(row.location_label, "Unknown location"),
    osName: rowText(row.os_name, "Unknown OS"),
  };
}

function recoveryCodeSummary(rows: RecoveryCodeRow[]): AccountRecoveryCodeSummary {
  const used = rows.filter((row) => row.used_at).length;
  const lastGeneratedAt =
    rows
      .map((row) => row.created_at)
      .sort()
      .at(-1) ?? null;

  return {
    lastGeneratedAt,
    total: rows.length,
    unused: rows.length - used,
    used,
  };
}

function mapRecoveryRequest(row: RecoveryRequestRow): AccountRecoveryRequest {
  return {
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    createdAt: row.created_at,
    details: row.details,
    id: row.id,
    requestType: row.request_type,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

async function maybeSendLoginSmsAlert(input: {
  sessionId: string;
  snapshot: LoginRequestSnapshot;
  supabase: NonNullable<ReturnType<typeof createUserScopedSupabaseServerClient>>;
  user: KingUser;
}) {
  if (!input.user.phone) {
    return;
  }

  const { data: preferences, error: preferencesError } = await input.supabase
    .from("account_security_preferences")
    .select("sms_login_alerts_enabled")
    .eq("user_id", input.user.id)
    .maybeSingle<{ sms_login_alerts_enabled: boolean | null }>();

  if (preferencesError) {
    if (!isLoginSecuritySchemaMissing(preferencesError)) {
      logSupabaseError("Supabase load SMS login alert preference failed", preferencesError, {
        userId: input.user.id,
      });
    }

    return;
  }

  if (preferences?.sms_login_alerts_enabled === false) {
    return;
  }

  const result = await sendLoginSmsAlert({
    deviceLabel: input.snapshot.deviceLabel,
    locationLabel: input.snapshot.locationLabel,
    phone: input.user.phone,
  });
  const now = new Date().toISOString();
  const activityType = result.ok
    ? "login_sms_alert_sent"
    : "login_sms_alert_failed";
  const metadata = result.ok
    ? {
        message_id: result.messageId,
        provider: result.provider,
      }
    : {
        code: result.code,
        message: result.message,
      };
  const activityResult = await input.supabase.from("account_login_activity").insert({
    activity_type: activityType,
    browser_name: input.snapshot.browserName,
    city: input.snapshot.city,
    country: input.snapshot.country,
    device_label: input.snapshot.deviceLabel,
    device_type: input.snapshot.deviceType,
    ip_address: input.snapshot.ipAddress,
    location_label: input.snapshot.locationLabel,
    login_session_id: input.sessionId,
    metadata,
    os_name: input.snapshot.osName,
    region: input.snapshot.region,
    user_agent: input.snapshot.userAgent,
    user_id: input.user.id,
    created_at: now,
  });

  if (activityResult.error && !isLoginSecuritySchemaMissing(activityResult.error)) {
    logSupabaseError("Supabase record SMS login alert activity failed", activityResult.error, {
      userId: input.user.id,
    });
  }
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readMfaFactorType(value: string | null) {
  return value === "phone" || value === "totp" ? value : null;
}

function mapMfaFactor(
  value: unknown,
  fallbackType: AccountMfaFactor["factorType"],
): AccountMfaFactor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = stringFromRecord(record, "id");
  const factorType = readMfaFactorType(stringFromRecord(record, "factor_type")) ??
    fallbackType;

  if (!id) {
    return null;
  }

  return {
    createdAt: stringFromRecord(record, "created_at"),
    factorType,
    friendlyName: stringFromRecord(record, "friendly_name"),
    id,
    phone: stringFromRecord(record, "phone"),
    status: stringFromRecord(record, "status") ?? "unverified",
    updatedAt: stringFromRecord(record, "updated_at"),
  };
}

async function loadMfaOverview(): Promise<AccountMfaOverview> {
  const supabase = await createAuthenticatedSupabaseAuthSessionServerClient();

  if (!supabase) {
    return {
      currentLevel: null,
      factors: [],
      nextLevel: null,
      unavailableReason: "Sign in again to manage two-factor authentication.",
    };
  }

  const [factorsResult, assuranceResult] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  if (factorsResult.error) {
    return {
      currentLevel: null,
      factors: [],
      nextLevel: null,
      unavailableReason:
        factorsResult.error.message ||
        "Two-factor authentication could not be loaded.",
    };
  }

  const mfaData = factorsResult.data as
    | {
        phone?: unknown[];
        totp?: unknown[];
      }
    | null
    | undefined;
  const factors = [
    ...(mfaData?.totp ?? []).map((factor) => mapMfaFactor(factor, "totp")),
    ...(mfaData?.phone ?? []).map((factor) => mapMfaFactor(factor, "phone")),
  ]
    .filter((factor): factor is AccountMfaFactor => Boolean(factor));

  return {
    currentLevel: assuranceResult.data?.currentLevel ?? null,
    factors,
    nextLevel: assuranceResult.data?.nextLevel ?? null,
    unavailableReason: assuranceResult.error
      ? assuranceResult.error.message ||
        "Two-factor authentication status could not be checked."
      : null,
  };
}

async function safeQuery<T>(input: {
  fallback: T;
  label: string;
  load: () => PromiseLike<{ data: T | null; error: SupabaseErrorLike | null }>;
  onSchemaMissing: () => void;
  userId: string;
}) {
  const { data, error } = await input.load();

  if (!error) {
    return data ?? input.fallback;
  }

  if (isLoginSecuritySchemaMissing(error)) {
    input.onSchemaMissing();
    return input.fallback;
  }

  logSupabaseError(input.label, error, { userId: input.userId });
  return input.fallback;
}

async function loadPreferences(input: {
  markSchemaMissing: () => void;
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  const row = await safeQuery<PreferencesRow | null>({
    fallback: null,
    label: "Supabase load account security preferences failed",
    load: () =>
      input.supabase
        .from("account_security_preferences")
        .select(PREFERENCES_SELECT)
        .eq("user_id", input.user.id)
        .maybeSingle<PreferencesRow>(),
    onSchemaMissing: input.markSchemaMissing,
    userId: input.user.id,
  });

  if (!row) {
    return fallbackPreferences(input.user);
  }

  return {
    loginAlertsEnabled: row.login_alerts_enabled,
    recoveryEmail: row.recovery_email ?? input.user.email,
    recoveryPhone: row.recovery_phone ?? input.user.phone,
    smsLoginAlertsEnabled:
      row.sms_login_alerts_enabled ?? Boolean(input.user.phone),
    updatedAt: row.updated_at,
  };
}

export async function loadLoginSecurityOverview(): Promise<LoginSecurityOverview | null> {
  const [supabase, user, cookieStore, headerStore] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
    cookies(),
    headers(),
  ]);

  if (!user) {
    return null;
  }

  const currentRequest = getLoginRequestSnapshot(headerStore);
  const cookieSessionId = cookieStore.get(ACCOUNT_LOGIN_SESSION_COOKIE)?.value;
  const currentSessionId = isAccountLoginSessionId(cookieSessionId)
    ? cookieSessionId
    : null;
  let schemaMissing = false;
  const markSchemaMissing = () => {
    schemaMissing = true;
  };
  const defaultRecoveryCodes = {
    lastGeneratedAt: null,
    total: 0,
    unused: 0,
    used: 0,
  };

  if (!supabase) {
    return {
      account: {
        email: user.email,
        id: user.id,
        lastLoginAt: user.last_login_at,
        phone: user.phone,
        status: user.status,
      },
      activity: [],
      currentRequest,
      currentSessionId,
      dataUnavailableReason: "Account security is temporarily unavailable. Please try again later.",
      mfa: await loadMfaOverview(),
      preferences: fallbackPreferences(user),
      recoveryCodes: defaultRecoveryCodes,
      recoveryRequests: [],
      sessions: [
        currentSessionFallback({
          currentRequest,
          currentSessionId,
        }),
      ],
      smsLoginAlerts: getLoginSmsAlertStatus(),
      trustedDevices: [],
    };
  }

  const [
    preferences,
    sessionRows,
    trustedDeviceRows,
    activityRows,
    recoveryCodeRows,
    recoveryRequestRows,
    mfa,
  ] = await Promise.all([
    loadPreferences({ markSchemaMissing, supabase, user }),
    safeQuery<LoginSessionRow[]>({
      fallback: [],
      label: "Supabase load account login sessions failed",
      load: () =>
        supabase
          .from("account_login_sessions")
          .select(SESSION_SELECT)
          .eq("user_id", user.id)
          .is("revoked_at", null)
          .order("last_seen_at", { ascending: false })
          .limit(12)
          .returns<LoginSessionRow[]>(),
      onSchemaMissing: markSchemaMissing,
      userId: user.id,
    }),
    safeQuery<TrustedDeviceRow[]>({
      fallback: [],
      label: "Supabase load account trusted devices failed",
      load: () =>
        supabase
          .from("account_trusted_devices")
          .select(TRUSTED_DEVICE_SELECT)
          .eq("user_id", user.id)
          .is("removed_at", null)
          .order("trusted_at", { ascending: false })
          .limit(12)
          .returns<TrustedDeviceRow[]>(),
      onSchemaMissing: markSchemaMissing,
      userId: user.id,
    }),
    safeQuery<LoginActivityRow[]>({
      fallback: [],
      label: "Supabase load account login activity failed",
      load: () =>
        supabase
          .from("account_login_activity")
          .select(ACTIVITY_SELECT)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(16)
          .returns<LoginActivityRow[]>(),
      onSchemaMissing: markSchemaMissing,
      userId: user.id,
    }),
    safeQuery<RecoveryCodeRow[]>({
      fallback: [],
      label: "Supabase load account recovery codes failed",
      load: () =>
        supabase
          .from("account_recovery_codes")
          .select("id, used_at, created_at")
          .eq("user_id", user.id)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .returns<RecoveryCodeRow[]>(),
      onSchemaMissing: markSchemaMissing,
      userId: user.id,
    }),
    safeQuery<RecoveryRequestRow[]>({
      fallback: [],
      label: "Supabase load account recovery requests failed",
      load: () =>
        supabase
          .from("account_recovery_requests")
          .select(RECOVERY_REQUEST_SELECT)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5)
          .returns<RecoveryRequestRow[]>(),
      onSchemaMissing: markSchemaMissing,
      userId: user.id,
    }),
    loadMfaOverview(),
  ]);
  const sessions = sessionRows.map((row) => mapSession(row, currentSessionId));
  const hasCurrentSession = sessions.some((session) => session.isCurrent);

  if (!hasCurrentSession) {
    sessions.unshift(
      currentSessionFallback({
        currentRequest,
        currentSessionId,
      }),
    );
  }

  return {
    account: {
      email: user.email,
      id: user.id,
      lastLoginAt: user.last_login_at,
      phone: user.phone,
      status: user.status,
    },
    activity: activityRows.map(mapActivity),
    currentRequest,
    currentSessionId,
    dataUnavailableReason: schemaMissing
      ? "Security settings are temporarily unavailable. Please try again later or contact support."
      : null,
    mfa,
    preferences,
    recoveryCodes: recoveryCodeSummary(recoveryCodeRows),
    recoveryRequests: recoveryRequestRows.map(mapRecoveryRequest),
    sessions,
    smsLoginAlerts: getLoginSmsAlertStatus(),
    trustedDevices: trustedDeviceRows.map((row) =>
      mapTrustedDevice(row, currentSessionId),
    ),
  };
}

export async function recordAccountLoginForSession(input: {
  accessToken: string;
  requestHeaders: Pick<Headers, "get">;
  sessionId: string;
}) {
  if (!isAccountLoginSessionId(input.sessionId)) {
    return;
  }

  const supabase = createUserScopedSupabaseServerClient(input.accessToken);

  if (!supabase) {
    return;
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(
    input.accessToken,
  );

  if (authError || !authData.user) {
    return;
  }

  const user = await getKingUserForAuthUser(authData.user, input.accessToken);

  if (!user) {
    return;
  }

  const snapshot = getLoginRequestSnapshot(input.requestHeaders);
  const { error } = await supabase.rpc("record_account_login_session", {
    p_browser_name: snapshot.browserName,
    p_city: snapshot.city,
    p_country: snapshot.country,
    p_device_label: snapshot.deviceLabel,
    p_device_type: snapshot.deviceType,
    p_ip_address: snapshot.ipAddress,
    p_location_label: snapshot.locationLabel,
    p_os_name: snapshot.osName,
    p_region: snapshot.region,
    p_session_id: input.sessionId,
    p_user_agent: snapshot.userAgent,
  });

  if (error && !isLoginSecuritySchemaMissing(error)) {
    logSupabaseError("Supabase record account login session failed", error, {
      sessionId: input.sessionId,
      userId: user.id,
    });
  }

  if (!error) {
    await maybeSendLoginSmsAlert({
      sessionId: input.sessionId,
      snapshot,
      supabase,
      user,
    }).catch((smsError: unknown) => {
      console.error("Login SMS alert failed", {
        message:
          smsError instanceof Error ? smsError.message : String(smsError),
        userId: user.id,
      });
    });
  }
}

export async function recordCurrentAccountSessionLogout() {
  const [supabase, user, cookieStore, headerStore] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
    cookies(),
    headers(),
  ]);

  if (!supabase || !user) {
    return;
  }

  const sessionId = cookieStore.get(ACCOUNT_LOGIN_SESSION_COOKIE)?.value;

  if (!isAccountLoginSessionId(sessionId)) {
    return;
  }

  const revokedAt = new Date().toISOString();
  const snapshot = getLoginRequestSnapshot(headerStore);
  const revokeResult = await supabase
    .from("account_login_sessions")
    .update({
      revoked_at: revokedAt,
      revoked_by_user_id: user.id,
    })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (revokeResult.error && !isLoginSecuritySchemaMissing(revokeResult.error)) {
    logSupabaseError(
      "Supabase record current account session logout failed",
      revokeResult.error,
      {
        sessionId,
        userId: user.id,
      },
    );
  }

  const activityResult = await supabase.from("account_login_activity").insert({
    activity_type: "session_logged_out",
    browser_name: snapshot.browserName,
    city: snapshot.city,
    country: snapshot.country,
    device_label: snapshot.deviceLabel,
    device_type: snapshot.deviceType,
    ip_address: snapshot.ipAddress,
    location_label: snapshot.locationLabel,
    login_session_id: sessionId,
    metadata: {},
    os_name: snapshot.osName,
    region: snapshot.region,
    user_agent: snapshot.userAgent,
    user_id: user.id,
  });

  if (
    activityResult.error &&
    !isLoginSecuritySchemaMissing(activityResult.error)
  ) {
    logSupabaseError(
      "Supabase record current account logout activity failed",
      activityResult.error,
      {
        sessionId,
        userId: user.id,
      },
    );
  }
}
