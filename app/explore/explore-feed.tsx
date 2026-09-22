"use client";

import { loadExploreFeedAction } from "@/app/explore/actions";
import { PostCommentThread } from "@/app/post-comments/post-comment-thread";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import { AuthIntentPrompt } from "@/components/auth-intent-prompt";
import { LumiTrustPopover } from "@/components/reylumi-trust";
import {
  ReylumiIcon,
  type ReylumiIconName,
} from "@/components/reylumi-icons";
import { SalonOperatingStatusBadge } from "@/components/salon-operating-status-badge";
import type {
  ExploreDiscoveryResultKind,
  ExploreDiscoveryShortcut,
  ExploreFeedCursor,
  ExploreFeedItem,
  ExploreFeedMedia,
  ExploreFeedPage,
} from "@/types/explore";
import type {
  PostCommentTarget,
  PostCommentViewer,
} from "@/types/post-comments";
import {
  buildReylumiTrustSummary,
  type ReylumiTrustSummary,
} from "@/lib/reylumi-trust";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

const EXPLORE_FEED_SESSION_KEY = "kingpos-explore-continuous-feed";
const EXPLORE_FEED_SESSION_VERSION = 10;
const EXPLORE_FEED_SESSION_TTL_MS = 30 * 60 * 1000;
const EXPLORE_FEED_SESSION_ITEM_LIMIT = 120;

type StoredExploreFeedState = {
  cursor: ExploreFeedCursor | null;
  hasMore: boolean;
  items: ExploreFeedItem[];
  route: string;
  savedAt: number;
  scrollY: number;
  version: typeof EXPLORE_FEED_SESSION_VERSION;
};

function emptyBookingMeta(): ExploreFeedItem["bookingMeta"] {
  return {
    availabilityLabel: null,
    distanceMiles: null,
    durationMinutes: null,
    price: null,
  };
}

function readStoredBookingMeta(value: unknown): ExploreFeedItem["bookingMeta"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyBookingMeta();
  }

  const meta = value as Partial<ExploreFeedItem["bookingMeta"]>;
  const distanceMiles =
    typeof meta.distanceMiles === "number" && Number.isFinite(meta.distanceMiles)
      ? meta.distanceMiles
      : null;
  const durationMinutes =
    typeof meta.durationMinutes === "number" && Number.isFinite(meta.durationMinutes)
      ? meta.durationMinutes
      : null;
  const price =
    typeof meta.price === "number" && Number.isFinite(meta.price)
      ? meta.price
      : null;

  return {
    availabilityLabel:
      typeof meta.availabilityLabel === "string" &&
      meta.availabilityLabel.trim()
        ? meta.availabilityLabel
        : null,
    distanceMiles,
    durationMinutes,
    price,
  };
}

function feedItemKey(item: ExploreFeedItem) {
  return item.feedKey;
}

function isStoredFeedItem(value: unknown): value is ExploreFeedItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  const author = item.author as Record<string, unknown> | undefined;

  return (
    typeof item.feedKey === "string" &&
    typeof item.contentId === "string" &&
    typeof item.publishedAt === "string" &&
    (item.sourceType === "salon" || item.sourceType === "personal") &&
    (item.contentType === "look" ||
      item.contentType === "salon_recommendation" ||
      item.contentType === "update" ||
      item.contentType === "beauty_post") &&
    author !== undefined &&
    typeof author.name === "string" &&
    Array.isArray(item.media) &&
    item.media.some(
      (media) =>
        media &&
        typeof media === "object" &&
        typeof (media as Record<string, unknown>).imageUrl === "string",
    )
  );
}

function normalizeStoredFeedItem(item: ExploreFeedItem): ExploreFeedItem {
  const normalized =
    typeof item.commentCount === "number"
      ? item
      : { ...item, commentCount: 0 };

  return {
    ...normalized,
    bookingMeta: readStoredBookingMeta(
      (item as Partial<ExploreFeedItem>).bookingMeta,
    ),
  };
}

function readStoredFeedState(
  route: string,
  expectedFirstKey: string | null,
): StoredExploreFeedState | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(EXPLORE_FEED_SESSION_KEY) ?? "null",
    ) as Partial<StoredExploreFeedState> | null;

    if (
      !parsed ||
      parsed.version !== EXPLORE_FEED_SESSION_VERSION ||
      parsed.route !== route ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > EXPLORE_FEED_SESSION_TTL_MS ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }

    const items = parsed.items
      .filter(isStoredFeedItem)
      .map(normalizeStoredFeedItem)
      .slice(0, EXPLORE_FEED_SESSION_ITEM_LIMIT);
    const firstKey = items[0] ? feedItemKey(items[0]) : null;

    if (expectedFirstKey && firstKey && expectedFirstKey !== firstKey) {
      return null;
    }

    return {
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      hasMore: parsed.hasMore === true,
      items,
      route,
      savedAt: parsed.savedAt,
      scrollY:
        typeof parsed.scrollY === "number" && Number.isFinite(parsed.scrollY)
          ? Math.max(0, parsed.scrollY)
          : 0,
      version: EXPLORE_FEED_SESSION_VERSION,
    };
  } catch {
    return null;
  }
}

function writeStoredFeedState(input: {
  cursor: ExploreFeedCursor | null;
  hasMore: boolean;
  items: ExploreFeedItem[];
}) {
  try {
    const state: StoredExploreFeedState = {
      cursor: input.cursor,
      hasMore: input.hasMore,
      items: input.items.slice(0, EXPLORE_FEED_SESSION_ITEM_LIMIT),
      route: `${window.location.pathname}${window.location.search}`,
      savedAt: Date.now(),
      scrollY: window.scrollY,
      version: EXPLORE_FEED_SESSION_VERSION,
    };

    window.sessionStorage.setItem(
      EXPLORE_FEED_SESSION_KEY,
      JSON.stringify(state),
    );
  } catch {
    window.sessionStorage.removeItem(EXPLORE_FEED_SESSION_KEY);
  }
}

function shouldRestoreStoredFeedState() {
  const navigation = window.performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;

  return navigation?.type !== "reload";
}

function appendUniqueFeedItems(
  current: ExploreFeedItem[],
  incoming: ExploreFeedItem[],
) {
  const seen = new Set(current.map(feedItemKey));
  const nextItems = incoming.filter((item) => {
    const key = feedItemKey(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return nextItems.length > 0 ? [...current, ...nextItems] : current;
}

function mergeStoredFeedItems(
  stored: ExploreFeedItem[],
  fresh: ExploreFeedItem[],
) {
  const freshByKey = new Map(fresh.map((item) => [feedItemKey(item), item]));
  const merged = stored.map((item) => freshByKey.get(feedItemKey(item)) ?? item);
  const mergedKeys = new Set(merged.map(feedItemKey));
  const freshOnlyItems = fresh.filter((item) => !mergedKeys.has(feedItemKey(item)));

  return freshOnlyItems.length > 0 ? [...merged, ...freshOnlyItems] : merged;
}

function displayName(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();

  return trimmed ? trimmed.replace(/\s+/g, " ") : fallback;
}

function locationLabel(item: ExploreFeedItem) {
  return [item.salon?.city, item.salon?.state].filter(Boolean).join(", ") || null;
}

function serviceLabel(item: ExploreFeedItem) {
  return (
    displayName(item.serviceName, "") ||
    displayName(item.serviceCategory, "") ||
    null
  );
}

function feedTrustSummary(item: ExploreFeedItem): ReylumiTrustSummary | null {
  if (!item.salon) {
    return null;
  }

  return buildReylumiTrustSummary(
    item.salon.trust,
    {
      verifiedVisitState: item.verification?.state === "verified",
    },
  );
}

function bookingCountLabel(count: number) {
  return `${count} booked`;
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

function priceLabel(item: ExploreFeedItem) {
  return item.bookingMeta.price !== null
    ? `${formatMoney(item.bookingMeta.price)}+`
    : item.booking?.eligible
      ? "Price varies"
      : null;
}

function durationLabel(item: ExploreFeedItem) {
  return item.bookingMeta.durationMinutes !== null
    ? formatDuration(item.bookingMeta.durationMinutes)
    : item.booking?.eligible
      ? "Time varies"
      : null;
}

function distanceLabel(item: ExploreFeedItem) {
  const distance = item.bookingMeta.distanceMiles;

  if (distance === null) {
    return null;
  }

  return distance < 10 ? `${distance.toFixed(1)} mi` : `${Math.round(distance)} mi`;
}

function ratingLabel(item: ExploreFeedItem) {
  const rating = item.salon?.trust.averageRating;
  const reviews = item.salon?.trust.sharedExperienceCount;

  if (rating === null || rating === undefined) {
    return null;
  }

  return typeof reviews === "number" && reviews > 0
    ? `${rating.toFixed(1)} (${reviews})`
    : `${rating.toFixed(1)}`;
}

function availabilityLabel(item: ExploreFeedItem) {
  if (item.bookingMeta.availabilityLabel) {
    return item.bookingMeta.availabilityLabel;
  }

  if (item.salon?.operatingStatus.isOpen) {
    return item.salon.operatingStatus.closesAtLocal
      ? `Open until ${item.salon.operatingStatus.closesAtLocal}`
      : "Open now";
  }

  return item.salon?.operatingStatus.nextOpensLabel ?? null;
}

function ActionTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <span className="group/action relative inline-flex">
      {children}
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg sm:group-hover/action:block sm:group-focus-within/action:block"
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}

function BookActionIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3.5 9h17" />
      <path d="M5 4h14a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Z" />
      <path d="m9 15 2 2 4-5" />
    </svg>
  );
}

function ShareActionIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v14" />
    </svg>
  );
}

function CommentActionIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
    </svg>
  );
}

function timeAgo(value: string) {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return "recent";
  }

  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000));

  if (seconds < 60) {
    return "now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d`;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function mediaAspectRatio(media: ExploreFeedMedia | undefined) {
  if (media?.aspectRatio && media.aspectRatio > 0) {
    const ratio = Math.min(1.55, Math.max(1.06, media.aspectRatio));
    return `${ratio}`;
  }

  if (media?.layoutVariant === "landscape") {
    return "4 / 3";
  }

  if (media?.layoutVariant === "square") {
    return "1 / 1";
  }

  return "4 / 5";
}

function isRecommendationCoverMedia(
  item: ExploreFeedItem,
  media: ExploreFeedMedia | undefined,
) {
  return (
    item.contentType === "salon_recommendation" &&
    media?.id.startsWith("salon-cover:") === true
  );
}

function initialsFor(value: string) {
  return (
    value
      .replace(/[^a-z0-9\s]/gi, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "R"
  );
}

function itemContextLabel(item: ExploreFeedItem) {
  if (item.contentType === "salon_recommendation") {
    return "Recommended salon";
  }

  if (item.sourceType === "personal") {
    return item.personal?.postType === "before_after"
      ? "Before & After"
      : "Beauty moment";
  }

  return item.contentType === "look" ? "Look" : "Update";
}

function imageAlt(item: ExploreFeedItem) {
  const label = serviceLabel(item);

  if (item.contentType === "salon_recommendation") {
    return label && item.salon
      ? `${item.salon.name} salon recommendation for ${label}`
      : `${item.salon?.name ?? item.author.name} salon recommendation`;
  }

  if (item.sourceType === "personal") {
    return label
      ? `${label} beauty post by ${item.author.name}`
      : `Beauty post by ${item.author.name}`;
  }

  return label && item.salon
    ? `${label} inspiration from ${item.salon.name}`
    : `Beauty inspiration from ${item.salon?.name ?? item.author.name}`;
}

function FeedAvatar({ item }: { item: ExploreFeedItem }) {
  const avatarUrl =
    item.author.avatarUrl ??
    (item.author.kind === "salon" ? item.salon?.logoImageUrl : null);
  const avatarName =
    item.author.kind === "salon"
      ? (item.salon?.name ?? item.author.name)
      : item.author.name;

  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-text-primary text-sm font-semibold text-white">
      {avatarUrl ? (
        <Image
          alt={`${avatarName} profile`}
          className="object-cover"
          fill
          sizes="36px"
          src={avatarUrl}
        />
      ) : (
        initialsFor(item.author.name)
      )}
    </span>
  );
}

function FeedSalonLogo({ item }: { item: ExploreFeedItem }) {
  const salon = item.salon;

  if (!salon) {
    return null;
  }

  return (
    <span
      aria-hidden
      className="relative grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-orange-soft text-[0.55rem] font-extrabold text-brand-orange ring-1 ring-divider-subtle"
    >
      {salon.logoImageUrl ? (
        <Image
          alt=""
          className="object-cover"
          fill
          sizes="20px"
          src={salon.logoImageUrl}
        />
      ) : (
        initialsFor(salon.name)
      )}
    </span>
  );
}

function FeedHeaderTitle({
  authorHref,
  item,
}: {
  authorHref: string;
  item: ExploreFeedItem;
}) {
  const salon = item.salon;
  const authorName = displayName(item.author.name, "Reylumi");
  const isLinkedPersonal = item.sourceType === "personal" && Boolean(salon);

  if (!isLinkedPersonal || !salon) {
    return (
      <Link
        className="min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href={authorHref}
      >
        <span className="inline-flex max-w-full items-center gap-1.5 text-sm font-semibold text-text-primary transition hover:text-brand-orange">
          <span className="truncate">{authorName}</span>
          {salon ? (
            <ReylumiIcon
              className="h-3.5 w-3.5 shrink-0 text-sky-500"
              name="verified"
            />
          ) : null}
        </span>
      </Link>
    );
  }

  const summary = feedTrustSummary(item);
  const profileHref = salon.href ?? null;
  const trustHref = profileHref ? `${profileHref}#lumi-trust` : null;
  const salonIdentity = (
    <span className="inline-flex min-w-0 max-w-[13rem] items-center gap-1.5">
      <FeedSalonLogo item={item} />
      <span className="truncate">{salon.name}</span>
      <ReylumiIcon
        className="h-3.5 w-3.5 shrink-0 text-sky-500"
        name="verified"
      />
    </span>
  );

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold text-text-primary">
      <Link
        className="block min-w-0 max-w-[9rem] truncate rounded-md transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:max-w-[11rem]"
        href={authorHref}
      >
        {authorName}
      </Link>
      <span className="shrink-0 font-medium text-text-secondary">at</span>
      {profileHref ? (
        <Link
          className="min-w-0 rounded-md transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={profileHref}
        >
          {salonIdentity}
        </Link>
      ) : (
        salonIdentity
      )}
      {summary ? (
        <LumiTrustPopover
          actionHref={trustHref}
          entityName={salon.name}
          markClassName="grid h-8 w-8 place-items-center rounded-full bg-white p-0 text-brand-orange shadow-[0_5px_14px_rgba(246,125,68,0.18)] ring-1 ring-brand-orange/25 hover:bg-brand-orange-soft"
          panelClassName="text-zinc-700"
          presentation="spark"
          size="sm"
          summary={summary}
        />
      ) : null}
      <SalonOperatingStatusBadge
        className="max-w-full"
        status={salon.operatingStatus}
      />
    </span>
  );
}

function FeedSalonIdentityLine({ item }: { item: ExploreFeedItem }) {
  const summary = feedTrustSummary(item);
  const location = locationLabel(item);
  const profileHref = item.salon?.href ?? null;
  const trustHref = profileHref ? `${profileHref}#lumi-trust` : null;

  if (!item.salon) {
    return (
      <span className="block truncate text-xs font-medium text-text-secondary">
        {itemContextLabel(item)}
      </span>
    );
  }

  if (item.sourceType === "personal") {
    return location ? (
      <span className="mt-0.5 block truncate text-xs font-medium text-text-secondary">
        {location}
      </span>
    ) : null;
  }

  const rating = ratingLabel(item);
  const distance = distanceLabel(item);

  return (
    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium text-text-secondary">
      {rating ? (
        <>
          <ReylumiIcon
            className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
            name="star"
          />
          <span className="font-semibold text-text-primary">{rating}</span>
        </>
      ) : null}
      {distance ? <span>{distance}</span> : null}
      {summary ? (
        <LumiTrustPopover
          actionHref={trustHref}
          entityName={item.salon.name}
          markClassName="grid h-8 w-8 place-items-center rounded-full bg-white p-0 text-brand-orange shadow-[0_5px_14px_rgba(246,125,68,0.18)] ring-1 ring-brand-orange/25 hover:bg-brand-orange-soft"
          panelClassName="text-zinc-700"
          presentation="spark"
          size="sm"
          summary={summary}
        />
      ) : null}
      <SalonOperatingStatusBadge
        className="max-w-full"
        status={item.salon.operatingStatus}
      />
      {location ? (
        <>
          <span aria-hidden className="text-text-muted/60">
            {"\u00b7"}
          </span>
          <span className="min-w-0 truncate">{location}</span>
        </>
      ) : null}
    </span>
  );
}

function FeedStatusLine({
  href,
  item,
  service,
  showContextBadge,
}: {
  href: string | null;
  item: ExploreFeedItem;
  service: string | null;
  showContextBadge: boolean;
}) {
  const details = [
    showContextBadge && item.contentType !== "salon_recommendation"
      ? itemContextLabel(item)
      : null,
    service,
  ].filter((detail): detail is string => Boolean(detail));

  if (details.length === 0) {
    return null;
  }

  const status = (
    <p className="text-xs font-semibold text-text-muted">
      {details.join(" \u00b7 ")}
    </p>
  );

  return href ? (
    <Link
      className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href={href}
    >
      {status}
    </Link>
  ) : (
    status
  );
}

function shareTitle(item: ExploreFeedItem) {
  return (
    displayName(item.caption, "") ||
    `${itemContextLabel(item)} by ${displayName(item.author.name, "Reylumi")}`
  );
}

function FeedShareButton({
  href,
  item,
}: {
  href: string;
  item: ExploreFeedItem;
}) {
  const [status, setStatus] = useState<"copied" | "idle">("idle");
  const timerRef = useRef<number | null>(null);

  function markCopied() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    setStatus("copied");
    timerRef.current = window.setTimeout(() => {
      setStatus("idle");
      timerRef.current = null;
    }, 1600);
  }

  async function copyUrl(url: string) {
    if (!navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(url);
    markCopied();
  }

  async function sharePost(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const url = new URL(href, window.location.origin).toString();

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle(item),
          url,
        });
        return;
      }

      await copyUrl(url);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      try {
        await copyUrl(url);
      } catch {
        setStatus("idle");
      }
    }
  }

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (
    <ActionTooltip label={status === "copied" ? "Copied" : "Share"}>
      <button
        aria-label={`Share ${itemContextLabel(item)} by ${displayName(
          item.author.name,
          "Reylumi",
        )}`}
        className="grid h-8 w-8 place-items-center rounded-full bg-white text-text-secondary ring-1 ring-divider-subtle transition hover:bg-surface-muted hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        onClick={(event) => {
          void sharePost(event);
        }}
        type="button"
      >
        <ShareActionIcon />
      </button>
      <span aria-live="polite" className="sr-only">
        {status === "copied" ? "Link copied." : ""}
      </span>
    </ActionTooltip>
  );
}

function SingleMedia({
  featured = false,
  item,
  media,
}: {
  featured?: boolean;
  item: ExploreFeedItem;
  media: ExploreFeedMedia;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const isCoverFallback = isRecommendationCoverMedia(item, media);

  return (
    <div
      className={[
        "relative overflow-hidden rounded-[0.85rem] bg-surface-muted",
        isCoverFallback ? "h-[13rem] sm:h-[16rem] lg:h-[17rem]" : "",
        featured && !isCoverFallback ? "min-h-[21rem] sm:min-h-0" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        isCoverFallback ? undefined : { aspectRatio: mediaAspectRatio(media) }
      }
    >
      {imageFailed ? (
        <div
          aria-label={imageAlt(item)}
          className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#fff7ed,#e6fffb)] px-6 text-center text-sm font-semibold text-text-secondary"
          role="img"
        >
          {item.author.name}
        </div>
      ) : (
        <Image
          alt={imageAlt(item)}
          className="object-cover transition duration-500 group-hover:scale-[1.015] motion-reduce:transition-none"
          fill
          loading="lazy"
          onError={() => setImageFailed(true)}
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 68vw, 720px"
          src={media.imageUrl}
        />
      )}
    </div>
  );
}

function beforeAfterMediaPair(item: ExploreFeedItem) {
  if (
    item.sourceType !== "personal" ||
    item.personal?.postType !== "before_after"
  ) {
    return null;
  }

  const before = item.media.find((media) => media.role === "before");
  const after = item.media.find((media) => media.role === "after");

  if (!before || !after) {
    return null;
  }

  return { after, before };
}

function BeforeAfterMedia({
  featured = false,
  item,
}: {
  featured?: boolean;
  item: ExploreFeedItem;
}) {
  const pair = beforeAfterMediaPair(item);
  const firstMedia = item.media[0];

  if (!pair) {
    return firstMedia ? (
      <SingleMedia featured={featured} item={item} media={firstMedia} />
    ) : null;
  }

  return (
    <BeforeAfterCompare
      after={{
        alt: `After image from ${item.author.name}`,
        id: pair.after.id,
        url: pair.after.imageUrl,
      }}
      aspectClassName={featured ? "aspect-[5/6] sm:aspect-[4/3]" : "aspect-[4/5] sm:aspect-[4/3]"}
      before={{
        alt: `Before image from ${item.author.name}`,
        id: pair.before.id,
        url: pair.before.imageUrl,
      }}
      roundedClassName="rounded-none"
      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 68vw, 720px"
    />
  );
}

function FeedMedia({
  featured = false,
  item,
}: {
  featured?: boolean;
  item: ExploreFeedItem;
}) {
  const firstMedia = item.media[0];

  if (!firstMedia) {
    return (
      <div className="grid aspect-[4/5] place-items-center bg-surface-muted px-6 text-center text-sm font-semibold text-text-secondary">
        {item.author.name}
      </div>
    );
  }

  const isBeforeAfter =
    item.sourceType === "personal" &&
    item.personal?.postType === "before_after";
  const media = isBeforeAfter ? (
    <BeforeAfterMedia featured={featured} item={item} />
  ) : (
    <SingleMedia featured={featured} item={item} media={firstMedia} />
  );

  return (
    <div className="relative">
      {media}
      {!isBeforeAfter && item.media.length > 1 ? (
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">
          {item.media.length} photos
        </span>
      ) : null}
    </div>
  );
}

function FeedMediaFrame({
  featured = false,
  href,
  item,
}: {
  featured?: boolean;
  href: string | null;
  item: ExploreFeedItem;
}) {
  const router = useRouter();
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const media = <FeedMedia featured={featured} item={item} />;
  const isBeforeAfter = Boolean(beforeAfterMediaPair(item));

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    pointerMovedRef.current = false;
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;

    if (!start) {
      return;
    }

    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);

    if (deltaX > 6 || deltaY > 6) {
      pointerMovedRef.current = true;
    }
  }

  function isComparatorControl(target: EventTarget | null) {
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          "a,button,input,textarea,select,[role='button'],[role='slider']",
        ),
      )
    );
  }

  function openBeforeAfterPost(event: MouseEvent<HTMLDivElement>) {
    if (!href || pointerMovedRef.current || isComparatorControl(event.target)) {
      pointerMovedRef.current = false;
      return;
    }

    router.push(href);
  }

  function openBeforeAfterPostFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!href || isComparatorControl(event.target)) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  }

  return (
    <div
      aria-label={
        href && isBeforeAfter
          ? `Open ${itemContextLabel(item)} by ${item.author.name}`
          : undefined
      }
      className={[
        "relative",
        href && isBeforeAfter
          ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={href && isBeforeAfter ? openBeforeAfterPost : undefined}
      onKeyDown={
        href && isBeforeAfter ? openBeforeAfterPostFromKeyboard : undefined
      }
      onPointerDown={href && isBeforeAfter ? startPointer : undefined}
      onPointerMove={href && isBeforeAfter ? movePointer : undefined}
      role={href && isBeforeAfter ? "link" : undefined}
      tabIndex={href && isBeforeAfter ? 0 : undefined}
    >
      {href && !isBeforeAfter ? (
        <Link
          aria-label={`Open ${itemContextLabel(item)} by ${item.author.name}`}
          className="group block focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange"
          href={href}
        >
          {media}
        </Link>
      ) : (
        media
      )}
    </div>
  );
}

function exploreCommentTarget(item: ExploreFeedItem): PostCommentTarget | null {
  if (!item.saveTarget) {
    return null;
  }

  return {
    profileId: item.personal?.profileId ?? null,
    salonId: item.saveTarget.salonId ?? item.salon?.id ?? null,
    sourceId: item.saveTarget.sourceId,
    sourceType: item.saveTarget.sourceType,
    title: displayName(item.caption, "") || itemContextLabel(item),
  };
}

function FeedHeroIntro({
  item,
  service,
}: {
  item: ExploreFeedItem;
  service: string | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const salonName = item.salon?.name ?? item.author.name;
  const firstMedia = item.media[0];
  const city = item.salon?.city ?? "Milwaukee";
  const title =
    item.feedKey.startsWith("showcase:hero:")
      ? "Chrome Season"
      : service ?? salonName ?? itemContextLabel(item);
  const supporting = [
    item.feedKey.startsWith("showcase:hero:")
      ? "23 artists near you can create this look"
      : null,
    !item.feedKey.startsWith("showcase:hero:") ? ratingLabel(item) : null,
    !item.feedKey.startsWith("showcase:hero:")
      ? distanceLabel(item) ?? locationLabel(item)
      : null,
    !item.feedKey.startsWith("showcase:hero:") ? availabilityLabel(item) : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const href = item.destination.href ?? item.booking?.href ?? "/explore";

  return (
    <div className="relative min-h-[20.5rem] overflow-hidden rounded-t-[1.05rem] bg-text-primary sm:hidden">
      {firstMedia && !imageFailed ? (
        <Image
          alt={imageAlt(item)}
          className="object-cover"
          fill
          onError={() => setImageFailed(true)}
          priority
          sizes="100vw"
          src={firstMedia.imageUrl}
        />
      ) : (
        <div className="grid h-full min-h-[20.5rem] place-items-center bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)] px-6 text-center text-xl font-semibold text-brand-orange">
          {salonName}
        </div>
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.03),rgba(0,0,0,0.24)_42%,rgba(0,0,0,0.68))]"
      />
      <div className="absolute left-3 top-3 rounded-full bg-white/18 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur">
        Only {city}
      </div>
      {item.saveTarget ? (
        <SavePostButton
          className="absolute right-3 top-3"
          initialSaved={item.saveTarget.saved}
          saveCount={item.saveTarget.saveCount}
          size="compact"
          target={item.saveTarget}
        />
      ) : null}
      <div className="absolute inset-x-0 bottom-0 grid gap-3 p-4 text-white">
        <div>
          <p className="w-fit rounded-full bg-white/16 px-2.5 py-1 text-[11px] font-bold uppercase tracking-normal text-white ring-1 ring-white/18">
            Trending in {city}
          </p>
          <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-normal">
            {title}
          </h2>
          {supporting ? (
            <p className="mt-1 max-w-[19rem] text-sm font-semibold leading-5 text-white/88">
              {supporting}
            </p>
          ) : null}
        </div>
        <Link
          className="inline-flex min-h-10 w-fit items-center rounded-[0.65rem] bg-white px-4 text-sm font-semibold text-text-primary transition hover:bg-brand-orange hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          href={href}
        >
          Explore look
        </Link>
      </div>
    </div>
  );
}

function FeedDecisionMeta({
  item,
  service,
}: {
  item: ExploreFeedItem;
  service: string | null;
}) {
  const distance = distanceLabel(item);
  const area = locationLabel(item);
  const metrics = [
    { label: "Rating", value: ratingLabel(item) },
    { label: distance ? "Distance" : "Area", value: distance ?? area },
    { label: "Service", value: service },
    { label: "Price", value: priceLabel(item) },
    { label: "Duration", value: durationLabel(item) },
    { label: "Availability", value: availabilityLabel(item) },
  ].filter(
    (metric): metric is { label: string; value: string } =>
      typeof metric.value === "string" && metric.value.trim().length > 0,
  );

  if (metrics.length === 0) {
    return null;
  }

  return (
    <dl className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-text-secondary">
      {metrics.map((metric) => (
        <div
          className={[
            "inline-flex min-w-0 items-center gap-1",
            metric.label === "Availability"
              ? "rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-100"
              : "",
            metric.label === "Price" ? "text-text-primary" : "",
          ].join(" ")}
          key={metric.label}
        >
          <dt className="sr-only">
            {metric.label}
          </dt>
          {metric.label === "Rating" ? (
            <ReylumiIcon
              className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
              name="star"
            />
          ) : null}
          <dd className="truncate">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function feedDiscoveryTitle(shortcut: ExploreDiscoveryShortcut) {
  if (shortcut.id === "available-today") {
    return "Available today";
  }

  if (shortcut.id === "near-you") {
    return "Available near you";
  }

  if (shortcut.id === "top-rated") {
    return "Top artists";
  }

  if (shortcut.id === "under-60") {
    return "Under $60";
  }

  if (shortcut.id === "trending") {
    return "Trending";
  }

  return shortcut.label;
}

function feedDiscoveryActionLabel(shortcut: ExploreDiscoveryShortcut) {
  if (shortcut.id === "available-today") {
    return "See times";
  }

  if (shortcut.id === "under-60") {
    return "See value picks";
  }

  return shortcut.actionLabel;
}

function feedShortcutIconName(
  shortcut: ExploreDiscoveryShortcut,
): ReylumiIconName {
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

function feedShortcutToneClass(shortcut: ExploreDiscoveryShortcut) {
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

function FeedDiscoveryPreview({
  fallback,
  imageUrl,
  index,
}: {
  fallback: string;
  imageUrl: string | null;
  index: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const visibleImage = imageFailed ? null : imageUrl;

  return (
    <span
      className="relative block aspect-square overflow-hidden rounded-[0.7rem] bg-surface-muted ring-1 ring-divider-subtle/65"
      style={{ transform: index === 1 ? "translateY(6px)" : undefined }}
    >
      {visibleImage ? (
        <Image
          alt=""
          className="object-cover"
          fill
          loading="lazy"
          onError={() => setImageFailed(true)}
          sizes="72px"
          src={visibleImage}
        />
      ) : (
        <span className="grid h-full w-full place-items-center bg-brand-orange-soft text-xs font-semibold text-brand-orange">
          {initialsFor(fallback)}
        </span>
      )}
    </span>
  );
}

function FeedDiscoveryModule({
  activeResultKind,
  onSelect,
  shortcut,
}: {
  activeResultKind: ExploreDiscoveryResultKind | null;
  onSelect?: (shortcut: ExploreDiscoveryShortcut) => void;
  shortcut: ExploreDiscoveryShortcut;
}) {
  const active =
    shortcut.action.type === "result" &&
    shortcut.action.resultKind === activeResultKind;
  const previews = shortcut.previews.slice(0, 3);
  const label = feedDiscoveryTitle(shortcut);
  const moduleBody = (
    <span className="grid gap-3">
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-[0.8rem] ring-1 ${feedShortcutToneClass(
            shortcut,
          )}`}
        >
          <ReylumiIcon
            className="h-5 w-5"
            name={feedShortcutIconName(shortcut)}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text-primary">
            {label}
          </span>
          {shortcut.context ? (
            <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">
              {shortcut.context}
            </span>
          ) : null}
          {shortcut.detail ? (
            <span className="mt-0.5 block line-clamp-1 text-xs text-text-muted">
              {shortcut.detail}
            </span>
          ) : null}
        </span>
        <span className="ml-auto inline-flex min-h-8 shrink-0 items-center rounded-full bg-brand-orange-soft px-3 text-xs font-semibold text-brand-orange">
          {feedDiscoveryActionLabel(shortcut)}
        </span>
      </span>
      <span aria-hidden className="grid grid-cols-3 gap-1.5">
        {previews.length > 0 ? (
          previews.map((preview, index) => (
            <FeedDiscoveryPreview
              fallback={preview.label ?? label}
              imageUrl={preview.imageUrl}
              index={index}
              key={preview.sourceId}
            />
          ))
        ) : (
          <FeedDiscoveryPreview fallback={label} imageUrl={null} index={0} />
        )}
      </span>
    </span>
  );
  const className = [
    "sm:hidden rounded-[0.95rem] bg-white p-3 text-left shadow-[0_10px_26px_rgba(35,25,22,0.045)] ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
    active
      ? "ring-brand-orange/35"
      : "ring-divider-subtle/70 hover:ring-brand-orange/25",
  ].join(" ");

  if (shortcut.action.type === "href") {
    return (
      <Link
        aria-label={`${label}. ${shortcut.actionLabel}`}
        className={className}
        href={shortcut.action.href}
      >
        {moduleBody}
      </Link>
    );
  }

  if (!onSelect) {
    return null;
  }

  return (
    <button
      aria-label={`${label}. ${shortcut.actionLabel}`}
      aria-pressed={active}
      className={className}
      onClick={() => onSelect(shortcut)}
      type="button"
    >
      {moduleBody}
    </button>
  );
}

function orderedFeedDiscoveryShortcuts(shortcuts: ExploreDiscoveryShortcut[]) {
  const priority = new Map([
    ["available-today", 0],
    ["near-you", 1],
    ["trending", 2],
    ["top-rated", 3],
    ["under-60", 4],
    ["recommended", 5],
  ]);

  return shortcuts
    .filter((shortcut) => shortcut.moduleKind !== "booking")
    .slice()
    .sort(
      (left, right) =>
        (priority.get(left.id) ?? 20) - (priority.get(right.id) ?? 20),
    )
    .slice(0, 4);
}

function ExploreFeedCard({
  featured = false,
  item,
  onCommentCountChange,
  viewer,
}: {
  featured?: boolean;
  item: ExploreFeedItem;
  onCommentCountChange: (feedKey: string, count: number) => void;
  viewer: PostCommentViewer;
}) {
  const service = serviceLabel(item);
  const href = item.destination.href;
  const isSalonRecommendation = item.contentType === "salon_recommendation";
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [bookPromptOpen, setBookPromptOpen] = useState(false);
  const [commentCountState, setCommentCountState] = useState(() => ({
    count: item.commentCount,
    feedKey: item.feedKey,
  }));
  const booking = item.booking?.eligible ? item.booking : null;
  const bookingHref = booking?.href ?? null;
  const bookedCount = booking?.bookedCount ?? null;
  const showBeautyBookedCount =
    item.contentType === "beauty_post" &&
    bookedCount !== null &&
    bookedCount > 0;
  const bookedCountText = showBeautyBookedCount
    ? bookingCountLabel(bookedCount)
    : null;
  const showContextBadge =
    !(
      item.sourceType === "personal" &&
      item.personal?.postType === "before_after"
    );
  const postHref = href && !isSalonRecommendation ? href : null;
  const actionHref = postHref ?? href;
  const authorHref =
    item.sourceType === "personal" && item.personal?.profileId
      ? `/explore/beauty/${encodeURIComponent(item.personal.profileId)}`
      : actionHref ?? item.salon?.href ?? "/explore";
  const commentTarget = exploreCommentTarget(item);
  const commentCount =
    commentCountState.feedKey === item.feedKey
      ? commentCountState.count
      : item.commentCount;
  const bookingActionLabel = featured ? "Book this look" : "Book";
  const bookingPromptDetails = [
    service,
    priceLabel(item),
    durationLabel(item),
    availabilityLabel(item),
  ].filter(Boolean);

  function updateCommentCount(count: number) {
    setCommentCountState({ count, feedKey: item.feedKey });
    onCommentCountChange(item.feedKey, count);
  }

  function openGuestBookPrompt(event: MouseEvent<HTMLAnchorElement>) {
    if (viewer.isAuthenticated) {
      return;
    }

    event.preventDefault();
    setBookPromptOpen(true);
  }

  return (
    <article
      className={[
        "flex flex-col overflow-visible bg-white ring-1",
        featured
          ? "rounded-[1.05rem] shadow-[0_14px_34px_rgba(35,25,22,0.07)] ring-brand-orange/20 sm:rounded-[0.95rem] sm:shadow-[0_8px_22px_rgba(35,25,22,0.035)] sm:ring-divider-subtle/65"
          : "rounded-[0.95rem] shadow-[0_8px_22px_rgba(35,25,22,0.035)] ring-divider-subtle/65",
      ].join(" ")}
      data-feed-key={item.feedKey}
      data-feed-hero={featured ? "true" : undefined}
      data-source-type={item.sourceType}
      data-testid="explore-feed-card"
    >
      {featured ? <FeedHeroIntro item={item} service={service} /> : null}
      <div
        className={[
          "min-w-0 items-center justify-between gap-2.5 px-3 py-2.5",
          featured ? "hidden sm:flex" : "order-2 flex sm:order-1",
        ].join(" ")}
      >
        <Link
          aria-label={`Open ${displayName(item.author.name, "Reylumi")}`}
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={authorHref}
        >
          <FeedAvatar item={item} />
        </Link>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <FeedHeaderTitle authorHref={authorHref} item={item} />
          <FeedSalonIdentityLine item={item} />
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-text-muted">
          {timeAgo(item.publishedAt)}
        </span>
      </div>

      <div className={featured ? "hidden sm:block" : "order-1 sm:order-2"}>
        <FeedMediaFrame featured={featured} href={href} item={item} />
      </div>

      <div className="order-3 grid gap-2 px-3 py-2.5">
        {item.caption ? (
          actionHref ? (
            <Link
              className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={actionHref}
            >
              <p className="line-clamp-2 text-sm leading-5 text-text-primary transition hover:text-brand-orange">
                {item.caption}
              </p>
            </Link>
          ) : (
            <p className="line-clamp-2 text-sm leading-5 text-text-primary">
              {item.caption}
            </p>
          )
        ) : null}
        <FeedStatusLine
          href={actionHref}
          item={item}
          service={service}
          showContextBadge={showContextBadge}
        />
        <FeedDecisionMeta item={item} service={service} />
        <div className="grid gap-2 pt-0.5">
          <div className="flex items-center gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {bookingHref ? (
                <ActionTooltip
                  label={
                    bookedCountText
                      ? `${bookedCountText}. Book this post`
                      : booking?.label ?? "Book"
                  }
                >
                  <Link
                    aria-label={[
                      bookedCountText
                        ? "Book this post"
                        : booking?.label ?? bookingActionLabel,
                      bookedCountText,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    className={[
                      "inline-flex max-w-full items-center justify-center gap-1.5 bg-brand-orange text-xs font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                      featured
                        ? "min-h-11 rounded-[0.72rem] px-4 text-sm sm:h-8 sm:min-h-0 sm:rounded-full sm:px-2.5 sm:text-xs"
                        : "h-8 rounded-full px-2.5",
                    ].join(" ")}
                    href={bookingHref}
                    onClick={openGuestBookPrompt}
                  >
                    <BookActionIcon />
                    <span className="truncate">
                      {bookingActionLabel}
                    </span>
                    {bookedCountText ? (
                      <span className="hidden rounded-full bg-white/18 px-1.5 py-0.5 text-[10px] font-bold text-white sm:inline-flex">
                        {bookedCountText}
                      </span>
                    ) : null}
                  </Link>
                </ActionTooltip>
              ) : null}
              {actionHref ? <FeedShareButton href={actionHref} item={item} /> : null}
              {commentTarget ? (
                <ActionTooltip label="Comment">
                  <button
                    aria-controls={`comments-${item.feedKey}`}
                    aria-expanded={commentsOpen}
                    aria-label={`Comment on ${itemContextLabel(item)}`}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-white px-2.5 text-xs font-semibold text-text-secondary ring-1 ring-divider-subtle transition hover:bg-surface-muted hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    onClick={() => setCommentsOpen((current) => !current)}
                    type="button"
                  >
                    <CommentActionIcon />
                    <span>{commentCount}</span>
                  </button>
                </ActionTooltip>
              ) : null}
            </div>
            {item.saveTarget ? (
              <SavePostButton
                className={[
                  "ml-auto shrink-0",
                  featured ? "hidden sm:inline-grid" : "",
                ].join(" ")}
                initialSaved={item.saveTarget.saved}
                saveCount={item.saveTarget.saveCount}
                size="compact"
                target={item.saveTarget}
              />
            ) : null}
          </div>
          {commentsOpen && commentTarget ? (
            <div
              className="rounded-xl bg-surface-muted/70 p-3 ring-1 ring-divider-subtle/70"
              id={`comments-${item.feedKey}`}
            >
              <PostCommentThread
                compact
                initialCount={commentCount}
                onCountChange={updateCommentCount}
                target={commentTarget}
                viewer={viewer}
              />
            </div>
          ) : null}
        </div>
      </div>
      {bookPromptOpen && bookingHref ? (
        <AuthIntentPrompt
          guestHref={bookingHref}
          guestLabel="Continue as guest"
          kicker="Book this look"
          onClose={() => setBookPromptOpen(false)}
          showProviderOptions
          title={item.salon?.name ?? item.author.name}
        >
          <div className="grid gap-3">
            <div className="rounded-[0.9rem] bg-surface-muted p-3 ring-1 ring-divider-subtle/70">
              <p className="text-sm font-semibold text-text-primary">
                {service ?? itemContextLabel(item)}
              </p>
              {bookingPromptDetails.length > 0 ? (
                <p className="mt-1 text-xs font-semibold text-text-secondary">
                  {bookingPromptDetails.join(" · ")}
                </p>
              ) : null}
            </div>
            <p>
              Create an account to save this look and book faster next time, or
              continue as a guest to browse service times.
            </p>
          </div>
        </AuthIntentPrompt>
      ) : null}
    </article>
  );
}

function ExploreFeedSkeleton() {
  return (
    <article className="overflow-hidden rounded-[0.95rem] bg-white shadow-[0_8px_22px_rgba(35,25,22,0.035)] ring-1 ring-divider-subtle/65">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="h-10 w-10 rounded-full bg-surface-muted" />
        <div className="grid flex-1 gap-2">
          <div className="h-3 w-32 rounded-full bg-surface-muted" />
          <div className="h-3 w-48 max-w-full rounded-full bg-surface-muted" />
        </div>
      </div>
      <div className="aspect-[4/3] bg-surface-muted" />
      <div className="grid gap-2 px-3 py-2.5">
        <div className="h-3 w-11/12 rounded-full bg-surface-muted" />
        <div className="h-3 w-7/12 rounded-full bg-surface-muted" />
      </div>
    </article>
  );
}

export function ExploreFeed({
  activeDiscoveryResult = null,
  discoveryShortcuts = [],
  initialPage,
  onDiscoveryShortcutSelect,
  viewer,
}: {
  activeDiscoveryResult?: ExploreDiscoveryResultKind | null;
  discoveryShortcuts?: ExploreDiscoveryShortcut[];
  initialPage: ExploreFeedPage;
  onDiscoveryShortcutSelect?: (shortcut: ExploreDiscoveryShortcut) => void;
  viewer: PostCommentViewer;
}) {
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState<ExploreFeedCursor | null>(
    initialPage.nextCursor,
  );
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [paginationError, setPaginationError] = useState(initialPage.error ?? "");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(false);
  const restoredRef = useRef(false);
  const requestedCursorsRef = useRef(new Set<string>());
  const firstKey = initialPage.items[0]
    ? feedItemKey(initialPage.items[0])
    : null;
  const isEmpty = items.length === 0 && !paginationError;
  const initialFailure = items.length === 0 && Boolean(paginationError);
  const memoizedItems = useMemo(() => items, [items]);
  const feedDiscoveryShortcuts = useMemo(
    () => orderedFeedDiscoveryShortcuts(discoveryShortcuts),
    [discoveryShortcuts],
  );

  const updateCommentCount = useCallback((feedKey: string, commentCount: number) => {
    setItems((current) => {
      const hasChange = current.some(
        (item) => feedItemKey(item) === feedKey && item.commentCount !== commentCount,
      );

      return hasChange
        ? current.map((item) =>
            feedItemKey(item) === feedKey ? { ...item, commentCount } : item,
          )
        : current;
    });
  }, []);

  const loadNextPage = useCallback(
    async (options: { retry?: boolean } = {}) => {
      if (
        !cursor ||
        !hasMore ||
        loadingMoreRef.current ||
        (paginationError && !options.retry)
      ) {
        return;
      }

      if (requestedCursorsRef.current.has(cursor) && !options.retry) {
        return;
      }

      requestedCursorsRef.current.add(cursor);
      loadingMoreRef.current = true;
      setLoadingMore(true);
      setPaginationError("");

      try {
        const page = await loadExploreFeedAction(cursor);

        if (!mountedRef.current) {
          return;
        }

        if (page.error) {
          requestedCursorsRef.current.delete(cursor);
          setPaginationError(page.error);
          return;
        }

        setItems((current) => appendUniqueFeedItems(current, page.items));
        setCursor(page.nextCursor === cursor ? null : page.nextCursor);
        setHasMore(page.hasMore && page.nextCursor !== cursor);
      } catch {
        if (mountedRef.current) {
          requestedCursorsRef.current.delete(cursor);
          setPaginationError("Explore posts could not be loaded.");
        }
      } finally {
        if (mountedRef.current) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [cursor, hasMore, paginationError],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (restoredRef.current) {
      return;
    }

    restoredRef.current = true;

    if (!shouldRestoreStoredFeedState()) {
      window.sessionStorage.removeItem(EXPLORE_FEED_SESSION_KEY);
      return;
    }

    const route = `${window.location.pathname}${window.location.search}`;
    const stored = readStoredFeedState(route, firstKey);

    if (!stored || stored.items.length === 0) {
      return;
    }

    const restoreFrame = window.requestAnimationFrame(() => {
      if (!mountedRef.current) {
        return;
      }

      setItems((current) => mergeStoredFeedItems(stored.items, current));
      setCursor(stored.cursor);
      setHasMore(stored.hasMore);
      setPaginationError("");
      window.scrollTo(0, stored.scrollY);
    });

    return () => window.cancelAnimationFrame(restoreFrame);
  }, [firstKey]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      writeStoredFeedState({ cursor, hasMore, items });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [cursor, hasMore, items]);

  useEffect(() => {
    const node = sentinelRef.current;

    if (!node || !hasMore || loadingMore || paginationError) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadNextPage();
        }
      },
      {
        rootMargin: "900px 0px",
        threshold: 0,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadNextPage, loadingMore, paginationError]);

  return (
    <section
      aria-busy={loadingMore}
      aria-label="Explore discovery feed"
      className="mx-auto grid w-full max-w-[40rem] gap-2.5"
      id="explore-feed"
      data-testid="explore-continuous-feed"
    >
      {initialFailure ? (
        <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
          {paginationError}
        </div>
      ) : null}

      {isEmpty ? (
        <div className="rounded-[1.25rem] border border-dashed border-divider-subtle bg-surface-elevated p-6 text-center text-sm leading-6 text-text-secondary">
          Public beauty posts and salon visuals will appear here as Reylumi discovery grows.
        </div>
      ) : null}

      <div className="grid gap-3">
        {memoizedItems.map((item, index) => {
          const shortcutIndex =
            index > 0 && (index + 1) % 3 === 0
              ? Math.floor((index + 1) / 3) - 1
              : -1;
          const shortcut =
            shortcutIndex >= 0 && feedDiscoveryShortcuts.length > 0
              ? feedDiscoveryShortcuts[
                  shortcutIndex % feedDiscoveryShortcuts.length
                ]
              : null;

          return (
            <Fragment key={feedItemKey(item)}>
              <ExploreFeedCard
                featured={index === 0}
                item={item}
                onCommentCountChange={updateCommentCount}
                viewer={viewer}
              />
              {shortcut ? (
                <FeedDiscoveryModule
                  activeResultKind={activeDiscoveryResult}
                  onSelect={onDiscoveryShortcutSelect}
                  shortcut={shortcut}
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>

      {paginationError && items.length > 0 ? (
        <div className="grid gap-3 rounded-[1rem] bg-white p-4 text-sm text-text-secondary shadow-[0_10px_28px_rgba(35,25,22,0.035)] ring-1 ring-divider-subtle/65">
          <p>{paginationError}</p>
          <button
            className="w-fit rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => void loadNextPage({ retry: true })}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loadingMore ? (
        <div className="grid gap-3" aria-label="Loading more Explore posts">
          <ExploreFeedSkeleton />
        </div>
      ) : null}

      <div aria-hidden className="h-4" ref={sentinelRef} />

      {!hasMore && items.length > 0 ? (
        <p className="pb-2 text-center text-sm font-medium text-text-muted">
          You&apos;re caught up for now.
        </p>
      ) : null}
    </section>
  );
}
