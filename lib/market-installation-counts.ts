import "server-only";
import { marketServiceClient } from "@/lib/market-payments";

// Return aggregate totals only; salon identities never reach the browser.
export async function marketInstallationCounts(): Promise<Record<string, number>> {
  try {
    const client = marketServiceClient();
    const results = await Promise.all([
      client.from("salon_market_plugins").select("salon_id", { count: "exact", head: true }).eq("plugin_id", "payroll-data-download"),
      client.from("campaign_wallets").select("salon_id", { count: "exact", head: true }).eq("installed", true),
      client.from("vietnamese_plugin_subscriptions").select("salon_id", { count: "exact", head: true }).eq("installed", true),
      client.from("checkin_receipt_subscriptions").select("salon_id", { count: "exact", head: true }).gt("paid_until", new Date().toISOString()),
    ]);
    if (results.some(result => result.error)) return {};
    return Object.fromEntries(["payroll-data-download", "campaigns", "vietnamese-language", "checkin-receipt"].map((id, index) => [id, results[index].count ?? 0]));
  } catch { return {}; }
}
