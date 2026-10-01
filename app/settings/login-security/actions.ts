"use server";

import {
  ACCOUNT_LOGIN_SESSION_COOKIE,
  getLoginRequestSnapshot,
  isAccountLoginSessionId,
} from "@/lib/account-security-shared";
import {
  LOGIN_SECURITY_PATH,
  isLoginSecuritySchemaMissing,
} from "@/lib/account-security";
import { clearWorkspaceContextCookies } from "@/lib/current-context";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import {
  clearSupabaseSessionCookies,
  createAuthenticatedSupabaseAuthSessionServerClient,
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
  setSupabaseSessionCookies,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { KingUser } from "@/types/user";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

type ActionInput = FormData | Record<string, unknown>;
type AuthenticatedSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;
type AuthSessionSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseAuthSessionServerClient>>
>;
type SupabaseErrorLike = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};
type MutationContextResult =
  | {
      error: string;
      ok: false;
    }
  | {
      error: null;
      ok: true;
      supabase: AuthenticatedSupabaseClient;
      user: KingUser;
    };

export type LoginSecurityActionResult = {
  error: string | null;
  message?: string;
  redirectTo?: string;
};

export type RecoveryCodesActionResult =
  | {
      codes: string[];
      error: null;
      message: string;
    }
  | {
      codes?: never;
      error: string;
      message?: never;
    };

export type TotpEnrollmentActionResult =
  | {
      enrollment: {
        factorId: string;
        qrCode: string | null;
        secret: string | null;
      };
      error: null;
      message: string;
    }
  | {
      enrollment?: never;
      error: string;
      message?: never;
    };

export type PhoneMfaEnrollmentActionResult =
  | {
      enrollment: {
        challengeId: string;
        factorId: string;
        phone: string;
      };
      error: null;
      message: string;
    }
  | {
      enrollment?: never;
      error: string;
      message?: never;
    };

const LOGIN_REDIRECT = "/login?message=You have been logged out.";
const PASSWORD_MIN_LENGTH = 8;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_REQUEST_TYPES = new Set([
  "lost_access",
  "lost_device",
  "account_compromised",
  "secure_account",
]);

function readActionValue(input: ActionInput, key: string) {
  return input instanceof FormData ? input.get(key) : input[key];
}

function readActionString(input: ActionInput, key: string) {
  const value = readActionValue(input, key);
  return typeof value === "string" ? value.trim() : "";
}

function readActionOptionalString(input: ActionInput, key: string) {
  return readActionString(input, key) || null;
}

function readActionBoolean(input: ActionInput, key: string) {
  const value = readActionValue(input, key);

  if (typeof value === "boolean") {
    return value;
  }

  return value === "on" || value === "true";
}

function normalizeRecoveryEmail(value: string | null) {
  const email = value?.trim().toLowerCase() ?? "";

  if (!email) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "invalid";
}

function schemaUnavailableResult(): LoginSecurityActionResult {
  return {
    error:
      "Security settings are temporarily unavailable. Please try again later or contact support.",
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

async function getMutationContext(): Promise<MutationContextResult> {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    return {
      error: "Sign in before updating login security.",
      ok: false,
    };
  }

  return {
    error: null,
    ok: true,
    supabase,
    user,
  };
}

async function getCurrentSessionId() {
  const value = (await cookies()).get(ACCOUNT_LOGIN_SESSION_COOKIE)?.value;
  return isAccountLoginSessionId(value) ? value : null;
}

async function clearCurrentSessionCookies() {
  const cookieStore = await cookies();

  await clearSupabaseSessionCookies();
  clearWorkspaceContextCookies(cookieStore);
  cookieStore.delete(ACCOUNT_LOGIN_SESSION_COOKIE);
}

function recoveryCodeDigest(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function newRecoveryCode() {
  const left = randomBytes(4).toString("hex").toUpperCase();
  const right = randomBytes(4).toString("hex").toUpperCase();

  return `RL-${left}-${right}`;
}

async function recordSecurityActivity(input: {
  activityType: string;
  metadata?: Record<string, unknown>;
  sessionId?: string | null;
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  const snapshot = getLoginRequestSnapshot(await headers());
  const sessionId = input.sessionId ?? (await getCurrentSessionId());
  const { error } = await input.supabase
    .from("account_login_activity")
    .insert({
      activity_type: input.activityType,
      browser_name: snapshot.browserName,
      city: snapshot.city,
      country: snapshot.country,
      device_label: snapshot.deviceLabel,
      device_type: snapshot.deviceType,
      ip_address: snapshot.ipAddress,
      location_label: snapshot.locationLabel,
      login_session_id: sessionId,
      metadata: input.metadata ?? {},
      os_name: snapshot.osName,
      region: snapshot.region,
      user_agent: snapshot.userAgent,
      user_id: input.user.id,
    });

  if (error && !isLoginSecuritySchemaMissing(error)) {
    logSupabaseError("Supabase record account security activity failed", error, {
      activityType: input.activityType,
      userId: input.user.id,
    });
  }
}

async function revokeCurrentSession(input: {
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  const sessionId = await getCurrentSessionId();

  if (!sessionId) {
    return;
  }

  const { error } = await input.supabase
    .from("account_login_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: input.user.id,
    })
    .eq("id", sessionId)
    .eq("user_id", input.user.id)
    .is("revoked_at", null);

  if (error && !isLoginSecuritySchemaMissing(error)) {
    logSupabaseError("Supabase revoke current login session failed", error, {
      sessionId,
      userId: input.user.id,
    });
  }
}

async function revokeOtherSessions(input: {
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  const sessionId = await getCurrentSessionId();

  if (!sessionId) {
    return;
  }

  const { error } = await input.supabase
    .from("account_login_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: input.user.id,
    })
    .eq("user_id", input.user.id)
    .neq("id", sessionId)
    .is("revoked_at", null);

  if (error && !isLoginSecuritySchemaMissing(error)) {
    logSupabaseError("Supabase revoke other login sessions failed", error, {
      sessionId,
      userId: input.user.id,
    });
  }
}

async function revokeAllSessions(input: {
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  const { error } = await input.supabase
    .from("account_login_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: input.user.id,
    })
    .eq("user_id", input.user.id)
    .is("revoked_at", null);

  if (error && !isLoginSecuritySchemaMissing(error)) {
    logSupabaseError("Supabase revoke all login sessions failed", error, {
      userId: input.user.id,
    });
  }
}

async function removeTrustedDevices(input: {
  exceptSessionId?: string | null;
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  let query = input.supabase
    .from("account_trusted_devices")
    .update({ removed_at: new Date().toISOString() })
    .eq("user_id", input.user.id)
    .is("removed_at", null);

  if (input.exceptSessionId) {
    query = query.neq("login_session_id", input.exceptSessionId);
  }

  const { error } = await query;

  if (error && !isLoginSecuritySchemaMissing(error)) {
    logSupabaseError("Supabase remove trusted devices failed", error, {
      userId: input.user.id,
    });
  }
}

async function signOutWithScope(
  supabase: AuthSessionSupabaseClient | null,
  scope: "global" | "local" | "others",
) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut({ scope });

  if (error) {
    logSupabaseError("Supabase sign out failed", error, { scope });
  }
}

function twoFactorSetupError(message: string | null | undefined) {
  const normalized = message?.toLowerCase() ?? "";

  if (
    normalized.includes("mfa") &&
    (normalized.includes("disabled") || normalized.includes("not enabled"))
  ) {
    return "Two-factor authentication is not enabled in Supabase Auth.";
  }

  if (
    normalized.includes("sms") ||
    normalized.includes("phone") ||
    normalized.includes("provider")
  ) {
    return "Text-message verification is temporarily unavailable. Please try again later.";
  }

  return message || "Two-factor authentication setup could not be started.";
}

export async function updateLoginSecurityPreferencesAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const context = await getMutationContext();

  if (!context.ok) {
    return { error: context.error };
  }

  const recoveryEmail = normalizeRecoveryEmail(
    readActionOptionalString(input, "recovery_email"),
  );
  const rawPhone = readActionOptionalString(input, "recovery_phone");
  const recoveryPhone = rawPhone ? normalizePhoneForIdentity(rawPhone) : null;

  if (recoveryEmail === "invalid") {
    return { error: "Enter a valid recovery email." };
  }

  if (rawPhone && !recoveryPhone) {
    return { error: "Enter a valid recovery phone." };
  }

  const { error } = await context.supabase
    .from("account_security_preferences")
    .upsert(
      {
        login_alerts_enabled: readActionBoolean(input, "login_alerts_enabled"),
        recovery_email: recoveryEmail,
        recovery_phone: recoveryPhone,
        sms_login_alerts_enabled: context.user.phone
          ? readActionBoolean(input, "sms_login_alerts_enabled")
          : true,
        user_id: context.user.id,
      },
      { onConflict: "user_id" },
    );

  if (error) {
    if (isLoginSecuritySchemaMissing(error)) {
      return schemaUnavailableResult();
    }

    logSupabaseError("Supabase update login security preferences failed", error, {
      userId: context.user.id,
    });
    return { error: "Login security preferences could not be saved." };
  }

  await recordSecurityActivity({
    activityType: "preferences_updated",
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Login security preferences saved.",
  };
}

export async function changeAccountPasswordAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const currentPassword = readActionString(input, "current_password");
  const newPassword = readActionString(input, "new_password");
  const confirmPassword = readActionString(input, "confirm_password");

  if (!currentPassword) {
    return { error: "Enter your current password." };
  }

  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return { error: "New password must be at least 8 characters." };
  }

  if (newPassword !== confirmPassword) {
    return { error: "New passwords do not match." };
  }

  const [context, authSupabase] = await Promise.all([
    getMutationContext(),
    createAuthenticatedSupabaseAuthSessionServerClient(),
  ]);

  if (!context.ok) {
    return { error: context.error };
  }

  if (!authSupabase) {
    return { error: "Your session expired. Sign in again to change password." };
  }

  if (!context.user.email) {
    return {
      error: "This account does not have an email password to change.",
    };
  }

  const publicSupabase = createSupabaseServerClient();

  if (!publicSupabase) {
    return { error: "Sign-in is temporarily unavailable. Please try again later." };
  }

  const { error: verifyError } = await publicSupabase.auth.signInWithPassword({
    email: context.user.email,
    password: currentPassword,
  });

  if (verifyError) {
    return { error: "Current password is incorrect." };
  }

  const { error: updateError } = await authSupabase.auth.updateUser({
    password: newPassword,
  });

  if (updateError) {
    return {
      error: updateError.message || "Password could not be updated.",
    };
  }

  await revokeOtherSessions({
    supabase: context.supabase,
    user: context.user,
  });
  await signOutWithScope(authSupabase, "others");
  await recordSecurityActivity({
    activityType: "password_changed",
    metadata: { other_sessions_revoked: true },
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Password changed. Other sessions were signed out.",
  };
}

export async function revokeLoginSessionAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const context = await getMutationContext();

  if (!context.ok) {
    return { error: context.error };
  }

  const sessionId = readActionString(input, "session_id");

  if (!isAccountLoginSessionId(sessionId)) {
    return { error: "Session could not be found." };
  }

  if (sessionId === (await getCurrentSessionId())) {
    return logOutCurrentSessionAction();
  }

  const { data, error } = await context.supabase
    .from("account_login_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: context.user.id,
    })
    .eq("id", sessionId)
    .eq("user_id", context.user.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (isLoginSecuritySchemaMissing(error)) {
      return schemaUnavailableResult();
    }

    logSupabaseError("Supabase revoke login session failed", error, {
      sessionId,
      userId: context.user.id,
    });
    return { error: "That session could not be logged out." };
  }

  if (!data) {
    return { error: "That session is already logged out." };
  }

  await recordSecurityActivity({
    activityType: "session_revoked",
    metadata: { session_id: sessionId },
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Session logged out.",
  };
}

export async function logOutCurrentSessionAction(): Promise<LoginSecurityActionResult> {
  const [context, authSupabase] = await Promise.all([
    getMutationContext(),
    createAuthenticatedSupabaseAuthSessionServerClient(),
  ]);

  if (context.ok) {
    await revokeCurrentSession({
      supabase: context.supabase,
      user: context.user,
    });
    await recordSecurityActivity({
      activityType: "session_logged_out",
      supabase: context.supabase,
      user: context.user,
    });
  }

  await signOutWithScope(authSupabase, "local");
  await clearCurrentSessionCookies();

  return {
    error: null,
    redirectTo: LOGIN_REDIRECT,
  };
}

export async function logOutAllSessionsAction(): Promise<LoginSecurityActionResult> {
  const [context, authSupabase] = await Promise.all([
    getMutationContext(),
    createAuthenticatedSupabaseAuthSessionServerClient(),
  ]);

  if (context.ok) {
    await revokeAllSessions({
      supabase: context.supabase,
      user: context.user,
    });
    await removeTrustedDevices({
      supabase: context.supabase,
      user: context.user,
    });
    await recordSecurityActivity({
      activityType: "all_sessions_logged_out",
      metadata: { trusted_devices_removed: true },
      supabase: context.supabase,
      user: context.user,
    });
  }

  await signOutWithScope(authSupabase, "global");
  await clearCurrentSessionCookies();

  return {
    error: null,
    redirectTo: LOGIN_REDIRECT,
  };
}

export async function trustCurrentDeviceAction(): Promise<LoginSecurityActionResult> {
  const context = await getMutationContext();

  if (!context.ok) {
    return { error: context.error };
  }

  const sessionId = await getCurrentSessionId();

  if (!sessionId) {
    return {
      error: "Sign in again before remembering this device.",
    };
  }

  const snapshot = getLoginRequestSnapshot(await headers());
  const trustedAt = new Date().toISOString();
  const { error: sessionError } = await context.supabase
    .from("account_login_sessions")
    .update({ trusted_at: trustedAt })
    .eq("id", sessionId)
    .eq("user_id", context.user.id);

  if (sessionError) {
    if (isLoginSecuritySchemaMissing(sessionError)) {
      return schemaUnavailableResult();
    }

    logSupabaseError("Supabase mark login session trusted failed", sessionError, {
      sessionId,
      userId: context.user.id,
    });
    return { error: "This device could not be remembered." };
  }

  const { data: existing, error: loadError } = await context.supabase
    .from("account_trusted_devices")
    .select("id")
    .eq("user_id", context.user.id)
    .eq("login_session_id", sessionId)
    .is("removed_at", null)
    .maybeSingle<{ id: string }>();

  if (loadError && !isLoginSecuritySchemaMissing(loadError)) {
    logSupabaseError("Supabase load trusted device failed", loadError, {
      sessionId,
      userId: context.user.id,
    });
  }

  const trustedDevicePayload = {
    browser_name: snapshot.browserName,
    device_label: snapshot.deviceLabel,
    device_type: snapshot.deviceType,
    last_seen_at: trustedAt,
    location_label: snapshot.locationLabel,
    login_session_id: sessionId,
    os_name: snapshot.osName,
    trusted_at: trustedAt,
    user_id: context.user.id,
  };
  const trustedDeviceResult = existing?.id
    ? await context.supabase
        .from("account_trusted_devices")
        .update(trustedDevicePayload)
        .eq("id", existing.id)
        .eq("user_id", context.user.id)
    : await context.supabase
        .from("account_trusted_devices")
        .insert(trustedDevicePayload);

  if (trustedDeviceResult.error) {
    if (isLoginSecuritySchemaMissing(trustedDeviceResult.error)) {
      return schemaUnavailableResult();
    }

    logSupabaseError(
      "Supabase save trusted device failed",
      trustedDeviceResult.error,
      {
        sessionId,
        userId: context.user.id,
      },
    );
    return { error: "This device could not be remembered." };
  }

  await recordSecurityActivity({
    activityType: "trusted_device_added",
    metadata: { session_id: sessionId },
    sessionId,
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "This device is now remembered.",
  };
}

export async function removeTrustedDeviceAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const context = await getMutationContext();

  if (!context.ok) {
    return { error: context.error };
  }

  const trustedDeviceId = readActionString(input, "trusted_device_id");

  if (!isAccountLoginSessionId(trustedDeviceId)) {
    return { error: "Trusted device could not be found." };
  }

  const { data, error } = await context.supabase
    .from("account_trusted_devices")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", trustedDeviceId)
    .eq("user_id", context.user.id)
    .is("removed_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    if (isLoginSecuritySchemaMissing(error)) {
      return schemaUnavailableResult();
    }

    logSupabaseError("Supabase remove trusted device failed", error, {
      trustedDeviceId,
      userId: context.user.id,
    });
    return { error: "Trusted device could not be removed." };
  }

  if (!data) {
    return { error: "Trusted device is already removed." };
  }

  await recordSecurityActivity({
    activityType: "trusted_device_removed",
    metadata: { trusted_device_id: trustedDeviceId },
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Trusted device removed.",
  };
}

export async function beginTotpEnrollmentAction(): Promise<TotpEnrollmentActionResult> {
  const authSupabase = await createAuthenticatedSupabaseAuthSessionServerClient();

  if (!authSupabase) {
    return {
      error: "Your session expired. Sign in again to set up two-factor authentication.",
    };
  }

  const { data, error } = await authSupabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Reylumi authenticator",
  });

  if (error || !data) {
    return {
      error:
        error?.message ||
        "Two-factor authentication setup could not be started.",
    };
  }

  return {
    enrollment: {
      factorId: data.id,
      qrCode: data.totp.qr_code ?? null,
      secret: data.totp.secret ?? null,
    },
    error: null,
    message: "Scan the code, then enter the 6-digit authenticator code.",
  };
}

export async function verifyTotpEnrollmentAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const factorId = readActionString(input, "factor_id");
  const code = readActionString(input, "code").replace(/\s+/g, "");

  if (!factorId || !code) {
    return { error: "Enter the authenticator code." };
  }

  const [authSupabase, context] = await Promise.all([
    createAuthenticatedSupabaseAuthSessionServerClient(),
    getMutationContext(),
  ]);

  if (!authSupabase) {
    return {
      error: "Your session expired. Sign in again to verify two-factor authentication.",
    };
  }

  const challenge = await authSupabase.auth.mfa.challenge({ factorId });

  if (challenge.error || !challenge.data?.id) {
    return {
      error:
        challenge.error?.message ||
        "Two-factor authentication challenge could not be created.",
    };
  }

  const verification = await authSupabase.auth.mfa.verify({
    challengeId: challenge.data.id,
    code,
    factorId,
  });

  if (verification.error) {
    return {
      error:
        verification.error.message ||
        "The authenticator code could not be verified.",
    };
  }

  await setSupabaseSessionCookies(verification.data);

  if (context.ok) {
    await recordSecurityActivity({
      activityType: "two_factor_enabled",
      metadata: { factor_id: factorId, factor_type: "totp" },
      supabase: context.supabase,
      user: context.user,
    });
  }

  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Two-factor authentication enabled.",
  };
}

export async function beginPhoneMfaEnrollmentAction(): Promise<PhoneMfaEnrollmentActionResult> {
  const context = await getMutationContext();

  if (!context.ok) {
    return { error: context.error };
  }

  const phone = normalizePhoneForIdentity(context.user.phone);

  if (!phone) {
    return {
      error: "Verify a phone number in Profile before setting up phone two-factor authentication.",
    };
  }

  const authSupabase = await createAuthenticatedSupabaseAuthSessionServerClient();

  if (!authSupabase) {
    return {
      error: "Your session expired. Sign in again to set up phone two-factor authentication.",
    };
  }

  const { data, error } = await authSupabase.auth.mfa.enroll({
    factorType: "phone",
    friendlyName: "Reylumi SMS",
    phone,
  });

  if (error || !data) {
    return {
      error: twoFactorSetupError(error?.message),
    };
  }

  const challenge = await authSupabase.auth.mfa.challenge({
    channel: "sms",
    factorId: data.id,
  });

  if (challenge.error || !challenge.data?.id) {
    await authSupabase.auth.mfa.unenroll({ factorId: data.id });

    return {
      error:
        challenge.error?.message ||
        "Phone verification code could not be sent.",
    };
  }

  return {
    enrollment: {
      challengeId: challenge.data.id,
      factorId: data.id,
      phone: data.phone ?? phone,
    },
    error: null,
    message: "Verification code sent by SMS.",
  };
}

export async function verifyPhoneMfaEnrollmentAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const factorId = readActionString(input, "factor_id");
  const challengeId = readActionString(input, "challenge_id");
  const code = readActionString(input, "code").replace(/\s+/g, "");

  if (!factorId || !challengeId || !code) {
    return { error: "Enter the SMS verification code." };
  }

  const [authSupabase, context] = await Promise.all([
    createAuthenticatedSupabaseAuthSessionServerClient(),
    getMutationContext(),
  ]);

  if (!authSupabase) {
    return {
      error: "Your session expired. Sign in again to verify phone two-factor authentication.",
    };
  }

  const verification = await authSupabase.auth.mfa.verify({
    challengeId,
    code,
    factorId,
  });

  if (verification.error) {
    return {
      error:
        verification.error.message ||
        "The SMS code could not be verified.",
    };
  }

  await setSupabaseSessionCookies(verification.data);

  if (context.ok) {
    await recordSecurityActivity({
      activityType: "two_factor_phone_enabled",
      metadata: { factor_id: factorId, factor_type: "phone" },
      supabase: context.supabase,
      user: context.user,
    });
  }

  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Phone two-factor authentication enabled.",
  };
}

export async function disableMfaFactorAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const factorId = readActionString(input, "factor_id");
  const factorType = readActionString(input, "factor_type") || "unknown";

  if (!factorId) {
    return { error: "Two-factor authentication factor could not be found." };
  }

  const [authSupabase, context] = await Promise.all([
    createAuthenticatedSupabaseAuthSessionServerClient(),
    getMutationContext(),
  ]);

  if (!authSupabase) {
    return {
      error: "Your session expired. Sign in again to disable two-factor authentication.",
    };
  }

  const { error } = await authSupabase.auth.mfa.unenroll({ factorId });

  if (error) {
    return {
      error:
        error.message ||
        "Two-factor authentication could not be disabled.",
    };
  }

  if (context.ok) {
    await recordSecurityActivity({
      activityType: "two_factor_disabled",
      metadata: { factor_id: factorId, factor_type: factorType },
      supabase: context.supabase,
      user: context.user,
    });
  }

  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Two-factor authentication disabled.",
  };
}

export async function disableTotpFactorAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  return disableMfaFactorAction(input);
}

export async function generateRecoveryCodesAction(): Promise<RecoveryCodesActionResult> {
  const context = await getMutationContext();

  if (!context.ok) {
    return { error: context.error };
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const revokedAt = new Date().toISOString();
  const revokeResult = await context.supabase
    .from("account_recovery_codes")
    .update({ revoked_at: revokedAt })
    .eq("user_id", context.user.id)
    .is("used_at", null)
    .is("revoked_at", null);

  if (revokeResult.error) {
    if (isLoginSecuritySchemaMissing(revokeResult.error)) {
      return { error: schemaUnavailableResult().error ?? "Security settings are temporarily unavailable. Please try again later." };
    }

    logSupabaseError(
      "Supabase revoke old recovery codes failed",
      revokeResult.error,
      { userId: context.user.id },
    );
    return { error: "Recovery codes could not be generated." };
  }

  const insertResult = await context.supabase
    .from("account_recovery_codes")
    .insert(
      codes.map((code) => ({
        code_digest: recoveryCodeDigest(code),
        code_hint: code.slice(-4),
        user_id: context.user.id,
      })),
    );

  if (insertResult.error) {
    if (isLoginSecuritySchemaMissing(insertResult.error)) {
      return { error: schemaUnavailableResult().error ?? "Security settings are temporarily unavailable. Please try again later." };
    }

    logSupabaseError(
      "Supabase create recovery codes failed",
      insertResult.error,
      { userId: context.user.id },
    );
    return { error: "Recovery codes could not be generated." };
  }

  await recordSecurityActivity({
    activityType: "recovery_codes_generated",
    metadata: { count: codes.length },
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    codes,
    error: null,
    message: "New recovery codes generated. They are shown only once.",
  };
}

export async function createRecoveryRequestAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const context = await getMutationContext();

  if (!context.ok) {
    return { error: context.error };
  }

  const requestType = readActionString(input, "request_type") || "lost_access";
  const recoveryEmail = normalizeRecoveryEmail(
    readActionOptionalString(input, "contact_email"),
  );
  const rawPhone = readActionOptionalString(input, "contact_phone");
  const contactPhone = rawPhone ? normalizePhoneForIdentity(rawPhone) : null;

  if (!RECOVERY_REQUEST_TYPES.has(requestType)) {
    return { error: "Choose a valid recovery request type." };
  }

  if (recoveryEmail === "invalid") {
    return { error: "Enter a valid contact email." };
  }

  if (rawPhone && !contactPhone) {
    return { error: "Enter a valid contact phone." };
  }

  if (!recoveryEmail && !contactPhone) {
    return { error: "Enter a contact email or phone for recovery." };
  }

  const { error } = await context.supabase
    .from("account_recovery_requests")
    .insert({
      contact_email: recoveryEmail,
      contact_phone: contactPhone,
      details: readActionOptionalString(input, "details"),
      request_type: requestType,
      status: "open",
      user_id: context.user.id,
    });

  if (error) {
    if (isLoginSecuritySchemaMissing(error)) {
      return schemaUnavailableResult();
    }

    logSupabaseError("Supabase create recovery request failed", error, {
      requestType,
      userId: context.user.id,
    });
    return { error: "Recovery request could not be created." };
  }

  await recordSecurityActivity({
    activityType: "recovery_request_created",
    metadata: { request_type: requestType },
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message: "Recovery request created.",
  };
}

export async function secureMyAccountAction(
  input: ActionInput,
): Promise<LoginSecurityActionResult> {
  const [context, authSupabase] = await Promise.all([
    getMutationContext(),
    createAuthenticatedSupabaseAuthSessionServerClient(),
  ]);

  if (!context.ok) {
    return { error: context.error };
  }

  const currentSessionId = await getCurrentSessionId();
  const details = readActionOptionalString(input, "details");
  const contactEmail =
    normalizeRecoveryEmail(readActionOptionalString(input, "contact_email")) ??
    context.user.email;
  const rawPhone = readActionOptionalString(input, "contact_phone");
  const contactPhone = rawPhone
    ? normalizePhoneForIdentity(rawPhone)
    : context.user.phone;

  if (contactEmail === "invalid") {
    return { error: "Enter a valid contact email." };
  }

  if (rawPhone && !contactPhone) {
    return { error: "Enter a valid contact phone." };
  }

  const preferencesResult = await context.supabase
    .from("account_security_preferences")
    .upsert(
      {
        login_alerts_enabled: true,
        sms_login_alerts_enabled: Boolean(context.user.phone),
        user_id: context.user.id,
      },
      { onConflict: "user_id" },
    );

  if (preferencesResult.error) {
    if (isLoginSecuritySchemaMissing(preferencesResult.error)) {
      return schemaUnavailableResult();
    }

    logSupabaseError(
      "Supabase secure account preferences failed",
      preferencesResult.error,
      { userId: context.user.id },
    );
    return { error: "Secure my account could not be started." };
  }

  await revokeOtherSessions({
    supabase: context.supabase,
    user: context.user,
  });
  await removeTrustedDevices({
    supabase: context.supabase,
    user: context.user,
  });

  const requestResult = await context.supabase
    .from("account_recovery_requests")
    .insert({
      contact_email: contactEmail,
      contact_phone: contactPhone,
      details,
      request_type: "secure_account",
      status: "open",
      user_id: context.user.id,
    });

  if (requestResult.error && !isLoginSecuritySchemaMissing(requestResult.error)) {
    logSupabaseError(
      "Supabase secure account recovery request failed",
      requestResult.error,
      { userId: context.user.id },
    );
  }

  await signOutWithScope(authSupabase, "others");
  await recordSecurityActivity({
    activityType: "secure_account_started",
    metadata: {
      current_session_id: currentSessionId,
      other_sessions_revoked: Boolean(currentSessionId),
      trusted_devices_removed: true,
    },
    supabase: context.supabase,
    user: context.user,
  });
  revalidatePath(LOGIN_SECURITY_PATH);

  return {
    error: null,
    message:
      "Secure my account started. Other sessions were signed out, trusted devices were removed, and login alerts are on.",
  };
}
