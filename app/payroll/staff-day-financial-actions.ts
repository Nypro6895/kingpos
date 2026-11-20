"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusinessContext, isOwnerMembership, isSalonManageContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { payrollWriteFailure } from "@/lib/payroll-write-result";

async function owner(salonId: string) {
  const context = await getCurrentBusinessContext();
  if (!context.user || !isSalonManageContext(context) || context.currentSalon?.id !== salonId || !isOwnerMembership(context.currentMembership)) throw new Error("The salon or account changed. Reopen the staff day before saving.");
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Please sign in again.");
  return { client, scope: `${salonId}:${context.user.id}` };
}

export async function readStaffDayFinancialInput(salonId: string, staffId: string, businessDate: string) {
  const { client, scope } = await owner(salonId);
  const { data, error } = await client.rpc("read_staff_day_financial_input", { p_salon: salonId, p_staff: staffId, p_date: businessDate });
  if (error) throw new Error(error.message);
  return { revision: Number(data.revision), service_total: Number(data.service_total), tip_amount: Number(data.tip_amount), scope };
}

export async function saveStaffDayFinancialInput(input: {
  salonId: string; staffId: string; businessDate: string; scope: string; requestId: string; revision: number;
  expectedService: number; expectedTip: number; serviceTotal: number; tipAmount: number; note: string;
}) {
  let auth: Awaited<ReturnType<typeof owner>>;
  try { auth = await owner(input.salonId); }
  catch (error) { return { status: "error" as const, message: error instanceof Error ? error.message : "Reopen the staff day before saving." }; }
  const { client, scope } = auth;
  if (input.scope !== scope) return { status: "error" as const, message: "The salon or account changed. Reopen the staff day before saving." };
  const { data, error } = await client.rpc("save_staff_day_financial_input", {
    p_salon: input.salonId, p_staff: input.staffId, p_date: input.businessDate, p_request: input.requestId,
    p_revision: input.revision, p_expected_service: input.expectedService, p_expected_tip: input.expectedTip,
    p_service: input.serviceTotal, p_tip: input.tipAmount, p_note: input.note,
  });
  if (error) { const failure = payrollWriteFailure(error); return { status: failure.outcomeUnknown ? "unknown" as const : "error" as const, message: failure.message }; }
  // Cache invalidation failure cannot turn a committed save into a failed save.
  try { revalidatePath("/reports"); revalidatePath("/payroll"); revalidatePath("/staff/my-work"); } catch { /* Refresh on next navigation. */ }
  return { status: "saved" as const, changed: Boolean(data.changed), current: data.current as { revision: number; service_total: number; tip_amount: number } };
}
