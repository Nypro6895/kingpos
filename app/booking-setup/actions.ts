"use server";

import { localDateTimeToUtcIso } from "@/lib/bookings";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
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

  if (!context.user || !isSalonManageContext(context)) {
    throw new Error("Open a salon workspace before managing booking setup.");
  }

  if (!context.currentAccount || !context.currentSalon) {
    throw new Error("Choose a salon before managing booking setup.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return {
    context,
    accountId: context.currentAccount.id,
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

export async function saveStaffWeeklyAvailabilityAction(input: {
  rules: WeeklyAvailabilityDraftRule[];
  staffId: string;
}): Promise<BookingSetupActionResult> {
  try {
    const { salonId, supabase } = await getActionContext();
    const payload = input.rules.map((rule) => ({
      day_of_week: rule.dayOfWeek,
      effective_end_date: rule.effectiveEndDate ?? null,
      effective_start_date: rule.effectiveStartDate ?? null,
      ends_at_local: rule.endsAtLocal,
      rule_type: rule.ruleType,
      starts_at_local: rule.startsAtLocal,
      timezone_iana: rule.timezoneIana,
    }));
    const { error } = await supabase.rpc("save_staff_weekly_availability", {
      p_rules: payload,
      p_salon_id: salonId,
      p_staff_id: ensureUuid(input.staffId, "Staff"),
    });

    if (error) {
      return failure(error.message);
    }

    revalidateBookingSetupPaths(salonId);
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
    const { salonId, supabase } = await getActionContext();
    const startsAt = localDateTimeToUtcIso(input.startLocal, input.timezoneIana);
    const endsAt = localDateTimeToUtcIso(input.endLocal, input.timezoneIana);

    if (!startsAt || !endsAt) {
      return failure("Select a valid start and end time.");
    }

    const { data, error } = await supabase.rpc("create_staff_time_block", {
      p_block_type: input.blockType,
      p_ends_at: endsAt,
      p_override_conflicts: input.overrideConflicts === true,
      p_reason: input.reason ?? null,
      p_salon_id: salonId,
      p_staff_id: ensureUuid(input.staffId, "Staff"),
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

    revalidateBookingSetupPaths(salonId);
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
    const { salonId, supabase } = await getActionContext();
    const { error } = await supabase.rpc("cancel_staff_time_block", {
      p_block_id: ensureUuid(input.blockId, "Time block"),
      p_salon_id: salonId,
    });

    if (error) {
      return failure(error.message);
    }

    revalidateBookingSetupPaths(salonId);
    return { ok: true };
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Time block could not be cancelled.",
    );
  }
}
