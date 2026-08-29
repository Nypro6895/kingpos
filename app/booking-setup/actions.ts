"use server";

import { localDateTimeToUtcIso } from "@/lib/bookings";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
  isSalonStaffContext,
} from "@/lib/current-context";
import { resolveStaffAccountForSalon } from "@/lib/staff-account";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type BookingSetupActionResult = {
  blockId?: string;
  conflicts?: Array<{
    booking_id: string;
    booking_line_id: string;
    customer_name: string;
    scheduled_end_at: string;
    scheduled_start_at: string;
    status: string;
  }>;
  error?: string;
  ok: boolean;
};

export type WeeklyAvailabilityDraftRule = {
  dayOfWeek: number;
  effectiveEndDate?: string | null;
  effectiveStartDate?: string | null;
  endsAtLocal: string;
  ruleType: "break" | "working";
  startsAtLocal: string;
  timezoneIana: string;
};

export type CreateTimeBlockInput = {
  blockType: "blocked" | "break" | "cleanup" | "time_off";
  endLocal: string;
  overrideConflicts?: boolean;
  reason?: string | null;
  staffId: string;
  startLocal: string;
  timezoneIana: string;
};

type JsonObject = Record<string, unknown>;

function failure(error: string, extra?: Partial<BookingSetupActionResult>) {
  return {
    ...extra,
    error,
    ok: false,
  } satisfies BookingSetupActionResult;
}

function revalidateBookingSetupPaths(salonId: string) {
  revalidatePath("/bookings");
  revalidatePath("/staff");
  revalidatePath("/services");
  revalidatePath("/staff/appointments");
  revalidatePath("/explore");
  revalidatePath("/salon-profile");
  revalidatePath(`/book/${salonId}`);
}

async function getActionContext() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Open a salon workspace before managing booking setup.");
  }

  if (!context.currentSalon) {
    throw new Error("Choose a salon before managing booking setup.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  if (isSalonStaffContext(context)) {
    const staffResolution = await resolveStaffAccountForSalon({ context, supabase });

    if (staffResolution.status !== "found") {
      throw new Error("No active staff profile is linked to your account for this salon.");
    }

    return {
      context,
      accountId: context.currentAccount?.id ?? context.accountId,
      ownStaffId: staffResolution.staff.id,
      salonId: context.currentSalon.id,
      supabase,
    };
  }

  if (!isSalonManageContext(context) || !context.currentAccount) {
    throw new Error("Open a salon workspace before managing booking setup.");
  }

  return {
    context,
    accountId: context.currentAccount.id,
    ownStaffId: null,
    salonId: context.currentSalon.id,
    supabase,
  };
}

function ensureUuid(value: string | undefined, label: string) {
  const clean = value?.trim();

  if (!clean) {
    throw new Error(`${label} is required.`);
  }

  return clean;
}

function rpcPayload(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function ensureMutableStaffId(
  actionContext: Awaited<ReturnType<typeof getActionContext>>,
  requestedStaffId: string,
) {
  if (actionContext.ownStaffId && requestedStaffId !== actionContext.ownStaffId) {
    throw new Error("You can only update your own booking settings.");
  }

  return requestedStaffId;
}

async function ensureMutableTimeBlock(
  actionContext: Awaited<ReturnType<typeof getActionContext>>,
  blockId: string,
) {
  if (!actionContext.ownStaffId) {
    return;
  }

  const { data, error } = await actionContext.supabase
    .from("staff_time_blocks")
    .select("id, staff_id")
    .eq("id", blockId)
    .eq("salon_id", actionContext.salonId)
    .maybeSingle<{ id: string; staff_id: string | null }>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.staff_id !== actionContext.ownStaffId) {
    throw new Error("You can only update your own time off.");
  }
}

export async function saveStaffWeeklyAvailabilityAction(input: {
  rules: WeeklyAvailabilityDraftRule[];
  staffId: string;
}): Promise<BookingSetupActionResult> {
  try {
    const actionContext = await getActionContext();
    const staffId = ensureMutableStaffId(
      actionContext,
      ensureUuid(input.staffId, "Staff"),
    );
    const payload = input.rules.map((rule) => ({
      day_of_week: rule.dayOfWeek,
      effective_end_date: rule.effectiveEndDate ?? null,
      effective_start_date: rule.effectiveStartDate ?? null,
      ends_at_local: rule.endsAtLocal,
      rule_type: rule.ruleType,
      starts_at_local: rule.startsAtLocal,
      timezone_iana: rule.timezoneIana,
    }));
    const { error } = await actionContext.supabase.rpc("save_staff_weekly_availability", {
      p_rules: payload,
      p_salon_id: actionContext.salonId,
      p_staff_id: staffId,
    });

    if (error) {
      return failure(error.message);
    }

    revalidateBookingSetupPaths(actionContext.salonId);
    return { ok: true };
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Weekly availability could not be saved.",
    );
  }
}

export async function createStaffTimeBlockAction(
  input: CreateTimeBlockInput,
): Promise<BookingSetupActionResult> {
  try {
    const actionContext = await getActionContext();
    const staffId = ensureMutableStaffId(
      actionContext,
      ensureUuid(input.staffId, "Staff"),
    );

    if (actionContext.ownStaffId && input.blockType !== "time_off") {
      return failure("Staff can only add time off from this workspace.");
    }

    const startsAt = localDateTimeToUtcIso(input.startLocal, input.timezoneIana);
    const endsAt = localDateTimeToUtcIso(input.endLocal, input.timezoneIana);

    if (!startsAt || !endsAt) {
      return failure("Select a valid start and end time.");
    }

    const { data, error } = await actionContext.supabase.rpc("create_staff_time_block", {
      p_block_type: input.blockType,
      p_ends_at: endsAt,
      p_override_conflicts: input.overrideConflicts === true,
      p_reason: input.reason ?? null,
      p_salon_id: actionContext.salonId,
      p_staff_id: staffId,
      p_starts_at: startsAt,
      p_timezone_iana: input.timezoneIana,
    });

    if (error) {
      return failure(error.message);
    }

    const result = rpcPayload(data);

    if (result.ok === false) {
      return failure(String(result.message ?? "Time block conflicts with bookings."), {
        conflicts: Array.isArray(result.conflicts)
          ? (result.conflicts as BookingSetupActionResult["conflicts"])
          : [],
      });
    }

    revalidateBookingSetupPaths(actionContext.salonId);
    return {
      blockId: typeof result.block_id === "string" ? result.block_id : undefined,
      ok: true,
    };
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Time block could not be created.",
    );
  }
}

export async function cancelStaffTimeBlockAction(input: {
  blockId: string;
}): Promise<BookingSetupActionResult> {
  try {
    const actionContext = await getActionContext();
    const blockId = ensureUuid(input.blockId, "Time block");
    await ensureMutableTimeBlock(actionContext, blockId);

    const { error } = await actionContext.supabase.rpc("cancel_staff_time_block", {
      p_block_id: blockId,
      p_salon_id: actionContext.salonId,
    });

    if (error) {
      return failure(error.message);
    }

    revalidateBookingSetupPaths(actionContext.salonId);
    return { ok: true };
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Time block could not be cancelled.",
    );
  }
}
