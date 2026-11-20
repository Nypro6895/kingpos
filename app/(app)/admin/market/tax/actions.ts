"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { saveMarketTaxProduct, saveMarketTaxSettings, syncMarketTaxProvider } from "@/lib/market-tax";
import type { AdminActionResult } from "../../_components/action-form";
import type { MarketTaxPriceBehavior } from "@/types/market-tax";

class TaxInputError extends Error {}

function version(form: FormData, optional = false): number | null {
  const value = form.get("version");
  if (optional && value === "") return null;
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new TaxInputError("Refresh the page before saving this configuration.");
  }
  return Number(value);
}

function taxCode(form: FormData): string | null {
  const value = form.get("tax_code");
  if (typeof value !== "string") throw new TaxInputError("Choose a valid Stripe product tax code.");
  const code = value.trim();
  if (!code) return null;
  if (!/^txcd_\d{8}$/.test(code)) throw new TaxInputError("Choose an exact Stripe product tax code, such as txcd_10103001.");
  return code;
}

function friendlyFailure(error: unknown) {
  if (error instanceof TaxInputError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (/\b(version|stale|conflict|changed)\b|another admin/i.test(message)) return "Another admin changed this configuration. Refresh before saving again.";
  if (/registration|register.*tax/i.test(message)) return "Review the products you sell and add required tax registrations in Stripe before enabling collection.";
  if (/tax.*code|product.*classification/i.test(message)) return "Choose a valid Stripe tax classification for the default or each published plugin.";
  if (/head.?office|business.*address/i.test(message)) return "Set your actual business address in Stripe Tax, then check the connection again.";
  if (/connect|credential|stripe.*configured|provider.*unavailable/i.test(message)) return "Connect Stripe in payment settings, then check the tax connection again.";
  if (/pending|not.*active|not.*ready/i.test(message)) return "Complete the Stripe Tax setup and check readiness before enabling collection.";
  return "This tax setting could not be saved. Review the configuration and try again.";
}

async function mutation(run: () => Promise<string>): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  try {
    const message = await run();
    revalidatePath("/admin/market/tax");
    revalidatePath("/admin/market");
    revalidatePath("/market");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, message: friendlyFailure(error) };
  }
}

export async function saveAutomaticTaxSettings(form: FormData): Promise<AdminActionResult> {
  return mutation(async () => {
    const enabledValue = form.get("enabled");
    if (enabledValue !== null && enabledValue !== "on") throw new TaxInputError("Choose a valid collection option.");
    const behavior = form.get("price_behavior");
    if (behavior !== "exclusive" && behavior !== "inclusive") throw new TaxInputError("Choose whether prices include tax.");
    await saveMarketTaxSettings({
      version: version(form)!, enabled: enabledValue === "on",
      price_behavior: behavior as MarketTaxPriceBehavior, default_tax_code: taxCode(form),
    });
    return enabledValue === "on"
      ? "Automatic tax collection enabled. New purchases use customer location, product classification and your active registrations."
      : "Tax configuration saved with automatic collection off.";
  });
}

export async function saveAutomaticTaxProduct(form: FormData): Promise<AdminActionResult> {
  return mutation(async () => {
    const plugin = form.get("plugin_id");
    if (typeof plugin !== "string" || !/^[a-z][a-z0-9-]{1,79}$/.test(plugin)) throw new TaxInputError("Refresh the plugin list before saving.");
    await saveMarketTaxProduct({ plugin_id: plugin, version: version(form, true), tax_code: taxCode(form) });
    return "Product classification saved. An empty override uses the default classification.";
  });
}

export async function checkAutomaticTaxConnection(): Promise<AdminActionResult> {
  return mutation(async () => {
    const result = await syncMarketTaxProvider();
    return typeof result.message === "string" && result.message.length <= 500 && !/(?:[spr]k_(?:live|test)_|whsec_)/i.test(result.message)
      ? result.message
      : "Stripe Tax status refreshed. Review the business address, registrations and product readiness below.";
  });
}
