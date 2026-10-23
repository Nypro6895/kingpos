"use server";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { marketPaymentReady, marketPaymentSettings, marketServiceClient, marketStripe } from "@/lib/market-payments";
import type { AdminActionResult } from "../_components/action-form";

export async function saveMarketSettings(form: FormData): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  try {
    const previous = await marketPaymentSettings();
    const enabled = form.has("enabled"), published = form.has("vietnamese_published"), bookingTest = form.has("booking_deposit_test_enabled");
    if (enabled) {
      if (!marketPaymentReady()) throw new Error("Configure MARKET_STRIPE_SECRET_KEY and MARKET_STRIPE_WEBHOOK_SECRET in the server environment first.");
      await marketStripe("account");
    }
    const client = marketServiceClient();
    const { error } = await client.from("market_payment_settings").update({ enabled, vietnamese_published: published, booking_deposit_test_enabled: bookingTest, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) throw new Error("Market settings could not be saved.");
    const { error: auditError } = await client.from("platform_admin_audit_logs").insert({ actor_user_id: actor.userId, action: "market.settings.update", target_type: "system", before_data: previous, after_data: { enabled, vietnamese_published: published, booking_deposit_test_enabled: bookingTest } });
    revalidatePath("/admin/market"); revalidatePath("/market");
    return { ok: true, message: auditError ? "Settings saved; audit recording needs attention." : "Market settings saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save Market settings." }; }
}
