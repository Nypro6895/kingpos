import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBusinessContext } from "@/lib/current-context";
import type { TaxProfile, TaxWorkspaceData } from "@/types/tax-workspace";

export async function taxWorkspaceClient() {
  const context = await getCurrentBusinessContext();
  if (!context.user) throw new Error("Sign in to your Reylumi account.");
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Please sign in again.");
  return { client, context };
}
export async function loadTaxIdentity() {
  const context = await getCurrentBusinessContext();
  if (!context.user)
    return {
      context,
      profile: null as TaxProfile | null,
      error: null as string | null,
    };
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client)
    return { context, profile: null, error: "Please sign in again." };
  const { data, error } = await client
    .from("tax_profiles")
    .select("*")
    .eq("user_id", context.user.id)
    .maybeSingle();
  return {
    context,
    profile: data as TaxProfile | null,
    error: error ? "Tax workspace requires the latest database update." : null,
  };
}
export async function loadTaxWorkspace(
  salonId: string,
): Promise<TaxWorkspaceData> {
  const { client } = await taxWorkspaceClient();
  const { data, error } = await client.rpc("tax_workspace_data", {
    p_salon: salonId,
  });
  if (error) throw new Error(error.message);
  return data as TaxWorkspaceData;
}
export type TaxBusinessSummary = {
  id: string;
  name: string;
  active: boolean;
  city?: string | null;
  state?: string | null;
  pending_count?: number | null;
  inactive_reason?: string | null;
  missing_paystubs?: number | null;
};
export async function loadTaxBusinesses(): Promise<TaxBusinessSummary[]> {
  const { client } = await taxWorkspaceClient();
  const { data, error } = await client.rpc("tax_businesses");
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function loadMyTaxDocuments() {
  const { client, context } = await taxWorkspaceClient();
  const { data, error } = await client
    .from("tax_documents")
    .select(
      "id,salon_id,salon_name,staff_name,period_start,period_end,staff_id,recipient_user_id,payroll_run_id,kind,title,file_name,mime_type,size_bytes,version,supersedes_id,uploaded_by,uploaded_role,created_at,archived_at,owner_deleted_at",
    )
    .eq("recipient_user_id", context.user!.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
