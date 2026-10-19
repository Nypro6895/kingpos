import { NextResponse, type NextRequest } from "next/server";
import { isReylumiIOSClient, isIOSExcludedPath } from "@/lib/ios-client";
import { ABUSE_DEVICE_COOKIE, ABUSE_HEADER, ABUSE_SIGNATURE_HEADER, abuseSigningKey, newDeviceToken, readDeviceToken, signSafetyContext } from "@/lib/abuse-signals";
import { refreshRequestSession } from "@/lib/supabase/refresh-session";
import { ADMIN_SESSION_COOKIE, readAdminSession, touchAdminSession, sessionCookieOptions } from "@/lib/supabase/session-policy";
import { APP_LOCAL_TRACE_REQUEST_ID, APP_LOCAL_TRACE_PROXY_REFRESH, APP_LOCAL_TRACE_PROXY_FAILURE, appLocalTraceRequestId, stripAppLocalCommandTraceHeaders, appLocalTraceNow, appLocalTraceDuration } from "@/lib/app-local-command-trace-protocol";

export async function proxy(request: NextRequest) {
  if (isReylumiIOSClient(request.headers.get("user-agent")) && isIOSExcludedPath(request.nextUrl.pathname)) {
    return new NextResponse("This feature is not available in Reylumi for iOS.", { status: 403 });
  }
  const headers = new Headers(request.headers);
  stripAppLocalCommandTraceHeaders(headers);
  const traceCommand = request.method === "POST" && request.nextUrl.pathname === "/api/app-local/command";
  let traceRequestId: string | undefined;
  if (traceCommand) {
    try { traceRequestId = appLocalTraceRequestId(headers.get(APP_LOCAL_TRACE_REQUEST_ID)) ?? crypto.randomUUID(); headers.set(APP_LOCAL_TRACE_REQUEST_ID, traceRequestId); } catch { /* Correlation cannot block a request. */ }
  }
  headers.delete("x-reylumi-auth-unavailable");
  const refreshStarted = traceCommand ? appLocalTraceNow() : 0;
  const refreshed = await refreshRequestSession(request);
  if (traceCommand) {
    try {
      headers.set(APP_LOCAL_TRACE_PROXY_REFRESH, appLocalTraceDuration(appLocalTraceNow() - refreshStarted).toFixed(1));
      if (refreshed.unavailable) headers.set(APP_LOCAL_TRACE_PROXY_FAILURE, "proxy_refresh_unavailable");
    } catch { /* Preserve the refresh result if diagnostics fail. */ }
  }
  const withTrace = <T extends NextResponse>(response: T): T => {
    try { if (traceRequestId) response.headers.set(APP_LOCAL_TRACE_REQUEST_ID, traceRequestId); } catch { /* Headers are diagnostic only. */ }
    return response;
  };
  if (refreshed.unavailable) headers.set("x-reylumi-auth-unavailable", "1");
  const access = request.cookies.get("sb-access-token")?.value;
  const adminCookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const adminPath = request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/");
  const adminApi = request.nextUrl.pathname.startsWith("/api/admin/");
  let touchedAdmin: string | null = null;
  if ((adminPath || adminApi) && access && !refreshed.unavailable) {
    if (!readAdminSession(adminCookie, access)) {
      if (adminApi) return NextResponse.json({ error: "Admin session expired. Log in again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
      const login = new URL("/login", request.url);
      login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      login.searchParams.set("message", "Admin session expired. Log in again.");
      const response = NextResponse.redirect(login);
      for (const update of refreshed.updates) response.cookies.set(update.name, update.value, update.options);
      return response;
    }
    // Background polling and RSC prefetch must not keep an idle admin signed in.
    if (request.headers.get("sec-fetch-dest") === "document" && !request.headers.has("next-router-prefetch") && request.headers.get("purpose") !== "prefetch") {
      touchedAdmin = touchAdminSession(adminCookie!, access);
      if (touchedAdmin) request.cookies.set(ADMIN_SESSION_COOKIE, touchedAdmin);
    }
  }
  headers.set("cookie", request.cookies.toString());
  headers.delete(ABUSE_HEADER); headers.delete(ABUSE_SIGNATURE_HEADER);
  if (!abuseSigningKey()) {
    const response = NextResponse.next({ request: { headers } });
    for (const update of refreshed.updates) response.cookies.set(update.name, update.value, update.options);
    return withTrace(response);
  }
  const existing = request.cookies.get(ABUSE_DEVICE_COOKIE)?.value;
  const token = readDeviceToken(existing) ? existing! : newDeviceToken();
  const context = signSafetyContext(token, request.headers);
  headers.set(ABUSE_HEADER, context.payload); headers.set(ABUSE_SIGNATURE_HEADER, context.signature);
  // Make the newly issued cookie available to actions in the same first request.
  if (token !== existing) {
    const jar = request.cookies; jar.set(ABUSE_DEVICE_COOKIE, token);
    headers.set("cookie", jar.toString());
  }
  const response = NextResponse.next({ request: { headers } });
  for (const update of refreshed.updates) response.cookies.set(update.name, update.value, update.options);
  if (refreshed.updates.length || touchedAdmin) response.headers.set("Cache-Control", "private, no-store");
  if (touchedAdmin) response.cookies.set(ADMIN_SESSION_COOKIE, touchedAdmin, sessionCookieOptions(false));
  if (token !== existing) response.cookies.set(ABUSE_DEVICE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  return withTrace(response);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|gif|ico|css|js|woff2?|mp4|exe)$).*)"] };
