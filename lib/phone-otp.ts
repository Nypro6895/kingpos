import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import {
  getSupabaseConfig,
  setSupabaseSessionCookies,
} from "@/lib/supabase/server";

export const PHONE_OTP_ATTEMPT_LIMIT = 5;
export const PHONE_OTP_CODE_EXPIRY_SECONDS = 10 * 60;
export const PHONE_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const PHONE_OTP_RESEND_LIMIT = 3;

export type PhoneOtpProviderId = "supabase-auth";

export type PhoneOtpProviderStatus = {
  attemptLimit: number;
  codeExpirySeconds: number;
  configured: boolean;
  provider: PhoneOtpProviderId | string | null;
  reason: string;
  resendCooldownSeconds: number;
};

export type PhoneOtpErrorCode =
  | "auth_user_changed"
  | "invalid_or_expired_code"
  | "invalid_phone"
  | "phone_change_not_created"
  | "provider_not_configured"
  | "send_throttled"
  | "session_expired"
  | "sign_in_required"
  | "sms_send_failed"
  | "too_many_attempts";

export type PhoneOtpSendResult =
  | {
      authUserId: string;
      deliveryMode: PhoneOtpDeliveryMode;
      messageId?: string;
      ok: true;
      provider: PhoneOtpProviderId;
      status: "already_confirmed" | "sent";
    }
  | {
      code: PhoneOtpErrorCode;
      message: string;
      ok: false;
    };

export type PhoneOtpVerifyResult =
  | {
      authUserId: string;
      ok: true;
      provider: PhoneOtpProviderId;
    }
  | {
      code: PhoneOtpErrorCode;
      message: string;
      ok: false;
    };

export type PhoneOtpDeliveryMode = "initial" | "resend";

function configuredProvider(): PhoneOtpProviderId | null {
  const rawProvider = process.env.REYLUMI_PHONE_OTP_PROVIDER?.trim().toLowerCase();

  if (rawProvider === "supabase" || rawProvider === "supabase-auth") {
    return "supabase-auth";
  }

  if (rawProvider) {
    return null;
  }

  if (getSupabaseConfig()) {
    return "supabase-auth";
  }

  return null;
}

export function getPhoneOtpProviderStatus(): PhoneOtpProviderStatus {
  const provider = configuredProvider();

  return {
    attemptLimit: PHONE_OTP_ATTEMPT_LIMIT,
    codeExpirySeconds: PHONE_OTP_CODE_EXPIRY_SECONDS,
    configured: Boolean(provider),
    provider: provider ?? process.env.REYLUMI_PHONE_OTP_PROVIDER?.trim() ?? null,
    reason: provider
      ? "Supabase Auth phone OTP is configured for transactional phone verification."
      : "No transactional phone OTP provider is configured in this workspace.",
    resendCooldownSeconds: PHONE_OTP_RESEND_COOLDOWN_SECONDS,
  };
}

function phoneOtpMessage(code: PhoneOtpErrorCode) {
  switch (code) {
    case "auth_user_changed":
      return "Your session changed. Sign in again to verify your phone.";
    case "invalid_phone":
      return "Enter a valid phone number.";
    case "phone_change_not_created":
      return "Phone verification could not be started.";
    case "provider_not_configured":
      return "Phone verification is not configured.";
    case "send_throttled":
      return "Please wait before requesting another code.";
    case "session_expired":
      return "Your session expired. Sign in again to verify your phone.";
    case "sign_in_required":
      return "Sign in before verifying your phone.";
    case "sms_send_failed":
      return "Verification code could not be sent. Please try again.";
    case "too_many_attempts":
      return "Too many attempts. Please wait and try again.";
    case "invalid_or_expired_code":
    default:
      return "The code could not be verified.";
  }
}

function failure(code: PhoneOtpErrorCode) {
  return {
    code,
    message: phoneOtpMessage(code),
    ok: false as const,
  };
}

function providerUnavailable() {
  return failure("provider_not_configured");
}

function providerFromStatus() {
  const status = getPhoneOtpProviderStatus();

  if (!status.configured || status.provider !== "supabase-auth") {
    return null;
  }

  return status.provider;
}

function userPhoneMatches(value: string | null | undefined, normalizedPhone: string) {
  return normalizePhoneForIdentity(value) === normalizedPhone;
}

function userHasPendingPhoneChange(user: User, normalizedPhone: string) {
  return userPhoneMatches(user.new_phone, normalizedPhone);
}

function userHasConfirmedPhone(user: User, normalizedPhone: string) {
  return (
    Boolean(user.phone_confirmed_at) &&
    userPhoneMatches(user.phone, normalizedPhone)
  );
}

function logMissingPhoneChangeState(input: {
  authUserId: string;
  deliveryMode: PhoneOtpDeliveryMode;
  normalizedPhone: string;
  user: User;
}) {
  console.error("Supabase Auth phone change OTP was not created", {
    authUserId: input.authUserId,
    deliveryMode: input.deliveryMode,
    hasCurrentPhoneConfirmedAt: Boolean(input.user.phone_confirmed_at),
    hasNewPhone: Boolean(input.user.new_phone),
    requestedPhoneAlreadyConfirmed:
      userPhoneMatches(input.user.phone, input.normalizedPhone) &&
      Boolean(input.user.phone_confirmed_at),
  });
}

function isAuthSessionMissingError(error: { code?: string; message?: string; name?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.name === "AuthSessionMissingError" ||
    error.code === "session_not_found" ||
    message.includes("auth session missing")
  );
}

function isProviderConfigurationError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";

  return (
    error.code === "provider_not_configured" ||
    error.code === "sms_provider_not_configured" ||
    error.code === "sms_provider_disabled" ||
    error.code === "phone_provider_disabled" ||
    message.includes("provider not configured") ||
    message.includes("sms provider is not configured") ||
    message.includes("sms provider is disabled")
  );
}

function mapSendProviderError(error: { code?: string; message?: string; name?: string }) {
  if (error.code === "over_sms_send_rate_limit") {
    return failure("send_throttled");
  }

  if (isAuthSessionMissingError(error)) {
    return failure("session_expired");
  }

  console.error("Supabase Auth phone OTP send failed", {
    code: error.code,
    message: error.message,
    name: error.name,
  });

  if (isProviderConfigurationError(error)) {
    return failure("provider_not_configured");
  }

  return failure("sms_send_failed");
}

function mapVerifyProviderError(error: { code?: string; message?: string; name?: string }) {
  if (error.code === "over_request_rate_limit") {
    return failure("too_many_attempts");
  }

  if (isAuthSessionMissingError(error)) {
    return failure("session_expired");
  }

  if (
    error.code === "otp_expired" ||
    error.code === "invalid_credentials" ||
    error.code === "validation_failed"
  ) {
    return failure("invalid_or_expired_code");
  }

  console.error("Supabase Auth phone OTP verification failed", {
    code: error.code,
    message: error.message,
  });

  return failure("invalid_or_expired_code");
}

export async function sendPhoneVerificationOtp(input: {
  deliveryMode?: PhoneOtpDeliveryMode;
  phone: string;
  supabase: SupabaseClient;
}): Promise<PhoneOtpSendResult> {
  const provider = providerFromStatus();
  const deliveryMode = input.deliveryMode ?? "initial";
  const normalizedPhone = normalizePhoneForIdentity(input.phone);

  if (!provider) {
    return providerUnavailable();
  }

  if (!normalizedPhone) {
    return failure("invalid_phone");
  }

  const userResult = await input.supabase.auth.getUser();

  if (userResult.error || !userResult.data.user) {
    return failure("session_expired");
  }

  const authUserId = userResult.data.user.id;
  let messageId: string | undefined;

  if (userHasConfirmedPhone(userResult.data.user, normalizedPhone)) {
    return {
      authUserId,
      deliveryMode,
      ok: true,
      provider,
      status: "already_confirmed",
    };
  }

  if (deliveryMode === "resend") {
    if (!userHasPendingPhoneChange(userResult.data.user, normalizedPhone)) {
      logMissingPhoneChangeState({
        authUserId,
        deliveryMode,
        normalizedPhone,
        user: userResult.data.user,
      });
      return failure("phone_change_not_created");
    }

    const { data, error } = await input.supabase.auth.resend({
      phone: normalizedPhone,
      type: "phone_change",
    });

    if (error) {
      return mapSendProviderError(error);
    }

    messageId = data.messageId ?? undefined;
  } else {
    const { error } = await input.supabase.auth.updateUser({
      phone: normalizedPhone,
    });

    if (error) {
      return mapSendProviderError(error);
    }
  }

  const afterUserResult = await input.supabase.auth.getUser();

  if (afterUserResult.error || !afterUserResult.data.user) {
    return failure("session_expired");
  }

  if (userHasConfirmedPhone(afterUserResult.data.user, normalizedPhone)) {
    return {
      authUserId,
      deliveryMode,
      ok: true,
      provider,
      status: "already_confirmed",
    };
  }

  if (!userHasPendingPhoneChange(afterUserResult.data.user, normalizedPhone)) {
    logMissingPhoneChangeState({
      authUserId,
      deliveryMode,
      normalizedPhone,
      user: afterUserResult.data.user,
    });
    return failure("phone_change_not_created");
  }

  return {
    authUserId,
    deliveryMode,
    ...(messageId ? { messageId } : {}),
    ok: true,
    provider,
    status: "sent",
  };
}

export async function verifyPhoneVerificationOtp(input: {
  code: string;
  phone: string;
  supabase: SupabaseClient;
}): Promise<PhoneOtpVerifyResult> {
  const provider = providerFromStatus();
  const normalizedPhone = normalizePhoneForIdentity(input.phone);
  const token = input.code.replace(/\s+/g, "");

  if (!provider) {
    return providerUnavailable();
  }

  if (!normalizedPhone) {
    return failure("invalid_phone");
  }

  if (!/^[0-9]{4,10}$/.test(token)) {
    return failure("invalid_or_expired_code");
  }

  const beforeUserResult = await input.supabase.auth.getUser();

  if (beforeUserResult.error || !beforeUserResult.data.user) {
    return failure("session_expired");
  }

  const beforeAuthUserId = beforeUserResult.data.user.id;

  const { data, error } = await input.supabase.auth.verifyOtp({
    phone: normalizedPhone,
    token,
    type: "phone_change",
  });

  if (error) {
    return mapVerifyProviderError(error);
  }

  if (data.session) {
    await setSupabaseSessionCookies(data.session);
  }

  const afterUserResult = await input.supabase.auth.getUser();

  if (afterUserResult.error || !afterUserResult.data.user) {
    return failure("session_expired");
  }

  const returnedAuthUserId = data.user?.id ?? data.session?.user.id ?? null;
  const afterAuthUserId = afterUserResult.data.user.id;

  if (
    afterAuthUserId !== beforeAuthUserId ||
    (returnedAuthUserId && returnedAuthUserId !== beforeAuthUserId)
  ) {
    return failure("auth_user_changed");
  }

  return {
    authUserId: afterAuthUserId,
    ok: true,
    provider,
  };
}
