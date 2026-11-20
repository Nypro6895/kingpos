"use server";
import { createHash, randomBytes } from "node:crypto";
import { PlatformError, platformRpc } from "@/lib/market-platform/server";
import { platformPublicOrigin } from "@/lib/market-platform/owner";
import { startSellerOnboarding, refreshSellerStatus, requestFullTestRefund } from "@/lib/market-platform/commerce";
import { inspectManifest } from "@/lib/market-platform/manifest-preflight";
import { developerMutationConfirmed, developerUncertain, connectionDetails } from "@/lib/market-platform/mutation-confirmation";

export type ActionState = { ok: boolean; message: string; token?: string; refreshToken?: string; url?: string; launchUrl?: string; uncertain?: boolean };
const uuid = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new PlatformError("Reload and select a valid record.");
  return value;
};
export async function platformAction(_state: ActionState, form: FormData): Promise<ActionState> {
  let attempted = false;
  const mutate = async (operation: string, args: Record<string, unknown>) => {
    attempted = true;
    const value = await platformRpc<unknown>(operation, args);
    if (!developerMutationConfirmed(operation, value, args)) throw new PlatformError(developerUncertain, "unknown");
  };
  try {
    const op = form.get("operation");
    const allowed: Record<string, string[]> = { profile: ["name", "email", "website", "description"], client: ["app", "confirm"], register: ["name"], submit: ["app", "manifest", "requestId"], review: ["version", "sha256", "publisher", "decision", "reason"], sandbox: ["version"], "sandbox-connect": ["version"], onboard: [], "seller-refresh": [], refund: ["order", "confirm"], moderate: ["app", "active", "reason"] };
    if (typeof op !== "string" || !allowed[op]) throw new PlatformError("Unsupported operation.");
    for (const key of form.keys()) if (!key.startsWith("$ACTION_") && (form.getAll(key).length !== 1 || !["operation", ...allowed[op]].includes(key))) throw new PlatformError("Unexpected or duplicate form field. Reload and retry.");
    if (op === "profile") {
      await mutate("profile_save", { p_name: form.get("name"), p_email: form.get("email"), p_website: form.get("website"), p_description: form.get("description") });
    } else if (op === "client") {
      if (form.get("confirm") !== "yes") throw new PlatformError("Confirm credential rotation and disconnection.");
      const secret = `rmc_${randomBytes(32).toString("base64url")}`;
      await mutate("rotate_client", { p_app: uuid(form.get("app")), p_secret_hash: createHash("sha256").update(secret).digest("hex") });
      return {ok:true,message:"Client secret shown once. Store in your backend secret manager. Rotation disconnects existing app sessions; Owners reconnect from Market.",token:secret};
    } else if (op === "moderate") {
      if (!["true", "false"].includes(String(form.get("active")))) throw new PlatformError("Choose availability.");
      await mutate("moderate", { p_app: uuid(form.get("app")), p_active: form.get("active") === "true", p_reason: form.get("reason") });
    } else if (op === "refund") {
      if (form.get("confirm") !== "yes") throw new PlatformError("Confirm the full test refund and transfer reversal.");
      const order = uuid(form.get("order")); attempted = true;
      const status = await requestFullTestRefund(order);
      if (!["pending", "requires_action", "succeeded", "failed", "canceled"].includes(status)) throw new PlatformError(developerUncertain, "unknown");
      return { ok: true, message: status === "failed" || status === "canceled"
        ? "The provider reports that this test refund failed or was canceled. Reconcile before requesting any further refund."
        : "Test refund status recorded. Reconcile the authoritative charge before treating the refund or access removal as completed." };
    } else if (op === "onboard") {
      attempted = true;
      return { ok: true, message: "Continue to Stripe's test onboarding. Use synthetic test information only.", url: await startSellerOnboarding() };
    } else if (op === "seller-refresh") {
      attempted = true;
      await refreshSellerStatus();
    } else if (op === "register") {
      await mutate("register", { p_name: String(form.get("name") ?? "") });
    } else if (op === "submit") {
      const file = form.get("manifest");
      if (!(file instanceof File) || file.size < 1 || file.size > 16384 || !file.name.endsWith(".json")) throw new PlatformError("Choose a JSON manifest of at most 16 KiB.");
      const checked = inspectManifest(await file.text());
      if (!checked.ok) throw new PlatformError(checked.errors.join(" "));
      await mutate("submit", { p_app: form.get("app") ? uuid(form.get("app")) : null, p_manifest: checked.manifest, p_request: uuid(form.get("requestId")) });
    } else if (op === "review") {
      const publisher=form.get("publisher");
      if(typeof publisher!=="string" || Array.from(publisher).length<2 || Array.from(publisher).length>100)throw new PlatformError("Reload the review queue and inspect the displayed publisher identity.");
      await mutate("review_exact", { p_version: uuid(form.get("version")), p_sha256: form.get("sha256"), p_publisher_name:publisher, p_decision: form.get("decision"), p_reason: form.get("reason") });
    } else if (op === "sandbox-connect") {
      const version=uuid(form.get("version"));
      const value = await platformRpc<{installationId?:string;versionId?:string;synthetic?:boolean}>("sandbox_connection_start", {p_version:version});
      const info = connectionDetails(value, value?.installationId ?? "");
      if (!info || value.synthetic !== true || value.versionId!==version) throw new PlatformError("Synthetic connection details could not be verified. Reload before continuing.");
      const url = new URL(info.launchUrl);
      url.searchParams.set("reylumi_installation",info.installationId);url.searchParams.set("reylumi_client_id",info.clientId);
      url.searchParams.set("reylumi_authorize_url",`${platformPublicOrigin()}/api/market-platform/authorize`);url.searchParams.set("reylumi_sandbox","true");
      return {ok:true,message:"This connection uses only synthetic test data. It does not install or approve the app for a real salon.",launchUrl:url.href};
    } else if (op === "sandbox") {
      const token = `rmp_${randomBytes(32).toString("base64url")}`;
      const digest = createHash("sha256").update(token).digest("hex");
      await mutate("sandbox", { p_version: uuid(form.get("version")), p_token_hash: digest });
      return { ok: true, message: "Synthetic test salon created. Store this developer test token on your app server. Expires after 24 hours or 1,000 requests; resetting revokes the previous token.", token };
    } else throw new PlatformError("Unsupported operation.");
    return { ok: true, message: "Saved. Your workspace has been refreshed." };
  } catch (error) {
    if (attempted && (!(error instanceof PlatformError) || error.outcome === "unknown")) return { ok: false, uncertain: true, message: developerUncertain };
    return { ok: false, message: error instanceof PlatformError ? error.message : "The request could not be saved. Reload and retry." };
  }
}
