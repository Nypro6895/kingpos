import { readBoundedRequestText } from "./request-body";

export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const CSP_REPORT_MAX_BATCH = 10;
const DIRECTIVES = new Set([
  "default-src", "script-src", "script-src-elem", "script-src-attr",
  "style-src", "style-src-elem", "style-src-attr", "img-src", "media-src",
  "font-src", "connect-src", "worker-src", "frame-src", "object-src",
  "base-uri", "form-action", "frame-ancestors",
]);
const AREAS = new Set(["admin", "pos", "explore", "book", "booking", "market", "settings", "payroll", "staff", "login", "signup"]);
const PROVIDERS = new Set(["api.maptiler.com", "api.stripe.com", "checkout.stripe.com", "js.stripe.com", "hooks.stripe.com", "www.google.com", "link.com"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function documentArea(value: unknown, origin: string) {
  if (typeof value !== "string") return "other";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return "other";
    const first = url.pathname.split("/")[1];
    return AREAS.has(first) ? first : "other";
  } catch { return "other"; }
}

function blockedSource(value: unknown, origin: string, supabaseUrl?: string) {
  if (value === "inline" || value === "eval" || value === "data" || value === "blob") return value;
  if (typeof value !== "string") return "other";
  try {
    const url = new URL(value);
    if (url.origin === origin) return "self";
    if (supabaseUrl && url.origin === new URL(supabaseUrl).origin) return "supabase";
    if (PROVIDERS.has(url.hostname)) return url.hostname;
    if (url.hostname.endsWith(".js.stripe.com")) return "stripe-js";
    if (url.hostname.endsWith(".link.com")) return "stripe-link";
    // Never log attacker-chosen hosts, paths, queries, credentials or samples.
    return "external";
  } catch { return "other"; }
}

export function summarizeCspReports(value: unknown, origin: string, supabaseUrl?: string) {
  const reports = Array.isArray(value) ? value.slice(0, CSP_REPORT_MAX_BATCH) : [value];
  const summaries = [];
  for (const item of reports) {
    const envelope = record(item);
    if (!envelope) continue;
    if (envelope.type && envelope.type !== "csp-violation") continue;
    const report = record(envelope["csp-report"]) ?? record(envelope.body);
    if (!report) continue;
    const directive = report["effective-directive"] ?? report.effectiveDirective;
    if (typeof directive !== "string" || !DIRECTIVES.has(directive)) continue;
    summaries.push({
      directive,
      area: documentArea(report["document-uri"] ?? report.documentURL, origin),
      blocked: blockedSource(report["blocked-uri"] ?? report.blockedURL, origin, supabaseUrl),
      disposition: report.disposition === "enforce" ? "enforce" : "report",
    });
  }
  return summaries;
}

/** Bounded, anonymous per-instance telemetry budget, not an auth rate limit. */
export function createCspReportBudget(limit = 30, intervalMs = 60_000) {
  let start = 0;
  let count = 0;
  return (now = Date.now()) => {
    if (now - start >= intervalMs || now < start) { start = now; count = 0; }
    if (count >= limit) return false;
    count += 1;
    return true;
  };
}

export async function readCspReportBody(request: Request) {
  return JSON.parse(await readBoundedRequestText(request, CSP_REPORT_MAX_BYTES)) as unknown;
}
