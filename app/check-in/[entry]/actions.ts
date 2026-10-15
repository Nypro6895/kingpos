"use server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function phoneRelayCheckin(input: { entry: string; phone: string; name: string; services: string[]; request: string }) {
  const client = createSupabaseServerClient();
  if (!client) return { error: "Check-in unavailable. Please use the salon screen." };
  const { data, error } = await client.rpc("service_relay_phone_checkin", { p_entry: input.entry, p_phone: input.phone, p_name: input.name, p_services: input.services, p_request: input.request });
  if (error) return { error: error.message };
  if (!data?.ok) return { error: data?.message ?? "Could not check in." };
  return { pass: data.pass?.passToken as string | undefined };
}
