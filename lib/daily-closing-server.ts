import "server-only";
import { getCurrentBusinessContext, isSalonManageContext, isOwnerMembership } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";


export type ClosingRequest = {
  mode: "owner" | "portable";
  salonId: string;
  expectedScope: string;
  date: string;
  requestId?: string;
  expectedRevision?: number;
  values?: {cashAmount: number; creditCardAmount: number; otherAmount: number; tipInput: number | null; serviceEntered: boolean; note: string | null};
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function validateClosingRequest(input: ClosingRequest, write: boolean) {
  if (!input || !["owner", "portable"].includes(input.mode) || !uuid.test(input.salonId ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) throw new Error("Invalid closing request.");
  const date = new Date(input.date + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date) throw new Error("Invalid report date.");
  if (input.expectedScope !== `${input.salonId}:${input.expectedScope?.split(":")[1]}` || !uuid.test(input.expectedScope?.split(":")[1] ?? "")) throw new Error("Reopen this report in the current session.");
  if (input.requestId !== undefined && !uuid.test(input.requestId)) throw new Error("Invalid request ID.");
  if (write && (!input.requestId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision! < 0 || !input.values)) throw new Error("Reopen this report before saving.");
}

export async function dailyClosingRequest(input: ClosingRequest, write: boolean) {
  validateClosingRequest(input, write);
  // Portable keeps its existing signed-capability endpoint and save hook.
  if (input.mode !== "owner") return {error:{code:"42501",message:"Reopen the portable report in its signed workspace."},data:null};
  const context = await getCurrentBusinessContext();
  if (!context.user || !isSalonManageContext(context) || context.currentSalon?.id !== input.salonId) {
    return {error: {code: "42501", message: "Select the intended salon and sign in before saving."}, data: null};
  }
  const scope = `${context.currentSalon.id}:${context.user.id}`;
  if (input.expectedScope !== scope) return {error:{code:"42501",message:"Your session changed. Reopen this report before saving."},data:null};
  if(write && !isOwnerMembership(context.currentMembership)) return {error:{code:"42501",message:"Only the Owner can change Daily Report amounts."},data:null};
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) return {error: {code: "UNAVAILABLE", message: "Unable to confirm the saved result."}, data: null};
  // Bind the authenticated database actor before any write; never use an anonymous RPC.
  const admitted = await supabase.rpc("read_owner_live_daily_report", {p_salon:input.salonId,p_date:input.date,p_request:input.requestId ?? null}).abortSignal(AbortSignal.timeout(8000));
  if (admitted.error) return admitted;
  if (admitted.data?.scope !== `${input.salonId}:user:${context.user.id}`) return {error:{code:"42501",message:"The report session changed. Reopen it before saving."},data:null};
  if (!write) return {...admitted,data:{...admitted.data,scope}};
  const result = await supabase.rpc("save_owner_live_daily_report", {p_salon: input.salonId, p_date: input.date, p_request: input.requestId, p_expected_revision: input.expectedRevision, p_values: input.values}).abortSignal(AbortSignal.timeout(12000));
  return result.error ? result : {...result,data:{...result.data,scope}};
}

