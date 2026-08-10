"use server";

import {
  ACCOUNT_AVATAR_BUCKET,
  buildAccountAvatarPath,
  getAccountAvatarPublicUrl,
  safeAccountAvatarUrl,
} from "@/lib/account-avatar";
import {
  claimCustomersForVerifiedPhone,
  getPhoneVerificationRequirement,
  inspectProfilePhoneClaim,
  type PhoneVerificationRequirement,
} from "@/lib/customer-identity-claims";
import {
  beginCustomerPhoneOtpChallenge,
  beginCustomerPhoneOtpVerification,
  completeCustomerPhoneOtpChallenge,
  recordCustomerPhoneOtpSendFailure,
  recordCustomerPhoneOtpVerificationFailure,
  recordCustomerVerifiedPhoneFromAuth,
} from "@/lib/customer-phone-verification";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import {
  sendPhoneVerificationOtp,
  verifyPhoneVerificationOtp,
} from "@/lib/phone-otp";
import {
  createAuthenticatedSupabaseAuthSessionServerClient,
  createAuthenticatedSupabaseServerClient,
  getAccessTokenFromRequest,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { KingUser } from "@/types/user";
import { revalidatePath } from "next/cache";

type ActionInput = FormData | Record<string, unknown>;
type AuthenticatedSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;
type AuthSessionSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseAuthSessionServerClient>>
>;

export type AccountAvatarUploadSession = {
  accessToken: string;
  anonKey: string;
  bucket: string;
  path: string;
  publicUrl: string;
  supabaseUrl: string;
};

export type AccountProfileActionResult = {
  error: string | null;
  phoneClaim?: PhoneVerificationRequirement | {
    linkedCount: number;
    message: string;
    normalizedPhone: string;
    status: "connected";
  } | null;
};

export type AccountPhoneOtpActionResult = {
  code?:
    | "already_verified"
    | "auth_user_changed"
    | "invalid_or_expired_code"
    | "phone_conflict"
    | "phone_change_not_created"
    | "provider_not_configured"
    | "send_throttled"
    | "session_expired"
    | "sms_send_failed"
    | "too_many_attempts";
  error: string | null;
  linkedCount?: number;
  message?: string;
  normalizedPhone?: string;
  resendAfterSeconds?: number;
  status?: "already_verified" | "sent" | "verified";
};

function actionHasKey(input: ActionInput, key: string) {
  return input instanceof FormData ? input.has(key) : key in input;
}

function readActionValue(input: ActionInput, key: string) {
  return input instanceof FormData ? input.get(key) : input[key];
}

function readActionString(input: ActionInput, key: string) {
  const value = readActionValue(input, key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
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

export async function getAccountAvatarUploadSessionAction(): Promise<AccountAvatarUploadSession> {
  const [accessToken, user] = await Promise.all([
    getAccessTokenFromRequest(),
    getCurrentKingUser(),
  ]);
  const config = getSupabaseConfig();

  if (!config || !accessToken || !user) {
    throw new Error("Sign in before uploading an avatar.");
  }

  const path = buildAccountAvatarPath(user.id);

  return {
    accessToken,
    anonKey: config.supabaseAnonKey,
    bucket: ACCOUNT_AVATAR_BUCKET,
    path,
    publicUrl: getAccountAvatarPublicUrl({
      bucket: ACCOUNT_AVATAR_BUCKET,
      path,
      supabaseUrl: config.supabaseUrl,
    }),
    supabaseUrl: config.supabaseUrl,
  };
}

export async function updateAccountProfileAction(
  input: ActionInput,
): Promise<AccountProfileActionResult> {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    return { error: "Sign in before updating your account." };
  }

  const rawPhone = readActionOptionalString(input, "phone");
  const normalizedPhone = rawPhone ? normalizePhoneForIdentity(rawPhone) : null;

  if (rawPhone && !normalizedPhone) {
    return { error: "Enter a valid phone number." };
  }

  const currentProfilePhone = normalizePhoneForIdentity(user.phone);
  const phoneChanged = normalizedPhone !== currentProfilePhone;
  let phoneClaim:
    | AccountProfileActionResult["phoneClaim"]
    | undefined;

  if (normalizedPhone) {
    const inspection = await inspectProfilePhoneClaim(normalizedPhone);

    if (!inspection.ok) {
      if (phoneChanged) {
        return { error: inspection.message };
      }
    } else if (!inspection.data.verifiedByCurrentUser) {
      const authSupabase =
        await createAuthenticatedSupabaseAuthSessionServerClient();

      if (!authSupabase) {
        return {
          error: "Your session expired. Sign in again to verify your phone.",
        };
      }

      const authPhoneMatch = await getConfirmedAuthPhoneMatch(
        authSupabase,
        inspection.data.normalizedPhone,
      );

      if (!authPhoneMatch.ok) {
        return {
          error: "Your session expired. Sign in again to verify your phone.",
        };
      }

      if (authPhoneMatch.matches) {
        if (!user.auth_user_id || authPhoneMatch.authUserId !== user.auth_user_id) {
          return {
            error: "Your session changed. Sign in again to verify your phone.",
          };
        }

        const connectionResult = await connectCurrentConfirmedAuthPhone({
          normalizedPhone: inspection.data.normalizedPhone,
        });

        if (!connectionResult.ok) {
          return { error: connectionResult.error };
        }

        phoneClaim = connectionResult.data;
      } else if (phoneChanged) {
        return {
          error: null,
          phoneClaim: getPhoneVerificationRequirement(
            inspection.data.normalizedPhone,
          ),
        };
      }
    } else if (inspection.data.eligibleUnclaimedCount > 0) {
      const claimResult = await claimCustomersForVerifiedPhone(normalizedPhone);

      if (!claimResult.ok) {
        return { error: claimResult.message };
      }

      if (claimResult.data.linkedCount > 0) {
        phoneClaim = {
          linkedCount: claimResult.data.linkedCount,
          message: verifiedPhoneConnectedMessage(claimResult.data.linkedCount),
          normalizedPhone: inspection.data.normalizedPhone,
          status: "connected",
        };
      }
    }
  }

  const patch: Record<string, string | null> = {
    display_name: readActionOptionalString(input, "display_name"),
    first_name: readActionOptionalString(input, "first_name"),
    last_name: readActionOptionalString(input, "last_name"),
    language: readActionOptionalString(input, "language") ?? "en",
    phone: normalizedPhone,
    timezone: readActionOptionalString(input, "timezone") ?? "America/Chicago",
  };

  if (readActionBoolean(input, "remove_avatar")) {
    patch.avatar_url = null;
  } else if (actionHasKey(input, "avatar_url")) {
    const avatarUrl = readActionOptionalString(input, "avatar_url");

    if (avatarUrl && !safeAccountAvatarUrl(avatarUrl)) {
      return { error: "Avatar URL is not valid." };
    }

    patch.avatar_url = avatarUrl;
  }

  const { error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", user.id);

  if (error) {
    console.error("Supabase update account profile failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      userId: user.id,
    });

    return { error: "Unable to update profile." };
  }

  revalidatePath("/account");
  revalidatePath("/beauty");
  revalidatePath("/", "layout");

  return { error: null, phoneClaim: phoneClaim ?? null };
}

function genericOtpSentMessage() {
  return "If this phone can receive verification texts, a code has been sent.";
}

function genericOtpVerifyError() {
  return "The code could not be verified. Check the code and try again.";
}

function verifiedPhoneConnectedMessage(linkedCount: number) {
  return linkedCount > 0
    ? "Phone verified and visit history connected."
    : "Phone verified.";
}

function sessionExpiredOtpResult(
  normalizedPhone?: string,
): AccountPhoneOtpActionResult {
  return {
    code: "session_expired",
    error: "Your session expired. Sign in again to verify your phone.",
    normalizedPhone,
  };
}

async function getConfirmedAuthPhoneMatch(
  supabase: AuthSessionSupabaseClient,
  normalizedPhone: string,
) {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      authUserId: null,
      matches: false,
      ok: false as const,
    };
  }

  return {
    authUserId: data.user.id,
    matches:
      Boolean(data.user.phone_confirmed_at) &&
      normalizePhoneForIdentity(data.user.phone) === normalizedPhone,
    ok: true as const,
  };
}

async function connectCurrentConfirmedAuthPhone(input: {
  normalizedPhone: string;
  supabase?: AuthenticatedSupabaseClient;
  user?: KingUser;
}) {
  const verifiedPhone = await recordCustomerVerifiedPhoneFromAuth(
    input.normalizedPhone,
  );

  if (!verifiedPhone.ok) {
    return {
      code: verifiedPhone.code,
      error:
        verifiedPhone.code === "phone_conflict"
          ? "This phone could not be connected to this account."
          : genericOtpVerifyError(),
      ok: false as const,
    };
  }

  const claimResult = await claimCustomersForVerifiedPhone(
    verifiedPhone.data.normalizedPhone,
  );

  if (!claimResult.ok) {
    return {
      code: claimResult.code,
      error: claimResult.message,
      ok: false as const,
    };
  }

  if (input.supabase && input.user) {
    const currentProfilePhone = normalizePhoneForIdentity(input.user.phone);

    if (currentProfilePhone !== verifiedPhone.data.normalizedPhone) {
      const { error: updateError } = await input.supabase
        .from("users")
        .update({ phone: verifiedPhone.data.normalizedPhone })
        .eq("id", input.user.id);

      if (updateError) {
        console.error("Supabase update confirmed auth profile phone failed", {
          code: updateError.code,
          details: updateError.details,
          hint: updateError.hint,
          message: updateError.message,
          userId: input.user.id,
        });

        return {
          code: "database_error",
          error: "Phone verification could not be completed.",
          ok: false as const,
        };
      }
    }
  }

  return {
    data: {
      linkedCount: claimResult.data.linkedCount,
      message: verifiedPhoneConnectedMessage(claimResult.data.linkedCount),
      normalizedPhone: verifiedPhone.data.normalizedPhone,
      status: "connected" as const,
    },
    ok: true as const,
  };
}

async function alreadyConfirmedPhoneOtpResult(
  normalizedPhone: string,
  authUserId: string,
): Promise<AccountPhoneOtpActionResult> {
  const [profileSupabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!profileSupabase || !user) {
    return sessionExpiredOtpResult(normalizedPhone);
  }

  if (!user.auth_user_id || authUserId !== user.auth_user_id) {
    return {
      code: "auth_user_changed",
      error: "Your session changed. Sign in again to verify your phone.",
      normalizedPhone,
    };
  }

  const connectionResult = await connectCurrentConfirmedAuthPhone({
    normalizedPhone,
    supabase: profileSupabase,
    user,
  });

  if (!connectionResult.ok) {
    return {
      code:
        connectionResult.code === "phone_conflict"
          ? "phone_conflict"
          : "invalid_or_expired_code",
      error: connectionResult.error,
      normalizedPhone,
    };
  }

  revalidatePath("/account");
  revalidatePath("/activity");
  revalidatePath("/beauty");
  revalidatePath("/", "layout");

  return {
    code: "already_verified",
    error: null,
    linkedCount: connectionResult.data.linkedCount,
    message: connectionResult.data.message,
    normalizedPhone: connectionResult.data.normalizedPhone,
    status: "already_verified",
  };
}

export async function sendAccountPhoneVerificationOtpAction(
  input: ActionInput,
): Promise<AccountPhoneOtpActionResult> {
  const phone = readActionOptionalString(input, "phone");
  const normalizedPhone = normalizePhoneForIdentity(phone);

  if (!normalizedPhone) {
    return { error: "Enter a valid phone number." };
  }

  const supabase = await createAuthenticatedSupabaseAuthSessionServerClient();

  if (!supabase) {
    return sessionExpiredOtpResult(normalizedPhone);
  }

  const authPhoneMatch = await getConfirmedAuthPhoneMatch(
    supabase,
    normalizedPhone,
  );

  if (!authPhoneMatch.ok) {
    return sessionExpiredOtpResult(normalizedPhone);
  }

  if (authPhoneMatch.matches) {
    return alreadyConfirmedPhoneOtpResult(
      normalizedPhone,
      authPhoneMatch.authUserId,
    );
  }

  const challenge = await beginCustomerPhoneOtpChallenge(normalizedPhone);

  if (!challenge.ok) {
    return {
      code:
        challenge.code === "send_throttled" ||
        challenge.code === "too_many_attempts"
          ? challenge.code
          : undefined,
      error:
        challenge.code === "send_throttled" ||
        challenge.code === "too_many_attempts"
          ? challenge.message
          : "Phone verification could not be started.",
    };
  }

  if (challenge.data.status === "already_verified") {
    return {
      code: "already_verified",
      error: null,
      message: "This phone is already verified.",
      normalizedPhone: challenge.data.normalizedPhone,
      status: "already_verified",
    };
  }

  const sendResult = await sendPhoneVerificationOtp({
    deliveryMode: challenge.data.deliveryMode,
    phone: challenge.data.normalizedPhone,
    supabase,
  });

  if (!sendResult.ok) {
    await recordCustomerPhoneOtpSendFailure(challenge.data.challengeId);

    if (
      sendResult.code === "session_expired" ||
      sendResult.code === "auth_user_changed" ||
      sendResult.code === "phone_change_not_created" ||
      sendResult.code === "sms_send_failed"
    ) {
      return {
        code: sendResult.code,
        error: sendResult.message,
        normalizedPhone: challenge.data.normalizedPhone,
      };
    }

    return {
      code:
        sendResult.code === "send_throttled"
          ? "send_throttled"
          : "provider_not_configured",
      error:
        sendResult.code === "send_throttled"
          ? sendResult.message
          : "Phone verification is not configured.",
      normalizedPhone: challenge.data.normalizedPhone,
    };
  }

  if (sendResult.status === "already_confirmed") {
    return alreadyConfirmedPhoneOtpResult(
      challenge.data.normalizedPhone,
      sendResult.authUserId,
    );
  }

  return {
    error: null,
    message: genericOtpSentMessage(),
    normalizedPhone: challenge.data.normalizedPhone,
    resendAfterSeconds: challenge.data.resendAfterSeconds,
    status: "sent",
  };
}

export async function verifyAccountPhoneOtpAction(
  input: ActionInput,
): Promise<AccountPhoneOtpActionResult> {
  const phone = readActionOptionalString(input, "phone");
  const code = readActionString(input, "code");
  const normalizedPhone = normalizePhoneForIdentity(phone);

  if (!normalizedPhone) {
    return { error: "Enter a valid phone number." };
  }

  const [supabase, authSupabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    createAuthenticatedSupabaseAuthSessionServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    return sessionExpiredOtpResult(normalizedPhone);
  }

  if (!authSupabase) {
    return sessionExpiredOtpResult(normalizedPhone);
  }

  const challenge = await beginCustomerPhoneOtpVerification(normalizedPhone);

  if (!challenge.ok) {
    return {
      code:
        challenge.code === "too_many_attempts"
          ? "too_many_attempts"
          : "invalid_or_expired_code",
      error:
        challenge.code === "too_many_attempts"
          ? challenge.message
          : genericOtpVerifyError(),
    };
  }

  const verifyResult = await verifyPhoneVerificationOtp({
    code,
    phone: challenge.data.normalizedPhone,
    supabase: authSupabase,
  });

  if (!verifyResult.ok) {
    if (
      verifyResult.code === "session_expired" ||
      verifyResult.code === "auth_user_changed"
    ) {
      return {
        code: verifyResult.code,
        error: verifyResult.message,
        normalizedPhone: challenge.data.normalizedPhone,
      };
    }

    const failureResult = await recordCustomerPhoneOtpVerificationFailure(
      challenge.data.challengeId,
    );

    return {
      code: failureResult.ok && failureResult.data.locked
        ? "too_many_attempts"
        : "invalid_or_expired_code",
      error: failureResult.ok && failureResult.data.locked
        ? "Too many attempts. Please wait and try again."
        : genericOtpVerifyError(),
    };
  }

  if (!user.auth_user_id || verifyResult.authUserId !== user.auth_user_id) {
    return {
      code: "auth_user_changed",
      error: "Your session changed. Sign in again to verify your phone.",
      normalizedPhone: challenge.data.normalizedPhone,
    };
  }

  const verifiedPhone = await recordCustomerVerifiedPhoneFromAuth(
    challenge.data.normalizedPhone,
  );

  if (!verifiedPhone.ok) {
    return {
      code:
        verifiedPhone.code === "phone_conflict"
          ? "phone_conflict"
          : "invalid_or_expired_code",
      error:
        verifiedPhone.code === "phone_conflict"
          ? "This phone could not be connected to this account."
          : genericOtpVerifyError(),
    };
  }

  const claimResult = await claimCustomersForVerifiedPhone(
    verifiedPhone.data.normalizedPhone,
  );

  if (!claimResult.ok) {
    return { error: claimResult.message };
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ phone: verifiedPhone.data.normalizedPhone })
    .eq("id", user.id);

  if (updateError) {
    console.error("Supabase update verified profile phone failed", {
      code: updateError.code,
      details: updateError.details,
      hint: updateError.hint,
      message: updateError.message,
      userId: user.id,
    });

    return { error: "Phone verification could not be completed." };
  }

  await completeCustomerPhoneOtpChallenge(challenge.data.challengeId);

  revalidatePath("/account");
  revalidatePath("/activity");
  revalidatePath("/beauty");
  revalidatePath("/", "layout");

  return {
    error: null,
    linkedCount: claimResult.data.linkedCount,
    message:
      claimResult.data.linkedCount > 0
        ? "Phone verified and eligible visit history was connected."
        : "Phone verified.",
    normalizedPhone: verifiedPhone.data.normalizedPhone,
    status: "verified",
  };
}
