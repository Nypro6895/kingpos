"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AppLocalHelp } from "@/components/app-local-help";
import { AppLocalCustomerBookings, AppLocalCustomerReceipt } from "@/components/app-local-customer-views";
import { AppLocalSavedPosts, AppLocalFollowing, AppLocalFavorites } from "@/components/app-local-social-views";
import { AppLocalMore } from "@/components/app-local-more";
import { AppLocalSupport, AppLocalSupportConversation } from "@/components/app-local-support";
import { CustomerActivityView } from "@/app/activity/customer-activity-view";
import { StaffMyWorkView } from "@/app/staff/my-work/staff-my-work-view";
import { StaffScheduleView } from "@/app/staff/appointments/staff-schedule-view";
import { StaffWorkdayView } from "@/app/staff/workday/staff-workday-view";
import { AppLocalTodayClient } from "@/app/staff/today/today-progressive-client";
import { MarketClient } from "@/app/market/market-client";
import { BookingDepositProduct } from "@/app/market/booking-deposit-product";
import { SettingsLoading } from "@/app/settings/settings-loading";
import { SettingsHubClient } from "@/app/settings/settings-hub-client";
import { MyPlaceClient } from "@/app/my-place/my-place-client";
import { ServicesManager } from "@/app/services/services-manager";
import { ServicesCatalogNativePage } from "@/app/services/services-catalog-native-page";
import { servicesCatalogNativePilotEnabled } from "./services-catalog-native-flag";
import { installServicesCatalogNativeLifecycle } from "./services-catalog-native-runtime";
import { marketBrowseFromQuery } from "@/app/market/market-browse";
import { useAppLocalResource } from "./app-local-resource";
import { AppLocalStaffRelay } from "./app-local-staff-relay";
import { getAppLocalHost, type AppLocalHost, type AppLocalContext } from "./app-local-host";
import { getAppLocalHelpGuide } from "./app-local-reference-content";
import type { CustomerActivityResource } from "@/app/activity/customer-activity-client";
import type { StaffMyWorkResource, StaffMyWorkSearchParams } from "./staff-my-work-experience";
import type { StaffScheduleResource, StaffWorkdayResource } from "./staff-read-view";
import type { MarketExperienceData } from "@/types/market-experience";
import type { AppLocalBookingsData, AppLocalReceiptData, AppLocalSavedPostsData, AppLocalFollowingData, AppLocalFavoritesData, AppLocalSettingsData, AppLocalStaffIdentityData, AppLocalMyPlaceData, AppLocalServicesData, AppLocalMoreData, AppLocalSupportData, AppLocalSupportCaseData } from "./app-local-platform-types";

export type AppLocalPageProps = { path: string; context: AppLocalContext | null; navigate: (href: string) => void; host?: AppLocalHost };
export type AppLocalPage = { id: string; title: string; requiresContext: boolean; Component: ComponentType<AppLocalPageProps>; features: readonly string[] };
type ReadViewProps<T> = AppLocalPageProps & { name: string; args?: Record<string, unknown>; title: string; children: (data: T, refresh: () => Promise<void>) => ReactNode; publicView?: (scope?: string) => ReactNode };
function ReadView<T>({ context, name, args = {}, title, children, publicView }: ReadViewProps<T>) {
  const scope = context?.context.scope;
  const state = useAppLocalResource<T>(scope, name, args, { enabled: Boolean(scope) });
  if (state.data !== undefined && context) return children(state.data, state.refresh);
  if (publicView) return publicView(scope);
  if (name === "page.settings") return <main className="settings-hub settings-route-loading"><h1>{title}</h1>{state.error?<div role="alert"><p>{state.error}</p><button type="button" onClick={()=>void state.refresh()}>Try again</button></div>:<SettingsLoading/>}</main>;
  return <main className="mx-auto grid max-w-5xl gap-4 p-6"><h1 className="text-2xl font-semibold">{title}</h1>{state.error ? <div role="alert"><p>{state.error}</p><button type="button" onClick={() => void state.refresh()}>Try again</button></div> : <p role="status">{context ? "Opening…" : "Connect to verify your account."}</p>}</main>;
}
const urlFor = (path: string) => new URL(path, "https://reylumi.com");
const queryFor = (path: string, names: readonly string[]) => Object.fromEntries(names.flatMap(name => { const value = urlFor(path).searchParams.get(name); return value === null ? [] : [[name, value]]; }));
const privatePage = (page: AppLocalPage): AppLocalPage => ({ ...page, Component(props) { return props.context?.context.authenticated ? <page.Component {...props} key={props.context.context.scope} /> : <main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-semibold">{page.title}</h1><p>Sign in to view your account.</p><a href={`/login?next=${encodeURIComponent(props.path)}`} onClick={event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void (props.host ?? getAppLocalHost()).openOnline(`/login?next=${encodeURIComponent(props.path)}`); }}>Sign in</a></main>; } });

function HelpPage(props: AppLocalPageProps) {
  const url = urlFor(props.path), language = url.searchParams.get("lang") === "vi" ? "vi" : "en";
  return <AppLocalHelp slug={url.pathname.startsWith("/help/") ? url.pathname.slice(6) : undefined} language={language} navigate={props.navigate} />;
}
function SupportPage(props: AppLocalPageProps) {
  if (props.context?.context.authenticated) return <ReadView<AppLocalSupportData> {...props} name="page.support" title="Report / Contact">{data => <AppLocalSupport data={data} from={urlFor(props.path).searchParams.get("from") ?? undefined} />}</ReadView>;
  return <AppLocalHelp support language={urlFor(props.path).searchParams.get("lang") === "vi" ? "vi" : "en"} navigate={href => {
    if (["/support", "/contact-support", "/account-recovery"].includes(urlFor(href).pathname)) void (props.host ?? getAppLocalHost()).openOnline(href);
    else props.navigate(href);
  }} />;
}
function SupportCasePage(props: AppLocalPageProps) { return <ReadView<AppLocalSupportCaseData> {...props} name="page.support-case" args={{ caseId: urlFor(props.path).pathname.split("/").at(-1)! }} title="Report / Contact">{(data, refresh) => <AppLocalSupportConversation data={data} refresh={refresh} />}</ReadView>; }
function MarketPage(props: AppLocalPageProps) {
  const browse = marketBrowseFromQuery(queryFor(props.path, ["q", "category"]));
  return <ReadView<MarketExperienceData> {...props} name="page.market" title="Market" publicView={scope => <MarketClient paymentsAvailable={false} experienceScope={scope} initialBrowse={browse} />} >{data => <MarketClient {...data} initialBrowse={browse} />}</ReadView>;
}
function DepositPage(props: AppLocalPageProps) {
  const cancelled = urlFor(props.path).searchParams.get("cancelled") === "1";
  return <ReadView<{ salonId?: string; installed: boolean }> {...props} name="page.market-deposit" title="Booking Deposit" publicView={() => <BookingDepositProduct cancelled={cancelled} />} >{data => <BookingDepositProduct {...data} cancelled={cancelled} />}</ReadView>;
}
function SettingsPage(props: AppLocalPageProps) {
  const url = urlFor(props.path), section = url.pathname === "/settings/login-security" ? "login-security" : url.pathname === "/staff/connections" ? "connections" : url.pathname === "/account" ? "personal-profile" : url.searchParams.get("section") ?? undefined;
  return <ReadView<AppLocalSettingsData> {...props} name="page.settings" title="All Settings">{data => <SettingsHubClient {...data} initialSection={section} initialQuery={url.searchParams.get("q") ?? undefined} />}</ReadView>;
}
function MyPlacePage(props: AppLocalPageProps) { return <ReadView<AppLocalMyPlaceData> {...props} name="page.my-place" title="My Place">{data => <MyPlaceClient {...data} error={urlFor(props.path).searchParams.get("error") ?? undefined} />}</ReadView>; }
installServicesCatalogNativeLifecycle(servicesCatalogNativePilotEnabled());
function ServicesPage(props: AppLocalPageProps) {
  if (servicesCatalogNativePilotEnabled() && (props.host ?? getAppLocalHost()).isNative && urlFor(props.path).searchParams.get("live") !== "1") return <ServicesCatalogNativePage {...props} />;
  return <ReadView<AppLocalServicesData> {...props} name="page.services" title="Services">{data => <ServicesManager {...data} expectedSalonId={props.context?.context.salonId ?? undefined} catalogScope={props.context?.context.scope} initialServiceId={urlFor(props.path).searchParams.get("service")} />}</ReadView>;
}
function MorePage(props: AppLocalPageProps) { return <ReadView<AppLocalMoreData> {...props} name="page.more" title="More">{data => <AppLocalMore {...data} />}</ReadView>; }
function ActivityPage(props: AppLocalPageProps) { return <ReadView<CustomerActivityResource> {...props} name="customer.activity" title="Activity">{data => <CustomerActivityView activity={data.result} />}</ReadView>; }
function BookingsPage(props: AppLocalPageProps) {
  const url = urlFor(props.path), args = queryFor(props.path, ["tab", "details"]);
  if (url.pathname.startsWith("/my-bookings/")) args.bookingId = url.pathname.slice("/my-bookings/".length);
  return <ReadView<AppLocalBookingsData> {...props} name="page.customer-bookings" args={args} title="My bookings">{data => <AppLocalCustomerBookings data={data} error={url.searchParams.get("error") ?? undefined} message={url.searchParams.get("message") ?? undefined} />}</ReadView>;
}
function ReceiptPage(props: AppLocalPageProps) { return <ReadView<AppLocalReceiptData> {...props} name="page.customer-receipt" args={{ ticketId: urlFor(props.path).pathname.split("/").at(-1)! }} title="Receipt">{data => <AppLocalCustomerReceipt {...data} />}</ReadView>; }
function SavedPage(props: AppLocalPageProps) { return <ReadView<AppLocalSavedPostsData> {...props} name="customer.saved-posts" args={queryFor(props.path, ["filter", "page", "q"])} title="Saved posts">{data => <AppLocalSavedPosts data={data} />}</ReadView>; }
function FollowingPage(props: AppLocalPageProps) {
  const args = queryFor(props.path, ["filter", "page", "q"]);
  if (urlFor(props.path).pathname === "/more/favorite-shop") args.filter = "shop";
  if (urlFor(props.path).pathname === "/more/favorite-customer") args.filter = "beauty";
  return <ReadView<AppLocalFollowingData> {...props} name="customer.following" args={args} title="Following">{data => <AppLocalFollowing data={data} />}</ReadView>;
}
function FavoritesPage(props: AppLocalPageProps) { return <ReadView<AppLocalFavoritesData> {...props} name="customer.favorites" args={queryFor(props.path, ["salons", "after"])} title="Your favorites">{data => <AppLocalFavorites data={data} />}</ReadView>; }

/** The trusted lease supplies identity immediately offline. Unapproved legacy users retain online-only resolution. */
function useStaffIdentity(props: AppLocalPageProps, view: string) {
  const scope = props.context?.context.scope, grant = props.context?.grant, binding = grant?.staffBinding;
  const leased = grant?.kind === "staff" && scope && grant.scopes.includes(scope) && binding && binding.viewerId === props.context?.context.viewerId && binding.salonId === grant.salonId
    ? { resourceScope: scope, staffId: binding.staffId, salonId: binding.salonId } : null;
  const hasLease = Boolean(leased), validatedAt = props.context?.onlineValidatedAt;
  const [loaded, setLoaded] = useState<{ scope: string; view: string; data?: AppLocalStaffIdentityData; error?: string } | null>(null);
  useEffect(() => {
    if (!scope || hasLease || !navigator.onLine) return;
    const controller = new AbortController(), host = props.host ?? getAppLocalHost();
    void host.read<AppLocalStaffIdentityData>("page.staff-identity", { view }, { scope, signal: controller.signal }).then(response => {
      if (!controller.signal.aborted && response.scope === scope && response.data) setLoaded({ scope, view, data: response.data });
    }).catch(error => { if (!controller.signal.aborted) setLoaded({ scope, view, error: error instanceof Error ? error.message : "Staff profile could not be loaded." }); });
    return () => controller.abort();
  }, [scope, view, hasLease, props.host, validatedAt]);
  const current = loaded && loaded.scope === scope && loaded.view === view ? loaded : null;
  return { data: leased ?? current?.data, error: current?.error };
}
function StaffPage(props: AppLocalPageProps) {
  const path = urlFor(props.path).pathname, view = path === "/staff/workday" ? "workday" : path === "/staff/appointments" ? "schedule" : "my-work";
  const identity = useStaffIdentity(props, view), params = queryFor(props.path, ["range", "status", "bookingId", "date", "quickId", "view", "tab", "payPeriodStart", "profile", "error"]);
  const args = { ...queryFor(props.path, view === "schedule" ? ["range", "status", "bookingId", "date", "quickId", "view"] : view === "my-work" ? ["tab", "payPeriodStart"] : []), staffId: identity.data?.staffId ?? "" };
  const state = useAppLocalResource<StaffMyWorkResource | StaffScheduleResource | StaffWorkdayResource>(identity.data?.resourceScope, view === "my-work" ? "staff.my-work" : `staff.${view}`, args, { enabled: Boolean(identity.data) });
  if (!identity.data || !state.data) return <main className="mx-auto grid max-w-5xl gap-4 p-6"><h1 className="text-2xl font-semibold">{view === "my-work" ? "My Work" : view === "schedule" ? "Appointments" : "Workday"}</h1>{identity.error || state.error ? <p role="alert">{identity.error ?? state.error}</p> : <p role="status">Opening…</p>}</main>;
  if (view === "my-work") return <StaffMyWorkView resource={state.data as StaffMyWorkResource} params={params as StaffMyWorkSearchParams} scope={identity.data.resourceScope} relay={<AppLocalStaffRelay scope={identity.data.resourceScope} salonId={identity.data.salonId} staffId={identity.data.staffId}/>} />;
  if (view === "workday") return <StaffWorkdayView data={(state.data as StaffWorkdayResource).result} error={params.error} />;
  const schedule = state.data as StaffScheduleResource;
  return <StaffScheduleView data={schedule.result} salonId={schedule.salonId} params={params} />;
}
function TodayPage(props: AppLocalPageProps) { return <AppLocalTodayClient scope={props.context!.context.scope} requestedDate={queryFor(props.path, ["date"]).date} />; }

const definitions = [
  { id: "help.home", title: "Help", requiresContext: false, Component: HelpPage, features: ["complete-guides", "search", "role-filters", "illustrations", "en-vi"] },
  { id: "support", title: "Report / Contact", requiresContext: false, Component: SupportPage, features: ["public-instructions", "original-request-form", "scoped-inbox", "guest-history-online"] },
  { id: "support.case", title: "Report / Contact", requiresContext: true, Component: SupportCasePage, features: ["original-conversation", "original-replies", "original-evidence-upload"] },
  { id: "market", title: "Market", requiresContext: false, Component: MarketPage, features: ["full-catalog", "search", "categories", "original-feature-panels"] },
  { id: "market.booking-deposit", title: "Booking Deposit", requiresContext: false, Component: DepositPage, features: ["full-product", "original-checkout"] },
  { id: "settings.hub", title: "All Settings", requiresContext: true, Component: SettingsPage, features: ["original-settings-hub", "original-panels", "original-online-confirmations"] },
  { id: "my-place", title: "My Place", requiresContext: true, Component: MyPlacePage, features: ["original-workspaces", "original-requests", "original-invitations", "original-lifecycle"] },
  { id: "services", title: "Services", requiresContext: true, Component: ServicesPage, features: ["original-complete-service-manager", "original-configurations", "original-confirmations"] },
  { id: "more", title: "More", requiresContext: true, Component: MorePage, features: ["complete-role-menu", "original-workspace-actions"] },
  { id: "customer.activity", title: "Activity", requiresContext: true, Component: ActivityPage, features: ["upcoming", "history", "original-detail-drawers"] },
  { id: "customer.bookings", title: "My bookings", requiresContext: true, Component: BookingsPage, features: ["upcoming", "past", "cancelled", "original-details"] },
  { id: "customer.receipt", title: "Receipt", requiresContext: true, Component: ReceiptPage, features: ["complete-services", "totals", "recorded-payments", "original-visit-review"] },
  { id: "customer.saved-posts", title: "Saved posts", requiresContext: true, Component: SavedPage, features: ["complete-list", "search", "filters", "pagination", "original-remove"] },
  { id: "customer.following", title: "Following", requiresContext: true, Component: FollowingPage, features: ["complete-list", "search", "filters", "pagination", "original-unfollow"] },
  { id: "customer.favorites", title: "Your favorites", requiresContext: true, Component: FavoritesPage, features: ["salons", "inspiration", "original-favorite-controls"] },
  { id: "staff.work", title: "My Work", requiresContext: true, Component: StaffPage, features: ["original-daily", "pay", "analysis", "schedule", "workday", "original-commands"] },
  { id: "owner.today", title: "Today", requiresContext: true, Component: TodayPage, features: ["original-complete-dashboard", "date", "original-shortcuts"] },
] satisfies AppLocalPage[];
const pages = new Map(definitions.map(page => [page.id, page.requiresContext ? privatePage(page) : page]));
export const APP_LOCAL_PAGE_IDS = definitions.map(({ id, title, requiresContext, features }) => ({ id, title, requiresContext, features }));
/** Only actual registered views are returned. Unimplemented routes stay explicit. */
export function getAppLocalPage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || /\\|%2f|%5c|%00/i.test(path)) return null;
    const url = urlFor(path), pathname = url.pathname.replace(/\/$/, "") || "/";
    if (url.hash || path.length > 4096 || [...url.searchParams].some(([key, value]) => /^(token|access_token|refresh_token|code|secret|signature|session|session_id|password|payment|bookingStripe|checkout|payment_intent|payment_intent_client_secret|setup_intent|setup_intent_client_secret|redirect_status|client_secret|key|invite|next|return_to)$/i.test(key) || value.length > 512)) return null;
    let id: string | undefined;
    if (pathname === "/help" || pathname.startsWith("/help/") && getAppLocalHelpGuide(pathname.slice(6))) id = "help.home";
    else if (pathname === "/support") id = "support";
    else if (/^\/support\/[0-9a-f-]{36}$/i.test(pathname)) id = "support.case";
    else if (pathname === "/market") id = "market";
    else if (pathname === "/market/booking-deposit") id = "market.booking-deposit";
    else if (["/settings", "/settings/login-security", "/staff/connections", "/account", "/roles", "/permissions"].includes(pathname)) id = "settings.hub";
    else if (pathname === "/my-place") id = "my-place";
    else if (pathname === "/services") id = "services";
    else if (pathname === "/more") id = "more";
    else if (pathname === "/activity") id = "customer.activity";
    else if (/^\/activity\/receipts\/[0-9a-f-]{36}$/i.test(pathname)) id = "customer.receipt";
    else if (pathname === "/my-bookings" || /^\/my-bookings\/[0-9a-f-]{36}$/i.test(pathname)) id = "customer.bookings";
    else if (["/more/saved-post", "/more/saved-posts", "/more/saved-designs"].includes(pathname)) id = "customer.saved-posts";
    else if (["/more/following", "/more/favorite-shop", "/more/favorite-customer"].includes(pathname)) id = "customer.following";
    else if (pathname === "/explore/favorites") id = "customer.favorites";
    else if (["/staff/my-work", "/staff/workday", "/staff/appointments"].includes(pathname)) id = "staff.work";
    else if (pathname === "/staff/today") id = "owner.today";
    return id ? pages.get(id) ?? null : null;
  } catch { return null; }
}
