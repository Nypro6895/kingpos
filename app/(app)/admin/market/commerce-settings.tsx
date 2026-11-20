import { marketServiceClient } from "@/lib/market-payments";
import { CommerceForm, type CommerceConfiguration } from "./commerce-form";

export async function CommerceSettings() {
  const result = await (async () => {
    try { return await marketServiceClient().from("market_commerce_configuration").select("*").eq("id", true).single(); }
    catch { return { data: null, error: true }; }
  })();
  const { data, error } = result;
  if (error || !data) return <p role="alert">Apply the Market commerce configuration migration to configure bank receipt and draft pricing.</p>;
  const configuration: CommerceConfiguration = { version: data.version, bank_name: data.bank_name, bank_beneficiary: data.bank_beneficiary, bank_account: data.bank_account, bank_routing: data.bank_routing, bank_instructions: data.bank_instructions, tax_bps: data.tax_bps, fee_bps: data.fee_bps, fixed_fee_cents: data.fixed_fee_cents, plugin_prices: data.plugin_prices };
  return <CommerceForm key={data.version} configuration={configuration} />;
}
