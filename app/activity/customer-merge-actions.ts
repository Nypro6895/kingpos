"use server";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { revalidatePath } from "next/cache";

export type MyCustomerGroup = { salonId: string; salonName: string; customers: Array<{ id: string; name: string; phone: string | null }> };
export async function getMyCustomerMergeGroups(): Promise<MyCustomerGroup[]> {
  const user = await getCurrentKingUser();
  const client = await createAuthenticatedSupabaseServerClient();
  if (!user || !client) throw new Error("Sign in to manage your profiles.");
  const { data, error } = await client.rpc("my_customer_identity_groups");
  if (error) throw new Error("Could not load your profiles. Please retry.");
  return data ?? [];
}
export async function mergeMyCustomerProfiles(input: { salonId: string; targetId: string; sourceIds: string[] }) {
  // Require membership in this user's linked group even when the user also owns a salon.
  const groups = await getMyCustomerMergeGroups();
  const group = groups.find(g => g.salonId === input.salonId);
  if (!group || ![input.targetId, ...input.sourceIds].every(id => group.customers.some(c => c.id === id))) throw new Error("Select only profiles linked to your account.");
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Please reconnect.");
  const { error } = await client.rpc("merge_customer_records", { p_salon: input.salonId, p_target: input.targetId, p_sources: input.sourceIds, p_reason: "customer_confirmed" });
  if (error) throw new Error("These profiles could not be merged. Ask the salon to review them.");
  for (const path of ["/activity", "/beauty", "/customers", "/bookings", "/pos", "/pos-tickets"]) revalidatePath(path);
}
