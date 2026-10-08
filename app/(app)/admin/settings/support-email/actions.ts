"use server";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { getSupportEmailConfig, encryptSupportEmail, publicSupportEmailConfig, verifySupportEmailDomain, type SupportEmailConfig } from "@/lib/support-email";
import { supportEmail } from "@/lib/support-rules";
import { supportServiceClient } from "@/lib/support-server";
import type { AdminActionResult } from "../../_components/action-form";

export async function saveSupportEmailSettingsAction(form: FormData): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  try {
    const old = await getSupportEmailConfig();
    const config: SupportEmailConfig = { apiKey: String(form.get("api_key") || "").trim() || old.apiKey, from: supportEmail(form.get("from")), enabled: form.has("enabled"), domainVerified: false };
    if (config.enabled || form.get("intent") === "test") {
      if (!/^re_[a-zA-Z0-9_-]{10,190}$/.test(config.apiKey)) throw new Error("Enter a valid Resend API key.");
      config.domainVerified = await verifySupportEmailDomain(config);
    } else config.domainVerified = config.from === old.from && old.domainVerified;
    if (form.get("intent") === "test") return { ok: true, message: "Connection verified. The sender domain is ready. No email was sent." };
    const { error } = await supportServiceClient().rpc("save_platform_support_email_settings", { p_actor: actor.userId, p_encrypted: encryptSupportEmail(config), p_public: publicSupportEmailConfig(config) });
    if (error) throw new Error("Email settings could not be saved.");
    revalidatePath("/admin/settings/support-email"); revalidatePath("/admin/inbox", "layout");
    return { ok: true, message: config.enabled ? "Support email connected. Admins can now reply directly from Inbox." : "Direct email disabled. Messages continue to arrive in Inbox." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save support email settings." }; }
}
