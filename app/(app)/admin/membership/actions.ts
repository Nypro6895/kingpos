"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { loadMembershipDetail, loadMembershipWorkspace } from "@/lib/platform-admin/membership";
import type { MembershipMutation } from "@/types/reylumi-membership";

export async function membershipWorkspaceAction(query: string, status: string, page: number, plan = "") {
  await requirePlatformAdmin(P.membershipRead);
  try { return { data: await loadMembershipWorkspace(query, status, page, plan) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Membership could not load." }; }
}
export async function membershipDetailAction(id: string) {
  await requirePlatformAdmin(P.membershipRead);
  try { return { data: await loadMembershipDetail(id) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Membership could not load." }; }
}
export async function membershipSalonSearchAction(query: string) {
  await requirePlatformAdmin(P.membershipRead);
  try { return { data: await callPlatformAdminRpc<Array<{ id: string; name: string; phone: string | null; city: string | null }>>("reylumi_membership_salons", { p_query: query }) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Salon search could not load." }; }
}
export async function membershipActivityAction(kind: string, query: string, status: string, page: number) {
  await requirePlatformAdmin(P.membershipRead);
  try { return { data: await callPlatformAdminRpc<{items: unknown[]; total: number}>("reylumi_membership_activity", {p_kind:kind,p_query:query,p_status:status,p_page:page}) }; }
  catch(error){ return {error:error instanceof Error?error.message:"Activity could not load."}; }
}
export async function membershipCommandAction(input: MembershipMutation) {
  await requirePlatformAdmin(["save_plan", "publish_plan", "set_selling", "save_settings", "save_website"].includes(input.action) ? P.membershipConfigure : P.membershipManage);
  try {
    const data = await callPlatformAdminRpc<Record<string, unknown>>("reylumi_membership_command", { p: input });
    revalidatePath("/admin/membership"); revalidatePath("/membership");
    return { data };
  } catch (error) { return { error: error instanceof Error ? error.message : "Membership could not be updated." }; }
}
