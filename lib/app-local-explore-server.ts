import "server-only";
import { memoizeReadValidation } from "./read-context-scope";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { buildQuickActions, buildExploreDiscoveryContent, getExploreUtilityContent } from "./explore-page-resource-server";
import { EXPLORE_PAGE_SIZE, getExploreWorkspaceLocation, searchExploreSalons } from "./explore-search";
import { emptyFeedPage } from "./explore-feed";
import { resolveExploreQueryRouting } from "./explore-query-routing";
import { getExploreHomeContent, emptyHomeContent } from "./explore-home";
import { enrichExploreShowcaseContent } from "./explore-showcase-content";
import { prepareExploreStartupFeed } from "./explore-startup-feed-server";
import { exploreCommentIdentity } from "./explore-comment-identity";
import { runReadWithDeadline } from "./bounded-get";
import { POST as searchPOST } from "@/app/api/explore/search/route";
import { POST as feedPOST } from "@/app/api/explore/feed/route";
import { POST as areaPOST } from "@/app/api/explore/area/route";
import { GET as suggestionsGET } from "@/app/api/explore/suggestions/route";
import { GET as salonSocialGET } from "@/app/api/explore/salon-social/route";
import { APP_LOCAL_EXPLORE_QUERY_KEYS } from "./app-local-explore-metadata";
import type { AppLocalExploreCore, AppLocalExploreExtras } from "./app-local-explore-types";
import type { ExploreFeedPage, ExploreLocationSource, ExploreUtilityContent } from "@/types/explore";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";

const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
async function authorized(scope?: string) {
  const current = await headers();
  if (current.get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const context = await getRequestBusinessContext();
  if (!scope || getExperienceContext(context).scope !== scope) fail(409, "Your account has changed.");
  return { context, current };
}
function envelope<T>(scope: string, name: string, args: unknown, data: T, etag?: string): AppLocalRead<T> {
  const version = '"' + createHash("sha256").update(JSON.stringify([scope, name, args, data])).digest("hex") + '"';
  return { schemaVersion: 1, status: version === etag ? 304 : 200, scope, etag: version, updatedAt: Date.now(), ...(version === etag ? {} : { data }) };
}
function queryArgs(args: Record<string, unknown>) {
  if (Object.keys(args).some(key => key !== "query") || args.query !== undefined && (typeof args.query !== "string" || args.query.length > 4096)) fail(400, "Unsupported Explore filters");
  const query = new URLSearchParams(String(args.query ?? ""));
  if ([...query].some(([key, value]) => !APP_LOCAL_EXPLORE_QUERY_KEYS.includes(key as typeof APP_LOCAL_EXPLORE_QUERY_KEYS[number]) || value.length > 512 || query.getAll(key).length !== 1)) fail(400, "Unsupported Explore filters");
  query.delete("page"); query.sort(); return query;
}
function explicitSearch(params: URLSearchParams) {
  return Boolean((params.get("q") ?? "").trim() || (params.get("location") ?? "").trim() && params.get("browse") !== "1" || (params.get("category") ?? "").trim() || ["posts", "salons"].includes(params.get("type") ?? ""));
}
const emptyUtility = (): ExploreUtilityContent => ({ bookingLoadError: false, notificationLoadError: false, notifications: [], unreadNotificationCount: 0, upcomingBooking: null });
const startupRoutingKey = Symbol("explore-initial-routing");
function startupRouting(context: Awaited<ReturnType<typeof getRequestBusinessContext>>, params: URLSearchParams) {
  return memoizeReadValidation(startupRoutingKey,JSON.stringify([getExperienceContext(context).scope,params.toString()]),()=>loadStartupRouting(context,params));
}
async function loadStartupRouting(context: Awaited<ReturnType<typeof getRequestBusinessContext>>, params: URLSearchParams) {
  const explicit = explicitSearch(params), hasLocationParam = params.has("location");
  const workspaceLocation = await runReadWithDeadline(getExploreWorkspaceLocation(context), 8_000);
  const rawSource = params.get("locationSource"), locationInputSource = rawSource === "gps" || rawSource === "activity" || rawSource === "saved" || rawSource === "workspace" ? rawSource : undefined;
  const rawScope = params.get("scope"), target = params.get("type") === "posts" ? "posts" : params.get("type") === "salons" ? "salons" : "auto";
  const routing = await runReadWithDeadline(resolveExploreQueryRouting({ query: (params.get("q") ?? "").trim(), category: (params.get("category") ?? "").trim(), location: (params.get("location") ?? "").trim(), locationSource: locationInputSource, target: explicit ? target : "salons", scopePolicy: rawScope === "fixed" || rawScope === "expandable" ? rawScope : undefined }, { fallbackLocation: hasLocationParam ? "" : workspaceLocation.label, fallbackSource: workspaceLocation.source }), 8_000);
  const rawSort = params.get("sort"), sort: "trusted" | "bookable" | "closest" | "relevance" = rawSort === "trusted" || rawSort === "bookable" || rawSort === "closest" ? rawSort : "relevance";
  return { explicit, hasLocationParam, workspaceLocation, routing, sort };
}
/** The original core waits for search plus its small initial-home read only.
 * Full rails, personal utility, quick actions and feed have independent reads. */
async function explorePage(context: Awaited<ReturnType<typeof getRequestBusinessContext>>, params: URLSearchParams): Promise<AppLocalExploreCore> {
  const homePromise = explicitSearch(params) ? Promise.resolve(emptyHomeContent()) : runReadWithDeadline(getExploreHomeContent({ initial: true }), 8_000).catch(() => emptyHomeContent());
  const { explicit, hasLocationParam, workspaceLocation, routing, sort } = await startupRouting(context, params);
  const [searchResponse, homeContent] = await Promise.all([searchExploreSalons({ category: routing.category, location: routing.location, page: 1, pageSize: explicit ? EXPLORE_PAGE_SIZE : 4, query: routing.query, scopePolicy: routing.scopePolicy, sort, target: routing.target, locationSource: routing.locationSource }, { routing }), homePromise]);
  const initialFeed = emptyFeedPage(), utilityContent = emptyUtility();
  const discoveryContent = buildExploreDiscoveryContent({ homeContent, initialFeed, searchResponse, utilityContent, workspaceLocation });
  const showcase = enrichExploreShowcaseContent({ discoveryContent, homeContent, initialFeed, searchResponse });
  return { commentViewer: { identity: exploreCommentIdentity(context), canModerate: false, canReplyAsSalon: false, isAuthenticated: Boolean(context.user), userId: context.user?.id ?? null }, initialSearchMode: explicit, initialLocationSource: routing.locationSource as ExploreLocationSource, initialResponse: showcase.searchResponse, discoveryContent: showcase.discoveryContent, homeContent: showcase.homeContent, hasUrlLocation: hasLocationParam || routing.locationOrigin === "query", initialFeed: showcase.initialFeed, quickActions: [], workspaceLocation, deferred: { extras: true, feed: !explicit && !hasLocationParam && routing.locationOrigin !== "query", showcase: process.env.EXPLORE_ENABLE_DEMO_CONTENT === "true" } };
}
async function exploreExtras(context: Awaited<ReturnType<typeof getRequestBusinessContext>>, params: URLSearchParams): Promise<AppLocalExploreExtras> {
  const explicit = explicitSearch(params);
  const [homeContent, utilityContent, quickActions] = await Promise.all([
    explicit ? Promise.resolve(emptyHomeContent()) : runReadWithDeadline(getExploreHomeContent(), 10_000).catch(() => emptyHomeContent()),
    explicit ? Promise.resolve(emptyUtility()) : runReadWithDeadline(getExploreUtilityContent(context), 10_000).catch(() => emptyUtility()),
    runReadWithDeadline(buildQuickActions(context), 10_000).catch(() => []),
  ]);
  return { homeContent, utilityContent, quickActions };
}
async function exploreFeed(context: Awaited<ReturnType<typeof getRequestBusinessContext>>, params: URLSearchParams) {
  if (explicitSearch(params) || params.has("location")) return null;
  const { routing } = await startupRouting(context, params);
  if (routing.locationOrigin === "query") return null;
  return runReadWithDeadline(prepareExploreStartupFeed(context, { category: routing.category, location: routing.location }), 6_000).catch(() => null);
}
async function wire(response: Response): Promise<AppLocalHttpResponse> {
  const selected: Record<string, string> = {};
  for (const name of ["content-type", "cache-control", "etag", "server-timing"]) { const value = response.headers.get(name); if (value) selected[name] = value; }
  return { status: response.status, headers: selected, body: await response.text() };
}
const reads = new Set(["http.explore.search", "http.explore.feed-page", "http.explore.feed-updates", "http.explore.feed-validate", "http.explore.area", "http.explore.suggestions", "http.explore.salon-social"]);
/** POST-shaped original search/feed reads remain named GET resources on the host. */
export async function readAppLocalExploreResource(name: string, args: Record<string, unknown> = {}, options: { scope?: string; etag?: string; signal?: AbortSignal } = {}): Promise<AppLocalRead<AppLocalExploreCore | AppLocalExploreExtras | ExploreFeedPage | null | AppLocalHttpResponse> | null> {
  if (!["page.explore", "page.explore-extras", "page.explore-feed"].includes(name) && !reads.has(name)) return null;
  if (options.signal?.aborted) throw options.signal.reason;
  const { context, current } = await authorized(options.scope);
  if (["page.explore", "page.explore-extras", "page.explore-feed"].includes(name)) {
    const query = queryArgs(args);
    const load = async () => name === "page.explore" ? await explorePage(context, query) : name === "page.explore-extras" ? await exploreExtras(context, query) : await exploreFeed(context, query);
    const data = await runReadWithDeadline(load(), 15_000);
    if (options.signal?.aborted) throw options.signal.reason;
    return envelope(options.scope!, name, query.toString(), data, options.etag);
  }
  const requestHeaders = new Headers(); if (current.get("cookie")) requestHeaders.set("cookie", current.get("cookie")!);
  let response: Response;
  if (name === "http.explore.suggestions" || name === "http.explore.salon-social") {
    const social = name === "http.explore.salon-social", keys = social ? ["ids"] : ["q", "location", "category"];
    if (Object.entries(args).some(([key, value]) => !keys.includes(key) || typeof value !== "string" || value.length > (social ? 8192 : 512))) fail(400, "Unsupported Explore request");
    const url = new URL(social ? "/api/explore/salon-social" : "/api/explore/suggestions", "https://reylumi.com"); url.search = new URLSearchParams(args as Record<string, string>).toString();
    const request = new NextRequest(url, { headers: requestHeaders, signal: options.signal });
    response = await (social ? salonSocialGET : suggestionsGET)(request);
  } else {
    if (Object.keys(args).some(key => key !== "input") || !args.input || typeof args.input !== "object" || Array.isArray(args.input)) fail(400, "Invalid Explore request");
    const input = args.input as Record<string, unknown>, body = JSON.stringify(input);
    if (body.length > (name === "http.explore.area" ? 1024 : name === "http.explore.search" ? 8192 : 16384)) fail(400, "Explore request is too large");
    const feedMode = name.startsWith("http.explore.feed-") ? name.slice("http.explore.feed-".length) : null;
    if (feedMode && (input.mode ?? "page") !== feedMode) fail(400, "Unsupported discovery read");
    requestHeaders.set("Content-Type", "application/json");
    const path = name === "http.explore.search" ? "/api/explore/search" : name === "http.explore.area" ? "/api/explore/area" : "/api/explore/feed";
    const request = new NextRequest(new URL(path, "https://reylumi.com"), { method: "POST", body, headers: requestHeaders, signal: options.signal });
    response = await (name === "http.explore.search" ? searchPOST : name === "http.explore.area" ? areaPOST : feedPOST)(request);
  }
  if (options.signal?.aborted) throw options.signal.reason;
  // Session/cursor reads are transient and do not use 304 bodies or native persistence.
  return envelope(options.scope!, name, args, await wire(response));
}
export async function runAppLocalExploreHttpCommand(name: string, args: Record<string, unknown>, request: Request, scope: string): Promise<{ handled: boolean; data?: AppLocalHttpResponse; status?: number }> {
  if (name !== "http.explore.feed-events") return { handled: false };
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) fail(403, "Please open Explore again.");
  if (Object.keys(args).some(key => key !== "input") || !args.input || typeof args.input !== "object" || Array.isArray(args.input) || (args.input as Record<string, unknown>).mode !== "events") fail(400, "Invalid discovery events");
  const body = JSON.stringify(args.input); if (body.length > 16384) fail(400, "Discovery request is too large");
  const { current } = await authorized(scope), forwarded = new Headers({ "Content-Type": "application/json", Origin: origin });
  const cookie = request.headers.get("cookie") ?? current.get("cookie"); if (cookie) forwarded.set("cookie", cookie);
  const data = await wire(await feedPOST(new NextRequest(new URL("/api/explore/feed", origin), { method: "POST", body, headers: forwarded })));
  return { handled: true, data, status: data.status };
}
