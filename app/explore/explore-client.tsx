"use client";

import {
  loadExploreNearYouAction,
  searchExploreWithGpsAction,
} from "@/app/explore/actions";
import {
  ExploreDiscoveryRail,
  MobileDiscoveryShortcuts,
} from "@/app/explore/customer-explore-utility-panel";
import { ExploreFeed } from "@/app/explore/explore-feed";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import {
  LumiTrustMark,
  LumiTrustPopover,
  TrustFactPill,
} from "@/components/reylumi-trust";
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
  compareReylumiTopRatedSalons,
  orderReylumiExploreResults,
  type ReylumiExploreSearchOrder,
  type ReylumiTrustSummary,
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
  { category: "Spa", icon: "spa", label: "Spa" },
  { category: "Lashes", icon: "eye", label: "Lashes" },
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

function formatAddress(salon: ExploreSearchResult) {
  const cityState = formatDisplayLocation(
    [salon.city, salon.state].filter(Boolean).join(", "),
  );

  return [
    salon.addressLine1,
    salon.addressLine2,
    [cityState, salon.postalCode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
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

function salonGalleryHref(salonId: string) {
  return `${salonProfileHref(salonId)}#gallery`;
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
    params.delete("location");
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
  category,
  onChange,
  onMore,
}: {
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
              <span>{option.label}</span>
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

function salonInitials(name: string) {
  const cleanName = name.replace(/[^a-z0-9\s]/gi, " ").trim();

  return cleanName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "K";
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

function priceLine(salon: ExploreSearchResult) {
  return salon.startingPrice ? `From ${formatMoney(salon.startingPrice)}` : null;
}

function cardDetailLine(salon: ExploreSearchResult) {
  const service = cardServiceLabel(salon);
  const price = priceLine(salon);

  return [service, price].filter(Boolean).join(" / ");
}

type ExploreHeroSlide = {
  alt: string;
  bookingHref: string | null;
  id: string;
  imageUrl: string;
  salonHref: string | null;
  salonName: string;
  serviceLabel: string | null;
};

function heroSlidesFromContent(content: ExploreHomeContent): ExploreHeroSlide[] {
  const slides: ExploreHeroSlide[] = [];
  const seenUrls = new Set<string>();

  for (const item of content.inspiration.items.slice(0, 4)) {
    if (seenUrls.has(item.imageUrl)) {
      continue;
    }

    seenUrls.add(item.imageUrl);
    slides.push({
      alt: `${item.salonName} beauty inspiration`,
      bookingHref: item.bookingHref,
      id: `inspiration:${item.mediaId}`,
      imageUrl: item.imageUrl,
      salonHref: item.salonHref,
      salonName: item.salonName,
      serviceLabel: inspirationServiceLabel(item),
    });
  }

  for (const salon of [...content.recommendedSalons, ...content.newSalons]) {
    if (!salon.coverImageUrl || seenUrls.has(salon.coverImageUrl)) {
      continue;
    }

    seenUrls.add(salon.coverImageUrl);
    slides.push({
      alt: `${salon.name} salon photo`,
      bookingHref: salon.bookingHref,
      id: `salon:${salon.id}`,
      imageUrl: salon.coverImageUrl,
      salonHref:
        UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
          ? salonProfileHref(salon.id)
          : null,
      salonName: salon.name,
      serviceLabel: cardServiceLabel(salon),
    });

    if (slides.length >= 4) {
      break;
    }
  }

  return slides;
}

function ExploreHero({
  content,
  onExploreClick,
}: {
  content: ExploreHomeContent;
  onExploreClick: () => void;
}) {
  const slides = useMemo(() => heroSlidesFromContent(content), [content]);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexWithinBounds = slides.length > 0 ? activeIndex % slides.length : 0;
  const activeSlide = slides[activeIndexWithinBounds] ?? null;
  const hasSlides = slides.length > 0;

  useEffect(() => {
    if (slides.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, 5200);

    return () => window.clearInterval(interval);
  }, [slides.length]);

  function move(delta: number) {
    if (slides.length <= 1) {
      return;
    }

    setActiveIndex((current) => (current + delta + slides.length) % slides.length);
  }

  const heroTitle =
    activeSlide?.serviceLabel ?? activeSlide?.salonName ?? "Discover beauty around you";
  const heroContext = activeSlide
    ? [activeSlide.salonName, activeSlide.serviceLabel]
        .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
        .join(" · ")
    : "Public looks and salon updates";
  const heroHref = activeSlide?.bookingHref ?? activeSlide?.salonHref ?? null;
  const heroActionLabel = activeSlide?.bookingHref
    ? "Book"
    : activeSlide?.salonHref
      ? "View salon"
      : "Search Explore";

  return (
    <section
      className="relative min-h-[7.25rem] overflow-hidden rounded-[0.95rem] bg-white shadow-[0_8px_22px_rgba(35,25,22,0.035)] ring-1 ring-divider-subtle/65"
      data-testid="explore-hero"
    >
      {activeSlide ? (
        <Image
          alt={activeSlide.alt}
          className="object-cover object-[72%_center] transition-opacity duration-500"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 40rem"
          src={activeSlide.imageUrl}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-brand-orange-soft px-10 text-center">
          <Image
            alt="Reylumi"
            className="h-auto w-56 max-w-[70%] object-contain opacity-90"
            height={452}
            priority
            src="/brand/reylumi-logo-tagline.png"
            width={1313}
          />
        </div>
      )}
      <div
        aria-hidden
        className={[
          "absolute inset-0",
          hasSlides
            ? "bg-[linear-gradient(90deg,rgba(255,247,241,0.96)_0%,rgba(255,247,241,0.78)_45%,rgba(255,247,241,0.12)_100%)]"
            : "bg-white/18",
        ].join(" ")}
      />
      <div className="relative z-10 grid min-h-[7.25rem] content-center gap-2 px-4 py-3.5 sm:px-5 lg:max-w-[66%]">
        <div>
          <p className="text-[11px] font-semibold uppercase text-brand-orange">
            Featured now
          </p>
          <h2 className="mt-1 line-clamp-2 max-w-sm text-lg font-semibold leading-tight text-text-primary">
            {heroTitle}
          </h2>
          <p className="mt-1 line-clamp-1 max-w-sm text-xs font-semibold text-brand-teal">
            {heroContext}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {heroHref ? (
            <Link
              className="inline-flex min-h-8 items-center rounded-full bg-brand-orange px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={heroHref}
            >
              {heroActionLabel}
            </Link>
          ) : (
            <button
              className="inline-flex min-h-8 items-center rounded-full bg-brand-orange px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              onClick={onExploreClick}
              type="button"
            >
              {heroActionLabel}
            </button>
          )}
        </div>
      </div>
      {slides.length > 1 ? (
        <>
          <button
            aria-label="Previous inspiration"
            className="absolute left-2 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-text-secondary shadow-sm ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => move(-1)}
            type="button"
          >
            <span aria-hidden>&lsaquo;</span>
          </button>
          <button
            aria-label="Next inspiration"
            className="absolute right-2 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-text-secondary shadow-sm ring-1 ring-divider-subtle transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => move(1)}
            type="button"
          >
            <span aria-hidden>&rsaquo;</span>
          </button>
          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2">
            {slides.map((slide, index) => (
              <button
                aria-label={`Show inspiration ${index + 1}`}
                className={[
                  "h-2 rounded-full transition",
                  index === activeIndexWithinBounds
                    ? "w-5 bg-brand-orange"
                    : "w-2 bg-white/85",
                ].join(" ")}
                key={slide.id}
                onClick={() => setActiveIndex(index)}
                type="button"
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
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
      {location.trim() ? (
        <input name="location" type="hidden" value={location.trim()} />
      ) : null}
      {normalizedCategory ? (
        <input name="category" type="hidden" value={normalizedCategory} />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          className="min-h-10 rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          type="submit"
        >
          Search
        </button>
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
        salon.averageRating !== null && salon.sharedExperienceCount > 0,
    )
    .sort(compareReylumiTopRatedSalons)
    .slice(0, 8);
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

function CompactSalonCard({ salon }: { salon: ExploreHomeSalon }) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? null : salon.coverImageUrl;
  const location = displaySalonCity(salon);
  const displayName = displaySalonName(salon.name);
  const profileHref =
    UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
      ? salonProfileHref(salon.id)
      : null;
  const href = profileHref ?? salon.bookingHref ?? "/explore";
  const service = featuredServiceLine(salon);
  const price = priceLine(salon);
  const availability = salon.nextAvailabilityLabel;
  const trustSummary = salonTrustSummary(salon);

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
                alt={`${displayName} salon photo`}
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
            <LumiTrustMark
              className="absolute left-2 top-2 grid h-5 w-5 place-items-center bg-white/95 p-0 text-brand-orange shadow-sm ring-1 ring-brand-orange/20"
              presentation="spark"
              summary={trustSummary}
            />
          </span>
        </span>
        <span className="grid min-h-[6.9rem] content-between gap-2 p-3 pt-2.5">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">
              {displayName}
            </span>
            {location ? (
              <span className="mt-1 block truncate text-xs text-text-secondary">
                {location}
              </span>
            ) : null}
            {service ? (
              <span className="mt-1.5 block truncate text-xs font-medium text-brand-teal">
                {service}
              </span>
            ) : null}
          </span>
          <span className="flex min-h-5 items-center justify-between gap-2 text-[11px]">
            {price ? (
              <span className="truncate font-semibold text-text-primary">
                {price}
              </span>
            ) : (
              <span />
            )}
            {availability ? (
              <span className="truncate text-right font-medium text-text-secondary">
                {availability}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
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
        subtitle: "Sorted by customer rating with ReyLUMI activity context.",
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
  const href = UUID_PATTERN.test(item.salonId)
    ? salonGalleryHref(item.salonId)
    : null;
  const trustSummary = buildReylumiTrustSummary(item.trust);
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
      <LumiTrustMark
        className="absolute left-2 top-2 z-10 grid h-5 w-5 place-items-center bg-white/95 p-0 text-brand-orange shadow-sm ring-1 ring-brand-orange/20"
        presentation="spark"
        summary={trustSummary}
      />
    </>
  );

  return (
    <div className={tileFrameClass}>
      {href ? (
        <Link
          aria-label={`Open ${salonName} designs`}
          className={tileActionClass}
          href={href}
        >
          {tileContent}
        </Link>
      ) : (
        <button
          aria-label={`Open ${salonName} design`}
          className={tileActionClass}
          onClick={() => onOpen(item)}
          type="button"
        >
          {tileContent}
        </button>
      )}
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
}: {
  initialPage: ExploreInspirationPage;
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
          : undefined,
        title: "Fresh Looks",
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

function mapSalonToMapSalon(salon: ExploreHomeSalon): ExploreMapSalon | null {
  if (
    typeof salon.latitude !== "number" ||
    typeof salon.longitude !== "number" ||
    !Number.isFinite(salon.latitude) ||
    !Number.isFinite(salon.longitude)
  ) {
    return null;
  }

  return {
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
    serviceLabel: cardDetailLine(salon) || null,
    trust: {
      averageRating: salon.averageRating,
      noIssueRate: salon.reputationNoIssueRate,
      sharedExperienceCount: salon.sharedExperienceCount,
      uniqueCustomerCount: salon.uniqueCustomerCount,
      verifiedVisitCount: salon.verifiedVisitCount,
    },
  };
}

function salonTrustSummary(salon: ExploreSearchResult) {
  return buildReylumiTrustSummary(salon, {
    isNew: salon.isNew,
  });
}

function metricTrustFacts(summary: ReylumiTrustSummary) {
  return summary.facts
    .filter(
      (fact) =>
        fact.kind === "rating" ||
        fact.kind === "experience" ||
        fact.kind === "verified_visit",
    )
    .slice(0, 3);
}

function SalonCard({
  featured = false,
  rankAriaLabel,
  rankLabel,
  salon,
}: {
  featured?: boolean;
  rankAriaLabel: string;
  rankLabel: string;
  salon: ExploreSearchResult;
}) {
  const address = formatAddress(salon);
  const callHref = phoneHref(salon.phone);
  const distance = formatDistance(salon.distanceMiles);
  const location = formatSalonLocation(salon);
  const canViewProfile = UUID_PATTERN.test(salon.id) && salon.hasPublicProfile;
  const profileHref = canViewProfile ? salonProfileHref(salon.id) : null;
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? null : salon.coverImageUrl;
  const detailLine = cardDetailLine(salon);
  const trustSummary = salonTrustSummary(salon);
  const availabilityLabel = salon.nextAvailabilityLabel;
  const bookingHref =
    salon.bookingEnabled && salon.bookingHref ? salon.bookingHref : null;
  const cardSizeClass = featured
    ? "aspect-[4/3] sm:aspect-[3/2] xl:aspect-[16/9]"
    : "aspect-[4/3] sm:aspect-[1/1]";
  const imageSizes = featured
    ? "(max-width: 768px) 100vw, (max-width: 1280px) 66vw, 42vw"
    : "(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 24vw";

  return (
    <article
      className={[
        "group relative min-h-full overflow-hidden rounded-[1rem] bg-text-primary shadow-[0_12px_32px_rgba(80,47,36,0.08)] ring-1 ring-divider-subtle/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(80,47,36,0.12)] focus-within:ring-brand-orange/35",
        cardSizeClass,
      ].join(" ")}
      title={address || undefined}
    >
      {imageUrl ? (
        <Image
          alt={`${salon.name} salon photo`}
          className="object-cover transition duration-300 group-hover:scale-[1.02]"
          fill
          onError={() => setImageFailed(true)}
          sizes={imageSizes}
          src={imageUrl}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-text-primary px-6 text-center text-white">
          <div>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-white/10 text-lg font-semibold">
              {salonInitials(salon.name)}
            </div>
            <p className="mt-4 text-sm font-semibold">Photos coming soon</p>
          </div>
        </div>
      )}

      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(31,23,27,0.10),rgba(31,23,27,0.03)_36%,rgba(31,23,27,0.76))]"
      />

      <div className="absolute left-2.5 right-2.5 top-2.5 z-10 flex items-start justify-between gap-2">
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

      <div className="absolute inset-x-0 bottom-0 z-10 p-3.5 text-white sm:p-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {profileHref ? (
              <Link
                className="min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href={profileHref}
              >
                <h3
                  className={[
                    "line-clamp-2 font-semibold leading-tight transition hover:text-brand-orange",
                    featured ? "text-xl sm:text-2xl" : "text-lg",
                  ].join(" ")}
                >
                  {salon.name}
                </h3>
              </Link>
            ) : (
              <h3
                className={[
                  "min-w-0 line-clamp-2 font-semibold leading-tight",
                  featured ? "text-xl sm:text-2xl" : "text-lg",
                ].join(" ")}
              >
                {salon.name}
              </h3>
            )}
            <LumiTrustPopover
              actionHref={profileHref ? `${profileHref}#lumi-trust` : null}
              align="right"
              className="shrink-0"
              entityName={salon.name}
              markClassName="grid h-8 w-8 place-items-center rounded-full bg-white/92 p-0 text-brand-orange shadow-sm ring-1 ring-brand-orange/20 hover:bg-brand-orange-soft"
              panelClassName="text-zinc-700"
              presentation="spark"
              size="sm"
              summary={trustSummary}
            />
          </div>
          {location ? (
            <p className="mt-1 truncate text-sm font-medium text-white/80">
              {location}
            </p>
          ) : null}
          {detailLine ? (
            <p className="mt-1.5 line-clamp-1 text-sm font-semibold text-white">
              {detailLine}
            </p>
          ) : null}
          {availabilityLabel ? (
            <p className="mt-1 line-clamp-1 text-xs font-semibold uppercase text-emerald-100">
              {availabilityLabel}
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {bookingHref ? (
            <Link
              className="inline-flex min-h-8 items-center rounded-full bg-brand-orange px-3 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href={bookingHref}
            >
              Book
            </Link>
          ) : null}
          {profileHref ? (
            <Link
              className={[
                "inline-flex min-h-8 items-center rounded-full px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                bookingHref
                  ? "bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/20"
                  : "bg-white text-text-primary hover:bg-brand-orange-soft",
              ].join(" ")}
              href={profileHref}
            >
              View salon
            </Link>
          ) : null}
          {callHref && !bookingHref && !canViewProfile ? (
            <a
              aria-label={`Call ${salon.name}`}
              className="inline-flex min-h-8 items-center rounded-full bg-white/15 px-3 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
    <section className="grid gap-2.5">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm font-medium text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {results.map((salon, index) => {
          const featured = index === 0 && results.length >= 3;
          const rank = searchRankBadge(rankKind, index);

          return (
            <div
              className={featured ? "md:col-span-2 xl:col-span-2" : ""}
              key={`${salon.resultGroup}:${salon.id}`}
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
  const publishedAt = inspirationDateLabel(item.publishedAt);
  const trustSummary = buildReylumiTrustSummary(item.trust);
  const trustFacts = metricTrustFacts(trustSummary);

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
                  {item.salonName}
                </h2>
                {location ? (
                  <p className="mt-1 text-sm font-medium text-text-secondary">
                    {location}
                  </p>
                ) : null}
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

            {service ? (
              <p className="mt-4 text-sm font-semibold text-text-primary">
                {service}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <LumiTrustPopover
                entityName={item.salonName}
                markClassName="bg-surface-muted px-3 py-1 text-brand-orange ring-1 ring-divider-subtle"
                summary={trustSummary}
              />
              {trustFacts.slice(0, 2).map((fact) => (
                <TrustFactPill
                  className="max-w-[12rem] bg-surface-muted px-3 py-1 text-text-primary ring-1 ring-divider-subtle"
                  fact={fact}
                  key={fact.kind}
                />
              ))}
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
            {item.bookingHref ? (
              <Link
                className="inline-flex min-h-10 items-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={item.bookingHref}
              >
                {item.bookingLabel}
              </Link>
            ) : null}
            {item.salonHref ? (
              <Link
                className={[
                  "inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2",
                  item.bookingHref
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
    return "Popular";
  }

  if (salon.averageRating !== null && salon.sharedExperienceCount > 0) {
    return "Top Rated";
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
  const imageUrl = imageFailed ? null : salon.coverImageUrl;
  const location = displaySalonCity(salon);
  const displayName = displaySalonName(salon.name);
  const service = discoveryServiceLabel(salon);
  const price = priceLine(salon);
  const reason = discoveryBadgeLabel(salon, "Recommended");
  const { primaryHref, primaryLabel, viewHref } = recommendedCardLinks(salon);
  const showSecondaryViewAction = viewHref !== primaryHref;
  const trustSummary = salonTrustSummary(salon);
  const trustHref =
    UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
      ? `${salonProfileHref(salon.id)}#lumi-trust`
      : null;

  return (
    <article className="group relative min-h-[19rem] overflow-hidden rounded-[1rem] bg-text-primary shadow-[0_14px_38px_rgba(35,25,22,0.08)] ring-1 ring-divider-subtle/75">
      {imageUrl ? (
        <Image
          alt={`${displayName} salon photo`}
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
      <div className="relative z-10 grid min-h-[19rem] max-w-[76%] content-end gap-3.5 p-4 text-white sm:p-5">
        <div>
          <div className="flex flex-wrap gap-2">
            <LumiTrustPopover
              actionHref={trustHref}
              entityName={displayName}
              markClassName="grid h-8 w-8 place-items-center rounded-full bg-white/92 p-0 text-brand-orange ring-1 ring-brand-orange/20 hover:bg-brand-orange-soft"
              panelClassName="text-zinc-700"
              presentation="spark"
              size="sm"
              summary={trustSummary}
            />
            <span className="inline-flex w-fit rounded-full bg-white/14 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/20">
              Recommended because {reason.toLowerCase()}
            </span>
          </div>
          <h3 className="mt-3 line-clamp-2 text-xl font-semibold leading-tight sm:text-2xl">
            {displayName}
          </h3>
          <p className="mt-2 line-clamp-2 max-w-md text-sm leading-5 text-white/78">
            {service
              ? `A polished match for ${service.toLowerCase()} with public salon details and booking when available.`
              : "A polished salon pick with public details, nearby discovery, and booking when available."}
          </p>
          {location ? (
            <p className="mt-2 truncate text-xs font-semibold text-white/70">
              {location}
            </p>
          ) : null}
        </div>
        <div className="flex min-h-7 flex-wrap items-center gap-2 text-xs">
          {service ? (
            <span className="max-w-full truncate rounded-full bg-white/16 px-2.5 py-0.5 font-semibold text-white ring-1 ring-white/18">
              {service}
            </span>
          ) : null}
          {price ? (
            <span className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-text-primary">
              {price}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-9 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            href={primaryHref}
          >
            {primaryLabel}
          </Link>
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
  const imageUrl = imageFailed ? null : salon.coverImageUrl;

  return (
    <button
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
    </button>
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
  if (kind === "near_you") {
    return "Near you";
  }

  if (kind === "top_rated") {
    return "Top rated salons";
  }

  if (kind === "trending") {
    return "Fresh looks";
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
}: {
  content: ExploreHomeContent;
  gpsCoordinates: GpsCoordinates | null;
  kind: ExploreDiscoveryResultKind;
  nearYouSalons: ExploreHomeSalon[];
  onClear: () => void;
  onCurrentLocation: () => void;
}) {
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
    </section>
  );
}

function ExploreHomeSections({
  commentViewer,
  content,
  gpsMessage,
  initialFeed,
  nearYouSalons,
  onSelectCategory,
}: {
  commentViewer: PostCommentViewer;
  content: ExploreHomeContent;
  gpsMessage: string | null;
  initialFeed: ExploreFeedPage;
  nearYouSalons: ExploreHomeSalon[];
  onSelectCategory: (category: string) => void;
}) {
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
      <ExploreFeed initialPage={initialFeed} viewer={commentViewer} />

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
  const hasDiscoveryRail = discoveryContent.shortcuts.length > 0;
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

    const savedLocation = window.localStorage
      .getItem(SAVED_LOCATION_KEY)
      ?.trim();

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
    setGpsStatus("searching");
    setGpsMessage(null);
    setNearYouSalons([]);
    setActiveDiscoveryResult(null);

    const response = await searchExploreWithGpsAction({
      category: normalizedCategory,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      page: targetPage,
      pageSize: initialResponse.pageSize,
      query,
    });

    setGpsResponse(response);
    setLocationSource("gps");
    setGpsStatus("idle");
    setExplicitSearchMode(true);

    if (response.error) {
      setGpsMessage("We couldn't load salons for your current location right now.");
    }
  }

  async function runHomeNearYou(coordinates: GpsCoordinates) {
    setGpsStatus("searching");
    setGpsMessage(null);
    setGpsResponse(null);

    const response = await loadExploreNearYouAction({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });

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
  }

  function requestCurrentLocation() {
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
    setLocationSource(workspaceLocation.label ? "workspace" : "none");

    startTransition(() => {
      router.push(pathname, { scroll: false });
    });
  }

  function selectCategory(value: string) {
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
      : pathname;

    startTransition(() => {
      router.push(url, { scroll: false });
    });
  }

  function applySearchShortcut(input: {
    category?: string;
    location?: string;
    query?: string;
  }) {
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
            <div className="mx-auto grid w-full max-w-[40rem] gap-2.5 px-4 pb-2 pt-3 sm:px-6 lg:px-3">
              <CategoryChips
                category={selectedCategory}
                onChange={selectCategory}
                onMore={scrollToPopularServices}
              />

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

              <ExploreHero
                content={homeContent}
                onExploreClick={focusHeaderSearch}
              />
            </div>
          </section>

          {homeMode ? (
            <ExploreHomeSections
              commentViewer={commentViewer}
              content={homeContent}
              gpsMessage={gpsMessage}
              initialFeed={initialFeed}
              nearYouSalons={nearYouSalons}
              onSelectCategory={selectCategory}
            />
          ) : discoveryResultMode && activeDiscoveryResult ? (
            <ExploreDiscoveryResults
              content={homeContent}
              gpsCoordinates={gpsCoordinates}
              kind={activeDiscoveryResult}
              nearYouSalons={nearYouSalons}
              onClear={() => setActiveDiscoveryResult(null)}
              onCurrentLocation={requestCurrentLocation}
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

          <QuickActions actions={quickActions} />
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
  );
}
