import "server-only";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import type { MembershipDetail, MembershipWorkspace, PublicMembershipPlan } from "@/types/reylumi-membership";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function loadMembershipWorkspace(query = "", status = "all", page = 1, plan = "") {
  return callPlatformAdminRpc<MembershipWorkspace>("reylumi_membership_workspace", { p_query: query, p_status: status, p_page: page, p_plan: plan });
}
export async function publicMembershipWebsite() {
 const client=await createSupabaseServerClient();if(!client)return null;
 const {data,error}=await client.rpc('reylumi_membership_website_public');return error?null:data as import('@/types/reylumi-membership').MembershipWebsiteCopy|null;
}
export async function loadMembershipDetail(id: string) {
  return callPlatformAdminRpc<MembershipDetail>("reylumi_membership_detail", { p_id: id });
}
export async function publicMembershipPlans(): Promise<PublicMembershipPlan[] | null> {
  const client = await createSupabaseServerClient();
  if (!client) return null;
  const { data, error } = await client.rpc("reylumi_membership_public");
  if (error) return null;
  return data as PublicMembershipPlan[];
}
