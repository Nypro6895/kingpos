const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const isLoopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

/** NextURL normalizes loopback hostnames to localhost. Recover only an actual
 * loopback Host at the same scheme and port. External/forwarded authorities
 * never replace Request.url, including when the server is bound locally. */
export function effectiveRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (isLoopback(url.hostname) && ["http:", "https:"].includes(url.protocol) && host && loopbackHost.test(host)) {
    try {
      const candidate = new URL(`${url.protocol}//${host}`);
      if (candidate.port === url.port) return candidate.origin;
    } catch { /* Keep the URL authority on malformed Host input. */ }
  }
  return url.origin;
}

/** Cookie and pre-login writes need a browser origin, including native HTTPS
 * transports. User-Agent, forwarded host and app-identifying headers are never
 * authority. A missing/null Origin is rejected before reading a request body. */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  const expected = effectiveRequestOrigin(request);
  if (!origin || origin === "null" || origin !== expected) return false;
  const url = new URL(request.url), host = request.headers.get("host");
  if (isLoopback(url.hostname) && host !== null) {
    if (!loopbackHost.test(host)) return false;
    try { if (new URL(`${url.protocol}//${host}`).origin !== expected) return false; }
    catch { return false; }
  }
  return hasSafeFetchMetadata(request);
}

function hasSafeFetchMetadata(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

/** Only for a handler that independently verifies this explicit bearer and
 * never reads cookie identity/refresh tokens. This check grants no authority.
 * Origin-less API/native clients remain supported; browsers cannot supply an
 * Authorization header through a cross-site form or a simple CORS request. */
export function isBearerOnlyMutationOrigin(request: Request): boolean {
  if (!hasSafeFetchMetadata(request)) return false;
  if (request.headers.has("origin")) return isSameOriginMutation(request);
  return /^Bearer [^\s]+$/.test(request.headers.get("authorization") ?? "");
}
