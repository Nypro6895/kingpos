"use server";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { marketPaymentSettings, marketServiceClient } from "@/lib/market-payments";
import type { AdminActionResult } from "../_components/action-form";

export async function saveMarketPluginOperations(form: FormData): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  try {
    const previous = await marketPaymentSettings();
    const booking_deposit_test_enabled = form.has("booking_deposit_test_enabled");
    const client = marketServiceClient();
    const { error } = await client.from("market_payment_settings").update({ booking_deposit_test_enabled, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) throw new Error("The testing setting could not be saved.");
    const { error: auditError } = await client.from("platform_admin_audit_logs").insert({ actor_user_id: actor.userId, action: "market.booking_testing.update", target_type: "system", before_data: { booking_deposit_test_enabled: previous.booking_deposit_test_enabled }, after_data: { booking_deposit_test_enabled } });
    revalidatePath("/admin/market"); revalidatePath("/admin/settings"); revalidatePath("/market");
    return { ok: true, message: auditError ? "Testing setting saved; audit recording needs attention." : "Booking Deposit testing setting saved." };
  } catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : "The setting could not be saved. Please retry." }; }
}

