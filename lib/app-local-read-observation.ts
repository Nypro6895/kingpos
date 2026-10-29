import "server-only";
import { READ_REQUEST_TIMING_STAGES } from "./read-request-timing";

// Temporary, metadata-only observation for this owner-authorized device audit.
// This logging list never grants read authority. Call only after the original
// named reader accepts a resource, or with the two fixed context labels.
const RESOURCES = new Set<string>(["app.connection","context.root","context.route","customer.activity","customer.bookings","customer.favorites","customer.following","customer.history","customer.salons","customer.saved-posts","customer.tax-report","customer.tax-salons","customer.visit","display.http.entry","display.http.settings","http.business-claims.matches","http.explore.area","http.explore.feed-page","http.explore.feed-updates","http.explore.feed-validate","http.explore.post-comments","http.explore.salon-social","http.explore.search","http.explore.suggestions","http.notifications.feed","http.notifications.preferences","http.owner.closing","http.owner.closing-history","http.public-booking.availability","http.shell.advertising","http.shell.campaigns","http.shell.quick-booking","http.shell.session","http.staff.creation","owner.bookings","owner.campaigns","owner.check-in","owner.customer-display","owner.deposit-settings","owner.market-order","owner.payroll-tax-report","owner.payroll-tax-settings","owner.pos-settings","owner.report-closing","owner.reports","owner.salon-profile","owner.salon-settings","owner.ticket-detail","owner.tickets","owner.today","owner.transformations","owner.workspace","owner.workspace-patch","page.beauty","page.customer-bookings","page.customer-receipt","page.explore","page.explore-extras","page.explore-feed","page.market","page.market-deposit","page.more","page.my-place","page.notifications","page.owner-customer-detail","page.owner-customer-form","page.owner-customers","page.owner-payroll","page.owner-staff","page.owner-today","page.services","page.services-catalog","page.services-catalog-admission","page.settings","page.staff-identity","page.support","page.support-case","portable.book","portable.check-in","portable.customer-display-settings","portable.http.connection","portable.http.staff","portable.http.tickets","portable.http.workspace","portable.report","portable.ticket","portable.workspace","public.beauty","public.beauty-post","public.booking","public.campaign","public.directory","public.inspiration","public.salon","settings.direct","settings.personal","shell.auxiliary","shell.configuration","shell.navigation","shell.notice","shell.summary","staff.my-work","staff.relay","staff.schedule","staff.workday"]);
export const READ_OBSERVATION_END = Date.parse("2026-10-29T11:30:00Z");
const STAGES = new Set<string>([...READ_REQUEST_TIMING_STAGES, "total", "proxy_refresh", "workspace", "handler", "backend_auth", "backend_rest", "backend_rpc"]);
const reported = new WeakSet<Response>();
let emitted = 0;
type Span = { durationMs?: number; calls?: number; bytes?: number; sized?: number };
export function observeAppLocalRead<T extends Response>(response: T, resource: string, now: () => number = Date.now, emit: (line: string) => void = line => console.info(line)): T {
  try {
    if (now() >= READ_OBSERVATION_END || emitted >= 1000 || reported.has(response) || !RESOURCES.has(resource)) return response;
    const spans: Record<string, Span> = {};
    const timing = response.headers.get("Server-Timing") ?? "";
    if (timing.length > 16_384) return response;
    for (const item of timing.split(",")) {
      const [name, ...parameters] = item.trim().split(";");
      if (!STAGES.has(name)) continue;
      const span: Span = {};
      for (const parameter of parameters) {
        const match = /^(dur|calls|bytes|sized)=([0-9]+(?:\.[0-9]+)?)$/.exec(parameter.trim());
        if (!match) continue;
        const value = Number(match[2]);
        if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) continue;
        if (match[1] === "dur") span.durationMs = Math.min(3_600_000, value);
        else if (name.startsWith("backend_") && Number.isSafeInteger(value)) span[match[1] as "calls" | "bytes" | "sized"] = value;
      }
      if (Object.keys(span).length) spans[name] = span;
    }
    reported.add(response); emitted++;
    // Never inspect/clone the body or log URL, args, scope, headers, account,
    // generation, device, request identifiers or free-form errors.
    emit(JSON.stringify({ event: "app_local_read_observation_v1", resource, status: response.status, spans }));
  } catch { /* Observation cannot alter the original response or retry work. */ }
  return response;
}
