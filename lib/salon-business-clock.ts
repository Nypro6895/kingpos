import "server-only";
import { cache } from "react";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";

// Request-scoped: never cache one salon's clock across accounts or requests.
export const getSalonBusinessTimezone = cache(async (salonId: string): Promise<string> => {
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) throw new Error("Salon clock is unavailable. Please retry.");
  const { data, error } = await supabase.rpc("get_salon_business_timezone", { p_salon_id: salonId });
  if (error || typeof data !== "string" || !data.trim()) throw new Error("Salon clock is unavailable. Please retry.");
  new Intl.DateTimeFormat("en-US", { timeZone: data }).format();
  return data;
});

export async function getContextBusinessTimezone(context: CurrentBusinessContext) {
  return context.currentSalon ? getSalonBusinessTimezone(context.currentSalon.id) : "America/Chicago";
}

export async function getContextBusinessDate(context: CurrentBusinessContext) {
  const timezone = await getContextBusinessTimezone(context);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const read = (key: string) => parts.find(part => part.type === key)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}
