import "server-only";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { portableDailyClosingRequest } from "@/app/pos/portable/actions";

export type ClosingRequest = {
  mode: "owner" | "portable";
  salonId: string;
  date: string;
  requestId?: string;
  expectedRevision?: number;
  values?: {cashAmount: number; creditCardAmount: number; otherAmount: number; note: string | null};
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function validateClosingRequest(input: ClosingRequest, write: boolean) {
  if (!input || !["owner", "portable"].includes(input.mode) || !uuid.test(input.salonId ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw new Error("Invalid closing request.");
  const date = new Date(input.date + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date) throw new Error("Invalid report date.");
  if (input.requestId !== undefined && !uuid.test(input.requestId)) throw new Error("Invalid request ID.");
  if (write && (!input.requestId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision! < 0 || !input.values)) throw new Error("Reopen this report before saving.");
}

export async function dailyClosingRequest(input: ClosingRequest, write: boolean) {
  validateClosingRequest(input, write);
  if (input.mode === "portable") return portableDailyClosingRequest(input, write);
  const context = await getCurrentBusinessContext();
  if (!context.user || !isSalonManageContext(context) || context.currentSalon?.id !== input.salonId) {
    return {error: {code: "42501", message: "Select the intended salon and sign in before saving."}, data: null};
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return {error: {code: "UNAVAILABLE", message: "Unable to confirm the saved result."}, data: null};
  return write
    ? supabase.rpc("save_daily_closing_once", {p_salon: input.salonId, p_date: input.date, p_request: input.requestId, p_expected_revision: input.expectedRevision, p_values: input.values}).abortSignal(AbortSignal.timeout(12000))
    : supabase.rpc("read_daily_closing_save_state", {p_salon: input.salonId, p_date: input.date, p_request: input.requestId ?? null}).abortSignal(AbortSignal.timeout(8000));
}
