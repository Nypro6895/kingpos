"use server";

import {
  RECOVERY_ADMIN_PATH,
  RECOVERY_BACK_OFFICE_PATH,
  currentUserCanManageRecoveryBackOffice,
} from "@/lib/account-security-backoffice";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type ActionInput = FormData | Record<string, unknown>;
type RecoveryBackOfficeActionResult = {
  error: string | null;
  message?: string;
};

const RECOVERY_STATUSES = new Set([
  "open",
  "reviewing",
  "needs_info",
  "approved",
  "denied",
  "resolved",
  "cancelled",
]);
const RECOVERY_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const RECOVERY_RISK_LEVELS = new Set([
  "unknown",
  "low",
  "medium",
  "high",
  "critical",
]);
const USER_RECOVERY_STATUSES = new Set(["active", "suspended"]);

function readActionValue(input: ActionInput, key: string) {
  return input instanceof FormData ? input.get(key) : input[key];
}

function readActionString(input: ActionInput, key: string) {
  const value = readActionValue(input, key);
  return typeof value === "string" ? value.trim() : "";
}

async function getSupportSupabase() {
  const [supabase, canAccess] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    currentUserCanManageRecoveryBackOffice(),
  ]);

  if (!supabase || !canAccess) {
    return null;
  }

  return supabase;
}

function revalidateRecoveryBackOfficePaths() {
  revalidatePath(RECOVERY_BACK_OFFICE_PATH);
  revalidatePath(RECOVERY_ADMIN_PATH);
}

function supportActionError(error: { message?: string | null } | null) {
  return error?.message || "Recovery back-office action could not be completed.";
}

export async function updateRecoveryBackOfficeCaseAction(
  input: ActionInput,
): Promise<RecoveryBackOfficeActionResult> {
  const requestId = readActionString(input, "request_id");
  const status = readActionString(input, "status") || "reviewing";
  const priority = readActionString(input, "priority") || "normal";
  const riskLevel = readActionString(input, "risk_level") || "unknown";

  if (!requestId) {
    return { error: "Recovery request could not be found." };
  }

  if (!RECOVERY_STATUSES.has(status)) {
    return { error: "Choose a valid recovery status." };
  }

  if (!RECOVERY_PRIORITIES.has(priority)) {
    return { error: "Choose a valid priority." };
  }

  if (!RECOVERY_RISK_LEVELS.has(riskLevel)) {
    return { error: "Choose a valid risk level." };
  }

  const supabase = await getSupportSupabase();

  if (!supabase) {
    return { error: "Recovery support permission is required." };
  }

  const { error } = await supabase.rpc(
    "account_recovery_support_update_request",
    {
      p_note: readActionString(input, "note") || null,
      p_priority: priority,
      p_request_id: requestId,
      p_resolution_summary:
        readActionString(input, "resolution_summary") || null,
      p_risk_level: riskLevel,
      p_status: status,
    },
  );

  if (error) {
    return { error: supportActionError(error) };
  }

  revalidateRecoveryBackOfficePaths();

  return {
    error: null,
    message: "Recovery case updated.",
  };
}

export async function secureRecoveryBackOfficeAccountAction(
  input: ActionInput,
): Promise<RecoveryBackOfficeActionResult> {
  const requestId = readActionString(input, "request_id");

  if (!requestId) {
    return { error: "Recovery request could not be found." };
  }

  const supabase = await getSupportSupabase();

  if (!supabase) {
    return { error: "Recovery support permission is required." };
  }

  const { error } = await supabase.rpc(
    "account_recovery_support_secure_account",
    {
      p_note: readActionString(input, "note") || null,
      p_request_id: requestId,
    },
  );

  if (error) {
    return { error: supportActionError(error) };
  }

  revalidateRecoveryBackOfficePaths();

  return {
    error: null,
    message: "Account sessions and trusted devices were secured.",
  };
}

export async function updateRecoveryBackOfficeUserStatusAction(
  input: ActionInput,
): Promise<RecoveryBackOfficeActionResult> {
  const requestId = readActionString(input, "request_id");
  const status = readActionString(input, "user_status");

  if (!requestId) {
    return { error: "Recovery request could not be found." };
  }

  if (!USER_RECOVERY_STATUSES.has(status)) {
    return { error: "Choose active or suspended." };
  }

  const supabase = await getSupportSupabase();

  if (!supabase) {
    return { error: "Recovery support permission is required." };
  }

  const { error } = await supabase.rpc(
    "account_recovery_support_update_user_status",
    {
      p_note: readActionString(input, "note") || null,
      p_request_id: requestId,
      p_status: status,
    },
  );

  if (error) {
    return { error: supportActionError(error) };
  }

  revalidateRecoveryBackOfficePaths();

  return {
    error: null,
    message:
      status === "suspended"
        ? "Account suspended for recovery review."
        : "Account restored to active.",
  };
}
