import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ACCOUNT_LOGIN_SESSION_COOKIE } from "@/lib/account-security-shared";
import { REMEMBER_LOGIN_COOKIE, sessionCookieOptions, tokenNeedsRefresh } from "./session-policy";
import { isConfirmedAuthRejection } from "./auth-rejection";

type CookieUpdate = { name: string; value: string; options: ReturnType<typeof sessionCookieOptions> };

// Coalesce refreshes within a worker. Supabase's reuse window covers other workers.
// Never persist raw refresh tokens as map keys, or retain completed sessions indefinitely.
const refreshes = new Map<string, Promise<Awaited<ReturnType<ReturnType<typeof createClient>["auth"]["refreshSession"]>>>>();

export async function refreshRequestSession(request: NextRequest): Promise<{ updates: CookieUpdate[]; unavailable: boolean }> {
  const updates: CookieUpdate[] = [];
  if (request.headers.has("authorization") || request.nextUrl.pathname === "/api/auth/logout") return { updates, unavailable: false };
  const refreshToken = request.cookies.get("sb-refresh-token")?.value;
  const accessToken = request.cookies.get("sb-access-token")?.value;
  if (!refreshToken || !tokenNeedsRefresh(accessToken)) return { updates, unavailable: false };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { updates, unavailable: true };
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(refreshToken).digest("hex");
  let operation = refreshes.get(hash);
  if (!operation) {
    if (refreshes.size >= 500) return { updates, unavailable: true };
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) } });
    operation = client.auth.refreshSession({ refresh_token: refreshToken });
    refreshes.set(hash, operation);
    const timer = setTimeout(() => refreshes.delete(hash), 10_000);
    timer.unref();
  }
  try {
    const { data, error } = await operation;
    if (error || !data.session) {
      // A refresh failure does not establish that the account signed out.
      // Unknown400/408 must stop strict readers before an expired access token
      // can be mistaken for confirmed loss of the user's session.
      const unavailable = !error || !isConfirmedAuthRejection(error);
      return { updates, unavailable };
    }
    // Persist only an explicit Remember choice; legacy sessions never opt in silently.
    const remember = request.cookies.get(REMEMBER_LOGIN_COOKIE)?.value === "1";
    const options = sessionCookieOptions(remember);
    updates.push({ name: "sb-access-token", value: data.session.access_token, options },
      { name: "sb-refresh-token", value: data.session.refresh_token, options },
      { name: REMEMBER_LOGIN_COOKIE, value: remember ? "1" : "0", options });
    const id = request.cookies.get(ACCOUNT_LOGIN_SESSION_COOKIE)?.value;
    if (id) updates.push({ name: ACCOUNT_LOGIN_SESSION_COOKIE, value: id, options });
    for (const update of updates) request.cookies.set(update.name, update.value);
    return { updates, unavailable: false };
  } catch { return { updates, unavailable: true }; }
}
