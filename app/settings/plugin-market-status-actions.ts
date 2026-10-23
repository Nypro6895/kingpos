"use server";

import { marketPluginContext, payrollDataPluginInstalled } from "@/lib/market-plugins";
import { checkinReceiptSubscription } from "@/lib/checkin-receipt-subscription";
import { taxCompanySubscription } from "@/lib/tax-company-subscription";
import { serviceRelayInstalled } from "@/app/service-relay/actions";
import { campaignWalletAction } from "@/app/campaigns/credit-actions";
import { withSettingsTarget } from "@/lib/settings-target-context";

type PluginStatus = { name: string; label: string; active: boolean; settingsHref?: string; error?: string };
async function checkSalon(salonId: string) {
  const context = await marketPluginContext();
  if (!salonId || context.salonId !== salonId) throw new Error("Choose this salon in your Owner workspace first.");
}

export async function loadPluginMarketStatusAction(salonId: string, group: "salon" | "pos" | "payroll"): Promise<{ rows?: PluginStatus[]; error?: string }> {
  try {
    return await withSettingsTarget(salonId, async () => {
    await checkSalon(salonId);
    const reads: { name: string; label: string; read: () => Promise<Pick<PluginStatus, "active" | "settingsHref">> }[] = group === "pos" ? [
      { name: "Check-in Receipt", label: "Print check-in receipts", read: async () => ({ active: (await checkinReceiptSubscription(salonId)).active }) },
      { name: "Phone Checkin", label: "Check in customers by phone", read: async () => ({ active: await serviceRelayInstalled(salonId) }) },
    ] : group === "payroll" ? [
      { name: "Payroll Data Download", label: "Download payroll data", read: async () => ({ active: await payrollDataPluginInstalled(), settingsHref: "/payroll?tab=download" }) },
      { name: "Tax Company", label: "Connect your tax company", read: async () => ({ active: (await taxCompanySubscription(salonId)).active, settingsHref: "/payroll/tax-company/settings" }) },
    ] : group === "salon" ? [
      { name: "Campaigns", label: "Run ads for your salon", read: async () => ({ active: (await campaignWalletAction()).installed, settingsHref: "/campaigns" }) },
    ] : [];
    if (!reads.length) throw new Error("Invalid settings section.");
    const results = await Promise.allSettled(reads.map(item => item.read()));
    return { rows: results.map((result, index) => result.status === "fulfilled" ? { name: reads[index].name, label: reads[index].label, ...result.value } : { name: reads[index].name, label: reads[index].label, active: false, error: "Status unavailable. Reload settings." }) };
    });
  } catch (error) { return { error: error instanceof Error ? error.message : "Plugin settings could not load." }; }
}

