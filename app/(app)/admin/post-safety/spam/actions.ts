"use server";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { revalidatePath } from "next/cache";
import { abuseHash } from "@/lib/abuse-signals";
import { isIP } from "node:net";

export async function manageSpamAction(form: FormData) {
  try {
    const action = String(form.get("action") ?? "");
    const reason = String(form.get("reason") ?? "");
    if (action === "restrict") {
      const scope = String(form.get("scope") ?? "");
      let identifier = String(form.get("identifier") ?? "").trim();
      if (scope === "ip" && isIP(identifier)) identifier = abuseHash(`ip:${identifier}`);
      if (scope === "country") identifier = identifier.toUpperCase();
      await callPlatformAdminRpc("admin_abuse_restriction", { p_scope: scope, p_identifier: identifier, p_mode: String(form.get("mode") ?? ""), p_hours: Number(form.get("hours")), p_reason: reason });
    } else if (action === "approve_identity") {
      await callPlatformAdminRpc("admin_approve_abuse_identity", { p_user_id: String(form.get("id") ?? ""), p_reason: reason });
    } else if (action === "revoke") {
      await callPlatformAdminRpc("admin_revoke_abuse_restriction", { p_id: String(form.get("id") ?? ""), p_reason: reason });
    } else if (action === "policy") {
      const policy = Object.fromEntries([...form.entries()].filter(([key]) => key.startsWith("policy:")).map(([key, value]) => [key.slice(7), Number(value)]));
      await callPlatformAdminRpc("admin_abuse_policy", { p_policy: policy, p_reason: reason });
    } else if (action === "allow_comment" || action === "delete_comment") {
      await callPlatformAdminRpc("admin_review_spam_comment", { p_event_id: String(form.get("id") ?? ""), p_allow: action === "allow_comment", p_reason: reason });
    } else throw new Error("Choose an action.");
    revalidatePath("/admin/post-safety"); revalidatePath("/explore");
    return { ok: true, message: "Changes saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save changes." }; }
}
