import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSafetyContext } from "@/lib/abuse-context";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { abuseHash } from "@/lib/abuse-signals";
import { checkBotId } from "botid/server";

export type AbuseErrorCode = "security_check_required" | "rate_limited" | "restricted" | "security_unavailable";

const SECURITY_UNAVAILABLE = "Security checks are temporarily unavailable. Please try again later.";
const CHALLENGE_REQUIRED = "Please complete the security check at /security-check, then try again.";

export class AbuseRequestError extends Error {
  readonly status: 403 | 429 | 503;

  constructor(readonly code: AbuseErrorCode, message: string) {
    super(message);
    this.name = "AbuseRequestError";
    this.status = code === "security_unavailable" ? 503 : code === "rate_limited" ? 429 : 403;
  }
}

export function getAbuseErrorResponse(error: unknown) {
  if (error instanceof AbuseRequestError) {
    return { error: error.message, code: error.code, status: error.status, challengeRequired: error.code === "security_check_required" };
  }
  // Do not expose provider exceptions, request details or credentials to clients.
  return { error: SECURITY_UNAVAILABLE, code: "security_unavailable" as const, status: 503, challengeRequired: false };
}

export function abuseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AbuseRequestError("security_unavailable", SECURITY_UNAVAILABLE);
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
  if (error || !data || typeof data.allowed !== "boolean") throw new AbuseRequestError("security_unavailable", SECURITY_UNAVAILABLE);
  if (!data.allowed) {
    // The message fallback supports the database version deployed before typed errors.
    const message = typeof data.message === "string" ? data.message : "Please wait before trying again.";
    const code: AbuseErrorCode = data.challengeRequired === true || data.code === "security_check_required" || message.includes("/security-check")
      ? "security_check_required"
      : data.code === "restricted" || message.includes("temporarily restricted") ? "restricted" : "rate_limited";
    throw new AbuseRequestError(code, message);
  }
  if (process.env.VERCEL === "1" && ["signup", "post", "comment", "report"].includes(action)) {
    let verification;
    try {
      verification = await checkBotId({ advancedOptions: { checkLevel: "basic" } });
    } catch {
      throw new AbuseRequestError("security_unavailable", SECURITY_UNAVAILABLE);
    }
    if (verification.isBot) {
      const result = await abuseServiceClient().rpc("record_abuse_bot_event", {
        p_action: action, p_user_id: user?.id ?? null, p_device: context.deviceHash,
        p_ip: context.ipHash || null, p_country: context.country || null,
      });
      if (result.error) throw new AbuseRequestError("security_unavailable", SECURITY_UNAVAILABLE);
      if (!result.data) throw new AbuseRequestError("security_check_required", CHALLENGE_REQUIRED);
    }
  }
  return context;
}
export async function createSignupTicket(email: string) {
  const context = await assertAbuseRequest("signup", email);
  const { data, error } = await abuseServiceClient().rpc("issue_abuse_signup_ticket", {
    p_email_hash: abuseHash(`email:${email.trim().toLowerCase()}`), p_device: context.deviceHash, p_ip: context.ipHash || null,
  });
  if (error || typeof data !== "string") throw new AbuseRequestError("security_unavailable", "Account creation is temporarily unavailable. Please try again later.");
  return data as string;
}
