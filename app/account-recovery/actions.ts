"use server";

import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createHash } from "node:crypto";

type ActionInput = FormData | Record<string, unknown>;

export type AccountRecoveryCodeActionResult = {
  error: string | null;
  message?: string;
};

const GENERIC_RECOVERY_MESSAGE =
  "If the account and recovery code match, a recovery case has been sent for support review.";

function readActionValue(input: ActionInput, key: string) {
  return input instanceof FormData ? input.get(key) : input[key];
}

function readActionString(input: ActionInput, key: string) {
  const value = readActionValue(input, key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();

  if (!email) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "invalid";
}

function normalizeAccountIdentifier(value: string) {
  const identifier = value.trim();

  if (!identifier) {
    return null;
  }

  if (identifier.includes("@")) {
    return normalizeEmail(identifier);
  }

  return normalizePhoneForIdentity(identifier) ?? "invalid";
}

function normalizeRecoveryCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function recoveryCodeDigest(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function schemaMissing(error: { code?: string | null; message?: string | null }) {
  const message = error.message ?? "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    (error.code === "PGRST205" && /account_(security|login|trusted|recovery)/i.test(message))
  );
}

export async function redeemRecoveryCodeAction(
  input: ActionInput,
): Promise<AccountRecoveryCodeActionResult> {
  const accountIdentifier = normalizeAccountIdentifier(
    readActionString(input, "account_identifier"),
  );
  const recoveryCode = normalizeRecoveryCode(
    readActionString(input, "recovery_code"),
  );
  const contactEmail = normalizeEmail(readActionString(input, "contact_email"));
  const rawContactPhone = readActionString(input, "contact_phone");
  const contactPhone = rawContactPhone
    ? normalizePhoneForIdentity(rawContactPhone)
    : null;

  if (!accountIdentifier) {
    return { error: "Enter your account email or profile phone." };
  }

  if (accountIdentifier === "invalid") {
    return { error: "Enter a valid account email or profile phone." };
  }

  if (!recoveryCode) {
    return { error: "Enter a recovery code." };
  }

  if (contactEmail === "invalid") {
    return { error: "Enter a valid contact email." };
  }

  if (rawContactPhone && !contactPhone) {
    return { error: "Enter a valid contact phone." };
  }

  if (!contactEmail && !contactPhone) {
    return { error: "Enter a contact email or phone for support." };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { error: "Account recovery is temporarily unavailable. Please try again later." };
  }

  const { error } = await supabase.rpc("redeem_account_recovery_code", {
    p_account_identifier: accountIdentifier,
    p_code_digest: recoveryCodeDigest(recoveryCode),
    p_contact_email: contactEmail,
    p_contact_phone: contactPhone,
    p_details: readActionString(input, "details") || null,
  });

  if (error) {
    if (schemaMissing(error)) {
      return {
        error:
          "Account recovery is temporarily unavailable. Please try again later or contact support.",
      };
    }

    console.error("Supabase redeem recovery code failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });

    return { error: "Account recovery request could not be submitted." };
  }

  return {
    error: null,
    message: GENERIC_RECOVERY_MESSAGE,
  };
}
