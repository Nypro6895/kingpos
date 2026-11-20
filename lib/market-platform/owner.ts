import "server-only";
import { isOwnerMembership, isSalonManageContext, type CurrentBusinessContext } from "@/lib/current-context";
import { marketPluginContext } from "@/lib/market-plugins";
import { platformEnabled, platformRpc, PlatformError } from "./server";
import type { OwnerMarketState } from "@/types/market-platform-owner";
import { readOwnerMarketplace } from "./owner-read-model";

export async function loadOwnerMarketplace(context: CurrentBusinessContext): Promise<OwnerMarketState> {
  if (!platformEnabled()) return { status: "disabled", message: "Developer apps are not available in this environment." };
  if (!context.user || !context.currentSalon || !isSalonManageContext(context) || !isOwnerMembership(context.currentMembership) || context.currentSalon.status !== "active") {
    return { status: "select-salon", message: "Choose an active salon in your Owner workspace to manage developer apps." };
  }
  try {
    const data = readOwnerMarketplace(await platformRpc<unknown>("owner_workspace", { p_salon: context.currentSalon.id }), context.currentSalon.id);
    if (!data) { console.warn("Developer app workspace unavailable", { kind: "invalid-contract" }); throw new PlatformError("Invalid developer workspace response."); }
    return { status: "ready", data };
  }
  catch { return { status: "unavailable", message: "Developer apps could not be loaded. Your existing features remain available. Please refresh." }; }
}
export async function currentOwnerSalon(expectedSalon: unknown) {
  if (!platformEnabled()) throw new PlatformError("Developer apps are unavailable.");
  const context = await marketPluginContext();
  if (typeof expectedSalon !== "string" || context.salonId !== expectedSalon) throw new PlatformError("Your current salon changed. Refresh Market before continuing.");
  return context.salonId;
}
export function platformPublicOrigin() {
  const value = process.env.MARKET_PLATFORM_PUBLIC_ORIGIN ?? "https://reylumi.com";
  if (value !== "https://reylumi.com" && !/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(value)) throw new PlatformError("Marketplace connection origin is not configured.");
  return value;
}
