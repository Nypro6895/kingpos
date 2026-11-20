type HeaderEnvironment = {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

function supabaseOrigins(value: string | undefined) {
  if (!value) return [];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return [];
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

/** No request nonce: preserve Cache Components and streamed/static shells. */
export function browserSecurityHeaders(environment: HeaderEnvironment) {
  const storage = supabaseOrigins(environment.NEXT_PUBLIC_SUPABASE_URL);
  const reportPolicy = [
    "default-src 'self'",
    // This stricter script policy is observational until inline RSC scripts
    // have a rendering-compatible authorization strategy. Do not add eval.
    "script-src 'self' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${storage.filter(origin => origin.startsWith("https:")).join(" ")} https://api.maptiler.com https://*.stripe.com https://*.link.com`,
    `media-src 'self' blob: ${storage.filter(origin => origin.startsWith("https:")).join(" ")}`,
    "font-src 'self'",
    `connect-src 'self' ${storage.join(" ")} https://api.maptiler.com https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com`,
    // MapLibre 5's classic bundle starts its worker from a Blob URL.
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.google.com https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://hooks.stripe.com https://link.com https://*.link.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com https://connect.stripe.com",
    "frame-ancestors 'self'",
    "report-uri /api/security/csp-report",
  ].join("; ").replace(/\s{2,}/g, " ");

  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Keep first-party camera/GPS/media capture available to existing flows.
    { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(self)" },
    // These restrictions do not block framework scripts, provider requests or
    // the same-origin public booking preview embedded by the owner workspace.
    { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
  ];
  if (environment.NODE_ENV === "production") {
    headers.push({ key: "Content-Security-Policy-Report-Only", value: reportPolicy });
  }
  return headers;
}
