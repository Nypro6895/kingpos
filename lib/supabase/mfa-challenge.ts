import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthResponse } from "@/lib/auth-response";
import { systemSmsReady } from "@/lib/system-sms";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PENDING_MFA_MAX_AGE_SECONDS } from "./mfa-session";

type Challenge = NonNullable<AuthResponse["mfa"]>;
type Result = { challenge: Challenge; cookie: string; error?: never } | { error: string; challenge?: never; cookie?: never };
const attempts = new Map<string, { expires: number; result: Promise<Result> }>();
const failed = () => ({ error: "Two-factor verification could not be started. Log in again to retry." } as const);
const binding = (token: string) => createHash("sha256").update(token).digest("hex");
const signature = (body: string, token: string) => createHmac("sha256", token).update(`mfa-challenge:${body}`).digest("hex");

function readCookie(value: string | undefined, token: string): { challenge: Challenge; expired: boolean } | null {
  if (!value || value.length > 2048) return null;
  const [body, mac, extra] = value.split(".");
  if (extra || !body || !/^[a-f0-9]{64}$/.test(mac ?? "")) return null;
  if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(signature(body, token), "hex"))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as { binding: string; until: number; challenge: Challenge };
    if (data.binding !== binding(token) || !Number.isFinite(data.until) || data.until > Date.now() + PENDING_MFA_MAX_AGE_SECONDS * 1000) return null;
    const c = data.challenge;
    return c && typeof c.challengeId === "string" && typeof c.factorId === "string" && ["phone", "totp"].includes(c.factorType) ? { challenge: c, expired: data.until <= Date.now() } : null;
  } catch { return null; }
}

/** Same-worker overlapping resumes share a send. A received signed success
 * receipt can be reused on another worker. Distinct workers without that
 * receipt cannot promise global exactly-once SMS; ambiguity is held only in
 * this worker for the short pending lifetime, with no automatic retry. */
export async function resumeMfaChallenge(client: SupabaseClient, token: string, receipt?: string): Promise<Result> {
  const now = Date.now(), key = binding(token);
  for (const [id, entry] of attempts) if (entry.expires <= now) attempts.delete(id);
  try {
    const factors = await client.auth.mfa.listFactors();
    if (factors.error) return { error: "Two-factor authentication methods could not be loaded." };
    const all = [...(factors.data?.phone ?? []), ...(factors.data?.totp ?? [])];
    const verified = all.filter(f => f.status === "verified");
    const cached = readCookie(receipt, token);
    if (cached) {
      if (cached.expired || !verified.some(f => f.id === cached.challenge.factorId && f.factor_type === cached.challenge.factorType)) return { error: "Two-factor verification expired. Log in again to restart." };
      return { challenge: cached.challenge, cookie: receipt! };
    }
    const existing = attempts.get(key);
    if (existing) {
      const result = await existing.result;
      if (result.challenge) {
        const receipt = readCookie(result.cookie, token);
        if (!receipt || receipt.expired || !verified.some(f => f.id === result.challenge.factorId && f.factor_type === result.challenge.factorType)) return { error: "Two-factor verification expired. Log in again to restart." };
      }
      return result;
    }
    if (attempts.size >= 500) return failed();
    const factor = verified[0];
    if (!factor) return { error: "Two-factor authentication is required, but no supported verified factor was found." };
    // Insert before the first side effect, so simultaneous resumes share it.
    const result = (async (): Promise<Result> => {
      if (factor.factor_type === "phone" && !(await systemSmsReady("authSms"))) return { error: "System authentication SMS is disabled or not configured." };
      const response = await client.auth.mfa.challenge(factor.factor_type === "phone" ? { channel: "sms", factorId: factor.id } : { factorId: factor.id });
      if (response.error || !response.data?.id) return failed();
      const expiresAt = response.data.expires_at ?? null;
      const until = Math.min(now + PENDING_MFA_MAX_AGE_SECONDS * 1000, expiresAt ? expiresAt * 1000 : Infinity);
      if (!Number.isFinite(until) || until <= Date.now()) return { error: "Two-factor verification expired. Log in again to restart." };
      const phone = "phone" in factor && typeof factor.phone === "string" ? factor.phone : null;
      const challenge: Challenge = { challengeId: response.data.id, factorId: factor.id, factorType: factor.factor_type as "phone" | "totp", expiresAt,
        phone: factor.factor_type === "phone" ? phone?.replace(/\D/g, "").slice(-4) ?? null : null };
      const body = Buffer.from(JSON.stringify({ binding: key, until, challenge })).toString("base64url");
      return { challenge, cookie: `${body}.${signature(body, token)}` };
    })().catch(failed);
    attempts.set(key, { expires: now + PENDING_MFA_MAX_AGE_SECONDS * 1000, result });
    return await result;
  } catch { return failed(); }
}
