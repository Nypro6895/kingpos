import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { isSalonManageContext } from "./current-context";
import { getPublicSalonProfileData } from "./salon-profile";
import { getBeautyProfileRoutePage } from "./beauty-relationship";
import { getPublicExploreBeautyPost } from "./explore-personal";
import { getPostCommentViewer } from "./post-comments";
import { nailLookById } from "./nail-inspiration-catalog";
import { nailSalonEligible, nailSalonSearchInput } from "./nail-inspiration";
import { searchExploreSalons } from "./explore-search";
import { getPublicBookingPageData } from "./public-booking";
import { POST as availabilityPOST } from "@/app/api/public-booking/availability/route";
import { POST as confirmPOST } from "@/app/api/public-booking/confirm/route";
import { APP_LOCAL_BOOKING_QUERY_KEYS, APP_LOCAL_PUBLIC_READS } from "./app-local-public-metadata";
import { runReadWithDeadline } from "./bounded-get";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";
import type { AppLocalPublicData } from "./app-local-public-types";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
async function authorized(scope?: string) {
  const current = await headers(); if (current.get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const context = await getRequestBusinessContext(); if (!scope || getExperienceContext(context).scope !== scope) fail(409, "Your account has changed."); return { current, context };
}
function id(value: unknown): string { if (typeof value !== "string" || !uuid.test(value)) fail(400, "Invalid profile link"); return value; }
function envelope<T>(scope: string, name: string, args: Record<string, unknown>, data: T, etag?: string): AppLocalRead<T> {
  const version = '"' + createHash("sha256").update(JSON.stringify([scope, name, Object.keys(args).sort().map(key => [key, args[key]]), data])).digest("hex") + '"';
  return { schemaVersion: 1, status: version === etag ? 304 : 200, scope, etag: version, updatedAt: Date.now(), ...(version === etag ? {} : { data }) };
}
async function wire(response: Response): Promise<AppLocalHttpResponse> {
  const selected: Record<string, string> = {}; for (const name of ["content-type", "cache-control", "server-timing"]) { const value = response.headers.get(name); if (value) selected[name] = value; }
  return { status: response.status, headers: selected, body: await response.text() };
}
export async function readAppLocalPublicResource(name: string, args: Record<string, unknown> = {}, options: { scope?: string; etag?: string; signal?: AbortSignal } = {}): Promise<AppLocalRead<AppLocalPublicData | AppLocalHttpResponse> | null> {
  const rule = APP_LOCAL_PUBLIC_READS.find(row => row.name === name); if (!rule) return null;
  if (Object.keys(args).some(key => !(rule.argumentKeys as readonly string[]).includes(key))) fail(400, "Unsupported profile filters");
  if (options.signal?.aborted) throw options.signal.reason;
  const { context, current } = await authorized(options.scope);
  let data: AppLocalPublicData | AppLocalHttpResponse;
  if (name === "public.salon") {
    const salonId = id(args.salonId), profile = await runReadWithDeadline(getPublicSalonProfileData(salonId), 12_000); if (!profile) fail(404, "Salon not found");
    data = context.user && context.currentSalon?.id === salonId && isSalonManageContext(context) ? { view: "online", href: "/salon-profile", reason: "own-salon" } : { view: "salon", props: { capabilities: { canBook: profile.directoryListing?.claimState !== "unclaimed" && profile.profile.operatingStatus.kind !== "permanently_closed", canCreateContent: false, canEditProfile: false, canFollow: true, canManageContent: false, canModerateComments: false, canPublish: false, canReplyAsSalon: false, canViewDraftContent: false, currentUserId: context.user?.id ?? null, isAuthenticated: Boolean(context.user), isOwnSalon: false }, data: profile } };
  } else if (name === "public.beauty") {
    const profileId = id(args.profileId), customerId = args.customerId === undefined ? undefined : id(args.customerId);
    const page = await runReadWithDeadline(getBeautyProfileRoutePage({ profileId, customerId }), 12_000); if (!page) fail(404, "Beauty profile not found"); data = { view: "beauty", page };
  } else if (name === "public.beauty-post") {
    const profileId = id(args.profileId), postId = id(args.postId), [item, commentViewer] = await Promise.all([runReadWithDeadline(getPublicExploreBeautyPost({ profileId, postId }), 12_000), getPostCommentViewer()]);
    if (!item || item.personal.profileId !== profileId) fail(404, "Beauty post not found"); data = { view: "beauty-post", item, commentViewer, profileId, postId };
  } else if (name === "public.inspiration") {
    if (typeof args.lookId !== "string" || args.lookId.length > 100 || args.location !== undefined && (typeof args.location !== "string" || args.location.length > 160)) fail(400, "Invalid inspiration link");
    const look = nailLookById(args.lookId); if (!look) fail(404, "Inspiration not found"); const location = String(args.location ?? ""), discovery = { location, strictLocation: true };
    const nearby = location ? await runReadWithDeadline(searchExploreSalons(nailSalonSearchInput(discovery)), 12_000) : null;
    const salon = !nearby?.error ? nearby?.results.find(result => nailSalonEligible(result, discovery)) : undefined; data = { view: "inspiration", look, salon, location };
  } else if (name === "public.booking") {
    const salonId = id(args.salonId); if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 2048)) fail(400, "Invalid booking filters");
    const query = new URLSearchParams(String(args.query ?? "")); if ([...query].some(([key, value]) => !(APP_LOCAL_BOOKING_QUERY_KEYS as readonly string[]).includes(key) || value.length > 512 || query.getAll(key).length !== 1)) fail(400, "Unsupported booking link");
    const booking = await runReadWithDeadline(getPublicBookingPageData(salonId, Object.fromEntries(query), { deferAvailability: true }), 12_000);
    // Availability and payment secrets are never durable page data. The existing
    // payment-capable HTTPS page owns every deposit checkout from its first step.
    data = booking.bookingDeposit ? { view: "online", href: "/book/" + salonId + (query.size ? "?" + query : ""), reason: "payment" } : { view: "booking", data: { ...booking, slots: [], availabilityResolved: false } };
  } else {
    if (!args.input || typeof args.input !== "object" || Array.isArray(args.input) || JSON.stringify(args.input).length > 32768) fail(400, "Invalid availability request");
    const forwarded = new Headers({ "Content-Type": "application/json" }); if (current.get("cookie")) forwarded.set("cookie", current.get("cookie")!);
    data = await wire(await availabilityPOST(new Request("https://reylumi.com/api/public-booking/availability", { method: "POST", body: JSON.stringify(args.input), headers: forwarded, signal: options.signal })));
  }
  if (options.signal?.aborted) throw options.signal.reason; return envelope(options.scope!, name, args, data, name === "http.public-booking.availability" ? undefined : options.etag);
}
/** Original booking confirm is invoked once, only after fresh scope and its own Origin/input guards. */
export async function runAppLocalPublicHttpCommand(name: string, args: Record<string, unknown>, request: Request, scope: string): Promise<{ handled: boolean; data?: AppLocalHttpResponse; status?: number }> {
  if (name !== "http.public-booking.confirm") return { handled: false };
  const origin = new URL(request.url).origin; if (request.headers.get("origin") !== origin) fail(403, "Please open booking again.");
  if (Object.keys(args).some(key => key !== "input") || !args.input || typeof args.input !== "object" || Array.isArray(args.input) || JSON.stringify(args.input).length > 32768) fail(400, "Invalid booking request");
  const { current } = await authorized(scope);
  // A salon may enable a deposit after this device loaded its catalog. Check
  // that read policy before the original confirm handler creates any payment.
  const salonId = id((args.input as Record<string, unknown>).salonId);
  const booking = await runReadWithDeadline(getPublicBookingPageData(salonId, {}, { deferAvailability: true }), 12_000);
  if (booking.bookingDeposit) return { handled: true, status: 200, data: { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, code: "payment_online_required", message: "Continue in secure booking to review payment. Your selections have been kept here." }) } };
  const forwarded = new Headers({ "Content-Type": "application/json", Origin: origin }); const cookie = request.headers.get("cookie") ?? current.get("cookie"); if (cookie) forwarded.set("cookie", cookie);
  const data = await wire(await confirmPOST(new Request(new URL("/api/public-booking/confirm", origin), { method: "POST", headers: forwarded, body: JSON.stringify(args.input) }))); return { handled: true, data, status: data.status };
}
