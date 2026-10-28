import "server-only";
import { cache } from "react";
import { createAuthenticatedSupabaseServerClient, getAuthenticatedReadAuthority } from "@/lib/supabase/server";
import { getReadAbortSignal, memoizeReadValidation } from "@/lib/read-context-scope";
import type { CurrentBusinessContext } from "@/lib/current-context";

// Request-scoped: never cache one salon's clock across accounts or requests.
const timezoneReadKey = Symbol("salon-business-timezone");
export const getSalonBusinessTimezone = cache(async (salonId: string): Promise<string> => {
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) throw new Error("Salon clock is unavailable. Please retry.");
  const read = async () => {
    const request = supabase.rpc("get_salon_business_timezone", { p_salon_id: salonId });
    const signal = getReadAbortSignal();
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error || typeof data !== "string" || !data.trim()) throw new Error("Salon clock is unavailable. Please retry.");
    new Intl.DateTimeFormat("en-US", { timeZone: data }).format();
    return data;
  };
  // Route handlers do not share React's render cache. Authenticate every caller
  // first, then share only this request's timezone read for the same authority.
  const authority = getAuthenticatedReadAuthority(supabase);
  return authority ? memoizeReadValidation(timezoneReadKey, JSON.stringify([authority, salonId]), read) : read();
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
