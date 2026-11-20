/** Browsing retention policies. These never change server authorization or HTTP cache headers. */
export type ExperienceRoutePolicy = {
  family: string;
  classified: boolean;
  rememberUi: boolean;
  retainData: "public" | "memory" | "none";
  refreshAfterMs: number;
  maxAgeMs: number;
  requiresAuth: boolean;
  allowPrefetch: boolean;
  resetOnHide: boolean;
  revalidateOnShow: boolean;
};

const HANDLER_PATH = /^(?:\/api(?:\/|$)|\/download\/windows\/?$|\/workspace\/open\/?$|\/admin\/api(?:\/|$)|\/admin\/lookup\/?$|\/admin\/users\/(?:workspace|export|evidence)\/?$|\/admin\/locations\/workspace\/?$|\/admin\/dashboard\/(?:search|record|detail)\/?$|\/admin\/market\/(?:tax|ledger)\/export\/?$)/;
const AUTH_PATH = /^\/(?:login|signup|account-recovery|forgot-password|reset-password|security-check|accept-invite|ownership\/invite|staff\/invite)(?:\/|$)/;
const SECRET_PATH = /^\/(?:booking-payment|booking\/manage|deletion-status|market\/payment-return|check-in|visit|support\/guest|claim)(?:\/|$)/;
const PAYMENT_PATH = /^\/(?:check-writer|market\/(?:orders|booking-deposit\/(?:payment|settings))|settings\/(?:login-security|recovery-back-office)|admin\/(?:recovery|settings\/twilio|settings\/support-email))(?:\/|$)/;

const ACTIVE_PATH = /(?:^|\/)(?:new|create|edit|setup|delete|remove|cancel|confirm|checkout|transfer|accept|reset)(?:\/|$)/;
const SECRET_QUERY = /^(?:access_token|refresh_token|token|code|pass|password|secret|signature|session|session_id|client_secret|payment|bookingStripe|payment_intent|payment_intent_client_secret|setup_intent|setup_intent_client_secret|redirect_status|checkout|ticket|key|invitation|invite|authorization|redirect|redirectto|returnurl|next)$/i;
const ACTIVE_QUERY = /^(?:payment|checkout|security|login-security|recovery-back-office|edit|new|create|delete|cancel|confirm)$/i;

const none = (family: string, requiresAuth = false, classified = true): ExperienceRoutePolicy => ({
  family, classified, rememberUi: false, retainData: "none", refreshAfterMs: 0, maxAgeMs: 0,
  requiresAuth, allowPrefetch: false, resetOnHide: true, revalidateOnShow: requiresAuth,
});
const browse = (family: string, requiresAuth: boolean, refreshAfterMs = 30_000, maxAgeMs = 10 * 60_000): ExperienceRoutePolicy => ({
  family, classified: true, rememberUi: true, retainData: requiresAuth ? "memory" : "public",
  refreshAfterMs, maxAgeMs, requiresAuth, allowPrefetch: !requiresAuth, resetOnHide: false, revalidateOnShow: true,
});

function parsedRoute(href: string, baseOrigin?: string): URL | null {
  try {
    const origin = baseOrigin ?? (typeof window !== "undefined" ? window.location.origin : "https://reylumi.invalid");
    if (!href || href.length > 4096 || href.includes("\\") || /%00/i.test(href)) return null;
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password || !/^https?:$/.test(url.protocol)) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (/[%](?:2f|5c|00)/i.test(decoded) || /%2f|%5c/i.test(url.pathname) || decoded.includes("\\") || decoded.includes("\0")) return null;
    return url;
  } catch { return null; }
}

function hasSensitiveQuery(url: URL): boolean {
  return [...url.searchParams].some(([key, value]) => SECRET_QUERY.test(key)
    || (/^(?:tab|section|mode|action)$/i.test(key) && ACTIVE_QUERY.test(value))
    || value.length > 512 || /(?:access_token|refresh_token|client_secret)=/i.test(value));
}

/** All handlers remain network-only; individual client resources may reuse validated DTOs in memory. */
export function getExperienceRoutePolicy(href: string, kind: "page" | "handler" = "page"): ExperienceRoutePolicy {
  const url = parsedRoute(href);
  if (!url) return none("invalid", false, false);
  const path = decodeURIComponent(url.pathname).replace(/\/$/, "") || "/";
  if (kind === "handler" || HANDLER_PATH.test(path)) return none("handler");
  if (AUTH_PATH.test(path)) return none("auth");
  if (SECRET_PATH.test(path)) return none("secret");
  if (hasSensitiveQuery(url) || url.hash) return none("transient");
  // POS owns its cart, payment preparation and durable offline operations.
  if (/^\/pos(?:\/|$)/.test(path)) return { ...none("pos", true), resetOnHide: false };
  if (PAYMENT_PATH.test(path)) return none("sensitive", true);
  if (/^\/book(?:\/|$)/.test(path)) return none("booking");
  if (ACTIVE_PATH.test(path)) return none("form", true);
  if (/^\/(?:terms|privacy|legal|community|business-terms|help)$/.test(path)) return browse("legal", false, 60 * 60_000, 24 * 60 * 60_000);
  if (path === "/contact-support") return none("support-form");
  if (path.startsWith("/help/")) return browse("legal", false, 60 * 60_000, 24 * 60 * 60_000);
  if (path === "/") return browse("home", true);
  if (/^\/explore\/favorites(?:\/|$)/.test(path)) return browse("favorites", true);
  if (/^\/explore\/beauty(?:\/|$)/.test(path) && url.searchParams.has("customerId")) return browse("beauty-relationship", true);
  if (/^\/explore(?:\/|$)/.test(path)) return browse("explore", false, 30_000, 30 * 60_000);
  if (path === "/market" || path === "/market/booking-deposit") return browse("market", false, 60_000, 30 * 60_000);
  if (path.startsWith("/market/")) return none("market-detail", true);
  if (/^\/admin(?:\/|$)/.test(path)) return browse("admin", true, 5_000, 5 * 60_000);
  if (/^\/notifications(?:\/|$)/.test(path)) return browse("notifications", true, 15_000, 10 * 60_000);
  if (/^\/activity(?:\/|$)/.test(path)) return browse("activity", true);
  if (/^\/support(?:\/|$)/.test(path)) return browse("support", true, 15_000, 5 * 60_000);
  if (/^\/campaigns(?:\/|$)/.test(path)) return browse("campaigns", true, 15_000, 5 * 60_000);
  if (/^\/tax-company(?:\/|$)/.test(path)) return browse("tax-company", true);
  if (/^\/(?:account|settings|salon-settings|permissions|roles)(?:\/|$)/.test(path)) {
    // Retain navigation choices, never editable security/settings form records.
    return { ...none("settings", true), rememberUi: true, resetOnHide: false };
  }
  for (const family of ["bookings", "my-bookings", "businesses", "salons", "customers", "staff", "salon-profile", "my-place", "services", "more", "reports", "payroll", "beauty", "pos-tickets"]) {
    if (path === `/${family}` || path.startsWith(`/${family}/`)) return browse(family, true);
  }
  return none("unknown", false, false);
}

/** Keys never retain tokens, redirect handoffs, action URLs or form flows. */
export function getExperienceRouteKey(href: string, baseOrigin?: string): string | null {
  const url = parsedRoute(href, baseOrigin);
  if (!url || url.hash || hasSensitiveQuery(url)) return null;
  const relative = url.pathname + url.search;
  const policy = getExperienceRoutePolicy(relative);
  if (!policy.rememberUi) return null;
  url.searchParams.sort();
  return (url.pathname.replace(/\/$/, "") || "/") + url.search;
}
