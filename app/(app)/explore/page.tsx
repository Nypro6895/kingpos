import { exploreCommentIdentity } from "@/lib/explore-comment-identity";
import { withExperiencePage } from "@/components/experience-page";
import { Suspense } from "react";
import { ExploreStartupShell } from "@/app/explore/explore-startup-shell";
import { ExploreProgressiveClient } from "@/app/explore/explore-progressive-client";
import { prepareExploreStartupFeed } from "@/lib/explore-startup-feed-server";
import { runReadWithDeadline } from "@/lib/bounded-get";
import { getRequestBusinessContext as getCurrentBusinessContext } from "@/lib/request-business-context";
import { EXPLORE_PAGE_SIZE, getExploreWorkspaceLocation, searchExploreSalons } from "@/lib/explore-search";
import { emptyFeedPage } from "@/lib/explore-feed";
import { resolveExploreQueryRouting } from "@/lib/explore-query-routing";
import { getExploreHomeContent, emptyHomeContent } from "@/lib/explore-home";
import { enrichExploreShowcaseContent } from "@/lib/explore-showcase-content";
import { redirect } from "next/navigation";
import type { ExploreUtilityContent, ExploreLocationSource } from "@/types/explore";
import { buildQuickActions, buildExploreDiscoveryContent, getExploreUtilityContent, stringParam, clean, parsePage, type ExplorePageProps } from "@/lib/explore-page-resource-server";

async function ExploreCorePage({ searchParams }: ExplorePageProps) {
  const params = (await searchParams) ?? {};
  const rawQuery = clean(stringParam(params.q));
  const requestedLocation = clean(stringParam(params.location));
  const hasLocationParam = params.location !== undefined;
  const category = clean(stringParam(params.category));
  const requestedTarget = stringParam(params.type);
  const target = requestedTarget === "posts" || requestedTarget === "salons" ? "salons" : "auto";
  const filters = {
    ...Object.fromEntries((["shape", "length", "color", "finish", "tone", "season"] as const).flatMap(key => stringParam(params[key]) ? [[key, stringParam(params[key])!]] : [])),
    ...(stringParam(params.maxPrice) ? { maxPrice: Number(stringParam(params.maxPrice)) } : {}),
    ...(stringParam(params.bookableOnly) === "true" ? { bookableOnly: true } : {}),
    ...(stringParam(params.newOnly) === "true" ? { newOnly: true } : {}),
    ...(stringParam(params.trendingOnly) === "true" ? { trendingOnly: true } : {}),
  };
  const page = parsePage(clean(stringParam(params.page)));
  if (page > 1) {
    const fresh = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "page" && value !== undefined) fresh.set(key, stringParam(value) ?? "");
    }
    if (fresh.has("type")) fresh.set("type", "salons");
    redirect(`/explore${fresh.size ? `?${fresh}` : ""}`);
  }
  const hasExplicitSearchParams = Boolean(
    rawQuery || (requestedLocation && stringParam(params.browse) !== "1") || category || target !== "auto" || Object.keys(filters).length > 0 || page > 1,
  );
  const contextPromise = getCurrentBusinessContext();
  const homeContentPromise = hasExplicitSearchParams ? Promise.resolve(emptyHomeContent()) : runReadWithDeadline(getExploreHomeContent(), 10_000).catch(() => emptyHomeContent());
  const initialHomePromise = hasExplicitSearchParams ? Promise.resolve(emptyHomeContent()) : runReadWithDeadline(getExploreHomeContent({ initial: true }), 8_000).catch(() => emptyHomeContent());
  const context = await contextPromise;
  const workspaceLocationPromise = runReadWithDeadline(getExploreWorkspaceLocation(context), 8_000);
  const quickActionsPromise = buildQuickActions(context).catch(() => []);
  const utilityContentPromise = hasExplicitSearchParams ? Promise.resolve<ExploreUtilityContent>({
    bookingLoadError:false,notificationLoadError:false,notifications:[],unreadNotificationCount:0,upcomingBooking:null,
  }) : runReadWithDeadline(getExploreUtilityContent(context), 10_000).catch(() => ({ bookingLoadError: false, notificationLoadError: false, notifications: [], unreadNotificationCount: 0, upcomingBooking: null }));
  const workspaceLocation = await workspaceLocationPromise;
  const urlSource = stringParam(params.locationSource);
  const locationInputSource = urlSource === "gps" || urlSource === "activity" || urlSource === "saved" || urlSource === "workspace" || urlSource === "none" ? urlSource : undefined;
  const requestedScope = stringParam(params.scope);
  const routing = await runReadWithDeadline(resolveExploreQueryRouting({ query: rawQuery, category, location: requestedLocation, locationSource: locationInputSource,
    target: hasExplicitSearchParams ? target : "salons", scopePolicy: requestedScope === "fixed" || requestedScope === "expandable" ? requestedScope : undefined }, {
    fallbackLocation: hasLocationParam ? "" : workspaceLocation.label, fallbackSource: workspaceLocation.source,
  }), 8_000);
  const queryLocation = routing.locationOrigin === "query" ? routing.location : "";
  const query = routing.query;
  const effectiveLocation = routing.location;
  const locationSource: ExploreLocationSource = routing.locationSource;
  const scopePolicy = routing.scopePolicy;
  const requestedSort = stringParam(params.sort);
  const sort = requestedSort === "trusted" || requestedSort === "bookable" || requestedSort === "closest" ? requestedSort : "relevance";
  const feedPromise = !hasExplicitSearchParams && !hasLocationParam && !queryLocation
    ? runReadWithDeadline(prepareExploreStartupFeed(context, { category: routing.category, location: effectiveLocation }), 6_000).catch(() => null)
    : undefined;
  const [searchResponse, homeContent] = await Promise.all([searchExploreSalons({
        category: routing.category,
        filters,
        location: effectiveLocation,
        page,
        pageSize: hasExplicitSearchParams ? EXPLORE_PAGE_SIZE : 4,
        query,
        scopePolicy,
        sort,
        target: routing.target,
        locationSource,
      }, { routing }), initialHomePromise]);
  const initialFeed = emptyFeedPage();
  const utilityContent: ExploreUtilityContent = { bookingLoadError: false, notificationLoadError: false, notifications: [], unreadNotificationCount: 0, upcomingBooking: null };
  const extras = Promise.all([homeContentPromise, utilityContentPromise, quickActionsPromise]).then(([homeContent, utilityContent, quickActions]) => {
    const discoveryContent = buildExploreDiscoveryContent({ homeContent, initialFeed, searchResponse, utilityContent, workspaceLocation });
    const enriched = enrichExploreShowcaseContent({ discoveryContent, homeContent, initialFeed, searchResponse });
    return { discoveryContent: enriched.discoveryContent, homeContent: enriched.homeContent, quickActions };
  }).catch(() => ({ discoveryContent: { shortcuts: [] }, homeContent: emptyHomeContent(), quickActions: [] }));
  const discoveryContent = buildExploreDiscoveryContent({
    homeContent,
    initialFeed,
    searchResponse,
    utilityContent,
    workspaceLocation,
  });
  const showcaseContent = enrichExploreShowcaseContent({
    discoveryContent,
    homeContent,
    initialFeed,
    searchResponse,
  });
  const commentViewer = {
    identity: exploreCommentIdentity(context),
    canModerate: false,
    canReplyAsSalon: false,
    isAuthenticated: Boolean(context.user),
    userId: context.user?.id ?? null,
  };

  return (
    <>
    <ExploreProgressiveClient
      key={[
        showcaseContent.searchResponse.target,
        showcaseContent.searchResponse.contentQuery,
        JSON.stringify(showcaseContent.searchResponse.filters ?? {}),
        showcaseContent.searchResponse.displayQuery,
        showcaseContent.searchResponse.query,
        showcaseContent.searchResponse.location,
        showcaseContent.searchResponse.category,
        showcaseContent.searchResponse.page,
        sort,
        scopePolicy,
        locationSource,
        hasExplicitSearchParams ? "search" : "home",
      ].join(":")}
      extras={extras}
      feed={feedPromise}
      initial={{ commentViewer,
      initialSearchMode: hasExplicitSearchParams,
      initialLocationSource: locationSource,
      initialResponse: showcaseContent.searchResponse,
      discoveryContent: showcaseContent.discoveryContent,
      homeContent: showcaseContent.homeContent,
      hasUrlLocation: hasLocationParam || Boolean(queryLocation),
      initialFeed: showcaseContent.initialFeed,
      quickActions: [],
      workspaceLocation,
      }}
    />
    </>
  );
}

async function ExploreCoreResult({ content }: { content: ReturnType<typeof ExploreCorePage> }) { return await content; }

async function ExplorePage({ searchParams }: ExplorePageProps) {
  const params = await searchParams ?? {};
  if (parsePage(clean(stringParam(params.page))) > 1) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (key !== "page" && value !== undefined) query.set(key, stringParam(value) ?? "");
    if (query.has("type")) query.set("type", "salons");
    redirect(`/explore${query.size ? `?${query}` : ""}`);
  }
  // Start the authoritative load before awaiting the shared identity. Returning
  // this Suspense shell does not wait for search, optional rails or feed hydration.
  const content = runReadWithDeadline(ExploreCorePage({ searchParams: Promise.resolve(params) }), 15_000);
  // Identity may fail before the stream is returned; keep the parallel read handled.
  void content.catch(() => {});
  const context = await getCurrentBusinessContext();
  const source = stringParam(params.locationSource);
  return <Suspense fallback={<ExploreStartupShell query={clean(stringParam(params.q))} category={clean(stringParam(params.category)) || "All"}
    location={clean(stringParam(params.location))} source={source === "gps" || source === "activity" || source === "saved" || source === "workspace" ? source : params.location ? "manual" : "none"}
    viewerId={context.user?.id ?? null} />}><ExploreCoreResult content={content} /></Suspense>;
}

export default withExperiencePage(ExplorePage);
