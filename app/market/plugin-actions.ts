"use server";
import { revalidatePath } from "next/cache";
import { marketPluginContext, PAYROLL_DATA_PLUGIN } from "@/lib/market-plugins";

export async function setPayrollDataPlugin(installed: boolean) {
  try {
    const { client, salonId } = await marketPluginContext();
    const result = installed
      ? await client.from("salon_market_plugins").upsert({ salon_id: salonId, plugin_id: PAYROLL_DATA_PLUGIN }, { onConflict: "salon_id,plugin_id", ignoreDuplicates: true })
      : await client.from("salon_market_plugins").delete().eq("salon_id", salonId).eq("plugin_id", PAYROLL_DATA_PLUGIN);
    if (result.error) throw new Error("This feature could not be updated. Please try again later.");
    revalidatePath("/market");
    revalidatePath("/payroll");
    return { installed };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update this feature." };
  }
}
