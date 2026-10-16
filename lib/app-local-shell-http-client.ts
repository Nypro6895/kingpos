"use client";
import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import { getAppLocalCommandScope } from "./app-local-command-client";
import type { AppLocalHttpResponse } from "./app-local-http-client";

export function createAppLocalShellHttpFetch(options: { scope(): string | undefined; host(): AppLocalHost; fetch: typeof fetch; location?: string }): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined, raw = request?.url ?? String(input), base = new URL(options.location ?? location.href);
    let url: URL; try { url = new URL(raw, base); } catch { return options.fetch(input, init); }
    const local = url.protocol === base.protocol && url.hostname === base.hostname && url.port === base.port;
    if (!options.host().isNative || url.username || url.password || url.hash || !(local || url.origin === "https://reylumi.com") || raw.startsWith("//") && !local) return options.fetch(input, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const name = method === "GET" ? ({ "/api/auth/session": "http.shell.session", "/api/public-booking/context": "http.shell.quick-booking", "/api/explore/advertising": "http.shell.advertising" } as Record<string, string>)[url.pathname] : method === "POST" && !url.search ? ({ "/api/auth/logout": "shell.logout", "/api/explore/advertising": "http.shell.advertising-event" } as Record<string, string>)[url.pathname] : undefined;
    if (!name) return options.fetch(input, init);
    const scope = options.scope(), signal = init?.signal ?? request?.signal; if (!scope) throw new Error("Connect to verify your account."); if (signal?.aborted) throw signal.reason;
    let data: AppLocalHttpResponse;
    try {
      if (method === "GET") {
        if (name === "http.shell.session" && url.search) throw new Error("Unsupported session scope.");
        if ([...url.searchParams].some(([key]) => url.searchParams.getAll(key).length !== 1)) throw new Error("Unsupported shell request.");
        const result = await options.host().read<AppLocalHttpResponse>(name, Object.fromEntries(url.searchParams), { scope, signal: signal ?? undefined });
        if (!result.data) throw new Error("Could not open this page."); data = result.data;
      } else {
        const body = typeof init?.body === "string" ? init.body : request ? await request.clone().text() : "";
        if (body.length > 2048) throw new Error("The request could not be sent.");
        data = await options.host().command<AppLocalHttpResponse>(name, name === "shell.logout" ? {} : { input: JSON.parse(body) }, { scope });
      }
    } catch (error) {
      if (scope === options.scope() && error && typeof error === "object" && "status" in error && [401, 403, 409].includes(Number(error.status))) window.dispatchEvent(new Event("reylumi:app-local-access-changed"));
      throw error;
    }
    if (scope !== options.scope()) throw new Error("Your account has changed.");
    if (name === "shell.logout" && data.status >= 200 && data.status < 300) {
      window.dispatchEvent(new Event("reylumi:app-local-reset"));
      // A display lease is never reused after confirmed server logout.
      try { const fresh = await options.host().context("/market", { fresh: true }); window.dispatchEvent(new CustomEvent("reylumi:app-local-context", { detail: fresh })); } catch { /* The confirmed logout remains complete; the entry stays locked. */ }
    }
    if (signal?.aborted) throw signal.reason;
    return new Response([204, 205, 304].includes(data.status) ? null : data.body, { status: data.status, headers: data.headers });
  };
}
export function installAppLocalShellHttpTransport(scope = getAppLocalCommandScope) {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const original = window.fetch, transport = createAppLocalShellHttpFetch({ scope, host: getAppLocalHost, fetch: original });
  window.fetch = transport; return () => { if (window.fetch === transport) window.fetch = original; };
}
