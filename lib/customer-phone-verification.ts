import "server-only";

import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import {
  PHONE_OTP_ATTEMPT_LIMIT,
  PHONE_OTP_CODE_EXPIRY_SECONDS,
  PHONE_OTP_RESEND_COOLDOWN_SECONDS,
} from "@/lib/phone-otp";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

type RawRecord = Record<string, unknown>;

export type CustomerPhoneVerificationErrorCode =
  | "database_error"
  | "invalid_or_expired_code"
  | "invalid_phone"
  | "phone_conflict"
  | "send_throttled"
  | "sign_in_required"
  | "too_many_attempts"
  | "unverified_phone";

export type CustomerPhoneVerificationResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      code: CustomerPhoneVerificationErrorCode;
      message: string;
      ok: false;
    };

export type CustomerPhoneOtpChallenge = {
  challengeId: string | null;
  deliveryMode: "initial" | "resend";
  expiresAt: string | null;
  normalizedPhone: string;
  resendAfterSeconds: number;
  status: "already_verified" | "pending";
};

export type CustomerPhoneOtpVerification = {
  challengeId: string;
  normalizedPhone: string;
};

export type CustomerPhoneOtpFailure = {
  locked: boolean;
  retryAfterSeconds: number;
};

export type CustomerVerifiedPhoneRecord = {
  idempotent: boolean;
  normalizedPhone: string;
};

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readBoolean(value: unknown) {
  return value === true;
}

function readErrorCode(value: unknown): CustomerPhoneVerificationErrorCode {
  const code = readString(value);

  if (
    code === "database_error" ||
    code === "invalid_or_expired_code" ||
    code === "invalid_phone" ||
    code === "phone_conflict" ||
    code === "send_throttled" ||
    code === "sign_in_required" ||
    code === "too_many_attempts" ||
    code === "unverified_phone"
  ) {
    return code;
  }

  return "database_error";
}

function codeMessage(code: CustomerPhoneVerificationErrorCode) {
  switch (code) {
    case "invalid_phone":
      return "Enter a valid phone number.";
    case "send_throttled":
      return "Please wait before requesting another code.";
    case "sign_in_required":
      return "Sign in before verifying your phone.";
    case "too_many_attempts":
      return "Too many attempts. Please wait and try again.";
    case "database_error":
    case "invalid_or_expired_code":
    case "phone_conflict":
    case "unverified_phone":
    default:
      return "Phone verification could not be completed.";
  }
}

function failure<T = never>(
  code: CustomerPhoneVerificationErrorCode,
): CustomerPhoneVerificationResult<T> {
  return {
    code,
    message: codeMessage(code),
    ok: false,
  };
}

function parseChallenge(
  data: unknown,
  fallbackPhone: string,
): CustomerPhoneVerificationResult<CustomerPhoneOtpChallenge> {
  const payload = asRecord(data);

  if (payload.ok !== true) {
    return failure(readErrorCode(payload.code));
  }

  const status = readString(payload.status);

  return {
    data: {
      challengeId: readString(payload.challengeId),
      deliveryMode: readString(payload.deliveryMode) === "resend"
        ? "resend"
        : "initial",
      expiresAt: readString(payload.expiresAt),
      normalizedPhone: readString(payload.normalizedPhone) ?? fallbackPhone,
      resendAfterSeconds:
        readNumber(payload.resendAfterSeconds) ||
        PHONE_OTP_RESEND_COOLDOWN_SECONDS,
      status: status === "already_verified" ? "already_verified" : "pending",
    },
    ok: true,
  };
}

async function getAuthenticatedClient() {
  return createAuthenticatedSupabaseServerClient();
}

export function genericPhoneVerificationMessage() {
  return "Verify this phone to save it and connect eligible visit history.";
}

export function genericPhoneVerificationUnavailableMessage() {
  return "Phone verification is not available in this environment.";
}

export async function beginCustomerPhoneOtpChallenge(
  phone: string | null | undefined,
): Promise<CustomerPhoneVerificationResult<CustomerPhoneOtpChallenge>> {
  const normalizedPhone = normalizePhoneForIdentity(phone);

  if (!normalizedPhone) {
    return failure("invalid_phone");
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc(
    "begin_customer_phone_otp_challenge",
    {
      p_phone: normalizedPhone,
      p_provider: "supabase-auth",
    },
  );

  if (error) {
    console.error("Supabase begin phone OTP challenge failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return failure("database_error");
  }

  return parseChallenge(data, normalizedPhone);
}

export async function recordCustomerPhoneOtpSendFailure(
  challengeId: string | null | undefined,
) {
  if (!challengeId) {
    return;
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("record_customer_phone_otp_send_failed", {
    p_challenge_id: challengeId,
  });

  if (error) {
    console.error("Supabase phone OTP send-failure record failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
  }
}

export async function beginCustomerPhoneOtpVerification(
  phone: string | null | undefined,
): Promise<CustomerPhoneVerificationResult<CustomerPhoneOtpVerification>> {
  const normalizedPhone = normalizePhoneForIdentity(phone);

  if (!normalizedPhone) {
    return failure("invalid_phone");
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc(
    "begin_customer_phone_otp_verification",
    {
      p_phone: normalizedPhone,
    },
  );

  if (error) {
    console.error("Supabase begin phone OTP verification failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return failure("database_error");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return failure(readErrorCode(payload.code));
  }

  const challengeId = readString(payload.challengeId);

  if (!challengeId) {
    return failure("invalid_or_expired_code");
  }

  return {
    data: {
      challengeId,
      normalizedPhone: readString(payload.normalizedPhone) ?? normalizedPhone,
    },
    ok: true,
  };
}

export async function recordCustomerPhoneOtpVerificationFailure(
  challengeId: string,
): Promise<CustomerPhoneVerificationResult<CustomerPhoneOtpFailure>> {
  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc(
    "record_customer_phone_otp_verify_failure",
    {
      p_challenge_id: challengeId,
    },
  );

  if (error) {
    console.error("Supabase phone OTP failure record failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return failure("database_error");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return failure(readErrorCode(payload.code));
  }

  return {
    data: {
      locked: readBoolean(payload.locked),
      retryAfterSeconds: readNumber(payload.retryAfterSeconds),
    },
    ok: true,
  };
}

export async function recordCustomerVerifiedPhoneFromAuth(
  phone: string | null | undefined,
): Promise<CustomerPhoneVerificationResult<CustomerVerifiedPhoneRecord>> {
  const normalizedPhone = normalizePhoneForIdentity(phone);

  if (!normalizedPhone) {
    return failure("invalid_phone");
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc(
    "record_customer_verified_phone_from_auth",
    {
      p_phone: normalizedPhone,
    },
  );

  if (error) {
    console.error("Supabase verified phone from auth failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return failure("database_error");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return failure(readErrorCode(payload.code));
  }

  return {
    data: {
      idempotent: readBoolean(payload.idempotent),
      normalizedPhone: readString(payload.normalizedPhone) ?? normalizedPhone,
    },
    ok: true,
  };
}

export async function completeCustomerPhoneOtpChallenge(
  challengeId: string,
): Promise<CustomerPhoneVerificationResult<{ attemptLimit: number }>> {
  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc(
    "complete_customer_phone_otp_challenge",
    {
      p_challenge_id: challengeId,
    },
  );

  if (error) {
    console.error("Supabase phone OTP challenge completion failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return failure("database_error");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return failure(readErrorCode(payload.code));
  }

  return {
    data: {
      attemptLimit: PHONE_OTP_ATTEMPT_LIMIT,
    },
    ok: true,
  };
}

export function getPhoneOtpPolicy() {
  return {
    attemptLimit: PHONE_OTP_ATTEMPT_LIMIT,
    codeExpirySeconds: PHONE_OTP_CODE_EXPIRY_SECONDS,
    resendCooldownSeconds: PHONE_OTP_RESEND_COOLDOWN_SECONDS,
  };
}

export function isPhoneConflictCode(code: CustomerPhoneVerificationErrorCode) {
  return code === "phone_conflict";
}
