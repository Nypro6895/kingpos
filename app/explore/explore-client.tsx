"use client";
import { useExploreEditorialFeed } from "./use-explore-editorial-feed";
import { selectExploreEditorialPosts } from "@/lib/explore-post-presentation";
import { SalonPostPreview } from "@/components/salon-post-preview";
import { ExploreInspirationPost } from "./explore-inspiration-post";
import { ExploreSalonCard } from "./explore-salon-card";
import { ExploreSocialProvider } from "@/components/explore-social";
import { PostIdentity } from "@/components/post-identity";

import type { ExploreFeedItem } from "@/types/explore";


import {SalonTrustLine,SalonVerifiedBadge} from "@/components/salon-trust-line";
import {salonPopularPrice} from "@/lib/salon-identity";
import { resolveNailCoverImage, isDefaultNailImage } from "@/lib/default-nail-images";
import { NailIllustrationCredit } from "@/components/nail-illustration-credit";

import { rememberExplorePreferenceAction } from "@/app/explore/actions";
import { readExploreStartupInteraction, clearExploreStartupInteraction } from "@/lib/explore-startup-interaction";
import { ExploreDeferred } from "./explore-deferred";
import { useExploreFirstContentPaint } from "@/lib/explore-viewport-priority";
import { ExploreDiscoveryFeed } from "@/app/explore/explore-discovery-feed";
import { ExploreAutoLoad } from "@/app/explore/explore-auto-load";
import { ExploreEditorialHeading } from "./explore-editorial";
import { ExploreLookEditorial, ExploreSalonDirectory, ExploreBookingEditorial } from "./explore-editorial-sections";
import { exploreEditorialHref } from "@/lib/explore-editorial";
import { NailInspirationFilters } from "@/app/explore/nail-inspiration";
import { useExploreSearchMedia } from "@/lib/use-explore-search-media";
import type { NailFilters } from "@/lib/nail-inspiration-catalog";
import { ExploreSearchOnwardActions, ExploreSearchRecommendations } from "@/app/explore/explore-search-recommendations";
import { ExploreSearchContext } from "@/app/explore/explore-search-context";
import { ExploreIntroHeadline, ExploreSalonPreview } from "@/app/explore/explore-intro";
import { exploreAlternatingShortcuts, exploreShortcutDiscovery } from "@/lib/explore-entry-presentation";
import { consumeExploreDocumentReload, EXPLORE_HOME_RESET_EVENT, exploreHomeUrl } from "@/lib/explore-entry-navigation";
import { ExploreSearchToolbar } from "@/app/explore/explore-search-toolbar";
import { exploreSearchOnwardLink, groupExploreSearchRecommendations, isExplorePrimarySearchResult } from "@/lib/explore-search-recommendations";
import { buildExploreCommittedSearchContext, type ExploreCommittedGpsContext } from "@/lib/explore-search-context";
import type { ExploreSearchSuggestion } from "@/lib/explore-search-suggestions";
import { fetchExploreSearchPage } from "@/lib/explore-search-client";
import { fetchExploreGpsArea } from "@/lib/location/explore-gps-area-client";
import type { ExploreGpsArea } from "@/types/explore-gps-area";
import { classifyExploreSearchError, exploreSearchErrorMessage } from "@/lib/explore-search-rpc";
import { ExploreBookButton, ExploreSalonLove } from "@/components/explore-account-actions";
import { ExploreAdSlot } from "@/components/explore-advertising";
import { SavePostAuthProvider, SavePostButton } from "@/app/saved-post/save-post-button";
import {
  ReylumiIcon,
  type ReylumiIconName,
} from "@/components/reylumi-icons";
import {
  type ExploreDiscoveryContent,
  type ExploreDiscoveryResultKind,
  type ExploreDiscoveryShortcut,
  type ExploreFeedPage,
  type ExploreHomeContent,
  type ExploreHomeSalon,
  type ExploreInspirationItem,
  type ExploreInitialLocation,
  type ExploreLocationSource,
  type ExploreMapSalon,
  type ExplorePopularService,
  type ExploreSearchResponse,
  type ExploreSearchResult,
} from "@/types/explore";
import {
  buildReylumiTrustSummary,
  compareReylumiTrustedSalons,
  type ReylumiExploreSearchOrder,
} from "@/lib/reylumi-trust";
import { PostActions } from "@/app/salon-profile/post-actions";
import { useHiddenPosts, postIdentity } from "@/components/post-safety";
import type { PostCommentTarget } from "@/types/post-comments";
import type { PostCommentViewer } from "@/types/post-comments";
import dynamic from "next/dynamic";
import { ExploreViewportImage as Image } from "./explore-viewport-image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

export type ExploreQuickAction = {
  description: string;
  href: string;
  label: string;
  tone: "dark" | "light";
};

export type ExploreClientProps = {
  commentViewer: PostCommentViewer;
  discoveryContent: ExploreDiscoveryContent;
  hasUrlLocation: boolean;
  homeContent: ExploreHomeContent;
  initialFeed: ExploreFeedPage;
  initialFeedPromise?: Promise<ExploreFeedPage | null>;
  startupExtrasPending?: boolean;
  initialLocationSource: ExploreLocationSource;
  initialResponse: ExploreSearchResponse;
  initialSearchMode: boolean;
  quickActions: ExploreQuickAction[];
  workspaceLocation: ExploreInitialLocation;
};

type GpsCoordinates = {
  latitude: number;
  longitude: number;
};

type GpsStatus = "denied" | "error" | "idle" | "locating" | "searching" | "unsupported";

const SAVED_LOCATION_KEY = "kingpos-explore-manual-location";
const GPS_PREFERENCE_KEY = "kingpos-explore-use-current-location";
const MAPTILER_BROWSER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";
const ExploreMap = dynamic(
  () => import("@/app/explore/explore-map").then((mod) => mod.ExploreMap),
  {
    loading: () => (
      <div className="grid min-h-[22rem] place-items-center rounded-2xl bg-surface-muted text-sm font-medium text-text-secondary ring-1 ring-divider-subtle">
        Loading map
      </div>
    ),
    ssr: false,
  },
);
const ExploreDiscoveryRail = dynamic(() => import("./customer-explore-utility-panel").then(module => module.ExploreDiscoveryRail));
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};
const STATE_NAMES_LONGEST_FIRST = Object.keys(STATE_NAME_TO_ABBR).sort(
  (a, b) => b.length - a.length,
);
const STATE_ABBRS = new Set(Object.values(STATE_NAME_TO_ABBR));
const SERVICE_DEFAULT_IMAGE = "/explore/service-defaults.png";
const QUICK_ACTION_VISUALS = [
  {
    position: "center",
    size: "cover",
    src: "/explore/quick-actions-dark.png",
  },
  {
    position: "0% center",
    size: "600% 100%",
    src: "/explore/service-defaults.png",
  },
  {
    position: "100% center",
    size: "600% 100%",
    src: "/explore/service-defaults.png",
  },
] as const;

type DesktopDiscoveryDateFilter = "any" | "today" | "tomorrow" | "weekend";
type DesktopDiscoveryFilterState = {
  availability: "any" | "bookable" | "open_now" | "today";
  date: DesktopDiscoveryDateFilter;
  location: string;
  more: string[];
  price: "any" | "under_50" | "under_75" | "under_100";
  trust: "any" | "silver" | "gold";
  time: "any" | "morning" | "afternoon" | "evening";
};
type DesktopPopularFilterChip = {
  category?: string;
  label: string;
  more?: string;
  query?: string;
};

function cleanCategory(category: string) {
  return category && category !== "All" ? category : "";
}

function formatStatePart(value: string) {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();

  if (STATE_ABBRS.has(upper)) {
    return upper;
  }

  return STATE_NAME_TO_ABBR[trimmed.toLowerCase()] ?? trimmed;
}

function formatDisplayLocation(value: string) {
  const location = value.trim().replace(/\s+/g, " ");

  if (!location) {
    return "";
  }

  const commaParts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (commaParts.length > 1) {
    return [
      ...commaParts.slice(0, -1),
      formatStatePart(commaParts[commaParts.length - 1]),
    ].join(", ");
  }

  const lowerLocation = location.toLowerCase();
  const directState = STATE_NAME_TO_ABBR[lowerLocation];

  if (directState) {
    return directState;
  }

  const trailingStateName = STATE_NAMES_LONGEST_FIRST.find((stateName) =>
    lowerLocation.endsWith(` ${stateName}`),
  );

  if (trailingStateName) {
    const prefix = location.slice(0, -trailingStateName.length).trim();
    return prefix
      ? `${prefix}, ${STATE_NAME_TO_ABBR[trailingStateName]}`
      : STATE_NAME_TO_ABBR[trailingStateName];
  }

  const words = location.split(" ");
  const lastWord = words[words.length - 1]?.toUpperCase();

  if (words.length > 1 && lastWord && STATE_ABBRS.has(lastWord)) {
    return `${words.slice(0, -1).join(" ")}, ${lastWord}`;
  }

  return location;
}

function formatDistance(distanceMiles: number | null) {
  if (distanceMiles === null) {
    return null;
  }

  if (distanceMiles < 10) {
    return `${distanceMiles.toFixed(1)} mi`;
  }

  return `${Math.round(distanceMiles)} mi`;
}

function phoneHref(phone: string | null) {
  if (!phone) {
    return null;
  }

  const normalized = phone.replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : null;
}

function salonProfileHref(salonId: string) {
  return `/explore/salons/${encodeURIComponent(salonId)}`;
}

function buildUrl(input: {
  category: string;
  location: string;
  page: number;
  pathname: string;
  query: string;
  searchParams: URLSearchParams;
}) {
  const params = new URLSearchParams(input.searchParams.toString());
  if (params.has("type")) params.set("type", "salons");
  const category = cleanCategory(input.category);

  if (input.query.trim()) {
    params.set("q", input.query.trim());
  } else {
    params.delete("q");
  }

  if (input.location.trim()) {
    params.set("location", input.location.trim());
  } else {
    params.set("location", "");
  }

  if (category) {
    params.set("category", category);
  } else {
    params.delete("category");
  }

  if (input.page > 1) {
    params.set("page", String(input.page));
  } else {
    params.delete("page");
  }

  const queryString = params.toString();
  return queryString ? `${input.pathname}?${queryString}` : input.pathname;
}

function formatSalonLocation(salon: ExploreSearchResult) {
  return formatDisplayLocation(
    [salon.city, salon.state].filter(Boolean).join(", "),
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatDuration(minutes: number) {
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainingMinutes = rounded % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${remainingMinutes}m`;
}

function salonInitials(name: string) {
  const cleanName = name.replace(/[^a-z0-9\s]/gi, " ").trim();

  return cleanName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "K";
}

function SalonLogoContent({ salon, size }: { salon: ExploreSearchResult; size: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const logoUrl = salon.logoImageUrl;

  return logoUrl && failedUrl !== logoUrl ? (
    <Image
      alt={`${salon.name} logo`}
      className="object-contain bg-white"
      fill
      sizes={`${size}px`}
      src={logoUrl}
      onError={() => setFailedUrl(logoUrl)}
    />
  ) : salonInitials(salon.name);
}

function isTechnicalFixtureLabel(value: string) {
  return /^\[e2e\]/i.test(value.trim()) || /\b20\d{10,}\b/.test(value);
}

function displaySalonName(name: string) {
  const trimmed = name.trim();

  if (isTechnicalFixtureLabel(trimmed)) {
    return "Featured salon";
  }

  return trimmed.replace(/\s+/g, " ") || "Featured salon";
}

function displayDiscoveryLabel(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed || isTechnicalFixtureLabel(trimmed)) {
    return null;
  }

  return trimmed.replace(/\s+/g, " ");
}

function cardServiceLabel(salon: ExploreSearchResult) {
  const candidates = [
    salon.featuredServiceName,
    salon.featuredServiceCategory,
    salon.serviceCategories[0],
    salon.serviceNames[0],
  ];

  for (const candidate of candidates) {
    const label = displayDiscoveryLabel(candidate);

    if (label) {
      return label;
    }
  }

  return null;
}

function featuredServiceLine(salon: ExploreSearchResult) {
  const candidates = [
    salon.featuredServiceName,
    salon.bookableServiceName,
    salon.serviceNames[0],
    salon.featuredServiceCategory,
    salon.serviceCategories[0],
  ];

  for (const candidate of candidates) {
    const label = displayDiscoveryLabel(candidate);

    if (label) {
      return label;
    }
  }

  return candidates.some(Boolean) ? "Featured service" : null;
}

function cardDetailLine(salon: ExploreSearchResult) {
  return salonPopularPrice(salon) ?? cardServiceLabel(salon) ?? "";
}


function salonAvailabilityLine(salon: ExploreSearchResult) {
  if (salon.nextAvailabilityLabel) {
    return salon.nextAvailabilityLabel;
  }

  if (salon.operatingStatus.isOpen) {
    return salon.operatingStatus.closesAtLocal
      ? `Open until ${salon.operatingStatus.closesAtLocal}`
      : "Open now";
  }

  return salon.operatingStatus.nextOpensLabel ?? null;
}

const ExplorePostContext = createContext<{viewerId: string | null; viewer: PostCommentViewer; items: ExploreInspirationItem[]}>({viewerId: null, viewer:{userId:null,isAuthenticated:false,canModerate:false,canReplyAsSalon:false},items: []});
function inspirationTarget(item: ExploreInspirationItem): PostCommentTarget {
  return {salonId: item.salonId, sourceId: item.contentId, sourceType: item.contentType === "look" ? "salon_profile_look" : "salon_profile_update", title: item.captionExcerpt};
}
function InspirationActions({item, onHidden}: {item: ExploreInspirationItem; onHidden?: () => void}) {
  const {viewerId} = useContext(ExplorePostContext);
  return <PostActions target={inspirationTarget(item)} salon={{ id: item.salonId, name: item.salonName }} viewerId={viewerId} onHidden={onHidden} onChanged={() => window.location.reload()} />;
}
function useInspirationHidden(item?: ExploreInspirationItem) {
  const {viewerId} = useContext(ExplorePostContext);
  const hidden = useHiddenPosts(viewerId);
  return Boolean(item && hidden.includes(postIdentity(inspirationTarget(item))));
}

function inspirationDetailHref(item: ExploreInspirationItem) {
  return item.salonHref
    ? `${item.salonHref}#${item.contentType}-${item.contentId}`
    : item.bookingHref ?? "/explore";
}

function inspirationPriceLabel(item: ExploreInspirationItem) {
  return item.bookingMeta.price !== null
    ? `${formatMoney(item.bookingMeta.price)}+`
    : null;
}

function inspirationDurationLabel(item: ExploreInspirationItem) {
  return item.bookingMeta.durationMinutes !== null
    ? formatDuration(item.bookingMeta.durationMinutes)
    : null;
}

function inspirationDistanceLabel(item: ExploreInspirationItem) {
  const distance = item.bookingMeta.distanceMiles;

  if (distance === null) {
    return null;
  }

  return distance < 10 ? `${distance.toFixed(1)} mi` : `${Math.round(distance)} mi`;
}


function inspirationAvailabilityLabel(item: ExploreInspirationItem) {
  const label = item.bookingMeta.availabilityLabel?.trim();
  return label && !/^request\s+(?:a|the)\s+time$/i.test(label) ? label : null;
}

function DesktopInspiredCard({item,onOpen,priority=false}:{item:ExploreInspirationItem;onOpen?:(item:ExploreInspirationItem)=>void;priority?:boolean;editorial?:boolean}) { const {viewer}=useContext(ExplorePostContext);return <ExploreInspirationPost item={item} viewer={viewer} onOpen={onOpen} priority={priority}/>; }

function DesktopExploreLanding({
  content,
  salons,
}: {
  content: ExploreHomeContent;
  salons: ExploreSearchResult[];
}) {
  const bookableCount = mergeHomeSalons(
    content.recommendedSalons,
    content.newSalons,
  ).filter((salon) => salon.bookingEnabled).length;

  return (
    <div className="hidden bg-[linear-gradient(180deg,#fffaf7_0%,#ffffff_85%)] px-8 pb-6 pt-4 xl:block">
      <div className="mx-auto grid w-full max-w-[92rem] overflow-hidden rounded-[1rem] bg-white shadow-[0_18px_50px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/75">
        <div className="grid gap-4 px-6 py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-center">
            <div className="min-w-0">
              <ExploreIntroHeadline />
              <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-text-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <ReylumiIcon className="h-4 w-4 text-brand-orange" name="message" />
                  Real reviews
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ReylumiIcon className="h-4 w-4 text-sky-500" name="verified" />
                  Identity verification
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ReylumiIcon className="h-4 w-4 text-brand-teal" name="calendar" />
                  Instant booking
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ReylumiIcon className="h-4 w-4 text-text-muted" name="check" />
                  Secure payments
                </span>
              </div>
            </div>
            <ExploreSalonPreview content={content} salons={salons} />
          </div>
          <p className="sr-only">
            Explore shows {content.inspiration.items.length} public looks and{" "}
            {bookableCount} bookable shops.
          </p>
        </div>
      </div>
    </div>
  );
}


function mergeHomeSalons(
  ...groups: ExploreHomeSalon[][]
): ExploreHomeSalon[] {
  const byId = new Map<string, ExploreHomeSalon>();

  for (const group of groups) {
    for (const salon of group) {
      if (!byId.has(salon.id)) {
        byId.set(salon.id, salon);
      }
    }
  }

  return [...byId.values()];
}

function topRatedSalons(
  content: ExploreHomeContent,
  nearYouSalons: ExploreHomeSalon[],
) {
  return mergeHomeSalons(
    nearYouSalons,
    content.recommendedSalons,
    content.newSalons,
  )
    .filter(
      (salon) =>
        buildReylumiTrustSummary(salon).qualityScore !== null,
    )
    .sort(compareReylumiTrustedSalons)
    .slice(0, 8);
}

function mergeExploreResults(
  ...groups: ExploreSearchResult[][]
): ExploreSearchResult[] {
  const byId = new Map<string, ExploreSearchResult>();

  for (const group of groups) {
    for (const salon of group) {
      if (!byId.has(salon.id)) {
        byId.set(salon.id, salon);
      }
    }
  }

  return [...byId.values()];
}

function availableTodayResults({
  content,
  nearYouSalons,
  searchResults,
}: {
  content: ExploreHomeContent;
  nearYouSalons: ExploreHomeSalon[];
  searchResults: ExploreSearchResult[];
}) {
  return mergeExploreResults(
    nearYouSalons,
    content.recommendedSalons,
    content.newSalons,
    searchResults,
  )
    .filter(
      (salon) =>
        salon.bookingEnabled && Boolean(salon.bookableServiceId),
    )
    .sort((left, right) => {
      const leftTime = left.nextAvailableAt
        ? new Date(left.nextAvailableAt).getTime()
        : Number.POSITIVE_INFINITY;
      const rightTime = right.nextAvailableAt
        ? new Date(right.nextAvailableAt).getTime()
        : Number.POSITIVE_INFINITY;

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return (
        Number(right.operatingStatus.isOpen) -
        Number(left.operatingStatus.isOpen)
      );
    })
    .slice(0, 12);
}

function underBudgetResults({
  budget,
  content,
  nearYouSalons,
  searchResults,
}: {
  budget: number;
  content: ExploreHomeContent;
  nearYouSalons: ExploreHomeSalon[];
  searchResults: ExploreSearchResult[];
}) {
  return mergeExploreResults(
    nearYouSalons,
    content.recommendedSalons,
    content.newSalons,
    searchResults,
  )
    .filter(
      (salon) =>
        typeof salon.startingPrice === "number" &&
        salon.startingPrice > 0 &&
        salon.startingPrice <= budget,
    )
    .sort(
      (left, right) =>
        (left.startingPrice ?? budget) - (right.startingPrice ?? budget),
    )
    .slice(0, 12);
}

function desktopPriceLimit(value: DesktopDiscoveryFilterState["price"]) {
  if (value === "under_50") {
    return 50;
  }

  if (value === "under_75") {
    return 75;
  }

  if (value === "under_100") {
    return 100;
  }

  return null;
}

function trustLevelRank(signals: Parameters<typeof buildReylumiTrustSummary>[0]) {
 return {empty:0,level_1:1,level_2:2,level_3:3,full:4}[buildReylumiTrustSummary(signals).level];
}

function desktopTrustMinimum(value: DesktopDiscoveryFilterState["trust"]) {
  if (value === "gold") {
    return 3;
  }

  if (value === "silver") {
    return 2;
  }

  return null;
}

function hasDesktopMoreFilter(
  filters: DesktopDiscoveryFilterState,
  value: string,
) {
  return filters.more.includes(value);
}

function dateFromIso(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesDesktopTimeFilter(
  value: string | null,
  label: string | null,
  time: DesktopDiscoveryFilterState["time"],
) {
  if (time === "any") {
    return true;
  }

  const lowerLabel = label?.toLowerCase() ?? "";

  if (lowerLabel.includes(time)) {
    return true;
  }

  const date = dateFromIso(value);

  if (!date) {
    return false;
  }

  const hour = date.getHours();

  if (time === "morning") {
    return hour >= 6 && hour < 12;
  }

  if (time === "afternoon") {
    return hour >= 12 && hour < 17;
  }

  return hour >= 17 && hour < 22;
}

function matchesDesktopDateFilter(
  value: string | null,
  label: string | null,
  dateFilter: DesktopDiscoveryDateFilter,
) {
  if (dateFilter === "any") {
    return true;
  }

  const lowerLabel = label?.toLowerCase() ?? "";
  const date = dateFromIso(value);

  if (dateFilter === "today") {
    return lowerLabel.includes("today") || lowerLabel.includes("open");
  }

  if (dateFilter === "tomorrow") {
    return lowerLabel.includes("tomorrow");
  }

  if (dateFilter === "weekend") {
    if (lowerLabel.includes("weekend")) {
      return true;
    }

    if (!date) {
      return false;
    }

    const day = date.getDay();

    return day === 0 || day === 6;
  }

  return true;
}

function salonMatchesAvailabilityFilter(
  salon: ExploreSearchResult,
  availability: DesktopDiscoveryFilterState["availability"],
) {
  if (availability === "any") {
    return true;
  }

  if (availability === "bookable") {
    return salon.bookingEnabled;
  }

  if (availability === "open_now") {
    return salon.operatingStatus.isOpen;
  }

  return (
    salon.operatingStatus.isOpen ||
    Boolean(
      salon.nextAvailabilityLabel?.toLowerCase().includes("today") ||
        salon.nextAvailabilityLabel?.toLowerCase().includes("spots"),
    )
  );
}

function salonMatchesDiscoveryCategory(
  salon: ExploreSearchResult,
  category: string,
) {
  const normalizedCategory = cleanCategory(category);

  if (!normalizedCategory) {
    return true;
  }

  const haystack = [
    salon.featuredServiceCategory,
    salon.featuredServiceName,
    salon.bookableServiceName,
    ...salon.serviceCategories,
    ...salon.serviceNames,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedCategory.toLowerCase());
}

function filterSalonsForDesktopDiscovery(
  salons: ExploreSearchResult[],
  filters: DesktopDiscoveryFilterState,
  selectedCategory: string,
) {
  const priceLimit = desktopPriceLimit(filters.price);
  const trustMinimum = desktopTrustMinimum(filters.trust);

  return salons.filter((salon) => {
    if (!salonMatchesDiscoveryCategory(salon, selectedCategory)) {
      return false;
    }

    if (
      priceLimit !== null &&
      (typeof salon.startingPrice !== "number" ||
        salon.startingPrice > priceLimit)
    ) {
      return false;
    }

    if (
      trustMinimum !== null &&
      (trustLevelRank(salon) < trustMinimum)
    ) {
      return false;
    }

    if (!salonMatchesAvailabilityFilter(salon, filters.availability)) {
      return false;
    }

    if (
      !matchesDesktopDateFilter(
        salon.nextAvailableAt,
        salon.nextAvailabilityLabel,
        filters.date,
      )
    ) {
      return false;
    }

    if (
      !matchesDesktopTimeFilter(
        salon.nextAvailableAt,
        salon.nextAvailabilityLabel,
        filters.time,
      )
    ) {
      return false;
    }

    if (hasDesktopMoreFilter(filters, "bookable") && !salon.bookingEnabled) {
      return false;
    }

    if (hasDesktopMoreFilter(filters, "open_now") && !salon.operatingStatus.isOpen) {
      return false;
    }

    if (hasDesktopMoreFilter(filters, "verified") && salon.identityVerified !== true) {
      return false;
    }

    if (
      hasDesktopMoreFilter(filters, "under_60") &&
      (typeof salon.startingPrice !== "number" || salon.startingPrice > 60)
    ) {
      return false;
    }

    if (hasDesktopMoreFilter(filters, "new") && !salon.isNew) {
      return false;
    }

    if (
      hasDesktopMoreFilter(filters, "trending") &&
      salon.latestMediaCreatedAt === null &&
      salon.sharedExperienceCount < 25
    ) {
      return false;
    }

    return true;
  });
}

type DiscoveryLook = Pick<ExploreInspirationItem, "serviceCategory" | "serviceName" | "salonName" | "captionExcerpt" | "bookingMeta" | "trust" | "bookingEnabled"> & { operatingStatus: Pick<ExploreInspirationItem["operatingStatus"], "isOpen"> };

function lookMatchesDiscoveryCategory(
  item: DiscoveryLook,
  category: string,
) {
  const normalizedCategory = cleanCategory(category);

  if (!normalizedCategory) {
    return true;
  }

  const haystack = [
    item.serviceCategory,
    item.serviceName,
    item.salonName,
    item.captionExcerpt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedCategory.toLowerCase());
}

function filterLooksForDesktopDiscovery<T extends DiscoveryLook>(
  items: T[],
  filters: DesktopDiscoveryFilterState,
  selectedCategory: string,
) {
  const priceLimit = desktopPriceLimit(filters.price);
  const trustMinimum = desktopTrustMinimum(filters.trust);

  return items.filter((item) => {
    if (!lookMatchesDiscoveryCategory(item, selectedCategory)) {
      return false;
    }

    if (
      priceLimit !== null &&
      (typeof item.bookingMeta.price !== "number" ||
        item.bookingMeta.price > priceLimit)
    ) {
      return false;
    }

    if (
      trustMinimum !== null &&
      (trustLevelRank(item.trust) < trustMinimum)
    ) {
      return false;
    }

    if (
      filters.availability === "bookable" &&
      !item.bookingEnabled
    ) {
      return false;
    }

    if (
      filters.availability === "open_now" &&
      !item.operatingStatus.isOpen
    ) {
      return false;
    }

    if (
      filters.availability === "today" &&
      !(
        item.operatingStatus.isOpen ||
        item.bookingMeta.availabilityLabel?.toLowerCase().includes("today") ||
        item.bookingMeta.availabilityLabel?.toLowerCase().includes("spots")
      )
    ) {
      return false;
    }

    if (
      !matchesDesktopDateFilter(
        null,
        item.bookingMeta.availabilityLabel,
        filters.date,
      )
    ) {
      return false;
    }

    if (
      !matchesDesktopTimeFilter(
        null,
        item.bookingMeta.availabilityLabel,
        filters.time,
      )
    ) {
      return false;
    }

    if (hasDesktopMoreFilter(filters, "bookable") && !item.bookingEnabled) {
      return false;
    }

    if (hasDesktopMoreFilter(filters, "open_now") && !item.operatingStatus.isOpen) {
      return false;
    }

    if (hasDesktopMoreFilter(filters, "verified") && item.trust.identityVerified !== true) {
      return false;
    }

    if (
      hasDesktopMoreFilter(filters, "under_60") &&
      (typeof item.bookingMeta.price !== "number" || item.bookingMeta.price > 60)
    ) {
      return false;
    }

    return true;
  });
}

function feedMatchesDesktopDiscovery(item: ExploreFeedItem, filters: DesktopDiscoveryFilterState, category: string) {
  const structured = Boolean(item.contentKey && item.discoveryScope);
  if (item.discoverySalon) return filterSalonsForDesktopDiscovery([item.discoverySalon], filters, structured ? "All" : category).length > 0;
  if (!structured && (filters.more.includes("new") || filters.more.includes("trending"))) return false;
  const trust = item.salon?.trust ?? { averageRating: null, noIssueRate: null, sharedExperienceCount: 0, uniqueCustomerCount: 0, verifiedVisitCount: 0 };
  return filterLooksForDesktopDiscovery([{
    serviceCategory: item.serviceCategory,
    serviceName: item.serviceName,
    salonName: item.salon?.name ?? "",
    captionExcerpt: item.caption,
    bookingMeta: item.bookingMeta,
    trust,
    bookingEnabled: item.booking?.eligible === true,
    operatingStatus: item.salon?.operatingStatus ?? { isOpen: false },
  }], filters, structured ? "All" : category).length > 0;
}

function desktopFilterChipsForCategory(
  category: string,
  inspirationItems: ExploreInspirationItem[],
  services: ExplorePopularService[],
): DesktopPopularFilterChip[] {
  const normalizedCategory = cleanCategory(category).toLowerCase();
  const keywordScores = new Map<string, { label: string; score: number }>();

  function addKeyword(label: string | null, score: number) {
    const cleanedLabel = label?.replace(/^#+/, "").replace(/\s+/g, " ").trim();

    if (!cleanedLabel || cleanedLabel.length < 3 || cleanedLabel.length > 28) {
      return;
    }

    const key = cleanedLabel.toLowerCase();
    const current = keywordScores.get(key);
    keywordScores.set(key, {
      label: current?.label ?? cleanedLabel,
      score: (current?.score ?? 0) + score,
    });
  }

  inspirationItems.forEach((item) => {
    const itemCategory = (item.serviceCategory ?? "").toLowerCase();

    if (normalizedCategory && itemCategory !== normalizedCategory) {
      return;
    }

    const popularity =
      1 + Math.log2(Math.max(1, (item.saveTarget.saveCount ?? 0) + 1));
    addKeyword(item.serviceName, popularity * 3);
    addKeyword(item.serviceCategory, popularity);

    for (const match of item.captionExcerpt?.matchAll(/#([a-z0-9][a-z0-9-]{2,27})/gi) ?? []) {
      addKeyword(match[1]?.replace(/-/g, " ") ?? null, popularity * 2);
    }
  });

  const postKeywordChips: DesktopPopularFilterChip[] = [...keywordScores.values()]
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .map(({ label }) => ({ label, query: label }));
  const serviceChips: DesktopPopularFilterChip[] = services
    .filter(
      (service) =>
        !normalizedCategory || service.category.toLowerCase() === normalizedCategory,
    )
    .sort((left, right) => right.salonCount - left.salonCount)
    .map((service) => ({
      label: service.category,
      query: service.category,
    }));
  const chips = [
    ...postKeywordChips,
    ...serviceChips,
    { label: "Open now", more: "available_today" },
    { label: "Under $60", more: "under_60" },
    { label: "Gold LUMI Truth", more: "trust_gold" },
  ];
  const seen = new Set<string>();

  return chips.filter((chip) => {
    const key = chip.label.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  }).slice(0, 9);
}

function sectionHeader({
  actionHref,
  actionLabel = "View all",
  subtitle,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actionHref ? (
        <Link prefetch={false}
          className="shrink-0 text-sm font-semibold text-brand-orange hover:text-brand-orange-hover"
          href={actionHref}
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function PublicSalonProfilesSection({ salons, selectedCategory = "", editorial = false, location = "" }: { salons: ExploreSearchResult[]; selectedCategory?: string; editorial?: boolean; location?: string }) {
  const profiles = salons.filter((salon) => salon.hasPublicProfile && UUID_PATTERN.test(salon.id) && salonMatchesDiscoveryCategory(salon, selectedCategory)).slice(0, editorial ? 6 : 12);
  if (!profiles.length) return null;
  return <section className="grid gap-3" data-testid="public-salon-profiles">
    {editorial ? <ExploreEditorialHeading eyebrow="Places to know" title="Recommended for you" description="Get to know the salons, explore their services and find your next favorite place." action={<Link prefetch={false} className="text-sm font-semibold text-brand-orange" href={exploreEditorialHref(selectedCategory, location)}>Explore salons <span aria-hidden>↗</span></Link>} /> : <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-text-primary">Salons</h2>
      <Link prefetch={false} className="shrink-0 text-sm font-semibold text-brand-orange" href={`/explore?${new URLSearchParams({ category: cleanCategory(selectedCategory) || "All" })}`}>View all →</Link>
    </div>}
    <div className={`grid sm:grid-cols-2 xl:grid-cols-3 ${editorial ? "mt-3 gap-5" : "gap-3"}`}>
      {profiles.map(salon => <ExploreSalonCard key={salon.id} salon={salon}/>)}
    </div>
  </section>;
}

function CompactSalonCard({salon}:{salon:ExploreHomeSalon}) { return <ExploreSalonCard salon={salon} compact/>; }

function CarouselArrow({
  direction,
  label,
  onClick,
}: {
  direction: "next" | "previous";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={[
        "absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-lg font-semibold text-text-secondary shadow-[0_10px_28px_rgba(35,25,22,0.09)] ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange lg:grid",
        direction === "previous" ? "left-2" : "right-2",
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden>{direction === "previous" ? "\u2039" : "\u203a"}</span>
    </button>
  );
}

function scrollCarousel(node: HTMLDivElement | null, direction: "next" | "previous") {
  if (!node) {
    return;
  }

  node.scrollBy({
    behavior: "smooth",
    left: (direction === "next" ? 1 : -1) * Math.max(260, node.clientWidth * 0.82),
  });
}

function TopRatedCarousel({ salons }: { salons: ExploreHomeSalon[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative min-w-0 overflow-hidden">
      <div
        className="no-scrollbar min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth pb-3"
        ref={scrollerRef}
      >
        <div className="flex snap-x snap-mandatory gap-3">
          {salons.map((salon) => (
            <CompactSalonCard key={salon.id} salon={salon} />
          ))}
        </div>
      </div>
      <CarouselArrow
        direction="previous"
        label="Previous top rated salons"
        onClick={() => scrollCarousel(scrollerRef.current, "previous")}
      />
      <CarouselArrow
        direction="next"
        label="Next top rated salons"
        onClick={() => scrollCarousel(scrollerRef.current, "next")}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-12 bg-[linear-gradient(90deg,rgba(255,253,251,0),var(--page-background))] sm:block"
      />
    </div>
  );
}

function TopRatedSalonsSection({
  content,
  nearYouSalons,
}: {
  content: ExploreHomeContent;
  nearYouSalons: ExploreHomeSalon[];
}) {
  const salons = topRatedSalons(content, nearYouSalons);

  if (salons.length === 0) {
    return (
      <section className="grid gap-3" data-testid="top-rated-salons">
        {sectionHeader({
          subtitle: "Salons will appear here when Experience signals are available.",
          title: "Top Rated Salons",
        })}
        <div className="rounded-2xl border border-dashed border-divider-subtle bg-surface-elevated p-5 text-sm text-text-secondary">
          No salons have enough Experience signals yet.
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-3" data-testid="top-rated-salons">
      {sectionHeader({
        actionHref: "/explore",
        subtitle: "Based on LUMI Truth, customer feedback and repeat visits.",
        title: "Top Rated Salons",
      })}
      <TopRatedCarousel salons={salons} />
    </section>
  );
}

function mapSalonToMapSalon(salon: ExploreSearchResult): ExploreMapSalon | null {
  if (
    typeof salon.latitude !== "number" ||
    typeof salon.longitude !== "number" ||
    !Number.isFinite(salon.latitude) ||
    !Number.isFinite(salon.longitude)
  ) {
    return null;
  }

  return {
    bookingHref:salon.bookingEnabled?salon.bookingHref:null,
    phoneHref:salon.phone?`tel:${salon.phone}`:null,
    coverImageUrl: salon.coverImageUrl,
    distanceMiles: salon.distanceMiles,
    href:
      UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
        ? salonProfileHref(salon.id)
        : null,
    id: salon.id,
    latitude: salon.latitude,
    locationLabel: formatSalonLocation(salon),
    longitude: salon.longitude,
    name: salon.name,
    operatingStatus: salon.operatingStatus,
    serviceLabel: cardDetailLine(salon) || null,
    trust: {
            identityVerified: salon.identityVerified,
      popularServiceName: salon.popularServiceName,
      popularServiceMinimumPrice: salon.popularServiceMinimumPrice,
      popularServiceMaximumPrice: salon.popularServiceMaximumPrice,
      completedBookingCount: salon.completedBookingCount,
      trustEvidence: salon.trustEvidence ?? null,
      averageRating: salon.averageRating,
      noIssueRate: salon.reputationNoIssueRate,
      sharedExperienceCount: salon.sharedExperienceCount,
      uniqueCustomerCount: salon.uniqueCustomerCount,
      verifiedVisitCount: salon.verifiedVisitCount,
    },
  };
}



function SalonCard({salon}:{featured?:boolean;imageHref?:string|null;rankAriaLabel:string;rankLabel:string;salon:ExploreSearchResult}) { return <ExploreSalonCard salon={salon}/>; }

function inspirationLocation(item: ExploreInspirationItem) {
  return formatDisplayLocation(
    [item.salonCity, item.salonState].filter(Boolean).join(", "),
  );
}

function inspirationServiceLabel(item: ExploreInspirationItem) {
  return item.serviceName ?? item.serviceCategory;
}

function hasMeasuredDistance(results: ExploreSearchResult[]) {
  return results.some((salon) => salon.distanceMiles !== null);
}

type SearchOrderMode = ReylumiExploreSearchOrder;

type SearchShortcut = {
  category?: string;
  label: string;
  location?: string;
  query?: string;
};

function quotedQuery(query: string) {
  const trimmedQuery = query.trim();
  return trimmedQuery ? `"${trimmedQuery}"` : "";
}

function resultSummary(input: {
  bestCount: number;
  category: string;
  hasAnyResults: boolean;
  hasPrimaryResults: boolean;
  location: string;
  nearbyCount: number;
  query: string;
  recommendedCount: number;
}) {
  const location = input.location.trim();
  if (!input.hasPrimaryResults) return "No results found";
  return input.query.trim() ? "Results for " + quotedQuery(input.query) + (location ? " in " + location : "") : location ? "Salons in " + location : "Recommended salons on Reylumi";
}

type SearchRankKind = "area" | "best" | "recommended";

function searchRankBadge(kind: SearchRankKind, index: number) {
  const rank = index + 1;

  if (kind === "best") {
    return {
      ariaLabel:
        rank === 1
          ? "Rank 1 best match"
          : `Rank ${rank} in best matches`,
      label: rank === 1 ? "#1 Best match" : `#${rank}`,
    };
  }

  if (kind === "area") {
    return {
      ariaLabel: `Rank ${rank} in this area`,
      label: rank === 1 ? "#1 in this area" : `#${rank}`,
    };
  }

  return {
    ariaLabel: rank === 1 ? "Recommended salon" : `Recommended salon ${rank}`,
    label: rank === 1 ? "Recommended" : `#${rank} Recommended`,
  };
}

function homeRankBadge(salon: ExploreHomeSalon, index: number) {
  if (salon.homeSection === "near_you") {
    const rank = salon.homeRank || index + 1;

    return {
      ariaLabel: `Near you salon ${rank}`,
      label: rank === 1 ? "#1 Near you" : `#${rank} Near you`,
    };
  }

  if (salon.homeSection === "new") {
    return {
      ariaLabel: "New salon on Reylumi",
      label: "New on Reylumi",
    };
  }

  const rank = salon.homeRank || index + 1;

  return {
    ariaLabel: `Recommended salon ${rank}`,
    label: `#${rank} Recommended`,
  };
}

function ResultSection({
  description,
  hideHeading = false,
  rankKind,
  results,
  title,
}: {
  description?: string;
  hideHeading?: boolean;
  rankKind: SearchRankKind;
  results: ExploreSearchResult[];
  title: string;
}) {
  if (results.length === 0) {
    return null;
  }

  return (
    <section className={hideHeading ? "grid" : "grid gap-4"}>
      <div className={hideHeading ? "sr-only" : undefined}>
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm font-medium text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-12">
        {results.map((salon, index) => {
          const featured = index === 0 && results.length >= 3;
          const rank = searchRankBadge(rankKind, index);

          return (
            <div
              className={featured ? "min-w-0 xl:col-span-7" : index === 1 && results.length >= 3 ? "min-w-0 xl:col-span-5" : "min-w-0 xl:col-span-4"}
              key={`${salon.resultGroup}:${salon.id}`}
            >
              <SalonCard
                featured={featured}
                rankAriaLabel={rank.ariaLabel}
                rankLabel={rank.label}
                salon={salon}
              />
              {(index + 1) % 4 === 0 || (results.length < 4 && index === results.length - 1) ? <ExploreAdSlot slotIndex={Math.floor(index / 4)} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SearchRecommendationSections({ results, location, renderCards }: {
  results: ExploreSearchResult[];
  location: string;
  renderCards?: (results: ExploreSearchResult[]) => ReactNode;
}) {
  return groupExploreSearchRecommendations(results, location).map((group, index) => (
    <ExploreSearchRecommendations key={`${group.key}:${index}`} title={group.title}>
      {renderCards ? renderCards(group.results) : <ResultSection hideHeading rankKind="recommended" results={group.results} title={group.title} />}
    </ExploreSearchRecommendations>
  ));
}

function SearchRefinementBar({
  children,
  category,
  location,
  mode,
  onModeChange,
  onClear,
  onShortcut,
  query,
  workspaceLocation,
}: {
  children?: ReactNode;
  category: string;
  location: string;
  mode: SearchOrderMode;
  onModeChange: (mode: SearchOrderMode) => void;
  onClear: () => void;
  onShortcut: (input: {
    category?: string;
    location?: string;
    query?: string;
  }) => void;
  query: string;
  workspaceLocation: ExploreInitialLocation;
}) {
  const displayLocation = formatDisplayLocation(
    location.trim() || workspaceLocation.label,
  );
  const locationName = displayLocation.split(",")[0]?.trim();
  const normalizedCategory = cleanCategory(category);
  const shortcutLocation = displayLocation || workspaceLocation.label;
  const shortcutQuery = query.trim();
  const ordering: { label: string; mode: SearchOrderMode }[] = [
    { label: "Best match", mode: "relevance" },
    { label: "Trusted first", mode: "trusted" },
    { label: "Open booking", mode: "bookable" },
    { label: "Closest", mode: "closest" },
  ];
  const shortcutCandidates: Array<SearchShortcut | null> = [
    normalizedCategory
      ? null
      : { category: "Nails", label: "Nails" },
    shortcutQuery.toLowerCase() === "full-set"
      ? null
      : { label: "Full-set", query: "Full-Set" },
    shortcutLocation
      ? {
          label: locationName ? `Near ${locationName}` : "Near this area",
          location: shortcutLocation,
        }
      : null,
    shortcutQuery || normalizedCategory
      ? { label: "Clear term", query: "", category: "All" }
      : null,
  ];
  const shortcuts = shortcutCandidates.filter(
    (shortcut): shortcut is SearchShortcut => Boolean(shortcut),
  );

  return (
    <section
      aria-label="Search refinement"
      className="flex flex-wrap items-start gap-2"
      data-testid="explore-search-refinement"
    >
      {children}
      <select aria-label="Sort results" value={mode} onChange={event => onModeChange(event.target.value as SearchOrderMode)}
        className="min-h-11 rounded-full bg-surface-elevated px-3 text-sm font-medium text-text-primary outline-none ring-1 ring-divider-subtle focus:ring-brand-orange">
        {ordering.map(item => <option key={item.mode} value={item.mode}>{item.label}</option>)}
      </select>
        <details className="min-w-0 flex-1">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center rounded-full bg-surface-elevated px-4 text-sm font-medium text-text-primary ring-1 ring-divider-subtle">Filters</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onClear} className="min-h-11 rounded-full bg-white px-3 text-xs font-semibold text-text-primary ring-1 ring-divider-subtle hover:text-brand-orange">Clear filters</button>
          {shortcuts.map((shortcut) => (
            <button
              className="min-h-11 rounded-full bg-white px-3 text-xs font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              key={`${shortcut.label}:${shortcut.query ?? ""}:${shortcut.location ?? ""}:${shortcut.category ?? ""}`}
              onClick={() => onShortcut(shortcut)}
              type="button"
            >
              {shortcut.label}
            </button>
          ))}
          </div>
        </details>
    </section>
  );
}

function InspirationPreview({ item, onClose }: { item: ExploreInspirationItem; onClose: () => void }) {
  const { viewer } = useContext(ExplorePostContext);
  return <SalonPostPreview key={item.contentId} item={item} viewer={viewer} onClose={onClose}
    location={inspirationLocation(item)} service={inspirationServiceLabel(item)} price={inspirationPriceLabel(item)}
    duration={inspirationDurationLabel(item)} href={inspirationDetailHref(item)} />;
}

function NearYouHomeSection({
  results,
  userCoordinates,
}: {
  results: ExploreHomeSalon[];
  userCoordinates: GpsCoordinates | null;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [preferredSelectedSalonId, setPreferredSelectedSalonId] =
    useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const mapTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileMapDialogRef = useRef<HTMLDivElement | null>(null);
  const mobileMapCloseRef = useRef<HTMLButtonElement | null>(null);
  const mapSalons = useMemo(
    () =>
      results
        .map(mapSalonToMapSalon)
        .filter((salon): salon is ExploreMapSalon => Boolean(salon)),
    [results],
  );
  const mapAvailable = Boolean(MAPTILER_BROWSER_KEY && mapSalons.length > 0);
  const selectedSalonId = results.some(
    (salon) => salon.id === preferredSelectedSalonId,
  )
    ? preferredSelectedSalonId
    : results[0]?.id ?? null;
  const selectedSalon =
    results.find((salon) => salon.id === selectedSalonId) ?? results[0] ?? null;
  const selectSalon = useCallback((salonId: string) => {
    setPreferredSelectedSalonId(salonId);
  }, []);
  const closeMap = useCallback(() => {
    setMapOpen(false);
    queueMicrotask(() => mapTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!selectedSalonId) {
      return;
    }

    cardRefs.current.get(selectedSalonId)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedSalonId]);

  useEffect(() => {
    if (!mapOpen || !mapAvailable) {
      return;
    }

    if (!window.matchMedia("(min-width: 1024px)").matches) {
      queueMicrotask(() => mobileMapCloseRef.current?.focus());
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMap();
        return;
      }

      if (
        event.key !== "Tab" ||
        !mobileMapDialogRef.current ||
        window.matchMedia("(min-width: 1024px)").matches
      ) {
        return;
      }

      const focusableElements = Array.from(
        mobileMapDialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeMap, mapAvailable, mapOpen]);

  if (results.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Near you</h2>
          <p className="mt-1 text-sm font-medium text-text-secondary">
            Sorted by real distance from your current location.
          </p>
        </div>
        {mapAvailable ? (
          <button
            className="w-fit rounded-full bg-surface-elevated px-3 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => setMapOpen((current) => !current)}
            ref={mapTriggerRef}
            type="button"
          >
            {mapOpen ? "Hide map" : "View map"}
          </button>
        ) : null}
      </div>

      {mapOpen && mapAvailable ? (
        <>
          <div className="hidden lg:block">
            <ExploreMap
              maptilerKey={MAPTILER_BROWSER_KEY}
              onSelectSalon={selectSalon}
              salons={mapSalons}
              selectedSalonId={selectedSalon?.id ?? null}
              userCoordinates={userCoordinates}
            />
          </div>
          <div
            aria-labelledby="near-you-map-title"
            aria-modal="true"
            className="fixed inset-0 z-50 grid grid-rows-[auto_minmax(0,1fr)] bg-surface lg:hidden"
            ref={mobileMapDialogRef}
            role="dialog"
          >
            <div className="flex items-center justify-between gap-3 bg-surface-elevated px-4 py-3 shadow-[0_10px_30px_rgba(80,47,36,0.055)]">
              <div className="min-w-0">
                <p
                  className="text-sm font-semibold text-text-primary"
                  id="near-you-map-title"
                >
                  Near you map
                </p>
                {selectedSalon ? (
                  <p className="truncate text-xs font-medium text-text-secondary">
                    {selectedSalon.name}
                  </p>
                ) : null}
              </div>
              <button
                className="rounded-full bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle"
                onClick={closeMap}
                ref={mobileMapCloseRef}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 p-3">
              <ExploreMap
                maptilerKey={MAPTILER_BROWSER_KEY}
                onSelectSalon={selectSalon}
                salons={mapSalons}
                selectedSalonId={selectedSalon?.id ?? null}
                userCoordinates={userCoordinates}
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {results.map((salon, index) => {
          const featured = index === 0 && results.length >= 3;
          const rank = homeRankBadge(salon, index);
          const selected = salon.id === selectedSalonId;

          return (
            <div
              className={[
                featured ? "md:col-span-2 xl:col-span-2" : "",
                "rounded-[1.15rem] transition",
                selected ? "ring-2 ring-brand-teal ring-offset-2 ring-offset-page-background" : "",
              ].join(" ")}
              key={`${salon.homeSection}:${salon.id}`}
              onFocusCapture={() => setPreferredSelectedSalonId(salon.id)}
              onMouseEnter={() => setPreferredSelectedSalonId(salon.id)}
              ref={(node) => {
                if (node) {
                  cardRefs.current.set(salon.id, node);
                } else {
                  cardRefs.current.delete(salon.id);
                }
              }}
            >
              <SalonCard
                featured={featured}
                rankAriaLabel={rank.ariaLabel}
                rankLabel={rank.label}
                salon={salon}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function salonMatchesCategory(salon: ExploreHomeSalon, category: string) {
  const needle = category.toLowerCase();
  const haystack = [
    salon.featuredServiceCategory,
    salon.featuredServiceName,
    salon.bookableServiceName,
    ...salon.serviceCategories,
    ...salon.serviceNames,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

const SERVICE_VISUAL_RULES = [
  {
    index: 1,
    keywords: ["pedicure", "pedi", "foot", "feet", "toe", "toes"],
  },
  {
    index: 0,
    keywords: [
      "manicure",
      "mani",
      "nail",
      "nails",
      "gel",
      "acrylic",
      "dip",
      "polish",
      "add on",
      "addon",
      "add-on",
    ],
  },
  {
    index: 4,
    keywords: ["brow", "brows", "eyebrow", "eyebrows", "wax", "thread"],
  },
  {
    index: 3,
    keywords: ["eye", "lash", "lashes", "eyelash", "eyelashes"],
  },
  {
    index: 2,
    keywords: ["hair", "color", "balayage", "blowout", "cut", "style"],
  },
  {
    index: 5,
    keywords: ["massage", "spa", "facial", "body", "relax"],
  },
] as const;

function normalizedServiceTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function serviceDefaultVisualIndex(category: string) {
  const value = normalizedServiceTitle(category);

  return (
    SERVICE_VISUAL_RULES.find((rule) =>
      rule.keywords.some((keyword) => value.includes(keyword)),
    )?.index ?? 0
  );
}

function serviceDefaultVisualStyle(category: string) {
  const index = serviceDefaultVisualIndex(category);
  const position = `${(index / 5) * 100}% center`;

  return {
    backgroundImage: `url(${SERVICE_DEFAULT_IMAGE})`,
    backgroundPosition: position,
    backgroundRepeat: "no-repeat",
    backgroundSize: "600% 100%",
  };
}

function popularServiceStartingPrice(
  category: string,
  salons: ExploreHomeSalon[],
) {
  const prices = salons
    .filter((salon) => salonMatchesCategory(salon, category))
    .map((salon) => salon.startingPrice)
    .filter((price): price is number => typeof price === "number");

  return prices.length > 0 ? Math.min(...prices) : null;
}

function PopularServiceCard({
  onSelectCategory,
  salons,
  service,
}: {
  onSelectCategory: (category: string) => void;
  salons: ExploreHomeSalon[];
  service: ExplorePopularService;
}) {
  const startingPrice = popularServiceStartingPrice(service.category, salons);

  return (
    <button
      aria-label={`Search salons offering ${service.category}`}
      className="group grid min-h-[9.75rem] overflow-hidden rounded-[0.95rem] bg-surface-elevated text-left shadow-[0_8px_22px_rgba(35,25,22,0.04)] ring-1 ring-divider-subtle/75 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(35,25,22,0.07)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      onClick={() => onSelectCategory(service.category)}
      type="button"
    >
      <span
        aria-hidden
        className="relative block aspect-[16/9] overflow-hidden bg-surface-muted bg-cover transition duration-300 group-hover:scale-[1.015]"
        style={serviceDefaultVisualStyle(service.category)}
      >
        <span className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(0deg,rgba(36,27,31,0.34),rgba(36,27,31,0))]" />
      </span>
      <span className="grid gap-1.5 p-3">
        <span className="truncate text-base font-semibold text-text-primary">
          {service.category}
        </span>
        <span className="text-sm text-text-secondary">
          {startingPrice !== null
            ? `Starting ${formatMoney(startingPrice)}`
            : "Starting price varies"}
        </span>
        <span className="text-xs font-medium text-text-muted">
          {service.salonCount} nearby salon{service.salonCount === 1 ? "" : "s"}
        </span>
        <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-brand-orange-soft px-3 py-1 text-xs font-semibold text-brand-orange">
          View all
        </span>
      </span>
    </button>
  );
}

function PopularServicesSection({
  onSelectCategory,
  salons,
  services,
}: {
  onSelectCategory: (category: string) => void;
  salons: ExploreHomeSalon[];
  services: ExplorePopularService[];
}) {
  if (services.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2.5" data-testid="popular-services">
      <div>
        <h2 className="text-xl font-semibold text-text-primary">
          Explore by Service
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          Start with the look or care you want, then compare salons.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {services.map((service) => (
          <PopularServiceCard
            key={service.category}
            onSelectCategory={onSelectCategory}
            salons={salons}
            service={service}
          />
        ))}
      </div>
    </section>
  );
}

function discoveryResultTitle(kind: ExploreDiscoveryResultKind) {
  if (kind === "available_today") {
    return "Booking options";
  }

  if (kind === "near_you") {
    return "Near you";
  }

  if (kind === "top_rated") {
    return "Top artists";
  }

  if (kind === "trending") {
    return "Fresh looks";
  }

  if (kind === "under_60") {
    return "Under $60";
  }

  return "Recommended salons";
}

function ExploreDiscoveryResults({
  content,
  commentViewer,
  selectedCategory,
  location,
  strictLocation,
  gpsCoordinates,
  kind,
  nearYouSalons,
  onClear,
  onCurrentLocation,
  searchResults,
}: {
  content: ExploreHomeContent;
  commentViewer: PostCommentViewer;
  selectedCategory: string;
  location: string;
  strictLocation: boolean;
  gpsCoordinates: GpsCoordinates | null;
  kind: ExploreDiscoveryResultKind;
  nearYouSalons: ExploreHomeSalon[];
  onClear: () => void;
  onCurrentLocation: () => void;
  searchResults: ExploreSearchResult[];
}) {
  const discovery = kind === "trending" || kind === "recommended" ? exploreShortcutDiscovery({
    kind, category: selectedCategory, location, strictLocation, coordinates: gpsCoordinates,
  }) : null;
  const discoveryKey = discovery ? `shortcut:${kind}:${JSON.stringify(discovery)}:${commentViewer.userId}` : "";
  const availableResults = availableTodayResults({
    content,
    nearYouSalons,
    searchResults,
  });
  const under60Results = underBudgetResults({
    budget: 60,
    content,
    nearYouSalons,
    searchResults,
  });

  return (
    <section
      className="mx-auto grid w-full max-w-none gap-4 px-4 py-4 sm:px-6 lg:pl-8 lg:pr-3"
      data-testid="explore-discovery-results"
    >
      <div className="mx-auto flex w-full max-w-[40rem] items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-brand-teal">
            Discovery
          </p>
          <h2 className="mt-1 text-xl font-semibold text-text-primary">
            {discoveryResultTitle(kind)}
          </h2>
        </div>
        <button
          className="shrink-0 rounded-full bg-surface-elevated px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          onClick={onClear}
          type="button"
        >
          Back
        </button>
      </div>

      {kind === "near_you" ? (
        nearYouSalons.length > 0 ? (
          <NearYouHomeSection
            results={nearYouSalons}
            userCoordinates={gpsCoordinates}
          />
        ) : (
          <div className="mx-auto w-full max-w-[40rem]">
            <ExploreNotice
              action={
                <button
                  className="rounded-full bg-surface-elevated px-3 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange"
                  onClick={onCurrentLocation}
                  type="button"
                >
                  Use current location
                </button>
              }
              title="Use current location for nearby results"
            >
              Turn on location to sort active public salons by real distance.
            </ExploreNotice>
          </div>
        )
      ) : null}

      {kind === "available_today" ? (
        availableResults.length > 0 ? (
          <ResultSection
            description={`${availableResults.length} bookable option${
              availableResults.length === 1 ? "" : "s"
            }`}
            rankKind="best"
            results={availableResults}
            title="Booking options"
          />
        ) : (
          <div className="mx-auto w-full max-w-[40rem]">
            <ExploreNotice title="No booking options match yet">
              Try another area or compare salon profiles.
            </ExploreNotice>
          </div>
        )
      ) : null}

      {kind === "top_rated" ? (
        <TopRatedSalonsSection
          content={content}
          nearYouSalons={nearYouSalons}
        />
      ) : null}

      {discovery ? <ExploreDiscoveryFeed key={discoveryKey} sessionKey={discoveryKey}
        discovery={discovery} viewer={commentViewer} showOrderControls={false}
        emptyMessage="No public content matches this category and area yet. Try another area or category." /> : null}

      {kind === "under_60" ? (
        under60Results.length > 0 ? (
          <ResultSection
            description={`${under60Results.length} value-friendly option${
              under60Results.length === 1 ? "" : "s"
            }`}
            rankKind="recommended"
            results={under60Results}
            title="Under $60"
          />
        ) : (
          <div className="mx-auto w-full max-w-[40rem]">
            <ExploreNotice title="No services under $60 yet">
              Value-friendly services will appear here when salons publish
              starting prices.
            </ExploreNotice>
          </div>
        )
      ) : null}
      {!discovery ? <ExploreDiscoveryFeed
        discovery={{ intent: "discover", category: selectedCategory, location, strictLocation, latitude: gpsCoordinates?.latitude, longitude: gpsCoordinates?.longitude }}
        sessionKey={`shortcut-continuation:${kind}:${selectedCategory}:${location}:${commentViewer.userId}`}
        viewer={commentViewer}
        excludeKeys={(kind === "available_today" ? availableResults : kind === "under_60" ? under60Results : nearYouSalons).map(salon => "salon:" + salon.id)}
      /> : null}
    </section>
  );
}

function DesktopDiscoveryFilterBar({
  filters,
  inspirationItems,
  onChange,
  onSearchShortcut,
  onSelectCategory,
  selectedCategory,
  services,
}: {
  filters: DesktopDiscoveryFilterState;
  inspirationItems: ExploreInspirationItem[];
  onChange: (filters: DesktopDiscoveryFilterState) => void;
  onSearchShortcut: (input: {
    category?: string;
    location?: string;
    query?: string;
  }) => void;
  onSelectCategory: (category: string) => void;
  selectedCategory: string;
  services: ExplorePopularService[];
}) {
  const chips = desktopFilterChipsForCategory(
    selectedCategory,
    inspirationItems,
    services,
  );

  function update(next: Partial<DesktopDiscoveryFilterState>) {
    onChange({
      ...filters,
      ...next,
    });
  }

  function applyChip(chip: DesktopPopularFilterChip) {
    if (chip.more === "available_today") {
      update({
        availability: "open_now",
        date: "any",
      });
      return;
    }

    if (chip.more === "under_60") {
      update({
        more: filters.more.includes("under_60")
          ? filters.more
          : [...filters.more, "under_60"],
        price: "under_75",
      });
      return;
    }

    if (chip.more === "trust_gold") {
      update({ trust: "gold" });
      return;
    }

    if (chip.category) {
      onSelectCategory(chip.category);
      return;
    }

    if (chip.query) {
      onSearchShortcut({
        category: cleanCategory(selectedCategory) || undefined,
        location: filters.location,
        query: chip.query,
      });
    }
  }

  return (
    <section
      aria-label="Popular Explore keywords"
      className="rounded-[0.9rem] bg-white p-3 shadow-[0_10px_28px_rgba(35,25,22,0.04)] ring-1 ring-divider-subtle/75"
      data-testid="desktop-discovery-filters"
    >
      <div className="no-scrollbar flex min-w-0 gap-2 overflow-x-auto p-0.5">
          {chips.map((chip) => (
            <button
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-muted px-3 text-xs font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              key={chip.label}
              onClick={() => applyChip(chip)}
              type="button"
            >
              <ReylumiIcon className="h-3.5 w-3.5" name="sparkle" />
              {chip.label}
            </button>
          ))}
      </div>
    </section>
  );
}

function DesktopSectionSkeleton({ title }: { title: string }) {
  return (
    <section
      aria-hidden
      className="grid gap-3 rounded-[1rem] bg-white p-4 shadow-[0_14px_34px_rgba(35,25,22,0.035)] ring-1 ring-divider-subtle/70"
    >
      <div>
        <div className="h-5 w-44 rounded-full bg-surface-muted" />
        <div className="mt-2 h-4 w-72 rounded-full bg-surface-muted" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            className="grid gap-3 rounded-[0.95rem] bg-surface-muted p-3"
            key={item}
          >
            <div className="aspect-[4/3] rounded-[0.8rem] bg-white/70" />
            <div className="h-4 w-4/5 rounded-full bg-white/80" />
            <div className="h-3 w-3/5 rounded-full bg-white/70" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading {title}</span>
    </section>
  );
}

function DesktopLooksNearYouSection({
  looks,
  mapSalons,
  category,
  location,
  onExplore,
  userCoordinates,
  mode = "fresh",
  posts,
}: {
  posts?: ExploreFeedItem[];
  mode?: "fresh" | "recommended";
  looks: ExploreInspirationItem[];
  mapSalons: ExploreMapSalon[];
  category: string;
  location: string;
  onExplore: () => void;
  userCoordinates: GpsCoordinates | null;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedItem, setSelectedItem] =
    useState<ExploreInspirationItem | null>(null);
  const [preferredSelectedSalonId, setPreferredSelectedSalonId] =
    useState<string | null>(null);
  const mapAvailable = Boolean(MAPTILER_BROWSER_KEY && mapSalons.length > 0);
  const { viewerId, viewer } = useContext(ExplorePostContext);
  const hidden = useHiddenPosts(viewerId);
  const visibleLooks = looks.filter(item => !hidden.includes(postIdentity(inspirationTarget(item)))).filter((item, index, items) => items.findIndex(other => other.imageUrl === item.imageUrl) === index).slice(0, 6);
  const selectedSalonId = mapSalons.some(
    (salon) => salon.id === preferredSelectedSalonId,
  )
    ? preferredSelectedSalonId
    : mapSalons[0]?.id ?? null;

  return (
    <section className="grid gap-5" data-testid="desktop-looks-near-you">
      <div className={mapOpen && mapAvailable ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]" : "grid gap-5"}>
        <ExploreLookEditorial posts={posts?.filter(item=>!hidden.includes(`${item.sourceType === "personal" ? "beauty_post" : item.contentType === "update" ? "salon_profile_update" : "salon_profile_look"}:${item.contentId}`))} viewer={viewer} looks={visibleLooks} category={category} location={location} onExplore={onExplore} onOpen={setSelectedItem} mode={mode}/>
          {mapOpen && mapAvailable ? (
            <div className="sticky top-4 hidden self-start xl:block">
              <ExploreMap
                maptilerKey={MAPTILER_BROWSER_KEY}
                onSelectSalon={setPreferredSelectedSalonId}
                salons={mapSalons}
                selectedSalonId={selectedSalonId}
                userCoordinates={userCoordinates}
              />
            </div>
          ) : null}
        </div>
      {mapAvailable && visibleLooks.length > 0 ? (
        <button
          className="w-fit rounded-full bg-surface-elevated px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          onClick={() => setMapOpen((current) => !current)}
          type="button"
        >
          {mapOpen ? "Hide map" : "View map"}
        </button>
      ) : null}
      {selectedItem ? (
        <InspirationPreview
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}
    </section>
  );
}

function DesktopTopSalonsNearYouSection({salons,category,location}: {
  postHrefBySalonId: ReadonlyMap<string,string>;
  salons: ExploreSearchResult[]; category: string; location: string;
}) {
  return <ExploreSalonDirectory salons={salons.filter(salon => salonMatchesDiscoveryCategory(salon,category))} category={category} location={location}/>;
}

function DesktopAvailableTodaySection({salons,contactSalons,category,location}: {
  postHrefBySalonId: ReadonlyMap<string,string>;
  salons: ExploreSearchResult[]; contactSalons: ExploreSearchResult[]; category:string; location:string;
}) {
  return <ExploreBookingEditorial salons={salons} contactSalons={contactSalons.filter(salon=>salon.hasPublicProfile && UUID_PATTERN.test(salon.id))} category={category} location={location}/>;
}

function DesktopTrustValueModule() {
  const items: Array<{
    icon: ReylumiIconName;
    label: string;
    text: string;
  }> = [
    {
      icon: "verified",
      label: "Verified context",
      text: "Reviews and visit signals stay close to each salon card.",
    },
    {
      icon: "dollar",
      label: "Price-first browsing",
      text: "Compare starting prices before opening a booking flow.",
    },
    {
      icon: "calendar",
      label: "Availability up front",
      text: "Check opening hours and request a time with the salon.",
    },
    {
      icon: "heart",
      label: "Save intent",
      text: "Guests can browse first and create an account when they save or book.",
    },
  ];

  return (
    <section
      className="grid gap-4 rounded-[1rem] bg-text-primary p-5 text-white shadow-[0_18px_44px_rgba(35,25,22,0.12)] ring-1 ring-black/5"
      data-testid="desktop-trust-value"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-200">
          Why book on Reylumi?
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          Real work, real context, less guessing.
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {items.map((item) => (
          <div
            className="grid gap-3 rounded-[0.9rem] bg-white/8 p-4 ring-1 ring-white/12"
            key={item.label}
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white/12 text-orange-200">
              <ReylumiIcon className="h-5 w-5" name={item.icon} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">{item.label}</h3>
              <p className="mt-1 text-sm leading-6 text-white/72">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type DesktopProgressiveDiscoverySection = {
  key: string;
  render: () => ReactNode;
  title: string;
};

function DesktopProgressiveSections({
  sections,
  sessionKey,
}: {
  sections: DesktopProgressiveDiscoverySection[];
  sessionKey: string;
}) {
  const [visibleSectionCount, setVisibleSectionCount] = useState(1);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    try {
      const count = Number(window.sessionStorage.getItem(`explore-sections:${sessionKey}`));
      if (Number.isInteger(count) && count > 1) {
        const frame = window.requestAnimationFrame(() => setVisibleSectionCount(Math.min(sections.length, count)));
        return () => window.cancelAnimationFrame(frame);
      }
    } catch { /* Optional navigation cache. */ }
  }, [sections.length, sessionKey]);
  useEffect(() => {
    try { window.sessionStorage.setItem(`explore-sections:${sessionKey}`, String(visibleSectionCount)); }
    catch { /* Optional navigation cache. */ }
  }, [sessionKey, visibleSectionCount]);

  useEffect(() => {
    const node = loadMoreRef.current;

    if (!node || visibleSectionCount >= sections.length) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      const timeout = window.setTimeout(() => {
        setVisibleSectionCount(sections.length);
      }, 0);

      return () => window.clearTimeout(timeout);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleSectionCount((current) =>
            Math.min(sections.length, current + 1),
          );
        }
      },
      { rootMargin: "520px 0px" },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [sections.length, visibleSectionCount]);

  return (
    <div className="grid gap-12">
      {sections.slice(0, visibleSectionCount).map((section) => (
        <div key={section.key}>{section.render()}</div>
      ))}
      {visibleSectionCount < sections.length ? (
        <>
          <DesktopSectionSkeleton
            title={sections[visibleSectionCount]?.title ?? "more discovery"}
          />
          <div ref={loadMoreRef} />
        </>
      ) : null}
    </div>
  );
}

function DesktopDiscoveryMarketplace({
  activeResults,
  discoveryShortcuts,
  onDiscoveryShortcutSelect,
  commentViewer,
  content,
  gpsCoordinates,
  location,
  nearYouSalons,
  onApplySearchShortcut,
  onSelectCategory,
  selectedCategory,
  strictLocation,
}: {
  activeResults: ExploreSearchResult[];
  activeDiscoveryResult: ExploreDiscoveryResultKind | null;
  discoveryShortcuts: ExploreDiscoveryShortcut[];
  onDiscoveryShortcutSelect: (shortcut: ExploreDiscoveryShortcut) => void;
  commentViewer: PostCommentViewer;
  content: ExploreHomeContent;
  gpsCoordinates: GpsCoordinates | null;
  location: string;
  nearYouSalons: ExploreHomeSalon[];
  onApplySearchShortcut: (input: {
    category?: string;
    location?: string;
    query?: string;
  }) => void;
  onCurrentLocation: () => void;
  onSelectCategory: (category: string) => void;
  selectedCategory: string;
  workspaceLocation: ExploreInitialLocation;
  strictLocation: boolean;
}) {
  const alternatingShortcuts = useMemo(() => exploreAlternatingShortcuts(discoveryShortcuts), [discoveryShortcuts]);
  const defaultLocation = formatDisplayLocation(location);
  const filters = useMemo<DesktopDiscoveryFilterState>(() => ({
    availability: "any",
    date: "any",
    location: defaultLocation,
    more: [],
    price: "any",
    trust: "any",
    time: "any",
  }), [defaultLocation]);
  const filterResetKey = [
    filters.availability,
    filters.date,
    filters.location,
    filters.more.join(","),
    filters.price,
    filters.trust,
    filters.time,
    selectedCategory,
    gpsCoordinates?.latitude,
    gpsCoordinates?.longitude,
    strictLocation,
  ].join("|");

  const allDiscoverySalons = useMemo(
    () =>
      mergeExploreResults(
        nearYouSalons,
        content.recommendedSalons,
        content.newSalons,
        activeResults,
      ),
    [activeResults, content.newSalons, content.recommendedSalons, nearYouSalons],
  );
  const filteredSalons = useMemo(
    () =>
      filterSalonsForDesktopDiscovery(
        allDiscoverySalons,
        filters,
        selectedCategory,
      ),
    [allDiscoverySalons, filters, selectedCategory],
  );
  const filteredLooks = useMemo(
    () =>
      filterLooksForDesktopDiscovery(
        content.inspiration.items,
        filters,
        selectedCategory,
      ),
    [content.inspiration.items, filters, selectedCategory],
  );
  const mapSalons = useMemo(
    () =>
      filteredSalons
        .map(mapSalonToMapSalon)
        .filter((salon): salon is ExploreMapSalon => Boolean(salon))
        .slice(0, 12),
    [filteredSalons],
  );
  const topSalons = useMemo(
    () =>
      filteredSalons
        .slice()
        .sort(compareReylumiTrustedSalons)
        .slice(0, 8),
    [filteredSalons],
  );
  const availableSalonIds = useMemo(
    () => new Set(filteredSalons.map((salon) => salon.id)),
    [filteredSalons],
  );
  const availableTodaySalons = useMemo(
    () =>
      availableTodayResults({
        content,
        nearYouSalons,
        searchResults: activeResults,
      })
        .filter((salon) => availableSalonIds.has(salon.id))
        .slice(0, 8),
    [activeResults, availableSalonIds, content, nearYouSalons],
  );
  const postHrefBySalonId = useMemo(
    () =>
      new Map(
        content.inspiration.items.map((item) => [
          item.salonId,
          inspirationDetailHref(item),
        ]),
      ),
    [content.inspiration.items],
  );
  const feedDiscovery = useMemo(() => ({
    category: selectedCategory,
    location: filters.location,
    latitude: gpsCoordinates?.latitude,
    longitude: gpsCoordinates?.longitude,
    strictLocation: strictLocation || filters.location !== defaultLocation,
    maxPrice: hasDesktopMoreFilter(filters, "under_60") ? Math.min(desktopPriceLimit(filters.price) ?? 60, 60) : desktopPriceLimit(filters.price),
    bookableOnly: filters.availability === "bookable" || hasDesktopMoreFilter(filters, "bookable"),
    newOnly: hasDesktopMoreFilter(filters, "new"),
    trendingOnly: hasDesktopMoreFilter(filters, "trending"),
  }), [selectedCategory, filters, gpsCoordinates, defaultLocation, strictLocation]);
  const editorialPage = useExploreEditorialFeed(feedDiscovery, commentViewer.userId, "desktop");
  const editorialPosts = useMemo(()=>selectExploreEditorialPosts(editorialPage?.items ?? []),[editorialPage]);
  const filterFeedItem = useCallback((item: ExploreFeedItem) =>
    feedMatchesDesktopDiscovery(item, filters, selectedCategory) &&
    !editorialPosts.some(post => post.contentId === item.contentId && post.contentType === item.contentType),
    [filters, selectedCategory, editorialPosts]);
  const sections = useMemo(
    () => [
      {
        key: "looks",
        render: () => (
          <DesktopLooksNearYouSection
            posts={editorialPosts}
            looks={filteredLooks}
            mapSalons={mapSalons}
            category={selectedCategory}
            location={filters.location}
            onExplore={() => onDiscoveryShortcutSelect(alternatingShortcuts[0])}
            userCoordinates={gpsCoordinates}
          />
        ),
        title: "Fresh looks",
      },
      {
        key: "recommended-looks",
        title: "Recommended for you",
        render: () => <DesktopLooksNearYouSection mode="recommended" posts={editorialPosts} looks={filteredLooks} mapSalons={[]} category={selectedCategory} location={filters.location} onExplore={() => onDiscoveryShortcutSelect(alternatingShortcuts[0])} userCoordinates={gpsCoordinates}/>,
      },
      {
        key: "top-salons",
        render: () => (
          <DesktopTopSalonsNearYouSection
            postHrefBySalonId={postHrefBySalonId}
            salons={topSalons}
            category={selectedCategory}
            location={filters.location}
          />
        ),
        title: "Recommended for you",
      },
      {
        key: "available",
        render: () => (
          <DesktopAvailableTodaySection
            postHrefBySalonId={postHrefBySalonId}
            salons={availableTodaySalons}
            contactSalons={filteredSalons}
            category={selectedCategory}
            location={filters.location}
          />
        ),
        title: "Booking options",
      },
      {
        key: "trust",
        render: () => <DesktopTrustValueModule />,
        title: "Why book on Reylumi?",
      },
      {
        key: "continue-discovering",
        title: "More to discover",
        render: () => (
          <section className="grid gap-4" aria-label="More to discover">
            <div><h2 className="text-xl font-semibold text-text-primary">More to discover</h2>
              <p className="mt-1 text-sm text-text-muted">Fresh inspiration, customer looks and more places to explore.</p></div>
            <ExploreDiscoveryFeed key={filterResetKey} sessionKey={`desktop:${filterResetKey}`} refreshToken={content} initialPage={editorialPage} commentLeadPosts={editorialPosts} discovery={feedDiscovery} viewer={commentViewer} filterItem={filterFeedItem} discoveryShortcuts={alternatingShortcuts} onDiscoveryShortcutSelect={onDiscoveryShortcutSelect} />
          </section>
        ),
      },
    ],
    [
      alternatingShortcuts,
      onDiscoveryShortcutSelect,
      filterResetKey,
      feedDiscovery,
      filterFeedItem,
      editorialPage,
      editorialPosts,
      commentViewer,
      availableTodaySalons,
      content,
      filteredLooks,
      filteredSalons,
      selectedCategory,
      filters.location,
      gpsCoordinates,
      mapSalons,
      postHrefBySalonId,
      topSalons,
    ],
  );

  return (
    <section
      className="hidden bg-white px-8 pb-10 xl:block"
      data-testid="desktop-discovery-marketplace"
    >
      <div className="mx-auto grid w-full max-w-[92rem] gap-5">
        {content.error ? (
          <ExploreNotice title="Discovery content is limited right now." tone="warning">
            Search still works while this section refreshes.
          </ExploreNotice>
        ) : null}

        <DesktopProgressiveSections
          key={filterResetKey}
          sessionKey={filterResetKey}
          sections={sections}
        />
      </div>
    </section>
  );
}

function ExploreHomeSections({
  activeDiscoveryResult,
  commentViewer,
  content,
  discoveryShortcuts,
  initialFeed,
  initialFeedPromise,
  startupExtrasPending,
  nearYouSalons,
  onDiscoveryShortcutSelect,
  onSelectCategory,
  selectedCategory,
  location,
  gpsCoordinates,
  strictLocation,
}: {
  activeDiscoveryResult: ExploreDiscoveryResultKind | null;
  commentViewer: PostCommentViewer;
  content: ExploreHomeContent;
  discoveryShortcuts: ExploreDiscoveryShortcut[];
  initialFeed: ExploreFeedPage;
  initialFeedPromise?: Promise<ExploreFeedPage | null>;
  startupExtrasPending?: boolean;
  nearYouSalons: ExploreHomeSalon[];
  onDiscoveryShortcutSelect: (shortcut: ExploreDiscoveryShortcut) => void;
  onSelectCategory: (category: string) => void;
  selectedCategory: string;
  location: string;
  gpsCoordinates: GpsCoordinates | null;
  strictLocation: boolean;
}) {
  const discovery = useMemo(() => ({ category: selectedCategory, location,
    latitude: gpsCoordinates?.latitude, longitude: gpsCoordinates?.longitude, strictLocation,
  }), [selectedCategory, location, gpsCoordinates, strictLocation]);
  const feedSessionKey = `mobile:${JSON.stringify(discovery)}`;
  const editorialPage = useExploreEditorialFeed(discovery, commentViewer.userId, "mobile");
  const editorialPosts = useMemo(()=>selectExploreEditorialPosts(editorialPage?.items ?? []),[editorialPage]);
  const filterFeedItem = useCallback((item:ExploreFeedItem)=>!editorialPosts.some(post=>post.contentId===item.contentId && post.contentType===item.contentType),[editorialPosts]);
  const allDiscoverySalons = mergeHomeSalons(
    nearYouSalons,
    content.recommendedSalons,
    content.newSalons,
  );
  const hasContent =
    initialFeed.items.length > 0 ||
    content.inspiration.items.length > 0 ||
    nearYouSalons.length > 0 ||
    allDiscoverySalons.length > 0 ||
    content.popularServices.length > 0;

  return (
    <section
      aria-busy={false}
      className="mx-auto grid w-full max-w-[40rem] gap-2.5 px-4 py-3 sm:px-6 lg:px-3"
      data-testid="explore-home-content"
    >
      {content.error ? (
        <ExploreNotice title="We couldn't load Explore home right now." tone="warning">
          Search still works. Please try refreshing this section later.
        </ExploreNotice>
      ) : null}

      <div className="grid gap-10 pb-8" data-testid="mobile-editorial-sections">
        <DesktopLooksNearYouSection posts={editorialPosts} looks={content.inspiration.items.filter(item => lookMatchesDiscoveryCategory(item, selectedCategory) && (!location || [item.salonCity,item.salonState].filter(Boolean).join(", ").toLowerCase().includes(location.toLowerCase())))} mapSalons={[]} category={selectedCategory} location={location} onExplore={() => { const shortcut=exploreAlternatingShortcuts(discoveryShortcuts)[0]; if(shortcut) onDiscoveryShortcutSelect(shortcut); }} userCoordinates={gpsCoordinates}/>
        <DesktopLooksNearYouSection mode="recommended" posts={editorialPosts} looks={content.inspiration.items.filter(item => lookMatchesDiscoveryCategory(item, selectedCategory) && (!location || [item.salonCity,item.salonState].filter(Boolean).join(", ").toLowerCase().includes(location.toLowerCase())))} mapSalons={[]} category={selectedCategory} location={location} onExplore={() => { const shortcut=exploreAlternatingShortcuts(discoveryShortcuts)[0]; if(shortcut) onDiscoveryShortcutSelect(shortcut); }} userCoordinates={gpsCoordinates}/>
        <ExploreSalonDirectory salons={allDiscoverySalons.filter(salon=>salonMatchesDiscoveryCategory(salon,selectedCategory))} category={selectedCategory} location={location}/>
        <ExploreBookingEditorial salons={availableTodayResults({content,nearYouSalons,searchResults:[]}).filter(salon=>salonMatchesDiscoveryCategory(salon,selectedCategory))} contactSalons={allDiscoverySalons.filter(salon=>salonMatchesDiscoveryCategory(salon,selectedCategory))} category={selectedCategory} location={location}/>
      </div>
      <ExploreDiscoveryFeed key={`${feedSessionKey}:${commentViewer.userId}`} sessionKey={feedSessionKey} discovery={discovery} filterItem={filterFeedItem} commentLeadPosts={editorialPosts} initialPage={editorialPage ?? (selectedCategory === "All" && !strictLocation && !gpsCoordinates ? initialFeed : undefined)} initialPagePromise={!editorialPage && selectedCategory === "All" && !strictLocation && !gpsCoordinates ? initialFeedPromise : undefined} viewer={commentViewer} activeDiscoveryResult={activeDiscoveryResult} discoveryShortcuts={discoveryShortcuts} onDiscoveryShortcutSelect={onDiscoveryShortcutSelect} />

      {initialFeed.items.length === 0 ? (
        <PopularServicesSection
          onSelectCategory={onSelectCategory}
          salons={allDiscoverySalons}
          services={content.popularServices}
        />
      ) : null}

      {!hasContent && !content.error && !startupExtrasPending ? (
        <ExploreNotice title="Explore is getting ready">
          Public salons and services will appear here as soon as they meet the
          Explore requirements.
        </ExploreNotice>
      ) : null}
    </section>
  );
}

function ExploreNotice({
  action,
  children,
  title,
  tone = "neutral",
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
  tone?: "neutral" | "warning";
}) {
  const toneClass =
    tone === "warning"
      ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200/75"
      : "bg-surface-elevated text-text-secondary ring-1 ring-divider-subtle/80";

  return (
    <div className={`rounded-2xl p-4 shadow-[var(--shadow-soft)] ${toneClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <div className="mt-1 text-sm leading-6">{children}</div>
        </div>
        {action}
      </div>
    </div>
  );
}

function SearchContinuationFeed({ response, coordinates, viewerId, onChooseArea }: {
  response: ExploreSearchResponse;
  coordinates: GpsCoordinates | null;
  viewerId?: string | null;
  onChooseArea?: () => void;
}) {
  const [salons, setSalons] = useState<ExploreSearchResult[]>([]);
  const [page, setPage] = useState(response.page);
  const [hasMore, setHasMore] = useState(response.hasMore ?? response.page < response.totalPages);
  const [cursor, setCursor] = useState(response.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyExploreSearchError> | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const seen = useRef(new Set(response.results.map((salon) => salon.id)));
  const emptyPages = useRef(0);
  const visibleSalons = useExploreSearchMedia({ results: salons, response, coordinates, viewerId });
  const onward = exploreSearchOnwardLink(response);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; activeRequest.current?.abort(); };
  }, []);

  const loadMore = useCallback(async () => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const next = await fetchExploreSearchPage({
        query: response.query, category: response.category, location: response.location, filters: response.filters,
        displayQuery: response.displayQuery, contentQuery: response.contentQuery,
        queryKind: response.queryKind, locationPriority: response.locationPriority,
        locationOrigin: response.locationOrigin, intent: response.intent,
        target: "salons", locationSource: response.locationSource,
        latitude: coordinates?.latitude, longitude: coordinates?.longitude,
        page: page + 1, pageSize: response.pageSize,
        cursor,
        scopePolicy: response.scope?.policy,
        sort: response.sort,
      }, controller.signal);
      if (!alive.current) return;
      if (next.error) throw Object.assign(new Error(next.error), { code: next.errorKind === "cursor" ? "22023" : next.errorKind === "timeout" ? "57014" : undefined });
      const additions = next.results.filter((salon) => {
        if (seen.current.has(salon.id)) return false;
        seen.current.add(salon.id);
        return true;
      });
      setSalons((current) => [...current, ...additions]);
      setPage(next.page);
      setCursor(next.nextCursor ?? null);
      emptyPages.current = additions.length ? 0 : emptyPages.current + 1;
      const repeatedCursor = cursor && next.nextCursor && JSON.stringify(cursor) === JSON.stringify(next.nextCursor);
      setHasMore(!repeatedCursor && emptyPages.current < 3 && (next.hasMore ?? (next.results.length > 0 && next.page < next.totalPages)));
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) { const kind = classifyExploreSearchError(cause); setErrorKind(kind); setError(exploreSearchErrorMessage(kind)); }
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, [coordinates, cursor, hasMore, page, response]);

  const renderSalon = (salon: ExploreSearchResult) => <div key={salon.id} className="space-y-3">
    <div className="flex items-center gap-3 px-1">
      <div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-surface-muted"><SalonLogoContent salon={salon} size={40} /></div>
      <div><p className="font-semibold text-text-primary">{salon.name}</p><p className="text-sm text-text-secondary">{formatSalonLocation(salon)}</p></div>
    </div>
    <SalonCard featured rankAriaLabel={isExplorePrimarySearchResult(salon) ? "Search match" : "Discover this salon"} rankLabel={isExplorePrimarySearchResult(salon) ? "Match" : "Discover"} salon={salon} />
  </div>;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6 py-8" aria-label="More salons" data-testid="search-continuation-feed">
      {visibleSalons.length > 0 ? <>
        <div className="border-t border-divider-subtle pt-6">
          <h3 className="text-xl font-semibold text-text-primary">Keep exploring</h3>
          <p className="mt-1 text-sm text-text-secondary">More salons to discover as you scroll.</p>
        </div>
        {visibleSalons.filter(isExplorePrimarySearchResult).map(renderSalon)}
        <SearchRecommendationSections results={visibleSalons.filter(salon => !isExplorePrimarySearchResult(salon))} location={response.location} renderCards={rows => <div className="space-y-6">{rows.map(renderSalon)}</div>} />
      </> : null}
      {hasMore ? <ExploreAutoLoad enabled={!loading && !error} onLoad={loadMore} progressKey={page} /> : null}
      <div className="flex items-center justify-center" aria-live="polite">
        {loading ? <p className="text-sm text-text-secondary">Loading more salons…</p> : hasMore ? <div className="text-center">
          {error ? <p className="mb-3 text-sm text-text-secondary">{error}</p> : null}
          <button type="button" onClick={() => errorKind === "cursor" ? window.location.reload() : void loadMore()} className={`${error ? "" : "sr-only focus:not-sr-only"} min-h-11 rounded-full bg-surface-muted px-6 py-3 text-sm font-semibold text-text-primary`}>{errorKind === "cursor" ? "Refresh search" : error ? "Try again" : "Load more salons"}</button>
        </div> : <div className="text-center"><p className="text-sm text-text-secondary">You&apos;ve explored these salons.</p><ExploreSearchOnwardActions {...onward} onChooseArea={onChooseArea} /></div>}
      </div>
    </section>
  );
}

function QuickActions({ actions }: { actions: ExploreQuickAction[] }) {
  const [visualSeed, setVisualSeed] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setVisualSeed(Math.floor(Math.random() * 100));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  if (actions.length === 0) {
    return null;
  }

  return (
    <section
      className="mx-auto w-full max-w-none px-4 py-8 sm:px-6 lg:pl-8 lg:pr-3"
      data-testid="quick-actions"
    >
      <div
        className="relative grid overflow-hidden rounded-[1.25rem] bg-text-primary p-5 text-white shadow-[0_18px_48px_rgba(35,25,22,0.14)] ring-1 ring-black/5 lg:grid-cols-[minmax(0,0.62fr)_minmax(22rem,1fr)]"
        style={{
          backgroundImage: "url(/explore/quick-actions-dark.png)",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(31,23,27,0.90),rgba(31,23,27,0.72)_42%,rgba(31,23,27,0.46))]"
        />
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-200">
            Quick actions
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            Keep moving
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/74">
            The next useful places for this account and workspace.
          </p>
        </div>
        <div
          className={[
            "relative z-10",
            actions.length === 1 ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"
          ].join(" ")}
        >
          {actions.map((action, index) => {
            const visual =
              QUICK_ACTION_VISUALS[
                (visualSeed + index) % QUICK_ACTION_VISUALS.length
              ];

            return (
              <Link prefetch={false}
                className="group relative grid min-h-24 overflow-hidden rounded-[1rem] bg-white/8 p-4 text-white shadow-[0_12px_30px_rgba(0,0,0,0.14)] ring-1 ring-white/14 transition hover:-translate-y-0.5 hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href={action.href}
                key={action.label}
              >
                <span
                  aria-hidden
                  className="absolute inset-0 opacity-[0.38] transition group-hover:opacity-[0.48]"
                  style={{
                    backgroundImage: `url(${visual.src})`,
                    backgroundPosition: visual.position,
                    backgroundSize: visual.size,
                  }}
                />
                <span
                  aria-hidden
                  className="absolute inset-0 bg-[linear-gradient(90deg,rgba(31,23,27,0.88),rgba(31,23,27,0.58))]"
                />
                <span className="relative z-10 text-sm font-semibold">
                  {action.label}
                </span>
                <span className="relative z-10 mt-2 max-w-[86%] text-sm font-normal leading-5 text-white/76">
                  {action.description}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ExploreClient({
  commentViewer,
  discoveryContent,
  hasUrlLocation,
  homeContent,
  initialFeed,
  initialFeedPromise,
  startupExtrasPending,
  initialLocationSource,
  initialResponse,
  initialSearchMode,
  quickActions,
  workspaceLocation,
}: ExploreClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstContentRef = useRef<HTMLElement>(null);
  useExploreFirstContentPaint(firstContentRef);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialResponse.displayQuery ?? initialResponse.query);
  const [location, setLocation] = useState(initialResponse.location);
  const [category, setCategory] = useState(
    initialResponse.category || "All",
  );
  const [locationSource, setLocationSource] =
    useState<ExploreLocationSource>(initialLocationSource);
  const [gpsCoordinates, setGpsCoordinates] =
    useState<GpsCoordinates | null>(null);
  const [gpsResponse, setGpsResponse] =
    useState<ExploreSearchResponse | null>(null);
  // Read/save actions can refresh the server tree. Keep this search's cursor
  // until its filter key changes or the user explicitly starts another search.
  const [sessionResponse, setSessionResponse] = useState(initialResponse);
  const [nearYouSalons, setNearYouSalons] = useState<ExploreHomeSalon[]>([]);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [searchAreaOpen, setSearchAreaOpen] = useState(false);
  const [searchResetVersion, setSearchResetVersion] = useState(0);
  const [pendingIdeasHeight, setPendingIdeasHeight] = useState<number | null>(null);
  const [explicitSearchMode, setExplicitSearchMode] =
    useState(initialSearchMode);
  const [activeDiscoveryResult, setActiveDiscoveryResult] =
    useState<ExploreDiscoveryResultKind | null>(null);
  const [searchOrderMode, setSearchOrderMode] =
    useState<SearchOrderMode>(initialResponse.sort ?? "relevance");
  const appliedSavedLocation = useRef(false);
  const gpsArea = useRef<{ coordinates: GpsCoordinates; area: ExploreGpsArea; timestamp: number } | null>(null);
  const autoLocationChecked = useRef(Boolean(readExploreStartupInteraction(commentViewer.userId)?.gps));
  const requestLocationRef = useRef<() => void>(() => {});
  const gpsRequestVersion = useRef(0);
  const gpsRequest = useRef<AbortController | null>(null);
  const typedRequest = useRef<string | null>(null);
  const [committedGpsContext, setCommittedGpsContext] = useState<ExploreCommittedGpsContext | null>(null);
  useEffect(() => () => { gpsRequestVersion.current += 1; gpsRequest.current?.abort(); }, []);

  const gpsActive = Boolean(gpsResponse);
  const searchMode = explicitSearchMode || gpsActive;
  const activeResponse: ExploreSearchResponse =
    gpsActive && gpsResponse ? gpsResponse : sessionResponse;
  const committedSearch = useMemo(() => buildExploreCommittedSearchContext(activeResponse, {
    viewerId: commentViewer.userId,
    gpsContext: committedGpsContext,
  }), [activeResponse, commentViewer.userId, committedGpsContext]);
  const refreshedResults = useExploreSearchMedia({ results: activeResponse.results, response: activeResponse, coordinates: committedSearch.coordinates, viewerId: commentViewer.userId });
  const activeSections = useMemo(() => {
    const seen = new Set<string>();
    const refreshedById = new Map(refreshedResults.map(salon => [salon.id, salon]));
    const unique = (salons: ExploreSearchResult[]) => salons.flatMap(salon => {
      const current = refreshedById.get(salon.id);
      if (!current || seen.has(salon.id)) return [];
      seen.add(salon.id); return [current];
    });
    return {
      bestMatches: unique(activeResponse.sections.bestMatches),
      nearby: unique(activeResponse.sections.nearby),
      recommended: unique(activeResponse.sections.recommended),
      reference: unique(activeResponse.sections.reference ?? []),
    };
  }, [activeResponse, refreshedResults]);
  const activeResults = [...activeSections.bestMatches, ...activeSections.nearby, ...activeSections.recommended, ...activeSections.reference];
  const referenceResults = activeResults.filter(salon => !isExplorePrimarySearchResult(salon));
  const hasPrimaryResults = activeResults.some(isExplorePrimarySearchResult);
  const onward = exploreSearchOnwardLink(activeResponse);
  const [nailFilterSelection, setNailFilterSelection] = useState<{ sessionKey: string; filters: NailFilters }>({ sessionKey: committedSearch.sessionKey, filters: {} });
  const nailFilters = nailFilterSelection.sessionKey === committedSearch.sessionKey ? { ...activeResponse.filters, ...nailFilterSelection.filters } : activeResponse.filters ?? {};
  if (nailFilterSelection.sessionKey !== committedSearch.sessionKey) {
    setNailFilterSelection({ sessionKey: committedSearch.sessionKey, filters: {} });
  }
  const hasBestMatches = activeSections.bestMatches.length > 0;
  const hasNearbyResults = activeSections.nearby.length > 0;
  const hasRecommendedResults = activeSections.recommended.length > 0;
  const hasAnyResults =
    hasBestMatches || hasNearbyResults || hasRecommendedResults || activeSections.reference.length > 0;
  const selectedCategory = category || "All";
  const normalizedCategory = cleanCategory(selectedCategory);
  const isSearching = isPending || gpsStatus === "searching" || gpsStatus === "locating";
  const nearbyHasDistance = hasMeasuredDistance(activeSections.nearby);
  const searchTarget = "salons";
  const discoveryResultMode = !searchMode && activeDiscoveryResult !== null;
  const homeMode = !searchMode && !discoveryResultMode;
  const hasDiscoveryRail = !homeMode && !searchMode && discoveryContent.shortcuts.length > 0;
  useEffect(() => {
    // Guest preferences stay in browser storage. A no-op account action still
    // queues a server POST and can outlive the page during Safari refresh.
    if (commentViewer.isAuthenticated && (initialSearchMode || hasUrlLocation)) {
      void rememberExplorePreferenceAction({ location: initialLocationSource === "manual" ? initialResponse.location : undefined, category: initialResponse.category }).catch(() => {});
    }
  }, [commentViewer.isAuthenticated, hasUrlLocation, initialSearchMode, initialLocationSource, initialResponse.location, initialResponse.category]);
  const searchUnavailable = Boolean(activeResponse.error || activeResponse.errorKind || activeResponse.lookupFailed);
  const summaryText = searchUnavailable ? "Search is temporarily unavailable" : activeResponse.requiresGps ? "Choose a location to find salons near you" : !hasAnyResults && (isSearching || activeResponse.hasMore) ? "Loading results…" : resultSummary({
    bestCount: activeSections.bestMatches.length,
    category: committedSearch.category,
    hasAnyResults,
    hasPrimaryResults,
    location: formatDisplayLocation(committedSearch.location),
    nearbyCount: activeSections.nearby.length,
    query: activeResponse.query,
    recommendedCount: activeSections.recommended.length,
  });

  useEffect(() => {
    if (autoLocationChecked.current) return;
    let active = true;
    const restore = async () => {
      const chosenArea = initialResponse.locationOrigin === "manual" || initialResponse.locationOrigin === "query" || initialLocationSource === "manual";
      if (chosenArea) { autoLocationChecked.current = true; return; }
      let preference = "";
      try { preference = window.sessionStorage.getItem(GPS_PREFERENCE_KEY) ?? ""; } catch { /* Optional preference. */ }
      let granted = false;
      try { granted = (await navigator.permissions?.query({ name: "geolocation" }))?.state === "granted"; } catch { /* Safari can lack the permission query. */ }
      if (!active) return;
      autoLocationChecked.current = true;
      if (initialResponse.requiresGps || preference !== "off" && (granted || preference === "on")) {
        requestLocationRef.current();
        return;
      }
      if (appliedSavedLocation.current || hasUrlLocation || initialSearchMode || initialLocationSource === "activity" || initialLocationSource === "saved") return;
      appliedSavedLocation.current = true;
      let savedLocation = "";
      try { savedLocation = window.localStorage.getItem(SAVED_LOCATION_KEY)?.trim() ?? ""; } catch { return; }
      if (!savedLocation || savedLocation === location.trim()) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("locationSource", "saved");
      startTransition(() => router.replace(buildUrl({ category: selectedCategory, location: savedLocation, page: 1, pathname, query, searchParams: params }), { scroll: false }));
    };
    void restore();
    return () => { active = false; };
  }, [hasUrlLocation, initialSearchMode, initialLocationSource, initialResponse.locationOrigin, initialResponse.requiresGps, location, pathname, query, router, searchParams, selectedCategory]);

  async function findGpsArea(coordinates: GpsCoordinates, signal: AbortSignal) {
    const cached = gpsArea.current;
    if (cached && cached.coordinates.latitude === coordinates.latitude && cached.coordinates.longitude === coordinates.longitude && Date.now() - cached.timestamp < 600000) return cached.area;
    const area = await fetchExploreGpsArea(coordinates, signal, commentViewer.userId ?? "guest");
    if (!signal.aborted) gpsArea.current = { coordinates, area, timestamp: Date.now() };
    return area;
  }

  function rememberSearchUrl(response: ExploreSearchResponse, rawQuery: string, target: "auto" | "salons" | "posts", scope?: "fixed" | "expandable") {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["page", "cursor", "browse", "lat", "lng", "latitude", "longitude"]) params.delete(key);
    if (response.sort && response.sort !== "relevance") params.set("sort", response.sort); else params.delete("sort");
    if (rawQuery.trim()) params.set("q", rawQuery.trim()); else params.delete("q");
    if (response.category) params.set("category", response.category); else params.delete("category");
    params.set("type", "salons");
    for (const key of ["shape", "length", "color", "finish", "tone", "season", "maxPrice", "bookableOnly", "newOnly", "trendingOnly"] as const) {
      const value = response.filters?.[key];
      if (value !== undefined && value !== false && value !== null && value !== "") params.set(key, String(value)); else params.delete(key);
    }
    if (scope) params.set("scope", scope); else params.delete("scope");
    if (response.location) {
      params.set("location", response.location);
      params.set("locationSource", response.locationOrigin === "query" ? "saved" : response.locationSource ?? locationSource);
    } else { params.set("location", ""); params.delete("locationSource"); }
    // Next's native history integration updates searchParams without replacing
    // the active cursor. GPS stays in memory and is reacquired after refresh.
    window.history.replaceState(null, "", pathname + (params.size ? "?" + params : ""));
  }

  function hasResolvedGpsArea(coordinates: GpsCoordinates) {
    const cached = gpsArea.current;
    return Boolean(cached && cached.coordinates.latitude === coordinates.latitude && cached.coordinates.longitude === coordinates.longitude && Date.now() - cached.timestamp < 600000);
  }

  function recoverUnresolvedGps(
    searchQuery?: string,
    searchCategory = normalizedCategory,
    target: "auto" | "salons" | "posts" = searchTarget,
    scopePolicy: "fixed" | "expandable" = activeResponse.scope?.policy ?? "expandable",
  ) {
    const recoveryLocation = activeResponse.location;
    const previousGpsContext = committedGpsContext?.response === activeResponse ? committedGpsContext : null;
    const recoverySource: ExploreLocationSource = !recoveryLocation ? "none"
      : activeResponse.locationOrigin === "query" ? "saved"
        : activeResponse.locationOrigin === "manual" ? "manual"
          : activeResponse.locationSource === "gps" ? "saved"
            : activeResponse.locationSource ?? locationSource;
    setGpsCoordinates(previousGpsContext?.coordinates ?? null);
    setGpsResponse(activeResponse === sessionResponse ? null : activeResponse);
    setCommittedGpsContext(previousGpsContext);
    setNearYouSalons([]);
    setLocation(recoveryLocation);
    setLocationSource(previousGpsContext ? activeResponse.locationSource ?? "gps" : recoverySource);
    setGpsMessage("We couldn't find your area. Choose a location or try again.");
    // A newly typed city must still reach the indexed intent resolver when the
    // upstream area provider is unavailable. Never keep it bound to failed GPS.
    if (searchQuery !== undefined && (searchQuery !== query || target !== searchTarget)) {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of ["page", "cursor", "latitude", "longitude", "lat", "lng", "sort", "locationSource"]) params.delete(key);
      params.set("q", searchQuery);
      params.set("type", "salons");
      params.set("scope", scopePolicy);
      if (searchCategory) params.set("category", searchCategory); else params.delete("category");
      params.set("location", recoveryLocation);
      if (recoveryLocation) params.set("locationSource", recoverySource);
      startTransition(() => router.push(pathname + "?" + params, { scroll: false }));
    }
  }

  function prepareSearchTransition() {
    if (typeof document === "undefined") return;
    const height = document.querySelector('[data-testid="explore-content-search"]')?.getBoundingClientRect().height;
    if (height !== undefined && Number.isFinite(height) && height > 0) setPendingIdeasHeight(height);
  }

  async function runGpsSearch(
    coordinates: GpsCoordinates,
    targetPage = 1,
    searchQuery = query,
    sort: SearchOrderMode = searchOrderMode,
    searchCategory = normalizedCategory,
    target: "auto" | "salons" | "posts" = searchTarget,
    scopePolicy: "fixed" | "expandable" = activeResponse.scope?.policy ?? "expandable",
    filters = activeResponse.filters,
  ) {
    prepareSearchTransition();
    const version = ++gpsRequestVersion.current;
    gpsRequest.current?.abort();
    const controller = new AbortController();
    gpsRequest.current = controller;
    setGpsStatus("searching");
    setGpsMessage(null);
    setNearYouSalons([]);
    setActiveDiscoveryResult(null);

    try {
      const area = await findGpsArea(coordinates, controller.signal);
      if (version !== gpsRequestVersion.current) return;
      const response = await fetchExploreSearchPage({
        category: searchCategory, target: "salons", filters,
        location: area.label, locationSource: "gps",
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        page: targetPage,
        pageSize: initialResponse.pageSize,
        query: searchQuery,
        scopePolicy,
        sort,
      }, controller.signal);
      if (version !== gpsRequestVersion.current) return;

      if (!response.error) rememberSearchUrl(response, searchQuery, target, scopePolicy);
      setCommittedGpsContext(response.error ? null : { response, coordinates: { ...coordinates } });
      setGpsResponse(response);
      setSearchOrderMode(response.sort ?? "relevance");
      setLocation(response.location);
      setLocationSource(response.locationSource ?? "gps");
      setCategory(response.category || "All");
      setGpsCoordinates(response.locationOrigin === "query" || response.locationOrigin === "manual" ? null : coordinates);
      setGpsStatus("idle");
      setExplicitSearchMode(true);

      if (response.error) {
        setGpsMessage("We couldn't load salons for your current location right now.");
      }
    } catch {
      if (version === gpsRequestVersion.current) {
        if (!hasResolvedGpsArea(coordinates)) recoverUnresolvedGps(searchQuery, searchCategory, target, scopePolicy);
        else setGpsMessage("We couldn't load nearby salons. Please try again.");
      }
    } finally {
      if (version === gpsRequestVersion.current) setGpsStatus("idle");
    }
  }

  async function runHomeNearYou(coordinates: GpsCoordinates) {
    const version = ++gpsRequestVersion.current;
    gpsRequest.current?.abort();
    const controller = new AbortController();
    gpsRequest.current = controller;
    setGpsStatus("searching");
    setGpsMessage(null);
    setGpsResponse(null);
    setNearYouSalons([]);

    try {
      const area = await findGpsArea(coordinates, controller.signal);
      if (version !== gpsRequestVersion.current) return;
      const response = await fetchExploreSearchPage({
        location: area.label, locationSource: "gps", target: "salons",
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        query: "", page: 1, pageSize: 6,
        scopePolicy: "expandable", sort: "closest",
      }, controller.signal);
      if (version !== gpsRequestVersion.current) return;

      setLocation(response.location || area.label);
      setGpsCoordinates(coordinates);
      if (!response.error) rememberSearchUrl(response, "", "auto");
      const salons: ExploreHomeSalon[] = response.results
        .filter(salon => salon.searchScope === "A" || salon.searchScope === "B" && salon.distanceMiles !== null && salon.distanceMiles <= 50)
        .map((salon, index) => ({ ...salon, createdAt: null, updatedAt: null, publicDiscoveryPublishedAt: null, homeRank: index + 1, homeSection: "near_you" }));
      setNearYouSalons(salons);
      setLocationSource("gps");
      setGpsStatus("idle");
      setExplicitSearchMode(false);
      setActiveDiscoveryResult(null);

      if (response.error) {
        setGpsMessage("We couldn't load salons in your area right now.");
        return;
      }

      if (salons.length === 0) {
        setGpsMessage("No salons found in your area. You can try another location.");
      }
    } catch {
      if (version === gpsRequestVersion.current) {
        if (!hasResolvedGpsArea(coordinates)) recoverUnresolvedGps();
        else setGpsMessage("We couldn't load nearby salons. Please try again.");
      }
    } finally {
      if (version === gpsRequestVersion.current) setGpsStatus("idle");
    }
  }

  function requestCurrentLocation() {
    const currentSearchQuery = (document.getElementById("explore-search-query") as HTMLInputElement | null)?.value.trim() ?? query;
    const currentTarget = currentSearchQuery === query ? searchTarget : "auto";
    setQuery(currentSearchQuery);
    prepareSearchTransition();
    const version = ++gpsRequestVersion.current;
    gpsRequest.current?.abort();
    try { window.sessionStorage.setItem(GPS_PREFERENCE_KEY, "on"); } catch { /* Optional preference. */ }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("unsupported");
      setGpsMessage("Current location is not available in this browser.");
      return;
    }

    setGpsStatus("locating");
    setGpsMessage(null);
    const shouldRunSearch = Boolean(
      explicitSearchMode || currentSearchQuery.trim() || normalizedCategory,
    );

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (version !== gpsRequestVersion.current) return;
        const coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        // Keep the committed area, cards and cursor together until this GPS
        // point has resolved and its matching search has completed.
        if (shouldRunSearch) {
          void runGpsSearch(coordinates, 1, currentSearchQuery, currentSearchQuery === query ? searchOrderMode : "relevance", normalizedCategory, currentTarget);
        } else {
          void runHomeNearYou(coordinates);
        }
      },
      (error) => {
        if (version !== gpsRequestVersion.current) return;
        setGpsCoordinates(committedGpsContext?.response === activeResponse ? committedGpsContext.coordinates : null);
        setGpsStatus(error.code === error.PERMISSION_DENIED ? "denied" : "error");
        setGpsMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. You can still search by city or ZIP."
            : "Current location could not be read. Try a city or ZIP instead.",
        );
      },
      {
        enableHighAccuracy: false,
        maximumAge: 300000,
        timeout: 10000,
      },
    );
  }

  useEffect(() => { requestLocationRef.current = requestCurrentLocation; });
  useEffect(() => {
    window.addEventListener("reylumi:experience-reset", clearExploreStartupInteraction);
    return () => window.removeEventListener("reylumi:experience-reset", clearExploreStartupInteraction);
  }, []);
  useEffect(() => {
    const interaction = readExploreStartupInteraction(commentViewer.userId);
    if (!interaction) return;
    if (interaction.gps) requestLocationRef.current();
    clearExploreStartupInteraction();
  }, [commentViewer.userId]);

  function turnOffCurrentLocation() {
    try { window.sessionStorage.setItem(GPS_PREFERENCE_KEY, "off"); } catch { /* Optional preference. */ }
    gpsRequestVersion.current += 1;
    gpsRequest.current?.abort();
    appliedSavedLocation.current = true;
    setGpsCoordinates(null);
    setGpsResponse(null);
    setNearYouSalons([]);
    setGpsStatus("idle");
    setGpsMessage(null);
    setLocation("");
    setLocationSource("none");
    setActiveDiscoveryResult(null);
    const searchQuery = (document.getElementById("explore-search-query") as HTMLInputElement | null)?.value ?? query;
    setQuery(searchQuery);
    setExplicitSearchMode(Boolean(searchQuery.trim() || normalizedCategory));
    try { window.localStorage.removeItem(SAVED_LOCATION_KEY); } catch { /* Storage may be unavailable. */ }
    startTransition(() => router.push(buildUrl({
      category: selectedCategory, location: "", page: 1, pathname, query: searchQuery,
      searchParams: new URLSearchParams(searchParams.toString()),
    }), { scroll: false }));
  }

  useEffect(() => {
    function publishLocationState() {
      window.dispatchEvent(new CustomEvent("kingpos:explore-location-state", {
        detail: { enabled: Boolean(gpsCoordinates), pending: gpsStatus === "locating" || gpsStatus === "searching" },
      }));
    }
    publishLocationState();
    window.addEventListener("kingpos:explore-request-location-state", publishLocationState);
    return () => {
      window.removeEventListener("kingpos:explore-request-location-state", publishLocationState);
      window.dispatchEvent(new CustomEvent("kingpos:explore-location-state", {
        detail: { enabled: false, pending: false },
      }));
    };
  }, [gpsCoordinates, gpsStatus]);

  useEffect(() => {
    function handleHeaderLocationRequest() {
      requestCurrentLocation();
    }
    function handleHeaderGpsSearch(event: Event) {
      const detail = (event as CustomEvent<{ query: string; category?: string; target?: "auto" | "salons" | "posts" }>).detail;
      const searchQuery = detail.query;
      if (!gpsCoordinates) return;
      setQuery(searchQuery);
      if (detail.category !== undefined) setCategory(detail.category || "All");
      void runGpsSearch(gpsCoordinates, 1, searchQuery, searchOrderMode,
        detail.category === undefined ? normalizedCategory : cleanCategory(detail.category), "salons");
    }
    window.addEventListener("kingpos:explore-clear-current-location", turnOffCurrentLocation);
    window.addEventListener("kingpos:explore-search-current-location", handleHeaderGpsSearch);

    window.addEventListener(
      "kingpos:explore-use-current-location",
      handleHeaderLocationRequest,
    );

    return () => {
      window.removeEventListener("kingpos:explore-clear-current-location", turnOffCurrentLocation);
      window.removeEventListener("kingpos:explore-search-current-location", handleHeaderGpsSearch);
      window.removeEventListener(
        "kingpos:explore-use-current-location",
        handleHeaderLocationRequest,
      );
    };
  });

  function clearFilters() {
    try { window.sessionStorage.setItem(GPS_PREFERENCE_KEY, "off"); } catch { /* Optional preference. */ }
    if (commentViewer.isAuthenticated) void rememberExplorePreferenceAction({ location: "" }).catch(() => {});
    gpsRequestVersion.current += 1;
    gpsRequest.current?.abort();
    setGpsStatus("idle");
    setQuery("");
    setLocation("");
    setCategory("All");
    setGpsResponse(null);
    setGpsCoordinates(null);
    setNearYouSalons([]);
    setGpsStatus("idle");
    setGpsMessage(null);
    setExplicitSearchMode(false);
    setActiveDiscoveryResult(null);
    setLocationSource("none");
    try { window.localStorage.removeItem(SAVED_LOCATION_KEY); } catch { /* Storage may be unavailable. */ }

    startTransition(() => {
      router.push(`${pathname}?location=`, { scroll: false });
    });
  }

  function selectCategory(value: string) {
    prepareSearchTransition();
    if (commentViewer.isAuthenticated) void rememberExplorePreferenceAction({ category: value }).catch(() => {});
    gpsRequestVersion.current += 1;
    gpsRequest.current?.abort();
    setGpsStatus("idle");
    const nextCategory = cleanCategory(value);
    const nextSearchMode = Boolean(
      nextCategory || query.trim() || (explicitSearchMode && location.trim()),
    );

    setCategory(value);
    if (gpsCoordinates) {
      if (nextSearchMode) void runGpsSearch(gpsCoordinates, 1, query, searchOrderMode, nextCategory);
      else void runHomeNearYou(gpsCoordinates);
      return;
    }
    setGpsResponse(null);
    setNearYouSalons([]);
    setActiveDiscoveryResult(null);
    setExplicitSearchMode(nextSearchMode);

    const url = nextSearchMode
      ? buildUrl({
          category: value,
          location,
          page: 1,
          pathname,
          query,
          searchParams: new URLSearchParams(searchParams.toString()),
        })
      : buildUrl({ category: value, location, page: 1, pathname, query,
          searchParams: new URLSearchParams(searchParams.toString()) });

    startTransition(() => {
      router.push(url, { scroll: false });
    });
  }

  function applySearchShortcut(input: {
    category?: string;
    location?: string;
    query?: string;
    target?: "auto" | "salons" | "posts";
    scopePolicy?: "fixed" | "expandable";
    locationSource?: ExploreLocationSource;
  }) {
    prepareSearchTransition();
    gpsRequestVersion.current += 1;
    gpsRequest.current?.abort();
    setGpsStatus("idle");
    const nextCategory =
      input.category === undefined ? selectedCategory : input.category;
    const nextLocation =
      input.location === undefined ? location : input.location;
    const nextQuery = input.query === undefined ? query : input.query;
    const nextLocationSource = input.locationSource ?? (input.location === undefined ? locationSource : nextLocation.trim() ? "manual" : "none");
    if (gpsCoordinates && input.location === undefined) {
      setQuery(nextQuery); setCategory(nextCategory);
      void runGpsSearch(gpsCoordinates, 1, nextQuery, "relevance", cleanCategory(nextCategory), "salons", input.scopePolicy);
      return;
    }
    if (commentViewer.isAuthenticated) void rememberExplorePreferenceAction({ location: nextLocationSource === "manual" ? nextLocation : undefined, category: nextCategory }).catch(() => {});

    setQuery(nextQuery);
    setLocation(nextLocation);
    if (input.location !== undefined) {
      setLocationSource(nextLocationSource);
      setGpsCoordinates(null);
    }
    setCategory(nextCategory);
    setGpsResponse(null);
    setNearYouSalons([]);
    setActiveDiscoveryResult(null);
    setExplicitSearchMode(true);
    setSearchOrderMode("relevance");

    const shortcutParams = new URLSearchParams(searchParams.toString());
    for (const key of ["browse", "sort", "page", "cursor", "lat", "lng", "latitude", "longitude"]) shortcutParams.delete(key);
    shortcutParams.set("type", "salons");
    if (input.location !== undefined) {
      if (nextLocation.trim()) shortcutParams.set("locationSource", nextLocationSource); else shortcutParams.delete("locationSource");
      shortcutParams.set("scope", input.scopePolicy ?? (nextLocation.trim() ? "fixed" : "expandable"));
    } else if (input.scopePolicy) {
      shortcutParams.set("scope", input.scopePolicy);
    }
    const url = buildUrl({
      category: nextCategory,
      location: nextLocation,
      page: 1,
      pathname,
      query: nextQuery,
      searchParams: shortcutParams,
    });

    startTransition(() => {
      router.push(url, { scroll: false });
    });
  }

  function selectSearchSuggestion(suggestion: ExploreSearchSuggestion, scopePolicy: "fixed" | "expandable", typedLocation: string) {
    const area = suggestion.kind === "area";
    applySearchShortcut({
      query: area ? "" : suggestion.query,
      category: suggestion.kind === "service" && suggestion.category ? suggestion.category : selectedCategory,
      target: "salons",
      ...(area ? { location: suggestion.location ?? suggestion.query, scopePolicy: "fixed" as const }
        : typedLocation.trim() !== location.trim() ? { location: typedLocation.trim(), scopePolicy }
          : activeResponse.locationOrigin === "query" ? { location, locationSource: "saved" as const, scopePolicy } : { scopePolicy }),
    });
  }

  function applyNailFilters(filters: NailFilters) {
    setNailFilterSelection({ sessionKey: committedSearch.sessionKey, filters });
    const nextFilters = { ...activeResponse.filters };
    for (const key of ["shape", "length", "color", "finish", "tone", "season"] as const) {
      if (filters[key]) nextFilters[key] = filters[key]; else delete nextFilters[key];
    }
    if (committedSearch.coordinates) {
      void runGpsSearch(committedSearch.coordinates, 1, committedSearch.displayQuery, committedSearch.appliedSort, committedSearch.category, "salons", activeResponse.scope?.policy, nextFilters);
      return;
    }
    prepareSearchTransition();
    gpsRequestVersion.current += 1; gpsRequest.current?.abort();
    setGpsStatus("idle");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page"); params.delete("cursor"); params.set("type", "salons");
    for (const key of ["shape", "length", "color", "finish", "tone", "season"] as const) {
      if (filters[key]) params.set(key, filters[key]); else params.delete(key);
    }
    startTransition(() => router.push(pathname + "?" + params, { scroll: false }));
  }

  function cancelTypedSearch() {
    typedRequest.current = null;
    gpsRequestVersion.current += 1;
    gpsRequest.current?.abort();
    setGpsStatus("idle");
  }

  async function submitUnifiedSearch(searchQuery: string) {
    searchQuery = searchQuery.trim();
    if (typedRequest.current === searchQuery) return;
    typedRequest.current = searchQuery;
    const target = "salons";
    setQuery(searchQuery);
    // The text now chooses the field; an invisible old category must not narrow it.
    setCategory("All");
    if (gpsCoordinates) {
      await runGpsSearch(gpsCoordinates, 1, searchQuery, "relevance", "", target, undefined, searchQuery === query ? activeResponse.filters : {});
      if (typedRequest.current === searchQuery) typedRequest.current = null;
      return;
    }
    prepareSearchTransition();
    const version = ++gpsRequestVersion.current;
    gpsRequest.current?.abort();
    const controller = new AbortController();
    gpsRequest.current = controller;
    setGpsStatus("searching"); setGpsMessage(null);
    setActiveDiscoveryResult(null);
    const scope = activeResponse.scope?.policy ?? "expandable";
    try {
      const response = await fetchExploreSearchPage({
        query: searchQuery, category: "", target, location, filters: searchQuery === query ? activeResponse.filters : {},
        locationSource: activeResponse.locationOrigin === "query" ? "saved" : locationSource,
        scopePolicy: scope, sort: "relevance", page: 1, pageSize: initialResponse.pageSize,
      }, controller.signal);
      if (version !== gpsRequestVersion.current) return;
      setSessionResponse(response); setGpsResponse(null); setCommittedGpsContext(null);
      setNearYouSalons([]); setExplicitSearchMode(true);
      setSearchOrderMode(response.sort ?? "relevance");
      setLocation(response.location); setLocationSource(response.locationSource ?? locationSource);
      setCategory(response.category || "All");
      if (!response.error) rememberSearchUrl(response, searchQuery, target, scope);
    } catch {
      if (version === gpsRequestVersion.current) setGpsMessage("We couldn't update results. Please try again.");
    } finally {
      if (version === gpsRequestVersion.current) { setGpsStatus("idle"); typedRequest.current = null; }
    }
  }

  function resetExploreHome(replace = false) {
    cancelTypedSearch();
    setSearchResetVersion(value => value + 1);
    setQuery(""); setCategory("All"); setGpsResponse(null); setCommittedGpsContext(null);
    setExplicitSearchMode(false); setActiveDiscoveryResult(null); setSearchOrderMode("relevance");
    setGpsMessage(null); setSearchAreaOpen(false);
    const source = activeResponse.locationOrigin === "query" ? "saved" : locationSource;
    const url = exploreHomeUrl(location, source);
    startTransition(() => {
      if (replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: true });
    });
  }

  useEffect(() => {
    function onLogoReset(event: Event) { event.preventDefault(); resetExploreHome(); }
    window.addEventListener(EXPLORE_HOME_RESET_EVENT, onLogoReset);
    if (consumeExploreDocumentReload()) {
      router.replace(exploreHomeUrl(location, activeResponse.locationOrigin === "query" ? "saved" : locationSource), { scroll: false });
    }
    return () => window.removeEventListener(EXPLORE_HOME_RESET_EVENT, onLogoReset);
  });

  function applySearchArea(area: string, scopePolicy: "fixed" | "expandable") {
    try { window.sessionStorage.setItem(GPS_PREFERENCE_KEY, "off"); } catch { /* Optional preference. */ }
    setGpsMessage(null);
    const searchQuery = (document.getElementById("explore-search-query") as HTMLInputElement | null)?.value.trim() ?? query;
    applySearchShortcut({ query: searchQuery, target: searchQuery === query ? searchTarget : "auto", location: area, scopePolicy });
  }

  function changeSearchOrder(mode: SearchOrderMode) {
    prepareSearchTransition();
    setSearchOrderMode(mode);
    gpsRequestVersion.current += 1;
    gpsRequest.current?.abort();
    if (gpsActive && gpsCoordinates) {
      void runGpsSearch(gpsCoordinates, 1, query, mode);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", mode);
    params.delete("page");
    startTransition(() => router.push(buildUrl({ category: selectedCategory, location, page: 1, pathname, query, searchParams: params }), { scroll: false }));
  }

  function selectDiscoveryShortcut(shortcut: ExploreDiscoveryShortcut) {
    gpsRequestVersion.current += 1;
    gpsRequest.current?.abort();
    setGpsStatus("idle");
    if (shortcut.action.type === "category") {
      selectCategory(shortcut.action.category);
      return;
    }

    if (shortcut.action.type === "result") {
      setGpsResponse(null);
      setExplicitSearchMode(false);
      setActiveDiscoveryResult(shortcut.action.resultKind);
      window.requestAnimationFrame(() => {
        document
          .querySelector('[data-testid="explore-discovery-results"]')
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  return (
    <ExploreSocialProvider viewerId={commentViewer.userId}><SavePostAuthProvider isAuthenticated={commentViewer.isAuthenticated}>
    <ExplorePostContext.Provider value={{viewerId: commentViewer.userId, viewer: commentViewer, items: homeContent.inspiration.items}}>
    <main ref={firstContentRef} className="min-w-0 overflow-x-hidden bg-white">
      <div
        className={[
          hasDiscoveryRail
            ? "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(17.5rem,17.5rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(19rem,19rem)]"
            : "",
          "xl:items-start",
        ].join(" ")}
        data-testid="explore-desktop-grid"
      >
        <div className="min-w-0 overflow-hidden" data-testid="explore-main-column">
          <section className="bg-transparent" data-testid="explore-top-section">
            <div data-explore-inline-search className="mx-auto w-full max-w-[92rem] px-4 pt-2 sm:px-6 lg:px-3">
              <ExploreSearchToolbar key={searchResetVersion} query={query} category={normalizedCategory} location={location}
                initialDraftValue={readExploreStartupInteraction(commentViewer.userId)?.query}
                restoreInitialFocus={readExploreStartupInteraction(commentViewer.userId)?.focused}
                locationSource={activeResponse.locationOrigin === "query" ? "saved" : locationSource}
                scopePolicy={activeResponse.scope?.policy ?? (locationSource === "manual" ? "fixed" : "expandable")}
                locating={gpsStatus === "locating"} pending={isSearching}
                message={gpsMessage} areaOpen={searchAreaOpen} onAreaOpenChange={setSearchAreaOpen}
                onSearch={submitUnifiedSearch} onDraftChange={cancelTypedSearch} onCurrentLocation={requestCurrentLocation} onAreaApply={applySearchArea}
                onSuggestionSelect={suggestion => selectSearchSuggestion(suggestion, activeResponse.scope?.policy ?? "expandable", location)} />
            </div>
            {homeMode ? (
              <DesktopExploreLanding
                content={homeContent}
                salons={[...nearYouSalons, ...activeResults]}
              />
            ) : null}
          </section>

          {searchMode ? <ExploreSearchContext response={activeResponse} pending={isSearching}
            onAreaSelect={area => applySearchShortcut({ location: area })}
            onEditLocation={() => setSearchAreaOpen(true)} /> : null}
          {homeMode ? (
            <>
              <div className="xl:hidden">
                <ExploreHomeSections
                  activeDiscoveryResult={activeDiscoveryResult}
                  commentViewer={commentViewer}
                  content={homeContent}
                  discoveryShortcuts={discoveryContent.shortcuts}
                  initialFeed={initialFeed}
                  initialFeedPromise={initialFeedPromise}
                  startupExtrasPending={startupExtrasPending}
                  location={location}
                  gpsCoordinates={gpsCoordinates}
                  strictLocation={hasUrlLocation}
                  nearYouSalons={nearYouSalons}
                  onDiscoveryShortcutSelect={selectDiscoveryShortcut}
                  onSelectCategory={selectCategory}
                  selectedCategory={selectedCategory}
                />
              </div>
              <DesktopDiscoveryMarketplace
                activeResults={activeResults}
                activeDiscoveryResult={activeDiscoveryResult}
                discoveryShortcuts={discoveryContent.shortcuts}
                onDiscoveryShortcutSelect={selectDiscoveryShortcut}
                commentViewer={commentViewer}
                content={homeContent}
                gpsCoordinates={gpsCoordinates}
                location={location}
                nearYouSalons={nearYouSalons}
                onApplySearchShortcut={applySearchShortcut}
                onCurrentLocation={requestCurrentLocation}
                onSelectCategory={selectCategory}
                selectedCategory={selectedCategory}
                workspaceLocation={workspaceLocation}
                strictLocation={hasUrlLocation}
              />
            </>
          ) : discoveryResultMode && activeDiscoveryResult ? (
            <ExploreDiscoveryResults
              content={homeContent}
              commentViewer={commentViewer}
              selectedCategory={selectedCategory}
              location={location}
              strictLocation={(activeResponse.scope?.policy ?? (locationSource === "manual" ? "fixed" : "expandable")) === "fixed"}
              gpsCoordinates={gpsCoordinates}
              kind={activeDiscoveryResult}
              nearYouSalons={nearYouSalons}
              onClear={() => setActiveDiscoveryResult(null)}
              onCurrentLocation={requestCurrentLocation}
              searchResults={activeResults}
            />
          ) : (
            <>
              <section className="mx-auto grid w-full max-w-none gap-3 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:pl-8 lg:pr-3">
                <div>
                  <h2 className="text-xl font-semibold text-text-primary sm:text-2xl">
                    {summaryText}
                  </h2>
                  <p aria-live="polite" className="sr-only">
                    {isSearching ? "Updating Explore results." : summaryText}
                  </p>
                  {isSearching ? (
                    <p className="mt-1 text-sm text-text-secondary">
                      Updating results.
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="mx-auto grid w-full max-w-none gap-3 px-4 sm:px-6 lg:pl-8 lg:pr-3" data-testid="explore-content-search" style={isSearching && pendingIdeasHeight ? { minHeight: pendingIdeasHeight } : undefined}>
                {searchMode ? (
                  <SearchRefinementBar
                    category={committedSearch.category || "All"}
                    location={committedSearch.location}
                    mode={committedSearch.appliedSort}
                    onModeChange={changeSearchOrder}
                    onClear={clearFilters}
                    onShortcut={applySearchShortcut}
                    query={committedSearch.displayQuery}
                    workspaceLocation={workspaceLocation}
                  >
                    {!isSearching && !searchUnavailable && !activeResponse.requiresGps && hasAnyResults ? (
                      <NailInspirationFilters
                        key={committedSearch.sessionKey}
                        filters={nailFilters}
                        onChange={applyNailFilters}
                        search={{ salons: activeResults, discovery: { ...committedSearch.discovery, query: activeResponse.query } }}
                      />
                    ) : null}
                  </SearchRefinementBar>
                ) : null}
                {committedSearch.fallbackMessage && !isSearching ? <p className="text-sm text-text-secondary" role="status">{committedSearch.fallbackMessage}</p> : null}

                {searchUnavailable ? (
                  <ExploreNotice
                    title={activeResponse.errorKind === "timeout" ? "Search took too long" : activeResponse.errorKind === "network" ? "Search connection interrupted" : activeResponse.errorKind === "cursor" ? "Search session expired" : "We couldn't load salons right now."}
                    tone="warning"
                    action={<button type="button" onClick={() => void submitUnifiedSearch(query)} className="min-h-11 rounded-full bg-surface-muted px-4 font-semibold">Try again</button>}
                  >
                    {activeResponse.error || "Please try again."}
                  </ExploreNotice>
                ) : null}


                {!searchMode && !location.trim() && !activeResponse.error ? (
                  <ExploreNotice
                    action={
                      <button
                        className="rounded-full bg-surface-elevated px-3 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange"
                        onClick={requestCurrentLocation}
                        type="button"
                      >
                        Use current location
                      </button>
                    }
                    title="Add location for better discovery"
                  >
                    Search by city or ZIP, or choose current location when you want
                    distance-aware results.
                  </ExploreNotice>
                ) : null}


                {activeResponse.requiresGps && !searchUnavailable ? <><button type="button" onClick={requestCurrentLocation} disabled={isSearching} className="w-fit rounded-full bg-brand-teal-soft px-4 py-2 font-semibold text-brand-teal">Use current location</button><ExploreSearchOnwardActions {...onward} onChooseArea={() => setSearchAreaOpen(true)} /></> : null}
                {!searchUnavailable && !activeResponse.requiresGps ? (!hasAnyResults && !activeResponse.hasMore && !isSearching ? (
                  <div className="rounded-2xl border border-dashed border-divider-subtle bg-surface-elevated p-8 text-center shadow-[var(--shadow-soft)]">
                    <ExploreSearchOnwardActions {...onward} onChooseArea={() => setSearchAreaOpen(true)} />
                  </div>
                ) : (
                  <div className="grid gap-6">
                    <ResultSection
                      hideHeading
                      description={`${activeSections.bestMatches.length} result${
                        activeSections.bestMatches.length === 1 ? "" : "s"
                      }`}
                      rankKind="best"
                      results={activeSections.bestMatches.filter(isExplorePrimarySearchResult)}
                      title={
                        quotedQuery(committedSearch.displayQuery)
                          ? `Best matches for ${quotedQuery(committedSearch.displayQuery)}`
                          : committedSearch.category
                            ? `Best matches for ${committedSearch.category}`
                            : "Best matches"
                      }
                    />
                    <ResultSection
                      hideHeading={activeSections.bestMatches.length === 0}
                      description={`${activeSections.nearby.length} result${
                        activeSections.nearby.length === 1 ? "" : "s"
                      }`}
                      rankKind="area"
                      results={activeSections.nearby.filter(isExplorePrimarySearchResult)}
                      title={
                        committedSearch.location
                          ? `Salons in ${formatDisplayLocation(committedSearch.location)}`
                          : gpsActive && nearbyHasDistance
                            ? "Salons near you"
                            : "Salons in this area"
                      }
                    />
                    <ResultSection
                      hideHeading={activeSections.bestMatches.length === 0 && activeSections.nearby.length === 0}
                      description={`${activeSections.recommended.length} result${
                        activeSections.recommended.length === 1 ? "" : "s"
                      }`}
                      rankKind="recommended"
                      results={activeSections.recommended.filter(isExplorePrimarySearchResult)}
                      title="Recommended for you"
                    />
                    <SearchRecommendationSections results={referenceResults} location={formatDisplayLocation(committedSearch.location)} />
                  </div>
                )) : null}

                {hasAnyResults && !activeResponse.hasMore && !searchUnavailable && !activeResponse.requiresGps && !isSearching ? <ExploreSearchOnwardActions {...onward} onChooseArea={() => setSearchAreaOpen(true)} /> : null}

                {(activeResponse.hasMore ?? activeResponse.totalCount > activeResponse.pageSize) && !searchUnavailable && !activeResponse.requiresGps && !isSearching ? (
                  <SearchContinuationFeed
                    key={`${committedSearch.sessionKey}:${JSON.stringify(activeResponse.nextCursor)}`}
                    response={activeResponse}
                    coordinates={committedSearch.coordinates}
                     viewerId={commentViewer.userId}
                    onChooseArea={() => setSearchAreaOpen(true)}
                  />
                ) : null}
              </section>
            </>
          )}

          {!homeMode && !searchMode ? <QuickActions actions={quickActions} /> : null}
        </div>
        {hasDiscoveryRail ? (
          <ExploreDeferred><ExploreDiscoveryRail
            activeResultKind={activeDiscoveryResult}
            onSelect={selectDiscoveryShortcut}
            shortcuts={discoveryContent.shortcuts.map(shortcut => exploreAlternatingShortcuts(discoveryContent.shortcuts).find(entry => entry.id === shortcut.id) ?? shortcut)}
          /></ExploreDeferred>
        ) : null}
      </div>
    </main>
    </ExplorePostContext.Provider>
    </SavePostAuthProvider></ExploreSocialProvider>
  );
}
