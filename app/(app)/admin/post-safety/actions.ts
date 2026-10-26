"use server";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { revalidatePath } from "next/cache";

export async function reviewPostSafetyAction(form: FormData) {
  try {
    await callPlatformAdminRpc("review_post_safety_with_message", {
      p_case_id: String(form.get("caseId") ?? ""), p_action: String(form.get("action") ?? ""), p_reason: String(form.get("reason") ?? ""),
      p_public_message: String(form.get("publicMessage") ?? ""),
      p_request_id: String(form.get("requestId") ?? "") || null,
    });
    revalidatePath("/admin/post-safety"); revalidatePath("/admin/reports", "layout"); revalidatePath("/admin/users", "layout"); revalidatePath("/explore", "layout");
    return { ok: true, message: "Changes saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to review post." }; }
}
export async function openPostReportConversation(caseId:string) {
  const id=await callPlatformAdminRpc<string|null>("get_review_support_link",{p_kind:"post_report",p_request:caseId});
  if(!id)throw new Error("This report has no authenticated conversation.");
  return id;
}
export async function saveSafetyKeywordAction(form: FormData) {
  try {
    await callPlatformAdminRpc("admin_post_safety_keyword", {
      p_phrase: String(form.get("phrase") ?? ""), p_category: String(form.get("category") ?? ""), p_enabled: form.get("enabled") === "on",
    });
    revalidatePath("/admin/post-safety"); return { ok: true, message: "Changes saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save keyword." }; }
}
