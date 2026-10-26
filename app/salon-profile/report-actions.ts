"use server";

import { revalidatePath } from "next/cache";
import { assertAbuseRequest } from "@/lib/abuse-server";
import { SALON_REPORT_REASONS } from "@/lib/salon-report";
import { createAuthenticatedSupabaseServerClient, createSafetySupabaseServerClient } from "@/lib/supabase/server";

export async function reportSalonAction(input: { requestId: string; salonId: string; reason: string; details: string }) {
  try {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!input || !uuid.test(input.requestId) || !uuid.test(input.salonId)
      || !SALON_REPORT_REASONS.some(([reason]) => reason === input.reason)
      || typeof input.details !== "string" || input.details.trim().length > 2000) {
      throw new Error("Please check your report and choose a reason.");
    }
    await assertAbuseRequest("report");
    const client = await createAuthenticatedSupabaseServerClient() ?? await createSafetySupabaseServerClient();
    if (!client) throw new Error("Reporting is temporarily unavailable. Please try again later.");
    const { data, error } = await client.rpc("submit_salon_report", {
      p_request_id: input.requestId,
      p_salon_id: input.salonId,
      p_reason: input.reason,
      p_details: input.details.trim(),
    });
    if (error) throw new Error(error.code === "PGRST202" ? "Reporting is temporarily unavailable. Please try again later." : error.message);
    if (!data?.id) throw new Error("Your report could not be sent. Please try again.");
    revalidatePath("/admin/reports");
    revalidatePath("/support");
    return { ok: true as const, supportHref: data.supportHref as string | null };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Your report could not be sent. Please try again." };
  }
}
