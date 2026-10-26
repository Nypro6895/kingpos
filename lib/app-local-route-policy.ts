import inventory from "./app-local-route-inventory.generated.json";

export type AppLocalClassification = "public-static" | "business-catalog" | "live" | "sensitive-writes";
export type AppLocalScopeKind = "public" | "viewer" | "workspace" | "staff-binding" | "none";
export type AppLocalRoutePolicy = {
  route: string; source: string; layouts: string[]; classification: AppLocalClassification;
  roles: string[]; scope: AppLocalScopeKind; renderStrategy: string; rendererId: string | null;
  readResources: string[]; onlineReason: string | null;
  clientModules: Array<{ source: string; exports: string[] }>; propsLoaders: string[];
  ui: { availability: string; source: string; bundledContent: boolean; rendererReady: boolean; note: string };
  data: { policy: string; scope: string; requiresFreshServerAuthorityForWrites: boolean };
  actions: string; authority: string;
};

/** Inventory describes implementation; it never grants access to private data. */
export const APP_LOCAL_ROUTE_INVENTORY = inventory.routes as AppLocalRoutePolicy[];
export const APP_LOCAL_ROUTE_INVENTORY_VERSION = inventory.schemaVersion;
const SECRET_QUERY = /^(?:token|access_token|refresh_token|code|secret|signature|session|session_id|password|passcode|client_secret|payment|bookingStripe|checkout|payment_intent|payment_intent_client_secret|setup_intent|setup_intent_client_secret|redirect_status|key|invite|next|return_to)$/i;
const MORE_READ_SECTIONS = new Set(["saved-post", "saved-posts", "following", "memberships", "reviews", "gift-cards", "reports", "favorite-shop", "favorite-customer"]);

function matches(pattern: string, pathname: string) {
  const wanted = pattern.split("/"), actual = pathname.split("/");
  return wanted.length === actual.length && wanted.every((segment, index) => /^\[[^\]]+\]$/.test(segment) ? Boolean(actual[index]) : segment === actual[index]);
}

/** Unknown, foreign and token-bearing URLs cannot borrow an approved route. */
export function getAppLocalRoutePolicy(href: string, origin = "https://reylumi.invalid"): AppLocalRoutePolicy | null {
  let url: URL;
  try {
    if (!href || href.length > 4096 || /\\|%2f|%5c|%00/i.test(href)) return null;
    url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password || url.hash) return null;
  } catch { return null; }
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname).replace(/\/$/, "") || "/"; } catch { return null; }
  const policy = APP_LOCAL_ROUTE_INVENTORY.find(row => row.route === pathname) ?? APP_LOCAL_ROUTE_INVENTORY.find(row => matches(row.route, pathname));
  if (!policy) return null;
  if ([...url.searchParams].some(([key, value]) => SECRET_QUERY.test(key) || value.length > 512 || /^(?:section|tab|action|mode)$/i.test(key) && /^(?:login-security|recovery-back-office|ownership|close-salon|delete-account|edit|delete|transfer)$/i.test(value))) return { ...policy, scope: "none", data: { ...policy.data, policy: "online-only", scope: "none" }, renderStrategy: "online-only", rendererId: null, onlineReason: "A secure handoff must use its existing online route." };
  if (policy.route.startsWith("/explore/beauty/") && url.searchParams.has("customerId")) return { ...policy, scope: "viewer", data: { ...policy.data, policy: "scoped-authorized-snapshot", scope: "viewer" }, renderStrategy: "prepared-authorized-page" };
  if (policy.route === "/more/[section]") {
    const section = pathname.split("/").at(-1)!;
    if (!MORE_READ_SECTIONS.has(section)) return null;
    const resource = section === "saved-post" || section === "saved-posts" ? "customer.saved-posts" : section === "following" ? "customer.following" : null;
    return { ...policy, readResources: resource ? [resource] : [], rendererId: resource ?? policy.rendererId };
  }
  return policy;
}

export function canRetainAppLocalRead(policy: AppLocalRoutePolicy | null): boolean {
  return Boolean(policy && policy.scope !== "none" && policy.renderStrategy !== "online-only");
}
