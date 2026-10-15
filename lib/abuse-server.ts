import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSafetyContext } from "@/lib/abuse-context";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { abuseHash } from "@/lib/abuse-signals";
import { checkBotId } from "botid/server";

export function abuseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Security checks are temporarily unavailable. Please try again later.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function assertAbuseRequest(action: "post" | "comment" | "report" | "signup" | "login" | "recovery", subject?: string) {
  const context = await getSafetyContext();
  const user = ["signup", "login", "recovery"].includes(action) ? null : await getCurrentKingUser();
  const { data, error } = await abuseServiceClient().rpc("abuse_preflight", {
    p_action: action, p_user_id: user?.id ?? null, p_device: context.deviceHash,
    p_ip: context.ipHash || null, p_country: context.country || null,
    p_subject: subject ? abuseHash(`email:${subject.trim().toLowerCase()}`) : null,
  });
  if (error) throw new Error("Security checks are temporarily unavailable. Please try again later.");
  if (!data?.allowed) throw new Error(data?.message ?? "Please wait before trying again.");
  if (process.env.VERCEL === "1" && ["signup", "post", "comment", "report"].includes(action)) {
    const verification = await checkBotId({ advancedOptions: { checkLevel: "basic" } });
    if (verification.isBot) {
      const result = await abuseServiceClient().rpc("record_abuse_bot_event", {
        p_action: action, p_user_id: user?.id ?? null, p_device: context.deviceHash,
        p_ip: context.ipHash || null, p_country: context.country || null,
      });
      if (result.error || !result.data) throw new Error("Please complete the security check at /security-check, then try again.");
    }
  }
  return context;
}
export async function createSignupTicket(email: string) {
  const context = await assertAbuseRequest("signup", email);
  const { data, error } = await abuseServiceClient().rpc("issue_abuse_signup_ticket", {
    p_email_hash: abuseHash(`email:${email.trim().toLowerCase()}`), p_device: context.deviceHash, p_ip: context.ipHash || null,
  });
  if (error || !data) throw new Error("Account creation is temporarily unavailable. Please try again later.");
  return data as string;
}
