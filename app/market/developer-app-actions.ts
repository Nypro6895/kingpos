"use server";
import { redirect } from "next/navigation";
import { currentOwnerSalon, platformPublicOrigin } from "@/lib/market-platform/owner";
import { platformRpc, PlatformError } from "@/lib/market-platform/server";
import { startTestCheckout } from "@/lib/market-platform/commerce";
import { readOwnerMarketplace } from "@/lib/market-platform/owner-read-model";
import { installedAcknowledgement, installationObserved, revokedObserved, connectionDetails, ownerUncertain } from "@/lib/market-platform/mutation-confirmation";

import type { OwnerMarketplace } from "@/types/market-platform-owner";
export type OwnerAppActionState = { ok: boolean; message: string; checkoutUrl?: string; market?: OwnerMarketplace; uncertain?: boolean };
const uuid = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new PlatformError("Choose a valid app version.");return value;
};
export async function ownerAppAction(_state: OwnerAppActionState, form: FormData): Promise<OwnerAppActionState> {
  let launch: string | undefined;
  let attempted = false;
  let expectedInstallation: ReturnType<typeof installedAcknowledgement> = null;
  let revokedId: string | undefined;
  try {
    const op = String(form.get("operation"));
    const fields: Record<string, string[]> = { install: ["version", "sha256", "scopes", "consent"], revoke: ["installation"], connect: ["installation"], checkout: ["version", "sha256"] };
    if (!fields[op]) throw new PlatformError("Unsupported app operation.");
    for (const key of form.keys()) if (!key.startsWith("$ACTION_") && (!fields[op].concat("operation", "salon").includes(key) || form.getAll(key).length !== 1)) throw new PlatformError("Unexpected form fields. Refresh Market.");
    const salon = await currentOwnerSalon(form.get("salon"));
    if (op === "install") {
      if (form.get("consent") !== "yes") throw new PlatformError("Read and accept the permissions for this version.");
      const version = uuid(form.get("version")), scopes: unknown = JSON.parse(String(form.get("scopes")));
      attempted = true;
      const reply = await platformRpc<unknown>("install", { p_salon: salon, p_version: version, p_sha256: form.get("sha256"), p_scopes: scopes });
      expectedInstallation = installedAcknowledgement(reply, salon, version, scopes);
      if (!expectedInstallation) throw new PlatformError(ownerUncertain, "unknown");
    } else if (op === "revoke") {
      // Check installation is in the active salon, even if this Owner owns more than one.
      revokedId = uuid(form.get("installation"));
      if (await platformRpc<unknown>("connection_owner_check", { p_salon: salon, p_installation: revokedId }) !== true) throw new PlatformError("Current salon permission could not be verified. Reload Market before retrying.");
      attempted = true;
      if (await platformRpc<unknown>("revoke", { p_installation: revokedId }) !== true) throw new PlatformError(ownerUncertain, "unknown");
    } else if (op === "checkout") {
      const version = uuid(form.get("version")); attempted = true;
      return { ok: true, message: "Continue to test Checkout. Verified payment and salon permission consent are required before access.", checkoutUrl: await startTestCheckout(salon, version, String(form.get("sha256"))) };
    } else {
      const installation = uuid(form.get("installation"));
      const info = connectionDetails(await platformRpc<unknown>("connection_start", { p_salon: salon, p_installation: installation }), installation);
      if (!info) throw new PlatformError("Connection details could not be verified. Reload Market before opening this app.");
      const url = new URL(info.launchUrl);
      url.searchParams.set("reylumi_installation", info.installationId);url.searchParams.set("reylumi_client_id", info.clientId);
      url.searchParams.set("reylumi_authorize_url", `${platformPublicOrigin()}/api/market-platform/authorize`);
      launch = url.href;
    }
    if (!launch) {
      let market: OwnerMarketplace | null = null;
      try { market = readOwnerMarketplace(await platformRpc<unknown>("owner_workspace", {p_salon:salon}), salon); }
      catch { /* The mutation already completed; a failed observation must not claim it failed or succeeded twice. */ }
      if (!market || (expectedInstallation && !installationObserved(market, expectedInstallation)) || (revokedId && !revokedObserved(market, revokedId))) return { ok: false, uncertain: true, message: ownerUncertain };
      return { ok: true, market, message: op === "revoke" ? "Plugin removed and its salon connection revoked." : "Plugin activated for your current salon. Open it to connect automatically." };
    }
  } catch (error) {
    if (attempted && (!(error instanceof PlatformError) || error.outcome === "unknown")) return { ok: false, uncertain: true, message: ownerUncertain };
    return { ok: false, message: error instanceof PlatformError ? error.message : "This app could not be updated. Refresh Market and retry." };
  }
  redirect(launch!);
}
