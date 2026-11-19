const TICKET_NAVIGATION_ORIGIN = "https://ticket-navigation.local";
const TICKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPosTicketId(value: unknown): value is string {
  return typeof value === "string" && TICKET_ID_PATTERN.test(value);
}

function isTicketDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function ticketBusinessDate(openedAt: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(openedAt));
  const read = (name: string) => parts.find((part) => part.type === name)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

type TicketListLocation = {
  ticketId?: string | null;
  date?: string | null;
  q?: string | null;
};

export function buildTicketListHref({ ticketId, date, q }: TicketListLocation = {}) {
  const params = new URLSearchParams();
  if (isTicketDate(date)) params.set("date", date);
  if (typeof q === "string" && q.trim()) params.set("q", q.trim());
  if (isPosTicketId(ticketId)) params.set("ticketId", ticketId);
  const query = params.toString();
  return query ? `/pos-tickets?${query}` : "/pos-tickets";
}

function checkedTicketListReturnTo(value: unknown) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
  try {
    const url = new URL(path, TICKET_NAVIGATION_ORIGIN);
    if (url.origin !== TICKET_NAVIGATION_ORIGIN || !["/pos-tickets", "/pos/ticket"].includes(url.pathname)) return null;
    const canonical = buildTicketListHref({
      date: url.searchParams.get("date"),
      q: url.searchParams.get("q"),
      ticketId: url.searchParams.get("ticketId"),
    });
    return url.pathname === "/pos/ticket" ? canonical.replace("/pos-tickets", "/pos/ticket") : canonical;
  } catch {
    return null;
  }
}

export function sanitizeTicketListReturnTo(
  value: unknown,
  fallback = "/pos-tickets",
) {
  return checkedTicketListReturnTo(value) ?? checkedTicketListReturnTo(fallback) ?? "/pos-tickets";
}

/** Retain the already-shipped report → ticket → report return journey. */
export function sanitizeTicketDetailReturnTo(value: unknown, fallback = "/pos-tickets") {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value)) {
    try {
      const url = new URL(value, TICKET_NAVIGATION_ORIGIN);
      if (url.origin === TICKET_NAVIGATION_ORIGIN && ["/reports", "/pos/report"].includes(url.pathname)) {
        return url.pathname + url.search;
      }
    } catch { /* Fall through to the existing ticket-list validation. */ }
  }
  return sanitizeTicketListReturnTo(value, fallback);
}

export function buildTicketDetailHref(
  ticketId: string,
  { edit, returnTo }: { edit?: boolean; returnTo?: string | null } = {},
) {
  const params = new URLSearchParams();
  if (edit) params.set("edit", "1");
  if (returnTo) params.set("returnTo", sanitizeTicketDetailReturnTo(returnTo));
  const path = `/pos-tickets/${encodeURIComponent(ticketId)}`;
  return params.size ? `${path}?${params.toString()}` : path;
}
