"use server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CheckinReceipt } from "@/types/checkin-receipt";

export async function issueCheckinReceipt(token: string, visitId: string): Promise<{ receipt?: CheckinReceipt | null; error?: string }> {
  try {
    const client = createSupabaseServerClient();
    if (!client) throw new Error("Receipt service is unavailable.");
    const { data, error } = await client.rpc("issue_checkin_receipt", { p_token: token, p_visit: visitId });
    if (error) throw new Error("Receipt could not be prepared. Ask the front desk to retry.");
    return { receipt: data };
  } catch (error) { return { error: error instanceof Error ? error.message : "Receipt could not be prepared." }; }
}
