import type { SupabaseClient } from "@supabase/supabase-js";

export type MfaAssurance = "allowed" | "verified" | "required" | "unavailable";

/** Auth's explicit-token API verifies identity and reloads factors. A missing
 * assurance result is an outage, never evidence that MFA is absent. */
export async function readMfaAssurance(client: SupabaseClient, accessToken: string): Promise<MfaAssurance> {
  try {
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
    if (error || !data || !["aal1", "aal2"].includes(data.currentLevel ?? "") || !["aal1", "aal2"].includes(data.nextLevel ?? "")) return "unavailable";
    return data.currentLevel === "aal2" ? "verified" : data.nextLevel === "aal2" ? "required" : "allowed";
  } catch { return "unavailable"; }
}
