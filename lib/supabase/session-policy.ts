import { abuseHash, abuseSigningKey, verifySignedValue } from "@/lib/abuse-signals";

export const REMEMBER_LOGIN_COOKIE = "reylumi-remember-login";
export const ADMIN_SESSION_COOKIE = "reylumi-admin-session";
export const REMEMBER_LOGIN_SECONDS = 90 * 24 * 60 * 60;
export const ADMIN_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_MAX_MS = 12 * 60 * 60 * 1000;

export function tokenSessionId(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch { return null; }
}

export function tokenNeedsRefresh(token: string | undefined, now = Date.now()) {
  if (!token) return true;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return typeof payload.exp !== "number" || payload.exp * 1000 <= now + 60_000;
  } catch { return true; }
}

export function newAdminSession(token: string, now = Date.now()) {
  const id = tokenSessionId(token);
  if (!id || !abuseSigningKey()) return null;
  const payload = `${id}|${now}|${now}`;
  return `${payload}|${abuseHash(`admin-session:${payload}`)}`;
}

export function readAdminSession(value: string | undefined, token: string, now = Date.now()) {
  if (!value || value.length > 240) return null;
  const [id, issuedText, seenText, signature, extra] = value.split("|");
  const issued = Number(issuedText), seen = Number(seenText);
  const payload = `${id}|${issuedText}|${seenText}`;
  if (extra || !signature || id !== tokenSessionId(token) ||
      !Number.isSafeInteger(issued) || !Number.isSafeInteger(seen) ||
      issued <= 0 || seen < issued || seen > now ||
      now - issued >= ADMIN_MAX_MS || now - seen >= ADMIN_IDLE_MS ||
      !verifySignedValue(`admin-session:${payload}`, signature)) return null;
  return { id, issued, seen };
}

export function touchAdminSession(value: string, token: string, now = Date.now()) {
  const session = readAdminSession(value, token, now);
  if (!session) return null;
  const payload = `${session.id}|${session.issued}|${now}`;
  return `${payload}|${abuseHash(`admin-session:${payload}`)}`;
}

export function sessionCookieOptions(remember: boolean) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const, path: "/", ...(remember ? { maxAge: REMEMBER_LOGIN_SECONDS } : {}) };
}

type Writer = { set(name: string, value: string, options: ReturnType<typeof sessionCookieOptions>): unknown; delete(name: string): unknown };

export function writeLoginPolicy(writer: Writer, token: string, remember: boolean) {
  writer.set(REMEMBER_LOGIN_COOKIE, remember ? "1" : "0", sessionCookieOptions(remember));
  const admin = newAdminSession(token);
  if (admin) writer.set(ADMIN_SESSION_COOKIE, admin, sessionCookieOptions(false));
  else writer.delete(ADMIN_SESSION_COOKIE);
}
