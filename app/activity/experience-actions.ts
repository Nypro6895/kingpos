"use server";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function mutate(salonId: string, rpc: string, args: Record<string, unknown>) {
  try {
    const context = await getCurrentBusinessContext();
    if (!context.user || context.currentSalon?.id !== salonId || !(await hasPermission("salon_profile.content.manage", context))) return { error: "You do not have permission to reply for this salon." };
    const supabase = await createAuthenticatedSupabaseServerClient();
    if (!supabase) return { error: "Sign in to reply to reviews." };
    const result = await supabase.rpc(rpc, args);
    if (result.error) return { error: result.error.code === "42883" || result.error.code === "PGRST202" ? "Visit replies are temporarily unavailable. Please try again later." : result.error.message };
    for (const path of ["/salon-profile", `/explore/salons/${salonId}`, "/more/reviews", "/activity", "/notifications"]) revalidatePath(path);
    return { error: null };
  } catch { return { error: "Your reply could not be saved. Please try again." }; }
}

export async function replyToVisitExperienceAction(input: { salonId: string; experienceId: string; body: string; requestId: string }) {
  return mutate(input.salonId, "reply_to_visit_experience", { p_salon: input.salonId, p_experience: input.experienceId, p_body: input.body, p_request: input.requestId });
}
export async function resolveMyVisitExperienceAction(experienceId: string) {
  try {
    const supabase = await createAuthenticatedSupabaseServerClient();
    if (!supabase) return { error: "Sign in to confirm resolution." };
    const { error } = await supabase.rpc("resolve_my_visit_experience", { p_experience: experienceId });
    if (error) return { error: "Resolution could not be saved. Please try again." };
    for (const path of ["/more/reviews", "/salon-profile", "/explore", "/activity", "/my-bookings"]) revalidatePath(path);
    return { error: null };
  } catch { return { error: "Resolution could not be saved. Please try again." }; }
}

// Retain the old native command ID; older apps cannot resolve on behalf of customers.
export async function setVisitExperienceStatusAction(_input: { salonId: string; experienceId: string; status: "acknowledged" | "resolved" }) {
  void _input;
  return { error: "Only the customer can confirm resolution." };
}
