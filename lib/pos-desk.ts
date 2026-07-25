import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import {
  getCurrentSalonPosSettings,
  getPosDeskDefaults,
  normalizePosSettingsPayload,
} from "@/lib/pos-settings";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayDate } from "@/lib/staff-workdays";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  PosDeskCustomer,
  PosDeskService,
  PosDeskStaff,
  PosDeskTurnSummary,
} from "@/types/pos-desk";
import type { StaffWorkdayStatus } from "@/types/staff-workday";

export const POS_DESK_DEFAULTS = getPosDeskDefaults(
  normalizePosSettingsPayload(null),
);

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open POS Desk from a Business workspace.");
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before using POS Desk.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonPosDeskData() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return {
      context,
      customers: [],
      defaults: POS_DESK_DEFAULTS,
      services: [],
      staff: [],
      today: getTodayDate(),
    };
  }

  await requirePermission(POS_TICKET_PERMISSIONS.manage, context);

  const { salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const today = getTodayDate(context.user.timezone);
  const [
    settings,
    customersResult,
    servicesResult,
    staffResult,
    workdaysResult,
    turnsResult,
  ] = await Promise.all([
      getCurrentSalonPosSettings(context),
      supabase
        .from("customers")
        .select("id, name, phone, email")
        .eq("location_id", salon.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(25)
        .returns<PosDeskCustomer[]>(),
      supabase
        .from("services")
        .select("id, name, category, base_price")
        .eq("salon_id", salon.id)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .returns<PosDeskService[]>(),
      supabase
        .from("staff")
        .select("id, display_name, job_title, is_active")
        .eq("salon_id", salon.id)
        .eq("is_active", true)
        .eq("pos_enabled", true)
        .order("display_name", { ascending: true })
        .returns<Array<Omit<PosDeskStaff, "today_status" | "turns">>>(),
      supabase
        .from("staff_workdays")
        .select("staff_id, status")
        .eq("salon_id", salon.id)
        .eq("work_date", today)
        .returns<Array<{ staff_id: string; status: StaffWorkdayStatus }>>(),
      supabase
        .from("pos_ticket_item_turn_parts")
        .select("staff_id, turn_type")
        .eq("salon_id", salon.id)
        .eq("work_date", today)
        .returns<Array<{ staff_id: string; turn_type: "large" | "small" }>>(),
    ]);

  for (const result of [
    customersResult,
    servicesResult,
    staffResult,
    workdaysResult,
    turnsResult,
  ]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const workdayStatusByStaffId = new Map(
    (workdaysResult.data ?? []).map((workday) => [workday.staff_id, workday.status]),
  );
  const turnsByStaffId = new Map<string, PosDeskTurnSummary>();

  for (const member of staffResult.data ?? []) {
    turnsByStaffId.set(member.id, {
      largeTurns: 0,
      smallTurns: 0,
      totalTurns: 0,
    });
  }

  for (const part of turnsResult.data ?? []) {
    const summary = turnsByStaffId.get(part.staff_id);

    if (!summary) {
      continue;
    }

    if (part.turn_type === "large") {
      summary.largeTurns += 1;
    } else {
      summary.smallTurns += 1;
    }

    summary.totalTurns += 1;
  }

  const staff = (staffResult.data ?? [])
    .map<PosDeskStaff>((member) => ({
      ...member,
      today_status: workdayStatusByStaffId.get(member.id) ?? "not_checked_in",
      turns: turnsByStaffId.get(member.id) ?? {
        largeTurns: 0,
        smallTurns: 0,
        totalTurns: 0,
      },
    }))
    .sort((left, right) => {
      const leftUnavailable =
        left.today_status === "checked_out" || left.today_status === "unavailable";
      const rightUnavailable =
        right.today_status === "checked_out" || right.today_status === "unavailable";

      if (leftUnavailable !== rightUnavailable) {
        return leftUnavailable ? 1 : -1;
      }

      return (
        left.turns.totalTurns - right.turns.totalTurns ||
        left.turns.largeTurns - right.turns.largeTurns ||
        left.display_name.localeCompare(right.display_name)
      );
    });

  return {
    context,
    customers: customersResult.data ?? [],
    defaults: getPosDeskDefaults(settings),
    services: servicesResult.data ?? [],
    staff,
    today,
    totalsPreview: calculateTicketTotals({ items: [] }),
  };
}
