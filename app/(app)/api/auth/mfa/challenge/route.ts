import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/request-origin";
import { createPendingMfaSupabaseAuthSessionServerClient, getPendingMfaSessionTokensFromRequest, pendingMfaContinuationId, getSupabaseCookieOptions } from "@/lib/supabase/server";
import { readMfaAssurance } from "@/lib/supabase/mfa-assurance";
import { resumeMfaChallenge } from "@/lib/supabase/mfa-challenge";
import { PENDING_MFA_CHALLENGE_COOKIE, PENDING_MFA_MAX_AGE_SECONDS } from "@/lib/supabase/mfa-session";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Correlation only, not authentication: no token, factor or provider read.
 * A new mount must discover its current principal before joining a POST. */
export async function GET() {
  const tokens = await getPendingMfaSessionTokensFromRequest();
  if (!tokens) return reply({ error: "Two-factor verification expired. Log in again." }, 401);
  return reply({ continuationId: pendingMfaContinuationId(tokens) });
}

/** Explicit same-origin POST only: rendering/callback/refresh never sends SMS. */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return reply({ error: "Invalid request origin. Reload the page and try again." }, 403);
  const tokens = await getPendingMfaSessionTokensFromRequest();
  if (!tokens) return reply({ error: "Two-factor verification expired. Log in again." }, 401);
  if (request.headers.get("x-reylumi-mfa-continuation") !== pendingMfaContinuationId(tokens)) return reply({ error: "Your sign-in changed. Log in again to continue." }, 409);
  let pending;
  try { pending = await createPendingMfaSupabaseAuthSessionServerClient({ throwOnUnavailable: true }); }
  catch { return reply({ error: "Your sign-in could not be checked. Please try again later." }, 503); }
  if (!pending) return reply({ error: "Two-factor verification expired. Log in again." }, 401);
  if (pending.continuationId !== pendingMfaContinuationId(tokens)) return reply({ error: "Your sign-in changed. Log in again to continue." }, 409);
  const assurance = await readMfaAssurance(pending.supabase, pending.accessToken);
  if (assurance === "unavailable") return reply({ error: "Two-factor authentication status could not be checked. Please try again later." }, 503);
  if (assurance !== "required") return reply({ error: "Log in again to continue." }, 409);
  const result = await resumeMfaChallenge(pending.supabase, pending.accessToken, pending.challengeReceipt);
  if (result.error) return reply({ error: result.error }, 503);
  const response = reply({ mfa: result.challenge });
  response.cookies.set(PENDING_MFA_CHALLENGE_COOKIE, result.cookie!, getSupabaseCookieOptions(PENDING_MFA_MAX_AGE_SECONDS));
  return response;
}
