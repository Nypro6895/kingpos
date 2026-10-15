"use server";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { marketServiceClient } from "@/lib/market-payments";
import { decimalUnits, marketQuote, MARKET_PRICE_DEFAULTS } from "@/lib/market-commerce";
import type { AdminActionResult } from "../_components/action-form";

export async function saveCommerceConfiguration(form: FormData): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  try {
    const prices = Object.fromEntries(Object.keys(MARKET_PRICE_DEFAULTS).map(id => [id, decimalUnits(form.get(id), id)]));
    const tax = decimalUnits(form.get("tax"), "Tax"), fee = decimalUnits(form.get("fee"), "Transaction fee"), fixed = decimalUnits(form.get("fixed"), "Fixed fee");
    for (const price of Object.values(prices)) marketQuote(price, tax, fee, fixed);
    const text = (key: string, max: number) => {
      const value = form.get(key);
      if (typeof value !== "string" || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`Invalid ${key}.`);
      return value.trim();
    };
    const client = marketServiceClient();
    const { data: previous, error: readError } = await client.from("market_commerce_configuration").select("version").eq("id", true).single();
    if (readError || !previous) throw new Error("Apply the Market commerce migration first.");
    if (String(previous.version) !== form.get("version")) throw new Error("Settings changed. Refresh before saving.");
    const change = { bank_name: text("bank_name", 160), bank_beneficiary: text("bank_beneficiary", 160), bank_account: text("bank_account", 100), bank_routing: text("bank_routing", 100), bank_instructions: text("bank_instructions", 2000), tax_bps: tax, fee_bps: fee, fixed_fee_cents: fixed, plugin_prices: prices, version: previous.version + 1, updated_at: new Date().toISOString() };
    const { data, error } = await client.from("market_commerce_configuration").update(change).eq("id", true).eq("version", previous.version).select("version").single();
    if (error || !data) throw new Error("Settings changed or could not save. Refresh and retry.");
    const { error: audit } = await client.from("platform_admin_audit_logs").insert({ actor_user_id: actor.userId, action: "market.commerce.stage", target_type: "system", before_data: { version: previous.version }, after_data: { version: data.version, tax_bps: tax, fee_bps: fee, fixed_fee_cents: fixed, plugin_prices: prices } });
    revalidatePath("/admin/market");
    return { ok: true, message: audit ? "Draft saved. Audit recording needs attention." : "Draft saved. Existing checkout prices remain effective until bank settlement is released." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Could not save commerce configuration." }; }
}
