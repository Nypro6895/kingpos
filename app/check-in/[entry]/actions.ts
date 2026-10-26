"use server";
import type { CustomerIdentityChoice } from "@/types/customer-identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function phoneRelayCheckin(input: { entry: string; phone: string; name: string; services: string[]; request: string; identityChoice?: string; newCustomer?: boolean }) {
  const client = createSupabaseServerClient();
  if (!client) return { error: "Check-in unavailable. Please use the salon screen." };
  const { data, error } = await client.rpc("service_relay_phone_checkin_identity", { p_entry: input.entry, p_phone: input.phone, p_name: input.name, p_services: input.services, p_request: input.request, p_identity_choice: input.identityChoice ?? null, p_new_customer: input.newCustomer ?? false });
  if (error) return { error: error.message };
  if (!data?.ok) return { error: data?.message ?? "Could not check in.", candidates: (data?.candidates ?? []) as CustomerIdentityChoice[] };
  return { pass: data.pass?.passToken as string | undefined };
}
