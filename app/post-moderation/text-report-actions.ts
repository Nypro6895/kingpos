"use server";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { assertAbuseRequest } from "@/lib/abuse-server";
import { submitSocialTextReport } from "@/lib/social-text-reports";
import type { SocialTextReportTarget } from "@/types/social-text-reports";

export async function reportSocialText(input: {target:SocialTextReportTarget;requestId:string;reason:string}) {
  try {
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) throw Error("Sign in to report this content.");
    await assertAbuseRequest("report");
    return { ...await submitSocialTextReport(client, input), error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Your report could not be sent. Please retry." };
  }
}
