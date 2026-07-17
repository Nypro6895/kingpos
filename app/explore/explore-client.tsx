"use client";

import {
  loadExploreInspirationAction,
  loadExploreNearYouAction,
  searchExploreWithGpsAction,
} from "@/app/explore/actions";
import {
  type ExploreHomeContent,
  type ExploreHomeSalon,
  type ExploreInspirationCursor,
  type ExploreInspirationItem,
  type ExploreInspirationPage,
  type ExploreInitialLocation,
  type ExploreLocationSource,
  type ExploreMapSalon,
  type ExplorePopularService,
  type ExploreSearchResponse,
  type ExploreSearchResult,
} from "@/types/explore";
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
  hasUrlLocation: boolean;
  homeContent: ExploreHomeContent;
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
      <div className="grid min-h-[22rem] place-items-center rounded-lg border border-zinc-200 bg-zinc-100 text-sm font-medium text-zinc-500">
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

function cleanCategory(category: string) {
  return category && category !== "All" ? category : "";
}

function uniqueCategories(categories: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const category of categories) {
    const label = category.trim();
    const key = label.toLowerCase();

    if (!label || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(label);
  }

  return unique;
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

function locationStatusLabel(input: {
  displayLocation: string;
  source: ExploreLocationSource;
}) {
  const location = input.displayLocation.trim();

  if (input.source === "gps") {
    return "Current location";
  }

  if (input.source === "saved") {
    return location ? `Saved location: ${location}` : "Saved location";
  }

  if (input.source === "manual") {
    return location || "Manual location";
  }

  if (input.source === "workspace") {
    return location ? `Workspace: ${location}` : "Workspace location";
  }

  return "Add location";
}

function gpsActionLabel(status: GpsStatus) {
  switch (status) {
    case "locating":
      return "Locating";
    case "searching":
      return "Updating";
    default:
      return "Current location";
  }
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

function CategoryChips({
  categories,
  category,
  onChange,
}: {
  categories: string[];
  category: string;
  onChange: (category: string) => void;
}) {
  const selectedCategory = cleanCategory(category);
  const options = ["All", ...uniqueCategories(categories)];

  if (
    selectedCategory &&
    !options.some(
      (option) =>
        cleanCategory(option).toLowerCase() === selectedCategory.toLowerCase(),
    )
  ) {
    options.push(selectedCategory);
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-2">
        {options.map((option) => {
          const optionCategory = cleanCategory(option);
          const isActive =
            optionCategory.toLowerCase() === selectedCategory.toLowerCase();

          return (
            <button
              aria-pressed={isActive}
              className={[
                "min-h-10 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                isActive
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-950",
              ].join(" ")}
              key={option}
              onClick={() => onChange(option)}
              type="button"
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
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
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "KP";
}

function cardServiceLabel(salon: ExploreSearchResult) {
  return (
    salon.featuredServiceName ??
    salon.featuredServiceCategory ??
    salon.serviceCategories[0] ??
    salon.serviceNames[0] ??
    null
  );
}

function cardDetailLine(salon: ExploreSearchResult) {
  const service = cardServiceLabel(salon);
  const price = salon.startingPrice
    ? `From ${formatMoney(salon.startingPrice)}`
    : null;

  return [service, price].filter(Boolean).join(" / ");
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
  };
}

function reviewCountLabel(count: number) {
  return `${count} review${count === 1 ? "" : "s"}`;
}

function formatRating(value: number) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function cardReviewLabel(salon: ExploreSearchResult) {
  if (salon.averageRating === null || salon.reviewCount <= 0) {
    return null;
  }

  return `${formatRating(salon.averageRating)} / 5 (${reviewCountLabel(
    salon.reviewCount,
  )})`;
}

function cardReviewAriaLabel(salon: ExploreSearchResult) {
  if (salon.averageRating === null || salon.reviewCount <= 0) {
    return undefined;
  }

  return `Rated ${formatRating(salon.averageRating)} out of 5 from ${reviewCountLabel(
    salon.reviewCount,
  )}`;
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
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? null : salon.coverImageUrl;
  const detailLine = cardDetailLine(salon);
  const reviewLabel = cardReviewLabel(salon);
  const reviewAriaLabel = cardReviewAriaLabel(salon);
  const availabilityLabel = salon.nextAvailabilityLabel;
  const bookingHref =
    salon.bookingEnabled && salon.bookingHref ? salon.bookingHref : null;
  const cardSizeClass = featured
    ? "aspect-[4/5] sm:aspect-[3/2] xl:aspect-[16/10]"
    : "aspect-[4/5]";
  const imageSizes = featured
    ? "(max-width: 768px) 100vw, (max-width: 1280px) 66vw, 42vw"
    : "(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 24vw";

  return (
    <article
      className={[
        "group relative min-h-full overflow-hidden rounded-lg bg-zinc-900 shadow-sm ring-1 ring-zinc-200 transition duration-200 hover:shadow-lg focus-within:ring-zinc-400",
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
        <div className="absolute inset-0 grid place-items-center bg-zinc-900 px-6 text-center text-white">
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
        className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.20),rgba(0,0,0,0.06)_35%,rgba(0,0,0,0.82))]"
      />

      <div className="absolute left-3 right-3 top-3 z-10 flex items-start justify-between gap-2">
        <span
          aria-label={rankAriaLabel}
          className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-zinc-950 shadow-sm"
        >
          {rankLabel}
        </span>
        {distance ? (
          <span className="rounded-md bg-black/40 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
            {distance}
          </span>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 p-4 text-white sm:p-5">
        <div className="min-w-0">
          <h3
            className={[
              "line-clamp-2 font-semibold leading-tight",
              featured ? "text-2xl" : "text-xl",
            ].join(" ")}
          >
            {salon.name}
          </h3>
          {location ? (
            <p className="mt-1 truncate text-sm font-medium text-white/80">
              {location}
            </p>
          ) : null}
          {detailLine ? (
            <p className="mt-2 line-clamp-1 text-sm font-semibold text-white">
              {detailLine}
            </p>
          ) : null}
          {reviewLabel ? (
            <p
              aria-label={reviewAriaLabel}
              className="mt-2 line-clamp-1 text-sm font-semibold text-white"
            >
              {reviewLabel}
            </p>
          ) : null}
          {availabilityLabel ? (
            <p className="mt-1 line-clamp-1 text-xs font-semibold uppercase text-emerald-100">
              {availabilityLabel}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {bookingHref ? (
            <Link
              className="inline-flex min-h-9 items-center rounded-md bg-white px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href={bookingHref}
            >
              Book
            </Link>
          ) : null}
          {canViewProfile ? (
            <Link
              className={[
                "inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                bookingHref
                  ? "border border-white/30 bg-black/30 text-white hover:bg-black/50"
                  : "bg-white text-zinc-950 hover:bg-zinc-100",
              ].join(" ")}
              href={salonProfileHref(salon.id)}
            >
              View salon
            </Link>
          ) : null}
          {callHref ? (
            <a
              aria-label={`Call ${salon.name}`}
              className={[
                "min-h-9 items-center rounded-md border border-white/30 bg-black/30 px-3 text-sm font-semibold text-white transition hover:bg-black/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                bookingHref ? "hidden sm:inline-flex" : "inline-flex",
              ].join(" ")}
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

function inspirationAspectClass(item: ExploreInspirationItem) {
  if (item.layoutVariant === "landscape") {
    return "aspect-[5/4] sm:aspect-[4/3]";
  }

  if (item.layoutVariant === "square") {
    return "aspect-square";
  }

  return "aspect-[4/5]";
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
    return "Recommended salons on KingPOS";
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
      ariaLabel: "New salon on KingPOS",
      label: "New on KingPOS",
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
    <section className="grid gap-3">
      <div>
        <h3 className="text-xl font-semibold text-zinc-950">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm font-medium text-zinc-500">{description}</p>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

function InspirationCard({
  item,
  onOpen,
}: {
  item: ExploreInspirationItem;
  onOpen: (item: ExploreInspirationItem) => void;
}) {
  const location = inspirationLocation(item);
  const service = inspirationServiceLabel(item);

  return (
    <button
      aria-label={`Open ${item.salonName} inspiration preview`}
      className={[
        "group relative block w-full overflow-hidden rounded-lg bg-zinc-200 text-left shadow-sm ring-1 ring-zinc-200 transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
        inspirationAspectClass(item),
      ].join(" ")}
      data-inspiration-card="true"
      onClick={() => onOpen(item)}
      type="button"
    >
      <Image
        alt={`${item.salonName} nail inspiration`}
        className="object-cover transition duration-300 group-hover:scale-[1.02]"
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        src={item.imageUrl}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.02),rgba(0,0,0,0.08)_45%,rgba(0,0,0,0.72))]"
      />
      <div className="absolute inset-x-0 bottom-0 z-10 p-3 text-white sm:p-4">
        <p className="line-clamp-1 text-sm font-semibold sm:text-base">
          {item.salonName}
        </p>
        {location ? (
          <p className="mt-0.5 line-clamp-1 text-xs font-medium text-white/80">
            {location}
          </p>
        ) : null}
        {service ? (
          <p className="mt-1 line-clamp-1 text-xs font-semibold text-white">
            {service}
          </p>
        ) : null}
      </div>
    </button>
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
        className="grid max-h-[94dvh] w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-t-lg bg-white shadow-2xl sm:max-w-5xl sm:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)] sm:grid-rows-1 sm:rounded-lg"
        onKeyDown={trapFocus}
        ref={dialogRef}
        role="dialog"
      >
        <div className="relative min-h-[42dvh] bg-zinc-100 sm:min-h-[72dvh]">
          <Image
            alt={`${item.salonName} nail inspiration preview`}
            className="object-contain"
            fill
            sizes="(max-width: 768px) 100vw, 68vw"
            src={item.imageUrl}
          />
        </div>
        <div className="grid max-h-[52dvh] min-h-0 content-between gap-5 overflow-y-auto p-5 sm:max-h-none sm:p-6">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2
                  className="line-clamp-2 text-xl font-semibold text-zinc-950"
                  id="inspiration-preview-title"
                >
                  {item.salonName}
                </h2>
                {location ? (
                  <p className="mt-1 text-sm font-medium text-zinc-500">
                    {location}
                  </p>
                ) : null}
              </div>
              <button
                aria-label="Close preview"
                className="grid size-9 shrink-0 place-items-center rounded-md border border-zinc-200 text-lg font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                onClick={onClose}
                ref={closeButtonRef}
                type="button"
              >
                x
              </button>
            </div>

            {service ? (
              <p className="mt-4 text-sm font-semibold text-zinc-950">
                {service}
              </p>
            ) : null}
            {item.captionExcerpt ? (
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                {item.captionExcerpt}
              </p>
            ) : null}
            <div className="mt-4 grid gap-1 text-sm text-zinc-500">
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
            {item.salonHref ? (
              <Link
                className="inline-flex min-h-10 items-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                href={item.salonHref}
              >
                View salon
              </Link>
            ) : null}
            {item.phoneHref ? (
              <a
                className="inline-flex min-h-10 items-center rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
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

function FreshInspirationSection({
  initialPage,
}: {
  initialPage: ExploreInspirationPage;
}) {
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState<ExploreInspirationCursor | null>(
    initialPage.nextCursor,
  );
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [error, setError] = useState(initialPage.error);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedItem, setSelectedItem] =
    useState<ExploreInspirationItem | null>(null);

  async function loadMore() {
    if (!cursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setError(null);

    const nextPage = await loadExploreInspirationAction(cursor);

    if (nextPage.error) {
      setError(nextPage.error);
    } else {
      setItems((currentItems) => {
        const seenMediaIds = new Set(
          currentItems.map((item) => item.mediaId),
        );
        const newItems = nextPage.items.filter((item) => {
          if (seenMediaIds.has(item.mediaId)) {
            return false;
          }

          seenMediaIds.add(item.mediaId);
          return true;
        });

        return [...currentItems, ...newItems];
      });
      setCursor(nextPage.nextCursor);
      setHasMore(nextPage.hasMore);
    }

    setIsLoadingMore(false);
  }

  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">
          Fresh inspiration
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          See the latest work shared by salons on KingPOS.
        </p>
      </div>

      {error ? (
        <ExploreNotice
          title="Fresh inspiration could not be loaded."
          tone="warning"
        >
          Salon search and recommendations are still available.
        </ExploreNotice>
      ) : null}

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <InspirationCard
              item={item}
              key={item.mediaId}
              onOpen={setSelectedItem}
            />
          ))}
        </div>
      ) : !error ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-5">
          <p className="text-sm font-medium text-zinc-600">
            Fresh salon work will appear here as salons share public photos.
          </p>
        </div>
      ) : null}

      {hasMore && cursor ? (
        <div>
          <button
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLoadingMore}
            onClick={loadMore}
            type="button"
          >
            {isLoadingMore ? "Loading" : "Load more"}
          </button>
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

function HomeSalonSection({
  description,
  results,
  title,
}: {
  description: string;
  results: ExploreHomeSalon[];
  title: string;
}) {
  if (results.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">{title}</h2>
        <p className="mt-1 text-sm font-medium text-zinc-500">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {results.map((salon, index) => {
          const featured = index === 0 && results.length >= 3;
          const rank = homeRankBadge(salon, index);

          return (
            <div
              className={featured ? "md:col-span-2 xl:col-span-2" : ""}
              key={`${salon.homeSection}:${salon.id}`}
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
    <section className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-950">Near you</h2>
          <p className="mt-1 text-sm font-medium text-zinc-500">
            Sorted by real distance from your current location.
          </p>
        </div>
        {mapAvailable ? (
          <button
            className="w-fit rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
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
            className="fixed inset-0 z-50 grid grid-rows-[auto_minmax(0,1fr)] bg-white lg:hidden"
            ref={mobileMapDialogRef}
            role="dialog"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div className="min-w-0">
                <p
                  className="text-sm font-semibold text-zinc-950"
                  id="near-you-map-title"
                >
                  Near you map
                </p>
                {selectedSalon ? (
                  <p className="truncate text-xs font-medium text-zinc-500">
                    {selectedSalon.name}
                  </p>
                ) : null}
              </div>
              <button
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950"
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {results.map((salon, index) => {
          const featured = index === 0 && results.length >= 3;
          const rank = homeRankBadge(salon, index);
          const selected = salon.id === selectedSalonId;

          return (
            <div
              className={[
                featured ? "md:col-span-2 xl:col-span-2" : "",
                "rounded-lg transition",
                selected ? "ring-2 ring-emerald-500 ring-offset-2" : "",
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

function PopularServicesSection({
  onSelectCategory,
  services,
}: {
  onSelectCategory: (category: string) => void;
  services: ExplorePopularService[];
}) {
  if (services.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">
          Popular services
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Most widely available service categories across public salons.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {services.map((service) => (
          <button
            aria-label={`Search salons offering ${service.category}`}
            className="grid min-h-28 rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            key={service.category}
            onClick={() => onSelectCategory(service.category)}
            type="button"
          >
            <span className="text-base font-semibold text-zinc-950">
              {service.category}
            </span>
            <span className="mt-2 text-sm text-zinc-600">
              {service.salonCount} salon
              {service.salonCount === 1 ? "" : "s"}
            </span>
            <span className="mt-1 text-xs font-medium text-zinc-500">
              {service.activeServiceCount} active service
              {service.activeServiceCount === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ExploreHomeSections({
  content,
  gpsCoordinates,
  gpsMessage,
  nearYouSalons,
  onSelectCategory,
}: {
  content: ExploreHomeContent;
  gpsCoordinates: GpsCoordinates | null;
  gpsMessage: string | null;
  nearYouSalons: ExploreHomeSalon[];
  onSelectCategory: (category: string) => void;
}) {
  const nearYouIds = new Set(nearYouSalons.map((salon) => salon.id));
  const recommendedSalons = content.recommendedSalons.filter(
    (salon) => !nearYouIds.has(salon.id),
  );
  const newSalons = content.newSalons.filter(
    (salon) => !nearYouIds.has(salon.id),
  );
  const hasContent =
    content.inspiration.items.length > 0 ||
    nearYouSalons.length > 0 ||
    recommendedSalons.length > 0 ||
    newSalons.length > 0 ||
    content.popularServices.length > 0;

  return (
    <section
      aria-busy={false}
      className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-4 sm:px-6 lg:px-8"
    >
      {content.error ? (
        <ExploreNotice title="We couldn't load Explore home right now." tone="warning">
          Search still works. Please try refreshing this section later.
        </ExploreNotice>
      ) : null}

      <FreshInspirationSection initialPage={content.inspiration} />
      {gpsMessage ? (
        <ExploreNotice title="Location status" tone="warning">
          {gpsMessage}
        </ExploreNotice>
      ) : null}
      <NearYouHomeSection
        results={nearYouSalons}
        userCoordinates={gpsCoordinates}
      />
      <HomeSalonSection
        description="Based on public salon profiles and active services."
        results={recommendedSalons}
        title="Recommended for you"
      />
      <HomeSalonSection
        description="Recently published public salons."
        results={newSalons}
        title="New on KingPOS"
      />
      <PopularServicesSection
        onSelectCategory={onSelectCategory}
        services={content.popularServices}
      />

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
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-zinc-200 bg-white text-zinc-700";

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3">
      <button
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        type="button"
      >
        Previous
      </button>
      <p className="text-sm font-medium text-zinc-600">
        Page {page} of {totalPages}
      </p>
      <button
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
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
  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-950 p-5 text-white lg:grid-cols-[minmax(0,1fr)_minmax(22rem,.8fr)]">
        <div>
          <p className="text-sm font-semibold text-emerald-200">Quick actions</p>
          <h2 className="mt-2 text-xl font-semibold">Keep moving in KingPOS</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-300">
            Actions are based on your account, selected workspace, and permissions.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {actions.map((action) => (
            <Link
              className={[
                "grid min-h-24 rounded-lg border p-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                action.tone === "dark"
                  ? "border-white/20 bg-white text-zinc-950 hover:bg-zinc-100"
                  : "border-white/15 bg-white/10 text-white hover:bg-white/15",
              ].join(" ")}
              href={action.href}
              key={action.label}
            >
              <span className="text-sm font-semibold">{action.label}</span>
              <span
                className={
                  action.tone === "dark"
                    ? "mt-1 text-sm text-zinc-600"
                    : "mt-1 text-sm text-zinc-300"
                }
              >
                {action.description}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ExploreClient({
  hasUrlLocation,
  homeContent,
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
  const [locationSource, setLocationSource] =
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
  const appliedSavedLocation = useRef(false);

  const gpsActive = Boolean(gpsResponse && !location.trim());
  const searchMode = explicitSearchMode || gpsActive;
  const activeResponse: ExploreSearchResponse =
    gpsActive && gpsResponse ? gpsResponse : initialResponse;
  const activeResults = activeResponse.results;
  const activeSections = activeResponse.sections;
  const hasBestMatches = activeSections.bestMatches.length > 0;
  const hasNearbyResults = activeSections.nearby.length > 0;
  const hasRecommendedResults = activeSections.recommended.length > 0;
  const hasAnyResults =
    hasBestMatches || hasNearbyResults || hasRecommendedResults;
  const selectedCategory = category || "All";
  const normalizedCategory = cleanCategory(selectedCategory);
  const homeCategories = homeContent.popularServices.map(
    (service) => service.category,
  );
  const allDistancesMissing = gpsActive
    ? activeResults.length > 0 &&
      activeResults.every((salon) => salon.distanceMiles === null)
    : false;
  const isSearching = isPending || gpsStatus === "searching" || gpsStatus === "locating";
  const nearbyHasDistance = hasMeasuredDistance(activeSections.nearby);
  const noDirectMatches = Boolean(
    query.trim() && activeResponse.groupCounts.bestMatches === 0,
  );
  const homeMode = !searchMode;
  const displayLocation = formatDisplayLocation(location);
  const locationStatus = locationStatusLabel({
    displayLocation,
    source: locationSource,
  });
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
    setLocationSource(workspaceLocation.label ? "workspace" : "none");

    startTransition(() => {
      router.push(pathname, { scroll: false });
    });
  }

  function updateQuery(value: string) {
    setQuery(value);
    setNearYouSalons([]);
  }

  function updateLocation(value: string) {
    setLocation(value);
    setGpsResponse(null);
    setGpsCoordinates(null);
    setNearYouSalons([]);
    setLocationSource(value.trim() ? "manual" : "none");
  }

  function selectCategory(value: string) {
    const nextCategory = cleanCategory(value);
    const nextSearchMode = Boolean(
      nextCategory || query.trim() || (explicitSearchMode && location.trim()),
    );

    setCategory(value);
    setGpsResponse(null);
    setNearYouSalons([]);
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

  function goToPage(nextPage: number) {
    if (gpsActive && gpsCoordinates) {
      void runGpsSearch(gpsCoordinates, nextPage);
      return;
    }

    setExplicitSearchMode(true);

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

  function commitSearch() {
    const nextSearchMode = Boolean(
      query.trim() || location.trim() || normalizedCategory,
    );

    setGpsResponse(null);
    setNearYouSalons([]);
    setExplicitSearchMode(nextSearchMode);

    if (
      typeof window !== "undefined" &&
      location.trim() &&
      (locationSource === "manual" || locationSource === "saved")
    ) {
      window.localStorage.setItem(SAVED_LOCATION_KEY, location.trim());
    }

    const url = buildUrl({
      category: selectedCategory,
      location,
      page: 1,
      pathname,
      query,
      searchParams: new URLSearchParams(searchParams.toString()),
    });

    startTransition(() => {
      router.push(url, { scroll: false });
    });
  }

  return (
    <main className="min-w-0 overflow-x-hidden bg-zinc-50">
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-700">
                KingPOS Explore
              </p>
              <h1 className="mt-1 text-3xl font-semibold text-zinc-950 sm:text-4xl">
                Discover salons
              </h1>
            </div>
            <p className="text-sm font-semibold text-zinc-500 sm:text-right">
              {locationStatus}
            </p>
          </div>

          <form
            className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-[0_18px_45px_rgba(24,24,27,0.08)] md:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(14rem,.72fr)_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              commitSearch();
            }}
          >
            <label className="grid min-h-[4.25rem] gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 focus-within:border-zinc-950 focus-within:bg-white">
              <span className="text-[11px] font-semibold uppercase text-zinc-500">
                Salon or service
              </span>
              <input
                className="min-w-0 bg-transparent text-base font-semibold text-zinc-950 outline-none placeholder:text-zinc-400"
                onChange={(event) => updateQuery(event.target.value)}
                placeholder="Nails, gel, Tram"
                type="search"
                value={query}
              />
            </label>
            <label className="grid min-h-[4.25rem] gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 focus-within:border-zinc-950 focus-within:bg-white">
              <span className="text-[11px] font-semibold uppercase text-zinc-500">
                City or ZIP
              </span>
              <input
                className="min-w-0 bg-transparent text-base font-semibold text-zinc-950 outline-none placeholder:text-zinc-400"
                onChange={(event) => updateLocation(event.target.value)}
                placeholder="Milwaukee, WI"
                type="search"
                value={location}
              />
            </label>
            <button
              className="min-h-[4.25rem] rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSearching}
              type="submit"
            >
              {isSearching ? "Searching" : "Search"}
            </button>
            <button
              className="min-h-[4.25rem] rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={gpsStatus === "locating" || gpsStatus === "searching"}
              onClick={requestCurrentLocation}
              type="button"
            >
              {gpsActionLabel(gpsStatus)}
            </button>
          </form>

          <CategoryChips
            categories={homeCategories}
            category={selectedCategory}
            onChange={selectCategory}
          />
        </div>
      </section>

      {homeMode ? (
        <ExploreHomeSections
          content={homeContent}
          gpsCoordinates={gpsCoordinates}
          gpsMessage={gpsMessage}
          nearYouSalons={nearYouSalons}
          onSelectCategory={selectCategory}
        />
      ) : (
        <>
          <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-8">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950 sm:text-2xl">
                {summaryText}
              </h2>
              <p aria-live="polite" className="sr-only">
                {isSearching ? "Updating Explore results." : summaryText}
              </p>
              {isSearching ? (
                <p className="mt-1 text-sm text-zinc-600">Updating results.</p>
              ) : null}
            </div>
            {searchMode ? (
              <button
                className="w-fit rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                onClick={clearFilters}
                type="button"
              >
                Clear filters
              </button>
            ) : null}
          </section>

          <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 sm:px-6 lg:px-8">
        {activeResponse.error ? (
          <ExploreNotice title="We couldn't load salons right now." tone="warning">
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
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-50"
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
              : "Here are recommended salons available on KingPOS."}
          </ExploreNotice>
        ) : null}

        {!hasAnyResults && !activeResponse.error ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
            <h2 className="text-xl font-semibold text-zinc-950">
              No salons available yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
              No active salons match this search right now. Try another salon,
              service, city, state, or ZIP.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {searchMode ? (
                <button
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
              <button
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-50"
                onClick={requestCurrentLocation}
                type="button"
              >
                Use current location
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-8">
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

        {activeResponse.groupCounts.bestMatches > activeResponse.pageSize ? (
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
    </main>
  );
}
