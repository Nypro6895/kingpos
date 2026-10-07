"use client";

import type { ExploreFeedItem } from "@/types/explore";
import { SubmitButton } from "@/components/submit-button";

import {SalonTrustLine,SalonVerifiedBadge} from "@/components/salon-trust-line";
import {salonPopularPrice} from "@/lib/salon-identity";
import { resolveNailCoverImage, isDefaultNailImage } from "@/lib/default-nail-images";
import { NailIllustrationCredit } from "@/components/nail-illustration-credit";

import {
  loadExploreNearYouAction,
  searchExploreWithGpsAction,
} from "@/app/explore/actions";
import {
  ExploreDiscoveryRail,
  MobileDiscoveryShortcuts,
} from "@/app/explore/customer-explore-utility-panel";
import { ExploreDiscoveryFeed } from "@/app/explore/explore-discovery-feed";
import { withRequestTimeout } from "@/lib/request-timeout";
import { ExploreBookButton, ExploreSalonLove } from "@/components/explore-account-actions";
import { ExploreAdSlot } from "@/components/explore-advertising";
import { SavePostAuthProvider, SavePostButton } from "@/app/saved-post/save-post-button";
import { SalonOperatingStatusBadge } from "@/components/salon-operating-status-badge";
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
  type ExploreInspirationPage,
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
  orderReylumiExploreResults,
  type ReylumiExploreSearchOrder,
} from "@/lib/reylumi-trust";
import type { PostCommentViewer } from "@/types/post-comments";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type ExploreQuickAction = {
  description: string;
  href: string;
  label: string;
  tone: "dark" | "light";
};

type ExploreClientProps = {
  commentViewer: PostCommentViewer;
  discoveryContent: ExploreDiscoveryContent;
  hasUrlLocation: boolean;
  homeContent: ExploreHomeContent;
  initialFeed: ExploreFeedPage;
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
const EXPLORE_DISCOVERY_CATEGORIES = [
  { category: "All", icon: "grid", label: "All" },
  { category: "Nails", icon: "hand", label: "Nails" },
  { category: "Hair", icon: "user", label: "Hair" },
  { category: "Lashes", icon: "eye", label: "Lashes" },
  { category: "Spa", icon: "spa", label: "Spa" },
  { category: "Brows", icon: "brow", label: "Brows" },
  { category: "Massage", icon: "massage", label: "Massage" },
] as const;
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

type ExploreCategoryIconName =
  | "brow"
  | "eye"
  | "grid"
  | "hand"
  | "massage"
  | "more"
  | "spa"
  | "user";

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

function ExploreCategoryIcon({ name }: { name: ExploreCategoryIconName }) {
  const common = {
    "aria-hidden": true,
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };
  const paths: Record<ExploreCategoryIconName, ReactNode> = {
    brow: <path d="M4 14c4-4 12-4 16 0M7 12c3-1.8 7-1.8 10 0" />,
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    grid: (
      <>
        <rect height="5" rx="1" width="5" x="4" y="4" />
        <rect height="5" rx="1" width="5" x="15" y="4" />
        <rect height="5" rx="1" width="5" x="4" y="15" />
        <rect height="5" rx="1" width="5" x="15" y="15" />
      </>
    ),
    hand: (
      <>
        <path d="M7 11V6a1.5 1.5 0 0 1 3 0v5" />
        <path d="M10 10V5a1.5 1.5 0 0 1 3 0v6" />
        <path d="M13 11V7a1.5 1.5 0 0 1 3 0v6" />
        <path d="M16 13v-2a1.5 1.5 0 0 1 3 0v3c0 4-2.6 7-6.5 7H11c-2.2 0-3.9-1.1-5-3l-1.6-2.9a1.6 1.6 0 0 1 2.7-1.7L9 15" />
      </>
    ),
    massage: (
      <>
        <circle cx="8" cy="7" r="3" />
        <path d="M2 21c.8-4 3.2-6 7-6h2c4.2 0 7 2.1 8 6" />
        <path d="M16 6h6M18 3l4 3-4 3" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    spa: (
      <>
        <path d="M12 21c-4.5-2.8-7-6-7-9.5A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 7 5.5c0 3.5-2.5 6.7-7 9.5Z" />
        <path d="M12 6c0-2 1-3.5 3-4" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22a8 8 0 0 1 16 0" />
      </>
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function CategoryChips({
  allLabel = "All",
  category,
  onChange,
  onMore,
}: {
  allLabel?: string;
  category: string;
  onChange: (category: string) => void;
  onMore: () => void;
}) {
  const selectedCategory = cleanCategory(category);

  return (
    <nav
      aria-label="Explore categories"
      className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <div className="flex w-max gap-2">
        {EXPLORE_DISCOVERY_CATEGORIES.map((option) => {
          const optionCategory = cleanCategory(option.category);
          const isActive =
            optionCategory.toLowerCase() === selectedCategory.toLowerCase();
          const label = option.category === "All" ? allLabel : option.label;

          return (
            <button
              aria-pressed={isActive}
              className={[
                "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                isActive
                  ? "bg-brand-orange-soft text-brand-orange ring-1 ring-brand-orange/35"
                  : "bg-surface-elevated text-text-secondary ring-1 ring-divider-subtle/85 hover:text-text-primary hover:ring-brand-orange/25",
              ].join(" ")}
              key={option.label}
              onClick={() => onChange(option.category)}
              type="button"
            >
              <ExploreCategoryIcon name={option.icon} />
              <span>{label}</span>
            </button>
          );
        })}
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-elevated px-4 text-sm font-semibold text-text-secondary shadow-sm ring-1 ring-divider-subtle/85 transition hover:text-text-primary hover:ring-brand-orange/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          onClick={onMore}
          type="button"
        >
          <ExploreCategoryIcon name="more" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
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

function displaySalonCity(salon: ExploreSearchResult) {
  return formatDisplayLocation(
    [salon.city, salon.state].filter(Boolean).join(", "),
  );
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

function inspirationDetailHref(item: ExploreInspirationItem) {
  return item.salonHref
    ? `${item.salonHref}#${item.contentType}-${item.contentId}`
    : item.bookingHref ?? "/explore";
}

function shortcutIconName(shortcut: ExploreDiscoveryShortcut): ReylumiIconName {
  if (shortcut.id === "available-today") {
    return "calendar";
  }

  if (shortcut.id === "near-you") {
    return "map-pin";
  }

  if (shortcut.id === "top-rated") {
    return "star";
  }

  if (shortcut.id === "under-60") {
    return "dollar";
  }

  if (shortcut.id === "trending") {
    return "flame";
  }

  return "sparkle";
}

function shortcutToneClass(shortcut: ExploreDiscoveryShortcut) {
  if (shortcut.id === "available-today" || shortcut.id === "near-you") {
    return "bg-sky-50 text-sky-600 ring-sky-100";
  }

  if (shortcut.id === "top-rated") {
    return "bg-amber-50 text-amber-600 ring-amber-100";
  }

  if (shortcut.id === "under-60") {
    return "bg-violet-50 text-violet-600 ring-violet-100";
  }

  if (shortcut.id === "trending") {
    return "bg-rose-50 text-rose-600 ring-rose-100";
  }

  return "bg-emerald-50 text-emerald-600 ring-emerald-100";
}

function DesktopShortcutCard({
  activeResultKind,
  onSelect,
  shortcut,
}: {
  activeResultKind: ExploreDiscoveryResultKind | null;
  onSelect: (shortcut: ExploreDiscoveryShortcut) => void;
  shortcut: ExploreDiscoveryShortcut;
}) {
  const active =
    shortcut.action.type === "result" &&
    shortcut.action.resultKind === activeResultKind;
  const className = [
    "group grid min-h-[5.75rem] content-center rounded-[0.8rem] bg-white p-3 text-left shadow-[0_8px_18px_rgba(35,25,22,0.035)] ring-1 transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
    active ? "ring-brand-orange/35" : "ring-divider-subtle/75",
  ].join(" ");
  const content = (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-[0.75rem] ring-1 ${shortcutToneClass(
          shortcut,
        )}`}
      >
        <ReylumiIcon className="h-5 w-5" name={shortcutIconName(shortcut)} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-text-primary">
          {shortcut.label}
        </span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">
          {shortcut.actionLabel}
        </span>
        {shortcut.context ? (
          <span className="mt-0.5 block truncate text-[11px] text-text-muted">
            {shortcut.context}
          </span>
        ) : null}
      </span>
    </span>
  );

  if (shortcut.action.type === "href") {
    return (
      <Link className={className} href={shortcut.action.href}>
        {content}
      </Link>
    );
  }

  return (
    <button
      aria-pressed={active}
      className={className}
      onClick={() => onSelect(shortcut)}
      type="button"
    >
      {content}
    </button>
  );
}

function DesktopShortcutGrid({
  activeResultKind,
  onSelect,
  shortcuts,
}: {
  activeResultKind: ExploreDiscoveryResultKind | null;
  onSelect: (shortcut: ExploreDiscoveryShortcut) => void;
  shortcuts: ExploreDiscoveryShortcut[];
}) {
  if (shortcuts.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {shortcuts.slice(0, 5).map((shortcut) => (
        <DesktopShortcutCard
          activeResultKind={activeResultKind}
          key={shortcut.id}
          onSelect={onSelect}
          shortcut={shortcut}
        />
      ))}
    </div>
  );
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

function DesktopSocialProof({ content }: { content: ExploreHomeContent }) {
  const proofImages = content.inspiration.items.slice(0, 5);

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[0.9rem] bg-white/82 px-3 py-2 ring-1 ring-divider-subtle/70">
      <div className="flex -space-x-2">
        {proofImages.map((item, index) => (
          <span
            className="relative block h-9 w-9 overflow-hidden rounded-full bg-surface-muted ring-2 ring-white"
            key={`${item.mediaId}:${index}`}
          >
            <Image
              alt=""
              className="object-cover"
              fill
              loading="lazy"
              sizes="36px"
              src={item.salonLogoImageUrl ?? item.imageUrl}
            />
          </span>
        ))}
        {proofImages.length === 0 ? (
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-orange text-xs font-black text-white ring-2 ring-white">
            R
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-text-primary">
          Discover work from local beauty professionals
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-text-secondary">
          <span>Explore looks and available services</span>
        </p>
      </div>
    </div>
  );
}

function DesktopInspiredCard({
  item,
  onOpen,
  priority = false,
}: {
  item: ExploreInspirationItem;
  onOpen?: (item: ExploreInspirationItem) => void;
  priority?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const href = inspirationDetailHref(item);
  const service = inspirationServiceLabel(item) ?? "Featured look";
  const price = inspirationPriceLabel(item);
  const duration = inspirationDurationLabel(item);
  const distance = inspirationDistanceLabel(item);
  const availability = inspirationAvailabilityLabel(item);

  return (
    <article className="overflow-hidden rounded-[0.85rem] bg-white shadow-[0_12px_28px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/75 transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(35,25,22,0.08)]">
      <div className="relative p-2 pb-0">
        {onOpen ? (
          <button
            aria-label={`Open ${service} from ${item.salonName}`}
            className="group block w-full overflow-hidden rounded-[0.75rem] bg-surface-muted text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => onOpen(item)}
            type="button"
          >
            <span className="relative block aspect-[4/3]">
              {imageFailed ? (
                <span className="grid h-full w-full place-items-center bg-brand-orange-soft text-lg font-semibold text-brand-orange">
                  {salonInitials(item.salonName)}
                </span>
              ) : (
                <Image
                  alt={`${service} from ${item.salonName}`}
                  className="object-cover transition duration-500 group-hover:scale-[1.03]"
                  fill
                  loading={priority ? "eager" : "lazy"}
                  onError={() => setImageFailed(true)}
                  priority={priority}
                  sizes="(max-width: 1280px) 22vw, 280px"
                  src={item.imageUrl}
                />
              )}
            </span>
          </button>
        ) : (
          <Link
            aria-label={`Open ${service} from ${item.salonName}`}
            className="group block overflow-hidden rounded-[0.75rem] bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={href}
          >
          <span className="relative block aspect-[4/3]">
            {imageFailed ? (
              <span className="grid h-full w-full place-items-center bg-brand-orange-soft text-lg font-semibold text-brand-orange">
                {salonInitials(item.salonName)}
              </span>
            ) : (
              <Image
                alt={`${service} from ${item.salonName}`}
                className="object-cover transition duration-500 group-hover:scale-[1.03]"
                fill
                loading={priority ? "eager" : "lazy"}
                onError={() => setImageFailed(true)}
                priority={priority}
                sizes="(max-width: 1280px) 22vw, 280px"
                src={item.imageUrl}
              />
            )}
          </span>
          </Link>
        )}
        {availability ? (
          <span className="absolute left-4 top-4 rounded-full bg-emerald-50/95 px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm ring-1 ring-emerald-100">
            {availability}
          </span>
        ) : null}
        {item.saveTarget ? (
          <SavePostButton
            className="absolute right-4 top-4"
            initialSaved={item.saveTarget.saved}
            saveCount={item.saveTarget.saveCount}
            size="compact"
            target={item.saveTarget}
          />
        ) : (
          <span className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-white/92 text-text-secondary shadow-sm ring-1 ring-white/80">
            <ReylumiIcon className="h-4 w-4" name="bookmark" />
          </span>
        )}
      </div>
      <div className="grid gap-2 p-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              className="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm font-semibold text-text-primary transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={item.salonHref ?? href}
            >
              <span className="truncate">{item.salonName}</span>
              <SalonVerifiedBadge verified={item.trust.identityVerified}/>
            </Link>
            <SalonTrustLine signals={item.trust} href={item.salonHref} name={item.salonName} distance={distance} className="text-text-secondary"/>
          </div>
          <ExploreBookButton href={item.bookingEnabled ? item.bookingHref : null} name={item.salonName} contactHref={item.salonHref} phoneHref={item.phoneHref} />
        </div>
        <div className="grid gap-1">
          <p className="truncate text-sm font-semibold text-text-primary">
            {service}
          </p>
          <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-text-secondary">
            {price ? <span className="text-text-primary">{price}</span> : null}
            {duration ? <span>{duration}</span> : null}
          </p>
        </div>
      </div>
    </article>
  );
}

function DesktopInspiredGrid({ content }: { content: ExploreHomeContent }) {
  const items = content.inspiration.items.slice(0, 4);
  const [selectedItem, setSelectedItem] =
    useState<ExploreInspirationItem | null>(null);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3" data-testid="desktop-inspired-style">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">
            Inspired by your style
          </h2>
          <p className="mt-0.5 text-xs font-medium text-text-secondary">
            Real work, prices, time, distance, and open booking context.
          </p>
        </div>
        <Link
          className="text-xs font-semibold text-brand-orange transition hover:text-brand-orange-hover"
          href="/explore?category=Nails"
        >
          View all
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item, index) => (
          <DesktopInspiredCard
            item={item}
            key={item.mediaId}
            onOpen={setSelectedItem}
            priority={index === 0}
          />
        ))}
      </div>
      {selectedItem ? (
        <InspirationPreview
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}
    </section>
  );
}

function DesktopExploreLanding({
  activeDiscoveryResult,
  content,
  discoveryShortcuts,
  onExploreClick,
  onSelectCategory,
  onSelectDiscoveryShortcut,
  selectedCategory,
}: {
  activeDiscoveryResult: ExploreDiscoveryResultKind | null;
  content: ExploreHomeContent;
  discoveryShortcuts: ExploreDiscoveryShortcut[];
  onExploreClick: () => void;
  onSelectCategory: (category: string) => void;
  onSelectDiscoveryShortcut: (shortcut: ExploreDiscoveryShortcut) => void;
  selectedCategory: string;
}) {
  const bookableCount = mergeHomeSalons(
    content.recommendedSalons,
    content.newSalons,
  ).filter((salon) => salon.bookingEnabled).length;

  return (
    <div className="hidden bg-[linear-gradient(180deg,#fffaf7_0%,#ffffff_85%)] px-8 pb-6 pt-4 xl:block">
      <div className="mx-auto grid w-full max-w-[92rem] overflow-hidden rounded-[1rem] bg-white shadow-[0_18px_50px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/75">
        <div className="grid gap-5 px-7 py-7">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-center">
            <div className="min-w-0">
              <h1 className="max-w-xl text-3xl font-semibold leading-tight text-text-primary">
                Discover local beauty pros. See real work.{" "}
                <span className="text-brand-orange">Book instantly.</span>
              </h1>
              <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-text-secondary">
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
            <DesktopSocialProof content={content} />
          </div>
          <CategoryChips
            category={selectedCategory}
            onChange={onSelectCategory}
            onMore={onExploreClick}
          />
          <DesktopShortcutGrid
            activeResultKind={activeDiscoveryResult}
            onSelect={onSelectDiscoveryShortcut}
            shortcuts={discoveryShortcuts}
          />
          <DesktopInspiredGrid content={content} />
          <p className="sr-only">
            Explore shows {content.inspiration.items.length} public looks and{" "}
            {bookableCount} bookable shops.
          </p>
        </div>
      </div>
    </div>
  );
}

function MobileExploreSearch({
  gpsStatus,
  location,
  onCurrentLocation,
  query,
  selectedCategory,
}: {
  gpsStatus: GpsStatus;
  location: string;
  onCurrentLocation: () => void;
  query: string;
  selectedCategory: string;
}) {
  const normalizedCategory = cleanCategory(selectedCategory);
  const canUseLocation = gpsStatus !== "locating" && gpsStatus !== "searching";

  return (
    <form
      action="/explore"
      className="grid gap-2 rounded-[0.95rem] bg-surface-elevated p-2 shadow-[0_10px_26px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/75 xl:hidden"
      role="search"
    >
      <label
        className="grid min-h-11 gap-0.5 rounded-[0.8rem] bg-surface-muted px-3 py-1.5 ring-1 ring-transparent transition focus-within:bg-white focus-within:ring-brand-orange/25"
        htmlFor="customer-mobile-explore-search"
      >
        <span className="text-[11px] font-medium text-text-muted">
          Search Explore
        </span>
        <input
          className="min-w-0 bg-transparent text-sm font-semibold text-text-primary outline-none placeholder:text-text-muted"
          defaultValue={query}
          id="customer-mobile-explore-search"
          name="q"
          placeholder="Salon, service, city, or ZIP"
          type="search"
        />
      </label>
      <label className="grid gap-0.5 rounded-[0.8rem] bg-surface-muted px-3 py-1.5">
        <span className="text-[11px] font-medium text-text-muted">Location (optional)</span>
        <input
          className="min-w-0 bg-transparent text-sm text-text-primary outline-none"
          defaultValue={location}
          name="location"
          placeholder="Any location"
          type="search"
        />
      </label>
      {normalizedCategory ? (
        <input name="category" type="hidden" value={normalizedCategory} />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <SubmitButton pendingLabel="Processing…"
          className="min-h-10 rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          type="submit"
        >
          Search
        </SubmitButton>
        <button
          className="min-h-10 rounded-full bg-brand-teal-soft px-4 text-sm font-semibold text-brand-teal transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canUseLocation}
          onClick={onCurrentLocation}
          type="button"
        >
          {canUseLocation ? "Near you" : "Locating"}
        </button>
      </div>
    </form>
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
        Boolean(salon.nextAvailabilityLabel) || salon.operatingStatus.isOpen,
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
  if (item.discoverySalon) return filterSalonsForDesktopDiscovery([item.discoverySalon], filters, category).length > 0;
  if (filters.more.includes("new") || filters.more.includes("trending")) return false;
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
  }], filters, category).length > 0;
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
    { label: "Available today", more: "available_today" },
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
        <Link
          className="shrink-0 text-sm font-semibold text-brand-orange hover:text-brand-orange-hover"
          href={actionHref}
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function PublicSalonProfilesSection({ salons, selectedCategory = "" }: { salons: ExploreSearchResult[]; selectedCategory?: string }) {
  const profiles = salons.filter((salon) => salon.hasPublicProfile && UUID_PATTERN.test(salon.id) && salonMatchesDiscoveryCategory(salon, selectedCategory)).slice(0, 12);
  if (!profiles.length) return null;
  return <section className="grid gap-3" data-testid="public-salon-profiles">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold text-text-primary">Explore salons</h2><p className="mt-1 text-sm text-text-secondary">Find salon profiles, contact details and directions.</p></div>
      <Link className="shrink-0 text-sm font-semibold text-brand-orange" href={`/explore?${new URLSearchParams({ category: cleanCategory(selectedCategory) || "All" })}`}>View all →</Link>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {profiles.map((salon) => <article key={salon.id} className="grid gap-3 rounded-2xl border border-divider-subtle bg-white p-4">
        {salon.coverImageUrl ? <Link href={salonProfileHref(salon.id)} className="relative block aspect-[3/2] overflow-hidden rounded-xl">
          <Image src={salon.coverImageUrl} alt={isDefaultNailImage(salon.coverImageUrl) ? "AI-generated nail-service illustration" : `${salon.name} salon photo`} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw" className="object-cover" />
          <NailIllustrationCredit imageUrl={salon.coverImageUrl} className="absolute bottom-2 right-2" />
        </Link> : null}
        <Link href={salonProfileHref(salon.id)} className="flex items-center gap-3">
          <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)] font-semibold text-brand-orange"><SalonLogoContent salon={salon} size={48} /></span>
          <span className="min-w-0"><span className="block font-semibold text-text-primary">{salon.name}</span><span className="block text-xs text-text-secondary">{[salon.serviceCategories.join(" · "), salon.city, salon.state].filter(Boolean).join(" · ")}</span></span>
        </Link>
        <p className="text-sm text-text-secondary">{[salon.addressLine1, salon.addressLine2, salon.city, salon.state, salon.postalCode].filter(Boolean).join(", ")}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {salon.phone ? <a href={`tel:${salon.phone}`} className="font-semibold text-text-primary">{salon.phone}</a> : null}
          <Link className="font-medium text-brand-orange" href={salonProfileHref(salon.id)}>View profile →</Link>
        </div>
        <div className="flex justify-between gap-2"><ExploreSalonLove salonId={salon.id} name={salon.name}/><ExploreBookButton href={salon.bookingEnabled?salon.bookingHref:null} name={salon.name} contactHref={salonProfileHref(salon.id)} phoneHref={salon.phone?`tel:${salon.phone}`:null}/></div>
      </article>)}
    </div>
  </section>;
}

function CompactSalonCard({ salon }: { salon: ExploreHomeSalon }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? resolveNailCoverImage({ id: salon.id, name: salon.name, categories: salon.serviceCategories }) : salon.coverImageUrl;
  const displayName = displaySalonName(salon.name);
  const profileHref =
    UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
      ? salonProfileHref(salon.id)
      : null;
  const href = profileHref ?? salon.bookingHref ?? "/explore";
  const service = salonPopularPrice(salon) ? null : featuredServiceLine(salon);
  const price = salonPopularPrice(salon);

  return (
    <article
      className="min-w-[11.25rem] snap-start overflow-hidden rounded-[0.95rem] bg-surface-elevated shadow-[0_9px_24px_rgba(35,25,22,0.042)] ring-1 ring-divider-subtle/75 transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(35,25,22,0.075)] sm:min-w-0"
      style={{ flex: "0 0 calc((100% - 2.25rem) / 4)" }}
    >
      <Link
        className="group grid min-h-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href={href}
      >
        <span className="block p-2 pb-0">
          <span className="relative block aspect-[16/9] overflow-hidden rounded-[0.75rem] bg-surface-muted">
            {imageUrl ? (
              <Image
                alt={isDefaultNailImage(imageUrl) ? "AI-generated nail-service illustration" : `${displayName} salon photo`}
                className="object-cover transition duration-300 group-hover:scale-[1.025]"
                fill
                onError={() => setImageFailed(true)}
                sizes="(max-width: 768px) 180px, 25vw"
                src={imageUrl}
              />
            ) : (
              <span className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)] text-xl font-semibold text-brand-orange">
                {salonInitials(displayName)}
              </span>
            )}
          </span>
        </span>
        <NailIllustrationCredit imageUrl={imageUrl} className="mx-3 mt-2 justify-self-start" />
        <span className="grid gap-0.5 p-3 pt-2">
          <span className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold text-text-primary"><span className="truncate">{displayName}</span><SalonVerifiedBadge verified={salon.identityVerified}/></span>
          <SalonTrustLine staticOnly compact signals={salon} name={displayName} className="text-text-secondary"/>
          {price||service?<span className="truncate text-[11px] leading-5 text-text-secondary">{price??service}</span>:null}
          <SalonOperatingStatusBadge className="max-w-full" status={salon.operatingStatus}/>
        </span>
      </Link>
      <div className="flex items-center justify-between gap-2 px-3 pb-3"><ExploreSalonLove salonId={salon.id} name={salon.name}/><ExploreBookButton href={salon.bookingEnabled?salon.bookingHref:null} name={salon.name} contactHref={profileHref} phoneHref={salon.phone?`tel:${salon.phone}`:null}/></div>
    </article>
  );
}

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

function TrendingDesignTile({
  item,
  onOpen,
  remainingLabel,
}: {
  item: ExploreInspirationItem;
  onOpen: (item: ExploreInspirationItem) => void;
  remainingLabel: string | null;
}) {
  const salonName = displaySalonName(item.salonName);
  const tileFrameClass =
    "group relative aspect-[1.15/1] min-w-[6.75rem] max-w-[6.75rem] snap-start overflow-hidden rounded-[0.8rem] bg-surface-muted text-left shadow-[0_8px_20px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/75 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(35,25,22,0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:min-w-[7.5rem] sm:max-w-[7.5rem] lg:min-w-[8.25rem] lg:max-w-[8.25rem]";
  const tileActionClass =
    "absolute inset-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
  const tileContent = (
    <>
      <Image
        alt={`${salonName} design`}
        className="object-cover transition duration-300 group-hover:scale-[1.045]"
        fill
        sizes="132px"
        src={item.imageUrl}
      />
      <span
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(36,27,31,0),rgba(36,27,31,0.08)_62%,rgba(36,27,31,0.22))]"
      />
      {remainingLabel ? (
        <span className="absolute inset-0 z-20 grid place-items-center bg-text-primary/58 text-xl font-semibold text-white">
          {remainingLabel}
        </span>
      ) : null}
    </>
  );

  return (
    <div className={tileFrameClass}>
      <button
        aria-label={`Open ${salonName} design`}
        className={tileActionClass}
        onClick={() => onOpen(item)}
        type="button"
      >
        {tileContent}
      </button>
      <ExploreBookButton compact className="absolute bottom-1.5 left-1.5 z-30" href={item.bookingEnabled ? item.bookingHref : null} name={item.salonName} contactHref={item.salonHref} phoneHref={item.phoneHref} />
      <SavePostButton
        className="absolute bottom-1.5 right-1.5 z-30 origin-bottom-right scale-75 shadow-sm sm:bottom-2 sm:right-2 sm:scale-[.82]"
        initialSaved={item.saveTarget.saved}
        target={item.saveTarget}
      />
    </div>
  );
}

function TrendingDesignsSection({
  initialPage,
  subtitle,
  title = "Fresh Looks",
}: {
  initialPage: ExploreInspirationPage;
  subtitle?: string;
  title?: string;
}) {
  const [selectedItem, setSelectedItem] =
    useState<ExploreInspirationItem | null>(null);
  const visibleItems = initialPage.items.slice(0, 8);
  const remainingCount = Math.max(0, initialPage.items.length - visibleItems.length);
  const remainingLabel =
    remainingCount > 0 ? `+${remainingCount}` : initialPage.hasMore ? "More" : null;

  return (
    <section className="grid gap-3" data-testid="trending-designs">
      {sectionHeader({
        actionHref: "/explore",
        subtitle: initialPage.error
          ? "Inspiration could not be loaded right now."
          : subtitle,
        title,
      })}
      {visibleItems.length > 0 ? (
        <div className="relative min-w-0 overflow-hidden">
          <div
            className="no-scrollbar min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth pb-3"
          >
            <div className="flex w-max snap-x snap-mandatory gap-3">
              {visibleItems.map((item, index) => (
                <TrendingDesignTile
                  item={item}
                  key={item.mediaId}
                  onOpen={setSelectedItem}
                  remainingLabel={
                    index === visibleItems.length - 1 ? remainingLabel : null
                  }
                />
              ))}
            </div>
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-12 bg-[linear-gradient(90deg,rgba(255,255,255,0),var(--page-background))] sm:block"
          />
        </div>
      ) : !initialPage.error ? (
        <div className="rounded-2xl border border-dashed border-divider-subtle bg-surface-elevated p-5 text-sm text-text-secondary">
          Fresh public looks will appear here as salons share photos.
        </div>
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



function SalonCard({
  featured = false,
  imageHref,
  rankAriaLabel,
  rankLabel,
  salon,
}: {
  featured?: boolean;
  imageHref?: string | null;
  rankAriaLabel: string;
  rankLabel: string;
  salon: ExploreSearchResult;
}) {
  const callHref = phoneHref(salon.phone);
  const distance = formatDistance(salon.distanceMiles);
  const location = formatSalonLocation(salon);
  const canViewProfile = UUID_PATTERN.test(salon.id) && salon.hasPublicProfile;
  const profileHref = canViewProfile ? salonProfileHref(salon.id) : null;
  const mediaHref = imageHref ?? profileHref;
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? resolveNailCoverImage({ id: salon.id, name: salon.name, categories: salon.serviceCategories }) : salon.coverImageUrl;
  const service = salonPopularPrice(salon) ? null : cardServiceLabel(salon);
  const price = salonPopularPrice(salon);
  const availabilityLabel = salonAvailabilityLine(salon);
  const bookingHref =
    salon.bookingEnabled && salon.bookingHref ? salon.bookingHref : null;
  const cardSizeClass = featured
    ? "aspect-[4/3] md:aspect-[16/9]"
    : "aspect-[4/3]";
  const imageSizes = featured
    ? "(max-width: 768px) 100vw, (max-width: 1280px) 66vw, 42vw"
    : "(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 24vw";

  return (
    <article
      className={[
        "group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_32px_rgba(80,47,36,0.06)] ring-1 ring-divider-subtle/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(80,47,36,0.12)] focus-within:ring-brand-orange/35",
      ].join(" ")}
    >
      <div className={`relative shrink-0 overflow-hidden bg-surface-muted ${cardSizeClass}`}>
      {mediaHref ? (
        <Link
          aria-label={isDefaultNailImage(imageUrl) ? `Open profile of ${salon.name}` : `Open featured work from ${salon.name}`}
          className="absolute inset-0 z-[1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={mediaHref}
        />
      ) : null}
      {imageUrl ? (
        <Image
          alt={isDefaultNailImage(imageUrl) ? "AI-generated nail-service illustration" : `${salon.name} salon photo`}
          className="object-cover transition duration-300 group-hover:scale-[1.02]"
          fill
          onError={() => setImageFailed(true)}
          sizes={imageSizes}
          src={imageUrl}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-text-primary px-6 text-center text-white">
          <div>
            <div className="relative mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-white/20 bg-white/10 text-lg font-semibold">
              <SalonLogoContent salon={salon} size={64} />
            </div>
            <p className="mt-4 text-sm font-semibold">Photos coming soon</p>
          </div>
        </div>
      )}

      <NailIllustrationCredit imageUrl={imageUrl} className="absolute right-3 bottom-3 z-20" />
      <div className="pointer-events-none absolute left-2.5 right-2.5 top-2.5 z-10 flex items-start justify-between gap-2">
        <span
          aria-label={rankAriaLabel}
          className="grid min-h-9 min-w-9 place-items-center rounded-[0.85rem] bg-white px-2 py-1 text-center text-[11px] font-bold leading-tight text-brand-orange shadow-sm"
        >
          {rankLabel}
        </span>
        {distance ? (
          <span className="rounded-full bg-text-primary/45 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/20">
            {distance}
          </span>
        ) : null}
      </div>

      </div>
      <div className="flex flex-1 flex-col gap-4 p-4 text-text-primary sm:p-5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {profileHref ? (
              <Link
                className="min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={profileHref}
              >
                <h3
                  className={[
                    "break-words font-semibold leading-snug transition hover:text-brand-orange",
                    featured ? "text-xl sm:text-2xl" : "text-lg",
                  ].join(" ")}
                >
                  {salon.name}
                </h3>
              </Link>
            ) : (
              <h3
                className={[
                  "min-w-0 break-words font-semibold leading-snug",
                  featured ? "text-xl sm:text-2xl" : "text-lg",
                ].join(" ")}
              >
                {salon.name}
              </h3>
            )}
            <SalonVerifiedBadge verified={salon.identityVerified}/>
          </div>
          {availabilityLabel?<span className="sr-only">{availabilityLabel}</span>:null}
          <SalonTrustLine signals={salon} href={profileHref} name={salon.name} distance={distance} className="text-text-secondary"/>
          {location?<p className="mt-1 text-sm leading-5 text-text-secondary">{location}</p>:null}
          {service || price ? (
            <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-text-primary">
              {service ? <span className="line-clamp-1">{service}</span> : null}
              {price ? <span className="text-text-primary">{price}</span> : null}
            </p>
          ) : null}          <SalonOperatingStatusBadge
            className="mt-2 max-w-full"
            showDetail={featured}
            status={salon.operatingStatus}
          />

        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-divider-subtle pt-4">
          <ExploreBookButton href={bookingHref} name={salon.name} contactHref={profileHref} phoneHref={callHref} />
          <ExploreSalonLove salonId={salon.id} name={salon.name} />
          {profileHref ? (
            <Link
              className={[
                "inline-flex min-h-10 items-center rounded-full bg-surface-muted px-4 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
              ].join(" ")}
              href={profileHref}
            >
              View salon
            </Link>
          ) : null}
          {callHref && !bookingHref && !canViewProfile ? (
            <a
              aria-label={`Call ${salon.name}`}
              className="inline-flex min-h-10 items-center rounded-full bg-surface-muted px-4 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={callHref}
            >
              Call
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function inspirationLocation(item: ExploreInspirationItem) {
  return formatDisplayLocation(
    [item.salonCity, item.salonState].filter(Boolean).join(", "),
  );
}

function inspirationServiceLabel(item: ExploreInspirationItem) {
  return item.serviceName ?? item.serviceCategory;
}

function inspirationDateLabel(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getFocusableElements(root: HTMLElement | null) {
  if (!root) {
    return [];
  }

  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "textarea:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  ).filter((element) => !element.hasAttribute("disabled"));
}

function countLabel(count: number) {
  return `${count} salon${count === 1 ? "" : "s"}`;
}

function bestMatchCountLabel(count: number) {
  return `${count} best match${count === 1 ? "" : "es"}`;
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

function orderedSearchSections(
  sections: ExploreSearchResponse["sections"],
  mode: SearchOrderMode,
) {
  return {
    bestMatches: orderReylumiExploreResults(sections.bestMatches, mode),
    nearby: orderReylumiExploreResults(sections.nearby, mode),
    recommended: orderReylumiExploreResults(sections.recommended, mode),
  };
}

function quotedQuery(query: string) {
  const trimmedQuery = query.trim();
  return trimmedQuery ? `"${trimmedQuery}"` : "";
}

function bestMatchDescription(input: {
  category: string;
  count: number;
  query: string;
}) {
  const queryLabel = quotedQuery(input.query);
  const category = cleanCategory(input.category);

  if (queryLabel) {
    return `${bestMatchCountLabel(input.count)} for ${queryLabel}`;
  }

  if (category) {
    return `${bestMatchCountLabel(input.count)} for ${category}`;
  }

  return bestMatchCountLabel(input.count);
}

function resultSummary(input: {
  bestCount: number;
  category: string;
  hasAnyResults: boolean;
  location: string;
  nearbyCount: number;
  query: string;
  recommendedCount: number;
}) {
  const location = input.location.trim();
  const queryLabel = quotedQuery(input.query);

  if (input.bestCount > 0) {
    const context = bestMatchDescription({
      category: input.category,
      count: input.bestCount,
      query: input.query,
    });

    return location ? `${context} in ${location}` : context;
  }

  if (queryLabel && input.nearbyCount > 0) {
    return location
      ? `No exact matches for ${queryLabel}. ${countLabel(input.nearbyCount)} in ${location}`
      : `No exact matches for ${queryLabel}`;
  }

  if (input.nearbyCount > 0) {
    return location
      ? `${countLabel(input.nearbyCount)} in ${location}`
      : countLabel(input.nearbyCount);
  }

  if (input.recommendedCount > 0) {
    return "Recommended salons on Reylumi";
  }

  return input.hasAnyResults ? countLabel(input.bestCount) : "No salons available";
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
  rankKind,
  results,
  title,
}: {
  description?: string;
  rankKind: SearchRankKind;
  results: ExploreSearchResult[];
  title: string;
}) {
  if (results.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-4">
      <div>
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
              {(index + 1) % 4 === 0 || (results.length < 4 && index === results.length - 1) ? <ExploreAdSlot /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SearchRefinementBar({
  category,
  location,
  mode,
  onModeChange,
  onShortcut,
  query,
  workspaceLocation,
}: {
  category: string;
  location: string;
  mode: SearchOrderMode;
  onModeChange: (mode: SearchOrderMode) => void;
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
      className="grid gap-3 rounded-2xl bg-surface-elevated p-3 ring-1 ring-divider-subtle/75"
      data-testid="explore-search-refinement"
    >
      <div className="flex flex-wrap items-center gap-2">
        {ordering.map((item) => (
          <button
            aria-pressed={mode === item.mode}
            className={[
              "min-h-9 rounded-full px-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
              mode === item.mode
                ? "bg-text-primary text-white"
                : "bg-white text-text-secondary ring-1 ring-divider-subtle hover:text-brand-orange",
            ].join(" ")}
            key={item.mode}
            onClick={() => onModeChange(item.mode)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      {shortcuts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {shortcuts.map((shortcut) => (
            <button
              className="min-h-9 rounded-full bg-white px-3 text-xs font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              key={`${shortcut.label}:${shortcut.query ?? ""}:${shortcut.location ?? ""}:${shortcut.category ?? ""}`}
              onClick={() => onShortcut(shortcut)}
              type="button"
            >
              {shortcut.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function InspirationPreview({
  item,
  onClose,
}: {
  item: ExploreInspirationItem;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const location = inspirationLocation(item);
  const service = inspirationServiceLabel(item);
  const price = inspirationPriceLabel(item);
  const duration = inspirationDurationLabel(item);
  const publishedAt = inspirationDateLabel(item.publishedAt);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (!firstElement || !lastElement) {
      return;
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="inspiration-preview-title"
        aria-modal="true"
        className="grid max-h-[94dvh] w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-t-2xl bg-surface-elevated shadow-2xl sm:max-w-5xl sm:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)] sm:grid-rows-1 sm:rounded-2xl"
        onKeyDown={trapFocus}
        ref={dialogRef}
        role="dialog"
      >
        <div className="relative min-h-[42dvh] bg-surface-muted sm:min-h-[72dvh]">
          <Image
            alt={`${item.salonName} nail inspiration preview`}
            className="object-contain"
            fill
            sizes="(max-width: 768px) 100vw, 68vw"
            src={item.imageUrl}
          />
          <SavePostButton
            className="absolute bottom-4 right-4 z-10"
            initialSaved={item.saveTarget.saved}
            target={item.saveTarget}
          />
        </div>
        <div className="grid max-h-[52dvh] min-h-0 content-between gap-5 overflow-y-auto p-5 sm:max-h-none sm:p-6">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2
                  className="line-clamp-2 text-xl font-semibold text-text-primary"
                  id="inspiration-preview-title"
                >
                {item.salonName} <SalonVerifiedBadge verified={item.trust.identityVerified}/>
              </h2>
                <SalonTrustLine signals={item.trust} href={item.salonHref} name={item.salonName} distance={inspirationDistanceLabel(item)} expanded className="text-text-secondary"/>
                {service||price?<p className="text-xs leading-5 text-text-secondary">{[service,price,duration].filter(Boolean).join(" · ")}</p>:null}
                {location ? (
                  <p className="text-[11px] leading-5 font-medium text-text-secondary">
                    {location}
                  </p>
                ) : null}
                <SalonOperatingStatusBadge
                  className="mt-0.5 max-w-full"
                  showDetail
                  status={item.operatingStatus}
                />
              </div>
              <button
                aria-label="Close preview"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-lg font-semibold text-text-secondary hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                onClick={onClose}
                ref={closeButtonRef}
                type="button"
              >
                x
              </button>
            </div>

            {item.captionExcerpt ? (
              <p className="mt-3 text-sm leading-6 text-text-secondary">
                {item.captionExcerpt}
              </p>
            ) : null}
            <div className="mt-4 grid gap-1 text-sm text-text-muted">
              {publishedAt ? <p>{publishedAt}</p> : null}
              {item.authorDisplayName ? (
                <p>
                  {item.authorIsAnonymous
                    ? item.authorDisplayName
                    : `By ${item.authorDisplayName}`}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <ExploreBookButton href={item.bookingEnabled ? item.bookingHref : null} name={item.salonName} contactHref={item.salonHref} phoneHref={item.phoneHref} />
            {item.salonHref ? (
              <Link
                className={[
                  "inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2",
                  item.bookingEnabled && item.bookingHref
                    ? "bg-surface-muted text-text-primary ring-1 ring-divider-subtle hover:bg-brand-orange-soft focus-visible:outline-brand-orange"
                    : "bg-text-primary text-white hover:bg-brand-black focus-visible:outline-brand-orange",
                ].join(" ")}
                href={item.salonHref}
              >
                View salon
              </Link>
            ) : null}
            {item.phoneHref ? (
              <a
                className="inline-flex min-h-10 items-center rounded-full bg-surface-muted px-4 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={item.phoneHref}
              >
                Call
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function discoveryBadgeLabel(salon: ExploreHomeSalon, fallback: string) {
  if (salon.distanceMiles !== null) {
    return "Nearby";
  }

  if (salon.latestMediaCreatedAt) {
    return "Fresh";
  }

  if (salon.homeSection === "new" || salon.isNew) {
    return "New";
  }

  if (salon.activeServiceCount >= 5) {
    return "Service variety";
  }

  if (buildReylumiTrustSummary(salon).qualityScore !== null) {
    return "LUMI Truth";
  }

  return fallback;
}

function discoveryServiceLabel(salon: ExploreHomeSalon) {
  return featuredServiceLine(salon);
}

function recommendedCardLinks(salon: ExploreHomeSalon) {
  const profileHref =
    UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
      ? salonProfileHref(salon.id)
      : null;
  const bookingHref =
    salon.bookingEnabled && salon.bookingHref ? salon.bookingHref : null;
  const viewHref = profileHref ?? bookingHref ?? "/explore";

  return {
    bookingHref,
    primaryHref: bookingHref ?? viewHref,
    primaryLabel: bookingHref ? "Book" : "View Salon",
    viewHref,
  };
}

function RecommendedFeatureCard({
  salon,
}: {
  salon: ExploreHomeSalon;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? resolveNailCoverImage({ id: salon.id, name: salon.name, categories: salon.serviceCategories }) : salon.coverImageUrl;
  const location = displaySalonCity(salon);
  const displayName = displaySalonName(salon.name);
  const service = salonPopularPrice(salon) ? null : discoveryServiceLabel(salon);
  const price = salonPopularPrice(salon);
  const reason = discoveryBadgeLabel(salon, "Recommended");
  const { primaryHref, viewHref } = recommendedCardLinks(salon);
  const showSecondaryViewAction = viewHref !== primaryHref;
  const trustHref =
    UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
      ? `${salonProfileHref(salon.id)}#lumi-trust`
      : null;
  const imageHref = trustHref ? trustHref.replace(/#lumi-trust$/, "") : viewHref;

  return (
    <article className="group relative min-h-[19rem] overflow-hidden rounded-[1rem] bg-text-primary shadow-[0_14px_38px_rgba(35,25,22,0.08)] ring-1 ring-divider-subtle/75">
      <Link
        aria-label={`View ${displayName}`}
        className="absolute inset-0 z-[1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href={imageHref}
      />
      {imageUrl ? (
        <Image
          alt={isDefaultNailImage(imageUrl) ? "AI-generated nail-service illustration" : `${displayName} salon photo`}
          className="object-cover transition duration-500 group-hover:scale-[1.02]"
          fill
          onError={() => setImageFailed(true)}
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 62vw, 42vw"
          src={imageUrl}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)] text-4xl font-semibold text-brand-orange">
          {salonInitials(displayName)}
        </div>
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(31,23,27,0.88),rgba(31,23,27,0.56)_42%,rgba(31,23,27,0.08)_100%)]"
      />
      <NailIllustrationCredit imageUrl={imageUrl} className="absolute right-3 top-3 z-20" />
      <div className="relative z-10 grid min-h-[19rem] max-w-[76%] content-end gap-2 p-4 text-white sm:p-5">
        <div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex w-fit rounded-full bg-white/14 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/20">
              Recommended because {reason.toLowerCase()}
            </span>
          </div>
          <h3 className="mt-1 line-clamp-2 text-xl font-semibold leading-tight sm:text-2xl">
            {displayName} <SalonVerifiedBadge verified={salon.identityVerified}/>
          </h3>
          <SalonTrustLine signals={salon} href={viewHref} name={displayName} distance={formatDistance(salon.distanceMiles)} className="text-white/85"/>
          {location ? (
            <p className="mt-2 truncate text-xs font-semibold text-white/70">
              {location}
            </p>
          ) : null}
          {price||service?<p className="text-xs leading-5 text-white/85">{price??service}</p>:null}
          <SalonOperatingStatusBadge
            className="mt-2 max-w-full"
            inverted
            showDetail
            status={salon.operatingStatus}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <ExploreBookButton href={salon.bookingEnabled?salon.bookingHref:null} name={salon.name} contactHref={viewHref} phoneHref={salon.phone?`tel:${salon.phone}`:null}/><ExploreSalonLove salonId={salon.id} name={salon.name}/>

          {showSecondaryViewAction ? (
            <Link
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-white/14 px-4 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href={viewHref}
            >
              View salon
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function RecommendedMiniTile({
  active,
  index,
  onSelect,
  salon,
}: {
  active: boolean;
  index: number;
  onSelect: (index: number) => void;
  salon: ExploreHomeSalon;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = displaySalonName(salon.name);
  const imageUrl = imageFailed ? resolveNailCoverImage({ id: salon.id, name: salon.name, categories: salon.serviceCategories }) : salon.coverImageUrl;

  return (
    <div className="relative"><button
      aria-label={`Feature ${displayName}`}
      aria-pressed={active}
      className={[
        "group relative aspect-[1.35/1] overflow-hidden rounded-[0.9rem] bg-surface-muted shadow-[0_7px_18px_rgba(35,25,22,0.04)] ring-1 ring-divider-subtle/75 transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
        active ? "ring-2 ring-brand-orange" : "",
      ].join(" ")}
      onClick={() => onSelect(index)}
      type="button"
    >
      {imageUrl ? (
        <Image
          alt=""
          className="object-cover transition duration-300 group-hover:scale-[1.04]"
          fill
          onError={() => setImageFailed(true)}
          sizes="180px"
          src={imageUrl}
        />
      ) : (
        <span className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)] text-xl font-semibold text-brand-orange">
          {salonInitials(displayName)}
        </span>
      )}
      <span className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(36,27,31,0),rgba(36,27,31,0.18))]" />
      <NailIllustrationCredit imageUrl={imageUrl} className="absolute bottom-1 right-1" />
    </button><div className="absolute bottom-1 left-1 right-1 z-20 flex justify-between"><ExploreSalonLove salonId={salon.id} name={salon.name}/><ExploreBookButton compact href={salon.bookingEnabled?salon.bookingHref:null} name={salon.name} contactHref={salonProfileHref(salon.id)} phoneHref={salon.phone?`tel:${salon.phone}`:null}/></div></div>
  );
}

function RecommendedForYouSection({
  description,
  results,
  testId,
  title,
}: {
  description: string;
  results: ExploreHomeSalon[];
  testId: string;
  title: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexWithinBounds =
    results.length > 0 ? activeIndex % results.length : 0;

  useEffect(() => {
    if (results.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % results.length);
    }, 5600);

    return () => window.clearInterval(interval);
  }, [results.length]);

  if (results.length === 0) {
    return null;
  }

  const activeSalon = results[activeIndexWithinBounds] ?? results[0];
  const miniSalons = results
    .map((salon, index) => ({ index, salon }))
    .filter((item) => item.index !== activeIndexWithinBounds)
    .slice(0, 4);

  return (
    <section className="grid gap-2.5" data-testid={testId}>
      <div>
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          {description}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(15rem,0.72fr)]">
        <RecommendedFeatureCard salon={activeSalon} />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-1 xl:grid-cols-2">
          {miniSalons.map(({ index, salon }) => (
            <RecommendedMiniTile
              active={index === activeIndexWithinBounds}
              index={index}
              key={`${salon.homeSection}:${salon.id}`}
              onSelect={setActiveIndex}
              salon={salon}
            />
          ))}
        </div>
      </div>
    </section>
  );
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
    return "Available today";
  }

  if (kind === "near_you") {
    return "Near you";
  }

  if (kind === "top_rated") {
    return "Top artists";
  }

  if (kind === "trending") {
    return "Trending";
  }

  if (kind === "under_60") {
    return "Under $60";
  }

  return "Recommended salons";
}

function ExploreDiscoveryResults({
  content,
  gpsCoordinates,
  kind,
  nearYouSalons,
  onClear,
  onCurrentLocation,
  searchResults,
}: {
  content: ExploreHomeContent;
  gpsCoordinates: GpsCoordinates | null;
  kind: ExploreDiscoveryResultKind;
  nearYouSalons: ExploreHomeSalon[];
  onClear: () => void;
  onCurrentLocation: () => void;
  searchResults: ExploreSearchResult[];
}) {
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
            title="Available today"
          />
        ) : (
          <div className="mx-auto w-full max-w-[40rem]">
            <ExploreNotice title="No open times found yet">
              Bookable salons will appear here when availability is published.
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

      {kind === "trending" ? (
        <TrendingDesignsSection initialPage={content.inspiration} />
      ) : null}

      {kind === "recommended" ? (
        <RecommendedForYouSection
          description="Personalized from public salon details, service fit, and availability context."
          results={content.recommendedSalons}
          testId="recommended-discovery-results"
          title="Recommended salons"
        />
      ) : null}

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
        availability: "today",
        date: "today",
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

function DesktopEmptyState({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-[1rem] border border-dashed border-divider-subtle bg-surface-elevated p-6 text-sm text-text-secondary">
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-2xl leading-6">{children}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
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
  onCurrentLocation,
  userCoordinates,
}: {
  looks: ExploreInspirationItem[];
  mapSalons: ExploreMapSalon[];
  onCurrentLocation: () => void;
  userCoordinates: GpsCoordinates | null;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedItem, setSelectedItem] =
    useState<ExploreInspirationItem | null>(null);
  const [preferredSelectedSalonId, setPreferredSelectedSalonId] =
    useState<string | null>(null);
  const mapAvailable = Boolean(MAPTILER_BROWSER_KEY && mapSalons.length > 0);
  const selectedSalonId = mapSalons.some(
    (salon) => salon.id === preferredSelectedSalonId,
  )
    ? preferredSelectedSalonId
    : mapSalons[0]?.id ?? null;

  return (
    <section className="grid gap-3" data-testid="desktop-looks-near-you">
      {sectionHeader({
        subtitle:
          "Bookable looks with salon, price, LUMI Truth, distance, and availability context.",
        title: "Looks near you",
      })}
      {looks.length > 0 ? (
        <div
          className={[
            "grid gap-3",
            mapOpen && mapAvailable
              ? "xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]"
              : "",
          ].join(" ")}
        >
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {looks.slice(0, 6).map((item, index) => (
              <DesktopInspiredCard
                item={item}
                key={item.mediaId}
                onOpen={setSelectedItem}
                priority={index === 0}
              />
            ))}
          </div>
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
      ) : (
        <DesktopEmptyState
          action={
            <button
              className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange"
              onClick={onCurrentLocation}
              type="button"
            >
              Use current location
            </button>
          }
          title="No matching looks yet"
        >
          Try a broader price, LUMI Truth, or availability filter.
        </DesktopEmptyState>
      )}
      {mapAvailable && looks.length > 0 ? (
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

function DesktopTopSalonsNearYouSection({
  postHrefBySalonId,
  salons,
}: {
  postHrefBySalonId: ReadonlyMap<string, string>;
  salons: ExploreSearchResult[];
}) {
  if (salons.length === 0) {
    return (
      <section className="grid gap-3" data-testid="top-rated-salons">
        {sectionHeader({
          subtitle: "Broaden filters to see rated salons nearby.",
          title: "Top salons near you",
        })}
        <DesktopEmptyState title="No top salons match these filters">
          Customer feedback, visits, and booking signals will appear here as salons
          publish more discovery data.
        </DesktopEmptyState>
      </section>
    );
  }

  return (
    <section className="grid gap-3" data-testid="top-rated-salons">
      {sectionHeader({
        actionHref: "/explore",
        subtitle: "Based on LUMI Truth, availability and service fit.",
        title: "Top salons near you",
      })}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {salons.slice(0, 8).map((salon, index) => {
          const rank = searchRankBadge("recommended", index);

          return (
            <SalonCard
              featured={index === 0 && salons.length >= 3}
              imageHref={postHrefBySalonId.get(salon.id)}
              key={salon.id}
              rankAriaLabel={rank.ariaLabel}
              rankLabel={rank.label}
              salon={salon}
            />
          );
        })}
      </div>
    </section>
  );
}

function DesktopAvailableTodayCard({
  postHref,
  salon,
}: {
  index: number;
  postHref?: string;
  salon: ExploreSearchResult;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const displayName = displaySalonName(salon.name);
  const imageUrl = imageFailed ? resolveNailCoverImage({ id: salon.id, name: salon.name, categories: salon.serviceCategories }) : salon.coverImageUrl;
  const service = salon.bookableServiceName ?? cardServiceLabel(salon) ?? "Beauty service";
  const price = salon.bookableServicePrice == null ? null : formatMoney(salon.bookableServicePrice);
  const detailHref =
    postHref ?? (UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
      ? salonProfileHref(salon.id)
      : "/explore");

  return (
    <article className="grid overflow-hidden rounded-[1rem] bg-surface-elevated shadow-[0_10px_28px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/75">
      <Link
        className="group relative block aspect-[16/10] overflow-hidden bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href={detailHref}
      >
        {imageUrl ? (
          <Image
            alt={isDefaultNailImage(imageUrl) ? "AI-generated nail-service illustration" : `${displayName} available today`}
            className="object-cover transition duration-300 group-hover:scale-[1.025]"
            fill
            onError={() => setImageFailed(true)}
            sizes="(max-width: 1280px) 33vw, 24vw"
            src={imageUrl}
          />
        ) : (
          <span className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)] text-2xl font-semibold text-brand-orange">
            {salonInitials(displayName)}
          </span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-white/92 px-2.5 py-1 text-[11px] font-semibold text-brand-orange shadow-sm ring-1 ring-white/80">
          {salon.nextAvailabilityLabel ?? "Available today"}
        </span>
        <NailIllustrationCredit imageUrl={imageUrl} className="absolute bottom-2 right-2" />
      </Link>
      <div className="grid gap-3 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-text-primary">
            {displayName} <SalonVerifiedBadge verified={salon.identityVerified}/>
          </h3>
          <SalonTrustLine signals={salon} href={salonProfileHref(salon.id)} name={displayName} distance={formatDistance(salon.distanceMiles)} className="text-text-secondary"/>
          <p className="mt-1 truncate text-sm font-medium text-text-secondary">
            {service}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-text-secondary">
            {price ? <span className="text-text-primary">{price}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExploreBookButton href={salon.bookingEnabled ? salon.bookingHref : null} name={salon.name} contactHref={detailHref} phoneHref={salon.phone ? `tel:${salon.phone}` : null} />
          <ExploreSalonLove salonId={salon.id} name={salon.name}/>

        </div>
      </div>
    </article>
  );
}

function DesktopAvailableTodaySection({
  postHrefBySalonId,
  salons,
}: {
  postHrefBySalonId: ReadonlyMap<string, string>;
  salons: ExploreSearchResult[];
}) {
  return (
    <section className="grid gap-3" data-testid="desktop-available-today">
      {sectionHeader({
        actionHref: "/explore?category=Nails",
        actionLabel: "Search times",
        subtitle: "Same-day booking options with quick time slots.",
        title: "Available today",
      })}
      {salons.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {salons.slice(0, 8).map((salon, index) => (
            <DesktopAvailableTodayCard
              index={index}
              key={salon.id}
              postHref={postHrefBySalonId.get(salon.id)}
              salon={salon}
            />
          ))}
        </div>
      ) : (
        <DesktopEmptyState title="No same-day times match these filters">
          Try another date, remove the time filter, or broaden the price range.
        </DesktopEmptyState>
      )}
    </section>
  );
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
      text: "Open times and same-day slots surface during discovery.",
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

function DesktopPersonalizationCta({
  isAuthenticated,
  onSelectCategory,
}: {
  isAuthenticated: boolean;
  onSelectCategory: (category: string) => void;
}) {
  return (
    <section
      className="grid gap-4 rounded-[1rem] bg-[linear-gradient(135deg,#fff8f4,#f3fbfa)] p-5 shadow-[0_14px_34px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/75 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      data-testid="desktop-personalization-cta"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-orange">
          {isAuthenticated ? "Personalize Explore" : "Your Reylumi"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-text-primary">
          {isAuthenticated
            ? "Keep shaping your discovery."
            : "Save looks and book when you are ready."}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
          {isAuthenticated
            ? "Use your saved looks, bookings, and service preferences to make the next session sharper."
            : "Browse freely, then create an account when a look, salon, or time slot is worth keeping."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {isAuthenticated ? (
          <>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              onClick={() => onSelectCategory("Nails")}
              type="button"
            >
              Tune my feed
            </button>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/my-bookings"
            >
              My bookings
            </Link>
          </>
        ) : (
          <>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/signup"
            >
              Create account
            </Link>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/login"
            >
              Sign in
            </Link>
          </>
        )}
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
    <div className="grid gap-7">
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
  commentViewer,
  content,
  gpsCoordinates,
  location,
  nearYouSalons,
  onApplySearchShortcut,
  onCurrentLocation,
  onSelectCategory,
  selectedCategory,
  strictLocation,
}: {
  activeResults: ExploreSearchResult[];
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
  const defaultLocation = formatDisplayLocation(location);
  const [filters, setFilters] = useState<DesktopDiscoveryFilterState>(() => ({
    availability: "any",
    date: "any",
    location: defaultLocation,
    more: [],
    price: "any",
    trust: "any",
    time: "any",
  }));
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
        .filter(
          (salon) =>
            buildReylumiTrustSummary(salon).qualityScore !== null,
        )
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
  }), [selectedCategory, filters.location, gpsCoordinates, defaultLocation, strictLocation]);
  const filterFeedItem = useCallback((item: ExploreFeedItem) =>
    feedMatchesDesktopDiscovery(item, filters, selectedCategory) &&
    !content.inspiration.items.some(look => inspirationDetailHref(look) === item.destination.href),
    [filters, selectedCategory, content.inspiration.items]);
  const sections = useMemo(
    () => [
      {
        key: "looks",
        render: () => (
          <DesktopLooksNearYouSection
            looks={filteredLooks}
            mapSalons={mapSalons}
            onCurrentLocation={onCurrentLocation}
            userCoordinates={gpsCoordinates}
          />
        ),
        title: "Looks near you",
      },
      {
        key: "top-salons",
        render: () => (
          <DesktopTopSalonsNearYouSection
            postHrefBySalonId={postHrefBySalonId}
            salons={topSalons}
          />
        ),
        title: "Top salons near you",
      },
      {
        key: "trending",
        render: () => (
          <TrendingDesignsSection
            initialPage={{
              ...content.inspiration,
              items: filteredLooks.length > 0 ? filteredLooks : content.inspiration.items,
            }}
            subtitle="Styles people are saving and booking right now."
            title="Trending styles"
          />
        ),
        title: "Trending styles",
      },
      {
        key: "available",
        render: () => (
          <DesktopAvailableTodaySection
            postHrefBySalonId={postHrefBySalonId}
            salons={availableTodaySalons}
          />
        ),
        title: "Available today",
      },
      {
        key: "trust",
        render: () => <DesktopTrustValueModule />,
        title: "Why book on Reylumi?",
      },
      {
        key: "personalization",
        render: () => (
          <DesktopPersonalizationCta
            isAuthenticated={commentViewer.isAuthenticated}
            onSelectCategory={onSelectCategory}
          />
        ),
        title: "Personalization",
      },
      {
        key: "continue-discovering",
        title: "More to discover",
        render: () => (
          <section className="grid gap-4" aria-label="More to discover">
            <div><h2 className="text-xl font-semibold text-text-primary">More to discover</h2>
              <p className="mt-1 text-sm text-text-muted">Fresh inspiration, customer looks and more places to explore.</p></div>
            <ExploreDiscoveryFeed key={filterResetKey} sessionKey={`desktop:${filterResetKey}`} refreshToken={content} discovery={feedDiscovery} viewer={commentViewer} filterItem={filterFeedItem} />
          </section>
        ),
      },
    ],
    [
      filterResetKey,
      feedDiscovery,
      filterFeedItem,
      commentViewer,
      availableTodaySalons,
      content,
      filteredLooks,
      gpsCoordinates,
      mapSalons,
      onCurrentLocation,
      onSelectCategory,
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
        <DesktopDiscoveryFilterBar
          filters={filters}
          inspirationItems={content.inspiration.items}
          onChange={setFilters}
          onSearchShortcut={onApplySearchShortcut}
          onSelectCategory={onSelectCategory}
          selectedCategory={selectedCategory}
          services={content.popularServices}
        />

        {content.error ? (
          <ExploreNotice title="Discovery content is limited right now." tone="warning">
            Search still works while this section refreshes.
          </ExploreNotice>
        ) : null}

        <PublicSalonProfilesSection salons={filteredSalons} selectedCategory={selectedCategory} />
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
  gpsMessage,
  initialFeed,
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
  gpsMessage: string | null;
  initialFeed: ExploreFeedPage;
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

      {gpsMessage ? (
        <ExploreNotice title="Location status" tone="warning">
          {gpsMessage}
        </ExploreNotice>
      ) : null}
      <PublicSalonProfilesSection salons={allDiscoverySalons} selectedCategory={selectedCategory} />
      <ExploreDiscoveryFeed key={`${feedSessionKey}:${commentViewer.userId}`} sessionKey={feedSessionKey} discovery={discovery} initialPage={selectedCategory === "All" && !strictLocation && !gpsCoordinates ? initialFeed : undefined} viewer={commentViewer} activeDiscoveryResult={activeDiscoveryResult} discoveryShortcuts={discoveryShortcuts} onDiscoveryShortcutSelect={onDiscoveryShortcutSelect} />

      {initialFeed.items.length === 0 ? (
        <PopularServicesSection
          onSelectCategory={onSelectCategory}
          salons={allDiscoverySalons}
          services={content.popularServices}
        />
      ) : null}

      {!hasContent && !content.error ? (
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

function Pagination({
  disabled,
  onPageChange,
  page,
  totalPages,
}: {
  disabled: boolean;
  onPageChange: (page: number) => void;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-elevated p-3 shadow-[var(--shadow-soft)] ring-1 ring-divider-subtle/80">
      <button
        className="rounded-full bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        type="button"
      >
        Previous
      </button>
      <p className="text-sm font-medium text-text-secondary">
        Page {page} of {totalPages}
      </p>
      <button
        className="rounded-full bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        type="button"
      >
        Next
      </button>
    </div>
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
              <Link
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
  initialLocationSource,
  initialResponse,
  initialSearchMode,
  quickActions,
  workspaceLocation,
}: ExploreClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialResponse.query);
  const [location, setLocation] = useState(initialResponse.location);
  const [category, setCategory] = useState(
    initialResponse.category || "All",
  );
  const [, setLocationSource] =
    useState<ExploreLocationSource>(initialLocationSource);
  const [gpsCoordinates, setGpsCoordinates] =
    useState<GpsCoordinates | null>(null);
  const [gpsResponse, setGpsResponse] =
    useState<ExploreSearchResponse | null>(null);
  const [nearYouSalons, setNearYouSalons] = useState<ExploreHomeSalon[]>([]);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [explicitSearchMode, setExplicitSearchMode] =
    useState(initialSearchMode);
  const [activeDiscoveryResult, setActiveDiscoveryResult] =
    useState<ExploreDiscoveryResultKind | null>(null);
  const [searchOrderMode, setSearchOrderMode] =
    useState<SearchOrderMode>("relevance");
  const appliedSavedLocation = useRef(false);
  const gpsRequestVersion = useRef(0);
  useEffect(() => () => { gpsRequestVersion.current += 1; }, []);

  const gpsActive = Boolean(gpsResponse && !location.trim());
  const searchMode = explicitSearchMode || gpsActive;
  const activeResponse: ExploreSearchResponse =
    gpsActive && gpsResponse ? gpsResponse : initialResponse;
  const activeResults = activeResponse.results;
  const activeSections = useMemo(
    () => orderedSearchSections(activeResponse.sections, searchOrderMode),
    [activeResponse.sections, searchOrderMode],
  );
  const hasBestMatches = activeSections.bestMatches.length > 0;
  const hasNearbyResults = activeSections.nearby.length > 0;
  const hasRecommendedResults = activeSections.recommended.length > 0;
  const hasAnyResults =
    hasBestMatches || hasNearbyResults || hasRecommendedResults;
  const selectedCategory = category || "All";
  const normalizedCategory = cleanCategory(selectedCategory);
  const allDistancesMissing = gpsActive
    ? activeResults.length > 0 &&
      activeResults.every((salon) => salon.distanceMiles === null)
    : false;
  const isSearching = isPending || gpsStatus === "searching" || gpsStatus === "locating";
  const nearbyHasDistance = hasMeasuredDistance(activeSections.nearby);
  const noDirectMatches = Boolean(
    query.trim() && activeResponse.groupCounts.bestMatches === 0,
  );
  const discoveryResultMode = !searchMode && activeDiscoveryResult !== null;
  const homeMode = !searchMode && !discoveryResultMode;
  const hasDiscoveryRail = !homeMode && discoveryContent.shortcuts.length > 0;
  const displayLocation = formatDisplayLocation(location);
  const summaryText = resultSummary({
    bestCount: activeResponse.groupCounts.bestMatches,
    category: selectedCategory,
    hasAnyResults,
    location: displayLocation,
    nearbyCount: activeResponse.groupCounts.nearby,
    query,
    recommendedCount: activeResponse.groupCounts.recommended,
  });

  useEffect(() => {
    if (appliedSavedLocation.current || hasUrlLocation || initialSearchMode) {
      return;
    }

    appliedSavedLocation.current = true;

    if (typeof window === "undefined") {
      return;
    }

    let savedLocation: string | undefined;
    try { savedLocation = window.localStorage.getItem(SAVED_LOCATION_KEY)?.trim(); }
    catch { return; }

    if (!savedLocation || savedLocation === location.trim()) {
      return;
    }

    queueMicrotask(() => {
      setLocation(savedLocation);
      setLocationSource("saved");
      setGpsResponse(null);
    });
  }, [hasUrlLocation, initialSearchMode, location]);

  async function runGpsSearch(
    coordinates: GpsCoordinates,
    targetPage = 1,
  ) {
    const version = ++gpsRequestVersion.current;
    setGpsStatus("searching");
    setGpsMessage(null);
    setNearYouSalons([]);
    setActiveDiscoveryResult(null);

    try {
      const response = await withRequestTimeout(searchExploreWithGpsAction({
        category: normalizedCategory,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        page: targetPage,
        pageSize: initialResponse.pageSize,
        query,
      }));
      if (version !== gpsRequestVersion.current) return;

      setGpsResponse(response);
      setLocationSource("gps");
      setGpsStatus("idle");
      setExplicitSearchMode(true);

      if (response.error) {
        setGpsMessage("We couldn't load salons for your current location right now.");
      }
    } catch {
      if (version === gpsRequestVersion.current) setGpsMessage("We couldn't load nearby salons. Please try again.");
    } finally {
      if (version === gpsRequestVersion.current) setGpsStatus("idle");
    }
  }

  async function runHomeNearYou(coordinates: GpsCoordinates) {
    const version = ++gpsRequestVersion.current;
    setGpsStatus("searching");
    setGpsMessage(null);
    setGpsResponse(null);

    try {
      const response = await withRequestTimeout(loadExploreNearYouAction({
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      }));
      if (version !== gpsRequestVersion.current) return;

      setNearYouSalons(response.salons);
      setLocationSource("gps");
      setGpsStatus("idle");
      setExplicitSearchMode(false);
      setActiveDiscoveryResult("near_you");

      if (response.error) {
        setGpsMessage("We couldn't calculate nearby salons right now.");
        return;
      }

      if (response.salons.length === 0) {
        setGpsMessage("Current location is on, but no salons have mapped coordinates yet.");
      }
    } catch {
      if (version === gpsRequestVersion.current) setGpsMessage("We couldn't load nearby salons. Please try again.");
    } finally {
      if (version === gpsRequestVersion.current) setGpsStatus("idle");
    }
  }

  function requestCurrentLocation() {
    const version = ++gpsRequestVersion.current;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("unsupported");
      setGpsMessage("Current location is not available in this browser.");
      return;
    }

    setGpsStatus("locating");
    setGpsMessage(null);
    const shouldRunSearch = Boolean(
      explicitSearchMode || query.trim() || normalizedCategory,
    );

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (version !== gpsRequestVersion.current) return;
        const coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        setLocation("");
        setGpsResponse(null);
        setLocationSource("gps");
        setGpsCoordinates(coordinates);
        if (shouldRunSearch) {
          void runGpsSearch(coordinates, 1);
        } else {
          void runHomeNearYou(coordinates);
        }
      },
      (error) => {
        if (version !== gpsRequestVersion.current) return;
        setGpsCoordinates(null);
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

  useEffect(() => {
    function handleHeaderLocationRequest() {
      requestCurrentLocation();
    }

    window.addEventListener(
      "kingpos:explore-use-current-location",
      handleHeaderLocationRequest,
    );

    return () => {
      window.removeEventListener(
        "kingpos:explore-use-current-location",
        handleHeaderLocationRequest,
      );
    };
  });

  function clearFilters() {
    gpsRequestVersion.current += 1;
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
    gpsRequestVersion.current += 1;
    setGpsStatus("idle");
    const nextCategory = cleanCategory(value);
    const nextSearchMode = Boolean(
      nextCategory || query.trim() || (explicitSearchMode && location.trim()),
    );

    setCategory(value);
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
  }) {
    gpsRequestVersion.current += 1;
    setGpsStatus("idle");
    const nextCategory =
      input.category === undefined ? selectedCategory : input.category;
    const nextLocation =
      input.location === undefined ? location : input.location;
    const nextQuery = input.query === undefined ? query : input.query;

    setQuery(nextQuery);
    setLocation(nextLocation);
    setCategory(nextCategory);
    setGpsResponse(null);
    setNearYouSalons([]);
    setActiveDiscoveryResult(null);
    setExplicitSearchMode(true);
    setSearchOrderMode("relevance");

    const url = buildUrl({
      category: nextCategory,
      location: nextLocation,
      page: 1,
      pathname,
      query: nextQuery,
      searchParams: new URLSearchParams(searchParams.toString()),
    });

    startTransition(() => {
      router.push(url, { scroll: false });
    });
  }

  function goToPage(nextPage: number) {
    gpsRequestVersion.current += 1;
    setGpsStatus("idle");
    if (gpsActive && gpsCoordinates) {
      void runGpsSearch(gpsCoordinates, nextPage);
      return;
    }

    setExplicitSearchMode(true);
    setActiveDiscoveryResult(null);

    const url = buildUrl({
      category: selectedCategory,
      location,
      page: nextPage,
      pathname,
      query,
      searchParams: new URLSearchParams(searchParams.toString()),
    });

    startTransition(() => {
      router.push(url, { scroll: false });
    });
  }

  function focusHeaderSearch() {
    const searchInput =
      document.getElementById("customer-desktop-search") ??
      document.getElementById("customer-mobile-explore-search");

    searchInput?.focus({ preventScroll: false });
  }

  function scrollToPopularServices() {
    document
      .querySelector('[data-testid="popular-services"]')
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectDiscoveryShortcut(shortcut: ExploreDiscoveryShortcut) {
    gpsRequestVersion.current += 1;
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
    <SavePostAuthProvider isAuthenticated={commentViewer.isAuthenticated}>
    <main className="min-w-0 overflow-x-hidden bg-white">
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
            <div className="mx-auto grid w-full max-w-[40rem] gap-2 px-4 pb-1 pt-2 sm:px-6 lg:px-3 xl:hidden">
              <CategoryChips
                allLabel="For you"
                category={selectedCategory}
                onChange={selectCategory}
                onMore={scrollToPopularServices}
              />

              {!homeMode ? (
                <>
                  <MobileExploreSearch
                    gpsStatus={gpsStatus}
                    location={location}
                    onCurrentLocation={requestCurrentLocation}
                    query={query}
                    selectedCategory={selectedCategory}
                  />

                  <MobileDiscoveryShortcuts
                    activeResultKind={activeDiscoveryResult}
                    onSelect={selectDiscoveryShortcut}
                    shortcuts={discoveryContent.shortcuts}
                  />
                </>
              ) : null}
            </div>
            {homeMode ? (
              <DesktopExploreLanding
                activeDiscoveryResult={activeDiscoveryResult}
                content={homeContent}
                discoveryShortcuts={discoveryContent.shortcuts}
                onExploreClick={focusHeaderSearch}
                onSelectCategory={selectCategory}
                onSelectDiscoveryShortcut={selectDiscoveryShortcut}
                selectedCategory={selectedCategory}
              />
            ) : null}
          </section>

          {homeMode ? (
            <>
              <div className="xl:hidden">
                <ExploreHomeSections
                  activeDiscoveryResult={activeDiscoveryResult}
                  commentViewer={commentViewer}
                  content={homeContent}
                  discoveryShortcuts={discoveryContent.shortcuts}
                  gpsMessage={gpsMessage}
                  initialFeed={initialFeed}
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
                {searchMode ? (
                  <button
                    className="w-fit rounded-full bg-surface-elevated px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    onClick={clearFilters}
                    type="button"
                  >
                    Clear filters
                  </button>
                ) : null}
              </section>

              <section className="mx-auto grid w-full max-w-none gap-3 px-4 sm:px-6 lg:pl-8 lg:pr-3">
                {searchMode ? (
                  <SearchRefinementBar
                    category={selectedCategory}
                    location={location}
                    mode={searchOrderMode}
                    onModeChange={setSearchOrderMode}
                    onShortcut={applySearchShortcut}
                    query={query}
                    workspaceLocation={workspaceLocation}
                  />
                ) : null}

                {activeResponse.error ? (
                  <ExploreNotice
                    title="We couldn't load salons right now."
                    tone="warning"
                  >
                    Please try again in a moment.
                  </ExploreNotice>
                ) : null}

                {gpsMessage ? (
                  <ExploreNotice title="Location status" tone="warning">
                    {gpsMessage}
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

                {allDistancesMissing ? (
                  <ExploreNotice title="Distance is not available for these salons yet">
                    You can still search by city or ZIP to compare area listings.
                  </ExploreNotice>
                ) : null}

                {noDirectMatches && !activeResponse.error ? (
                  <ExploreNotice title={`No exact matches for "${query.trim()}".`}>
                    {hasNearbyResults && displayLocation
                      ? `Here are salons in ${displayLocation}.`
                      : "Here are recommended salons available on Reylumi."}
                  </ExploreNotice>
                ) : null}

                {!hasAnyResults && !activeResponse.error ? (
                  <div className="rounded-2xl border border-dashed border-divider-subtle bg-surface-elevated p-8 text-center shadow-[var(--shadow-soft)]">
                    <h2 className="text-xl font-semibold text-text-primary">
                      No salons available yet
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
                      No active salons match this search right now. Try another
                      salon, service, city, state, or ZIP.
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      {searchMode ? (
                        <button
                          className="rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                          onClick={clearFilters}
                          type="button"
                        >
                          Clear filters
                        </button>
                      ) : null}
                      <button
                        className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle hover:text-brand-orange"
                        onClick={requestCurrentLocation}
                        type="button"
                      >
                        Use current location
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-6">
                    <ResultSection
                      description={`${activeSections.bestMatches.length} result${
                        activeSections.bestMatches.length === 1 ? "" : "s"
                      }`}
                      rankKind="best"
                      results={activeSections.bestMatches}
                      title={
                        quotedQuery(query)
                          ? `Best matches for ${quotedQuery(query)}`
                          : normalizedCategory
                            ? `Best matches for ${normalizedCategory}`
                            : "Best matches"
                      }
                    />
                    <ResultSection
                      description={`${activeSections.nearby.length} result${
                        activeSections.nearby.length === 1 ? "" : "s"
                      }`}
                      rankKind="area"
                      results={activeSections.nearby}
                      title={
                        displayLocation
                          ? `Salons in ${displayLocation}`
                          : gpsActive && nearbyHasDistance
                            ? "Salons near you"
                            : "Salons in this area"
                      }
                    />
                    <ResultSection
                      description={`${activeSections.recommended.length} result${
                        activeSections.recommended.length === 1 ? "" : "s"
                      }`}
                      rankKind="recommended"
                      results={activeSections.recommended}
                      title="Recommended for you"
                    />
                  </div>
                )}

                {activeResponse.totalCount > activeResponse.pageSize ? (
                  <Pagination
                    disabled={isSearching}
                    onPageChange={goToPage}
                    page={activeResponse.page}
                    totalPages={activeResponse.totalPages}
                  />
                ) : null}
              </section>
            </>
          )}

          {!homeMode ? <QuickActions actions={quickActions} /> : null}
        </div>
        {hasDiscoveryRail ? (
          <ExploreDiscoveryRail
            activeResultKind={activeDiscoveryResult}
            onSelect={selectDiscoveryShortcut}
            shortcuts={discoveryContent.shortcuts}
          />
        ) : null}
      </div>
    </main>
    </SavePostAuthProvider>
  );
}
