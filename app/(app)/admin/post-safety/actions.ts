"use server";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { revalidatePath } from "next/cache";

export async function reviewPostSafetyAction(form: FormData) {
  try {
    await callPlatformAdminRpc("admin_review_post_safety", {
      p_case_id: String(form.get("caseId") ?? ""), p_action: String(form.get("action") ?? ""), p_reason: String(form.get("reason") ?? ""),
    });
    revalidatePath("/admin/post-safety"); revalidatePath("/admin/reports", "layout"); revalidatePath("/admin/users", "layout"); revalidatePath("/explore", "layout");
    return { ok: true, message: "Changes saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to review post." }; }
}
export async function saveSafetyKeywordAction(form: FormData) {
  try {
    await callPlatformAdminRpc("admin_post_safety_keyword", {
      p_phrase: String(form.get("phrase") ?? ""), p_category: String(form.get("category") ?? ""), p_enabled: form.get("enabled") === "on",
    });
    revalidatePath("/admin/post-safety"); return { ok: true, message: "Changes saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save keyword." }; }
}
