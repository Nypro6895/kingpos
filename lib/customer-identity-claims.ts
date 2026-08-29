import "server-only";

import { getPhoneOtpProviderStatus } from "@/lib/phone-otp";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

type AuthenticatedSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type RawRecord = Record<string, unknown>;

export type CustomerClaimErrorCode =
  | "customer_unavailable"
  | "database_error"
  | "expired_token"
  | "invalid_phone"
  | "invalid_token"
  | "phone_conflict"
  | "sign_in_required"
  | "token_used"
  | "unverified_phone";

export type CustomerIdentityClaimResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      code: CustomerClaimErrorCode;
      message: string;
      ok: false;
    };

export type CustomerClaimOffer = {
  claimPath: string;
  expiresAt: string;
  token: string;
};

export type CustomerClaimPreview = {
  alreadyLinked: boolean;
  expiresAt: string;
  salonName: string;
};

export type CustomerClaimCompletion = {
  idempotent: boolean;
  linkedCount: number;
};

export type ProfilePhoneClaimInspection = {
  conflict: boolean;
  eligibleUnclaimedCount: number;
  hasHistoricalMatch: boolean;
  normalizedPhone: string;
  ownedByCurrentCount: number;
  ownedByOtherCount: number;
  verifiedByCurrentUser: boolean;
};

export type PhoneVerificationRequirement = {
  attemptLimit: number;
  canSendOtp: boolean;
  codeExpirySeconds: number;
  message: string;
  normalizedPhone: string;
  provider: string | null;
  reason: string;
  resendCooldownSeconds: number;
  status: "verification_required";
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

function codeMessage(code: CustomerClaimErrorCode) {
  switch (code) {
    case "customer_unavailable":
      return "This visit cannot be connected to this account.";
    case "expired_token":
      return "This claim link has expired.";
    case "invalid_phone":
      return "Enter a valid phone number.";
    case "invalid_token":
      return "This claim link is invalid.";
    case "phone_conflict":
      return "This phone number is already connected to another ReyLUMI account.";
    case "sign_in_required":
      return "Sign in before connecting your history.";
    case "token_used":
      return "This claim link has already been used.";
    case "unverified_phone":
      return "Verify this phone number before connecting history.";
    case "database_error":
    default:
      return "Customer history could not be connected.";
  }
}

function readErrorCode(value: unknown): CustomerClaimErrorCode {
  const code = readString(value);

  if (
    code === "customer_unavailable" ||
    code === "database_error" ||
    code === "expired_token" ||
    code === "invalid_phone" ||
    code === "invalid_token" ||
    code === "phone_conflict" ||
    code === "sign_in_required" ||
    code === "token_used" ||
    code === "unverified_phone"
  ) {
    return code;
  }

  return "database_error";
}

function failure<T = never>(
  code: CustomerClaimErrorCode,
): CustomerIdentityClaimResult<T> {
  return {
    code,
    message: codeMessage(code),
    ok: false,
  };
}

function claimPathForToken(token: string) {
  return `/claim/customer?token=${encodeURIComponent(token)}`;
}

async function getAuthenticatedClient() {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  return supabase;
}

export async function issueCustomerClaimTokenForTicket(input: {
  customerId: string;
  expiresInSeconds?: number;
  supabase: AuthenticatedSupabaseClient;
  ticketId: string;
}): Promise<CustomerClaimOffer | null> {
  const { data, error } = await input.supabase.rpc("issue_customer_claim_token", {
    p_customer_id: input.customerId,
    p_expires_in_seconds: input.expiresInSeconds ?? 30 * 60,
    p_ticket_id: input.ticketId,
  });

  if (error) {
    console.error("Supabase issue customer claim token failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      customerId: input.customerId,
      ticketId: input.ticketId,
    });
    return null;
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return null;
  }

  const token = readString(payload.token);
  const expiresAt = readString(payload.expiresAt);

  if (!token || !expiresAt) {
    return null;
  }

  return {
    claimPath: readString(payload.claimPath) ?? claimPathForToken(token),
    expiresAt,
    token,
  };
}

export async function getCustomerClaimPreview(
  token: string | null | undefined,
): Promise<CustomerIdentityClaimResult<CustomerClaimPreview>> {
  const trimmedToken = token?.trim() ?? "";

  if (!trimmedToken) {
    return failure("invalid_token");
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc("get_customer_claim_token_preview", {
    p_token: trimmedToken,
  });

  if (error) {
    console.error("Supabase customer claim preview failed", {
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
      alreadyLinked: readBoolean(payload.alreadyLinked),
      expiresAt: readString(payload.expiresAt) ?? "",
      salonName: readString(payload.salonName) ?? "this salon",
    },
    ok: true,
  };
}

export async function claimCustomerFromToken(
  token: string | null | undefined,
): Promise<CustomerIdentityClaimResult<CustomerClaimCompletion>> {
  const trimmedToken = token?.trim() ?? "";

  if (!trimmedToken) {
    return failure("invalid_token");
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc("claim_customer_from_token", {
    p_token: trimmedToken,
  });

  if (error) {
    console.error("Supabase customer claim failed", {
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
      linkedCount: readNumber(payload.linkedCount),
    },
    ok: true,
  };
}

export async function inspectProfilePhoneClaim(
  phone: string | null | undefined,
): Promise<CustomerIdentityClaimResult<ProfilePhoneClaimInspection>> {
  const normalizedPhone = normalizePhoneForIdentity(phone);

  if (!normalizedPhone) {
    return failure("invalid_phone");
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc("inspect_customer_phone_claim", {
    p_phone: normalizedPhone,
  });

  if (error) {
    console.error("Supabase inspect customer phone claim failed", {
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
      conflict: readBoolean(payload.conflict),
      eligibleUnclaimedCount: readNumber(payload.eligibleUnclaimedCount),
      hasHistoricalMatch: readBoolean(payload.hasHistoricalMatch),
      normalizedPhone: readString(payload.normalizedPhone) ?? normalizedPhone,
      ownedByCurrentCount: readNumber(payload.ownedByCurrentCount),
      ownedByOtherCount: readNumber(payload.ownedByOtherCount),
      verifiedByCurrentUser: readBoolean(payload.verifiedByCurrentUser),
    },
    ok: true,
  };
}

export async function claimCustomersForVerifiedPhone(
  phone: string | null | undefined,
): Promise<CustomerIdentityClaimResult<CustomerClaimCompletion>> {
  const normalizedPhone = normalizePhoneForIdentity(phone);

  if (!normalizedPhone) {
    return failure("invalid_phone");
  }

  const supabase = await getAuthenticatedClient();

  if (!supabase) {
    return failure("sign_in_required");
  }

  const { data, error } = await supabase.rpc("claim_customers_for_verified_phone", {
    p_phone: normalizedPhone,
  });

  if (error) {
    console.error("Supabase verified phone customer claim failed", {
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
      idempotent: false,
      linkedCount: readNumber(payload.linkedCount),
    },
    ok: true,
  };
}

export function getPhoneVerificationRequirement(
  normalizedPhone: string,
): PhoneVerificationRequirement {
  const providerStatus = getPhoneOtpProviderStatus();

  return {
    attemptLimit: providerStatus.attemptLimit,
    canSendOtp: providerStatus.configured,
    codeExpirySeconds: providerStatus.codeExpirySeconds,
    message: "Verify this phone to save it and connect eligible visit history.",
    normalizedPhone,
    provider: providerStatus.provider,
    reason: providerStatus.reason,
    resendCooldownSeconds: providerStatus.resendCooldownSeconds,
    status: "verification_required",
  };
}
