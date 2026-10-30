import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { MyReview, MyReviewsData } from "@/types/customer-review";

export async function getMyReviewsData(input: { page?: number; experienceId?: string }): Promise<MyReviewsData> {
  const page = Number.isInteger(input.page) ? Math.min(1001,Math.max(1,input.page!)) : 1;
  const focused = input.experienceId && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.experienceId) ? input.experienceId : null;
  const supabase = await createAuthenticatedSupabaseServerClient();
  const result = await supabase?.rpc("get_my_visit_experiences", { p_limit: 11, p_offset: focused ? 0 : (page-1)*10, p_experience: focused });
  if (!result || result.error || !Array.isArray(result.data)) return {rows: [],page,focused: Boolean(focused),error: "Your reviews could not be loaded. Please try again."};
  return {rows: result.data as MyReview[],page,focused: Boolean(focused),error: null};
}
