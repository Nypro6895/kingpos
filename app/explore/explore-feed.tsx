"use client";
import { COLLAPSED_COMMENTS, editorialCommentOptions, feedCommentCandidate, selectExploreCommentPresentation, type ExploreCommentPresentation } from "@/lib/explore-comment-presentation";
import { useExploreCommentPresentation } from "./use-explore-comment-presentation";
import { ExploreCommentPreview } from "./explore-comment-preview";
import { NailIllustrationCredit } from "@/components/nail-illustration-credit";
import { exploreShortcutPreviews, type ExploreVisualPreview } from "@/lib/explore-visual-presentation";
import { explorePostIdentity } from "@/lib/explore-post-presentation";
import { ExploreSalonFollow, ExploreSalonMenu, ExploreSocialActions, useSalonSocial } from "@/components/explore-social";
import { exploreAlternatingShortcuts, exploreShortcutIndex } from "@/lib/explore-entry-presentation";
import { FeedLoadingSkeleton } from "@/components/loading-feedback";
import { currentExplorePrefetchPolicy, recordExploreLoadDuration } from "@/lib/explore-viewport-priority";
import { ExploreAutoLoad } from "@/app/explore/explore-auto-load";
import { isExploreAheadCancellation, watchExploreAheadAvailability } from "@/lib/explore-ahead-buffer";
import { readPriorityScheduler } from "@/lib/read-priority-scheduler";
import { useExperienceScope } from "@/components/experience-scope";
import { PostIdentity } from "@/components/post-identity";

import { exploreFeedErrorMessage, fetchExploreFeedPage, requestExploreFeed } from "@/lib/explore-feed-client";
import { exploreFeedRevisions, retainValidatedExploreItems, type ExploreFeedValidation } from "@/lib/explore-feed-revisions";
import { discoveryItemIdentity, matchesExploreFeedItem, type ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import { savedPostKey } from "@/types/saved-post";
import { PostActions } from "@/app/salon-profile/post-actions";
import { useHiddenPosts, postIdentity } from "@/components/post-safety";
import { usePostCaption } from "@/components/post-change-state";
import { PostCommentThread } from "@/app/post-comments/post-comment-thread";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import { InspirationAvailability } from "@/components/inspiration-availability";
import { ExploreBookButton, ExploreSalonLove } from "@/components/explore-account-actions";
import { ExploreAdSlot } from "@/components/explore-advertising";
import { SalonTrustLine, SalonVerifiedBadge } from "@/components/salon-trust-line";
import {
  ReylumiIcon,
  type ReylumiIconName,
} from "@/components/reylumi-icons";
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
} from "@/lib/reylumi-trust";
import { ExploreViewportImage as Image } from "./explore-viewport-image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

const EXPLORE_FEED_SESSION_KEY = "kingpos-explore-continuous-feed";
const EXPLORE_FEED_SESSION_VERSION = 15;
const EXPLORE_FEED_SESSION_TTL_MS = 30 * 60 * 1000;
const EXPLORE_FEED_SESSION_ITEM_LIMIT = 120;
const EXPLORE_FEED_SESSION_ROUTE_LIMIT = 6;
const EXPLORE_FEED_SESSION_BYTE_LIMIT = 1500000;

type StoredExploreFeedState = {
  sessionCursor?: string | null;
  cursor: ExploreFeedCursor | null;
  hasMore: boolean;
  items: ExploreFeedItem[];
  route: string;
  viewerId: string | null;
  savedAt: number;
  scrollY: number;
  scrollAnchor?: { contentKey: string; offset: number } | null;
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
  viewerId: string | null,
): StoredExploreFeedState | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(`${EXPLORE_FEED_SESSION_KEY}:${route}`) ?? "null",
    ) as Partial<StoredExploreFeedState> | null;

    if (
      !parsed ||
      parsed.version !== EXPLORE_FEED_SESSION_VERSION ||
      parsed.route !== route ||
      parsed.viewerId !== viewerId ||
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) || parsed.savedAt > Date.now() ||
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
      sessionCursor: typeof parsed.sessionCursor === "string" ? parsed.sessionCursor : null,
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      hasMore: parsed.hasMore === true,
      items,
      route,
      viewerId,
      savedAt: parsed.savedAt,
      scrollY:
        typeof parsed.scrollY === "number" && Number.isFinite(parsed.scrollY)
          ? Math.max(0, parsed.scrollY)
          : 0,
      scrollAnchor: parsed.scrollAnchor && typeof parsed.scrollAnchor.contentKey === "string" && typeof parsed.scrollAnchor.offset === "number" && Number.isFinite(parsed.scrollAnchor.offset) ? parsed.scrollAnchor : null,
      version: EXPLORE_FEED_SESSION_VERSION,
    };
  } catch {
    return null;
  }
}

function writeStoredFeedState(input: {
  sessionCursor?: string | null;
  cursor: ExploreFeedCursor | null;
  hasMore: boolean;
  items: ExploreFeedItem[];
  viewerId: string | null;
  route: string;
  scrollAnchor?: StoredExploreFeedState["scrollAnchor"];
}) {
  try {
    // Keep the last complete page boundary, never pair a truncated list with
    // a cursor pointing beyond items that have not been stored.
    if (input.items.length > EXPLORE_FEED_SESSION_ITEM_LIMIT) return;
    const state: StoredExploreFeedState = {
      sessionCursor: input.sessionCursor ?? null,
      cursor: input.cursor,
      hasMore: input.hasMore,
      items: input.items.slice(0, EXPLORE_FEED_SESSION_ITEM_LIMIT),
      route: input.route,
      viewerId: input.viewerId,
      savedAt: Date.now(),
      scrollY: window.scrollY,
      scrollAnchor: input.scrollAnchor ?? null,
      version: EXPLORE_FEED_SESSION_VERSION,
    };

    const serialized = JSON.stringify(state);
    if (serialized.length * 2 > EXPLORE_FEED_SESSION_BYTE_LIMIT) return;
    // Bound only our own entries; never evict drafts or unrelated app data.
    const storage = window.sessionStorage;
    const entries: { key: string; savedAt: number; bytes: number }[] = [];
    if (typeof storage.length === "number") for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (!key?.startsWith(`${EXPLORE_FEED_SESSION_KEY}:`) || key === `${EXPLORE_FEED_SESSION_KEY}:${input.route}`) continue;
      const raw = storage.getItem(key);
      try {
        const value = JSON.parse(raw ?? "null") as StoredExploreFeedState | null;
        if (!value || value.version !== EXPLORE_FEED_SESSION_VERSION || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > EXPLORE_FEED_SESSION_TTL_MS || value.savedAt > Date.now()) { storage.removeItem(key); continue; }
        entries.push({ key, savedAt: value.savedAt, bytes: (raw?.length ?? 0) * 2 });
      } catch { storage.removeItem(key); }
    }
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let bytes = entries.reduce((total, entry) => total + entry.bytes, serialized.length * 2);
    while (entries.length >= EXPLORE_FEED_SESSION_ROUTE_LIMIT || bytes > EXPLORE_FEED_SESSION_BYTE_LIMIT) {
      const entry = entries.shift();
      if (!entry) break;
      storage.removeItem(entry.key); bytes -= entry.bytes;
    }
    window.sessionStorage.setItem(
      `${EXPLORE_FEED_SESSION_KEY}:${input.route}`,
      serialized,
    );
  } catch {
    clearStoredFeedState();
  }
}

function clearStoredFeedState(route?: string) {
  try {
    if (route) window.sessionStorage.removeItem(`${EXPLORE_FEED_SESSION_KEY}:${route}`);
    else {
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith(`${EXPLORE_FEED_SESSION_KEY}:`)) window.sessionStorage.removeItem(key);
      }
      window.sessionStorage.removeItem(EXPLORE_FEED_SESSION_KEY);
    }
  } catch { /* Optional cache. */ }
}

function shouldRestoreStoredFeedState() {
  const navigation = window.performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;

  return navigation?.type !== "reload";
}

function applySavedPostChange(items: ExploreFeedItem[], detail: { key?: unknown; saved?: unknown; saveCount?: unknown } | null | undefined) {
  if (!detail || typeof detail.key !== "string" || typeof detail.saved !== "boolean") return items;
  const saved = detail.saved;
  const count = typeof detail.saveCount === "number" && Number.isFinite(detail.saveCount)
    ? Math.max(0, Math.trunc(detail.saveCount)) : undefined;
  let changed = false;
  const next = items.map((item) => {
    const target = item.saveTarget;
    if (!target || savedPostKey(target) !== detail.key ||
        (target.saved === saved && (count === undefined || target.saveCount === count))) return item;
    changed = true;
    return { ...item, saveTarget: { ...target, saved, ...(count === undefined ? {} : { saveCount: count }) } };
  });
  return changed ? next : items;
}

function appendUniqueFeedItems(
  current: ExploreFeedItem[],
  incoming: ExploreFeedItem[],
) {
  const seen = new Set(current.map(feedItemKey));
  const destinations = new Set(current.map(discoveryItemIdentity));
  const nextItems = incoming.filter((item) => {
    const key = feedItemKey(item);

    const identity = discoveryItemIdentity(item);
    if (seen.has(key) || destinations.has(identity)) {
      return false;
    }

    seen.add(key);
    destinations.add(identity);
    return true;
  });

  if (!nextItems.length) return current;
  const ordered = [...current];
  const remaining = [...nextItems];
  while (remaining.length) {
    const previousAuthor = ordered[ordered.length - 1]?.author.id;
    const differentAuthor = remaining.findIndex(item => item.author.id !== previousAuthor);
    ordered.push(...remaining.splice(differentAuthor < 0 ? 0 : differentAuthor, 1));
  }
  return ordered;
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

function FeedHeaderTitle({authorHref,item}:{authorHref:string;item:ExploreFeedItem}) {
 return <span className="flex min-w-0 items-start gap-1 text-sm text-text-primary"><PostIdentity source={item.sourceType} salonName={item.salon?.name} salonHref={item.salon?.href} authorName={item.sourceType==='salon'?item.salonAuthorName:item.author.name} authorHref={item.sourceType==='salon'?null:authorHref} authorRole={item.salonAuthorRole}/><SalonVerifiedBadge verified={item.salon?.trust.identityVerified}/></span>;
}
function FeedSalonIdentityLine({item}:{item:ExploreFeedItem}) {
 if(!item.salon)return <span className="block truncate text-xs text-text-secondary">{itemContextLabel(item)}</span>;
 return <SalonTrustLine signals={item.salon.trust} href={item.salon.href} name={item.salon.name} distance={distanceLabel(item)} className="text-text-secondary"/>;
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
        window.dispatchEvent(new CustomEvent("reylumi:explore-share", { detail: item.contentKey }));
        return;
      }

      await copyUrl(url);
      window.dispatchEvent(new CustomEvent("reylumi:explore-share", { detail: item.contentKey }));
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
      <NailIllustrationCredit imageUrl={media.imageUrl} className="absolute bottom-2 right-2"/>
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
        <Link prefetch={false}
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
  if (!item.saveTarget || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.saveTarget.sourceId)) {
    return null;
  }

  return {
    salonName: item.salon?.name ?? null,
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
  viewer,
}: {
  item: ExploreFeedItem;
  service: string | null;
  viewer: PostCommentViewer;
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
    null,
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
          loading="eager"
          onError={() => setImageFailed(true)}
          sizes="(max-width: 639px) calc(100vw - 1.5rem), 0px"
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
      {item.saveTarget && exploreCommentTarget(item) ? (
        <SavePostButton
          className="absolute right-3 top-3"
          initialSaved={item.saveTarget.saved}
          isAuthenticated={viewer.isAuthenticated}
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
        <Link prefetch={false}
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
  const metrics = [

    { label: "Service", value: service },
    { label: "Price", value: priceLabel(item) },
    { label: "Duration", value: durationLabel(item) },
    { label: "Status", value: item.salon?.operatingStatus.label ?? null },
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
    return "Booking options";
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
    return "Fresh looks";
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
  preview,
  fallbackImage,
}: {
  preview: ExploreVisualPreview;
  fallbackImage: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const visibleImage = imageFailed ? fallbackImage : preview.imageUrl;

  return (
    <span
      className="relative block aspect-[4/3] overflow-hidden rounded-[0.7rem] bg-surface-muted"
    >
        <Image
          alt={preview.label}
          className="object-cover"
          fill
          loading="lazy"
          onError={() => setImageFailed(true)}
          sizes="(min-width:640px) 200px, 30vw"
          src={visibleImage}
        />
      {preview.illustration || imageFailed ? <span className="absolute bottom-1 left-1 rounded bg-white/95 px-1.5 py-0.5 text-[10px] text-text-secondary">AI illustration</span> : null}
    </span>
  );
}

function FeedDiscoveryModule({
  activeResultKind,
  onSelect,
  shortcut,
  items,
  category,
  location,
}: {
  activeResultKind: ExploreDiscoveryResultKind | null;
  onSelect?: (shortcut: ExploreDiscoveryShortcut) => void;
  shortcut: ExploreDiscoveryShortcut;
  items: ExploreFeedItem[];
  category: string;
  location: string;
}) {
  const active =
    shortcut.action.type === "result" &&
    shortcut.action.resultKind === activeResultKind;
  const previews = exploreShortcutPreviews(shortcut, items, category, location);
  const referencePreviews = exploreShortcutPreviews({ ...shortcut, previews: [] }, [], category, location);
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
              {shortcut.moduleKind === "visual" && previews.every(preview => preview.illustration) ? "Style inspiration" : shortcut.context}
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
      <span className="grid gap-2" data-discovery-preview-row style={{ gridTemplateColumns: `repeat(${Math.max(1, previews.length)}, minmax(0, 1fr))` }}>
          {previews.map((preview, index) => (
            <FeedDiscoveryPreview
              preview={preview}
              fallbackImage={referencePreviews[index % referencePreviews.length]?.imageUrl ?? "/images/nail-defaults/nails-01.webp"}
              key={preview.imageUrl}
            />
          ))}
      </span>
    </span>
  );
  const className = [
    "rounded-[0.95rem] bg-white p-3 text-left shadow-[0_10px_26px_rgba(35,25,22,0.045)] ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
    active
      ? "ring-brand-orange/35"
      : "ring-divider-subtle/70 hover:ring-brand-orange/25",
  ].join(" ");

  if (shortcut.action.type === "href") {
    return (
      <Link prefetch={false}
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
      data-discovery-shortcut={shortcut.id}
      className={className}
      onClick={() => onSelect(shortcut)}
      type="button"
    >
      {moduleBody}
    </button>
  );
}

function orderedFeedDiscoveryShortcuts(shortcuts: ExploreDiscoveryShortcut[]) {
  return exploreAlternatingShortcuts(shortcuts);
}

export function ExploreFeedCard({featured=false,item,onCommentCountChange,viewer,showMedia=true,showCaption=true,inlineComments=true,onOpenComments,commentPresentation=COLLAPSED_COMMENTS,openCommentsInitially=false}:{featured?:boolean;item:ExploreFeedItem;onCommentCountChange:(key:string,count:number)=>void;viewer:PostCommentViewer;showMedia?:boolean;showCaption?:boolean;inlineComments?:boolean;onOpenComments?:()=>void;commentPresentation?:ExploreCommentPresentation;openCommentsInitially?:boolean}) {
 const hiddenPosts=useHiddenPosts(viewer.userId),social=useSalonSocial(item.salon?.id);
 const [commentsOpen,setCommentsOpen]=useState(openCommentsInitially),[focusKey,setFocusKey]=useState(0);
 const openComments=()=>{if(onOpenComments){onOpenComments();return;}setCommentsOpen(true);setFocusKey(key=>key+1);};
 const recommendation=item.contentType==="salon_recommendation";
 const commentTarget=exploreCommentTarget(item);
 const caption=usePostCaption(commentTarget,item.caption,viewer.userId)??null;
 const href=item.destination.href??item.salon?.href??"/explore";
 const bookingHref=item.booking?.eligible?item.booking.href:null;
 const salon=item.salon?{...item.salon,bookingHref}:null;
 const personName=item.sourceType==="personal"?item.author.name:item.salonAuthorRole==="staff"?item.salonAuthorName:null;
 const authorName=explorePostIdentity({source:item.sourceType,salonName:item.salon?.name,authorName:personName??item.author.name,authorRole:item.salonAuthorRole}).primary;
 const authorHref=item.sourceType==="personal"&&item.personal?.profileId?`/explore/beauty/${item.personal.profileId}`:item.salon?.href??href;
 const tagged=!recommendation&&item.salon&&authorName!==item.salon.name;
 if(social.state.hidden||(commentTarget&&hiddenPosts.includes(postIdentity(commentTarget))))return null;
 const header=<div className="flex min-w-0 items-center gap-2 px-3 py-2" data-feed-identity>
  <Link prefetch={false} href={authorHref} aria-label={`Open ${authorName}`} className="shrink-0">{!recommendation&&item.sourceType==='salon'&&personName?<span className="grid size-9 place-items-center rounded-full bg-orange-50 text-xs font-semibold text-brand-orange">{personName.split(/\s+/).slice(0,2).map(word=>word[0]).join('')}</span>:<FeedAvatar item={item}/>}</Link>
  <div className="min-w-0 flex-1">
   <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm">
    <Link prefetch={false} href={authorHref} className="min-w-0 truncate font-semibold" title={authorName}>{authorName}</Link>
    {tagged?<><span className="text-text-muted">Â·</span><Link prefetch={false} href={item.salon!.href??href} className="min-w-0 truncate font-medium" title={item.salon!.name}>{item.salon!.name}</Link></>:null}
    {salon?<ExploreSalonFollow salon={salon}/>:null}
   </div>
   <p className="text-xs text-text-muted">{item.platformIntroduction ? "Introduction by Reylumi" : recommendation?[item.serviceCategory,item.salon?.city,item.salon?.state].filter(Boolean).join(' Â· '):timeAgo(item.publishedAt)}</p>
  </div>
  {salon?<ExploreSalonMenu salon={salon} target={commentTarget??undefined}/>:commentTarget?<PostActions plain target={commentTarget} viewerId={viewer.userId}/>:null}
 </div>;
 return <article className={`${showMedia ? "-mx-4 sm:mx-0" : ""} flex min-w-0 flex-col border-b border-divider-subtle bg-white pb-2`} data-feed-key={item.feedKey} data-feed-hero={featured?'true':undefined} data-source-type={item.sourceType} data-testid="explore-feed-card">
  {showMedia?<FeedMediaFrame featured={false} href={href} item={{...item,caption}}/>:null}
  {header}
  {showCaption&&caption?<p className="line-clamp-3 px-3 pb-2 text-sm leading-5 text-text-secondary">{caption}</p>:null}
  <div className="px-3">
   <ExploreSocialActions salon={salon} href={href} target={item.saveTarget} commentCount={item.commentCount} onComment={commentTarget?openComments:undefined}/>
   {!commentsOpen&&commentPresentation.preview&&commentTarget?<ExploreCommentPreview key={`${viewer.userId}:${commentTarget.sourceType}:${commentTarget.sourceId}`} target={commentTarget} onOpen={openComments}/>:null}
   {inlineComments&&(commentPresentation.composer||commentsOpen)&&!recommendation&&commentTarget?<div onFocusCapture={()=>setCommentsOpen(true)}><PostCommentThread compact inlineComposer expanded={commentsOpen} focusKey={focusKey} initialCount={item.commentCount} onCountChange={count=>onCommentCountChange(item.feedKey,count)} target={commentTarget} viewer={viewer}/></div>:null}
  </div>
 </article>;
}

export function ExploreFeedSkeleton() {
  return <FeedLoadingSkeleton />;
}

type ExploreFeedProps = {
  commentLeadPosts?: ExploreFeedItem[];
  supplementaryPosts?: ReactNode[];
  supplementaryFooter?: ReactNode;
  activeDiscoveryResult?: ExploreDiscoveryResultKind | null;
  discoveryShortcuts?: ExploreDiscoveryShortcut[];
  initialPage: ExploreFeedPage;
  discovery?: ExploreFeedDiscoveryOptions;
  filterItem?: (item: ExploreFeedItem) => boolean;
  sessionKey?: string;
  prepareAheadKey?: string;
  allowRestore?: boolean;
  emptyContent?: ReactNode;
  emptyMessage?: string;
  endContent?: (items: ExploreFeedItem[]) => ReactNode;
  errorContent?: ReactNode;
  maxEmptyPages?: number;
  heading?: string;
  description?: string;
  feedId?: string;
  onDiscoveryShortcutSelect?: (shortcut: ExploreDiscoveryShortcut) => void;
  viewer: PostCommentViewer;
};

export function ExploreFeed(props: ExploreFeedProps) {
  const scope = useExperienceScope()?.context.scope;
  const identity = JSON.stringify([scope, props.sessionKey, props.discovery]);
  const [snapshot, setSnapshot] = useState({
    page: props.initialPage,
    viewerId: props.viewer.userId,
    identity,
    revision: 0,
  });
  // A new server payload starts a new pagination session. React discards this
  // render and retries before committing children, so old pages cannot mix in.
  if (snapshot.page !== props.initialPage || snapshot.viewerId !== props.viewer.userId || snapshot.identity !== identity) {
    setSnapshot({ page: props.initialPage, viewerId: props.viewer.userId, identity, revision: snapshot.revision + 1 });
  }
  return <ExploreFeedContent key={snapshot.revision} {...props} restoreSession={props.allowRestore !== false && snapshot.revision === 0} />;
}

function ExploreFeedContent({
  commentLeadPosts = [],
  supplementaryPosts = [],
  supplementaryFooter,
  activeDiscoveryResult = null,
  discoveryShortcuts = [],
  initialPage,
  onDiscoveryShortcutSelect,
  viewer,
  restoreSession,
  discovery,
  filterItem,
  sessionKey = "",
  prepareAheadKey,
  emptyContent,
  emptyMessage,
  endContent,
  errorContent,
  maxEmptyPages,
  heading,
  description,
  feedId = "explore-feed",
}: ExploreFeedProps & { restoreSession: boolean }) {
  const readScope = useExperienceScope()?.context.scope ?? `explore:${viewer.userId ?? "guest"}`;
  const aheadKey = JSON.stringify([readScope, viewer.userId, prepareAheadKey ?? sessionKey, prepareAheadKey ? null : discovery]);
  const [items, setItems] = useState(initialPage.items);
  const [sessionCursor, setSessionCursor] = useState(initialPage.sessionCursor ?? null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const restoreRequest = useRef<AbortController | null>(null);
  const restoringRef = useRef(restoreSession);
  const [isRestoring, setIsRestoring] = useState(restoreSession);
  const generationRef = useRef(0);
  const telemetryRef = useRef({ session: sessionCursor, recorded: new Set<string>(), queue: new Map<string, Record<string, unknown>>(), retries: new Map<string, number>(), flushing: false });
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
  const pendingScrollRef = useRef<number | null>(null);
  const pendingAnchorRef = useRef<StoredExploreFeedState["scrollAnchor"]>(null);
  const requestedCursorsRef = useRef(new Set<string>());
  const emptyPagesRef = useRef(0);
  const firstKey = initialPage.items[0]
    ? feedItemKey(initialPage.items[0])
    : null;
  const initialFailure = items.length === 0 && Boolean(paginationError);
  // A keyword search exhausts real matching posts before suggesting reference images.
  const matchingPostsFirst = Boolean(discovery?.query?.trim());
  const showSearchInspiration = matchingPostsFirst && !hasMore && !loadingMore && !isRestoring && !paginationError;
  const memoizedItems = useMemo(() => items.filter(item => matchesExploreFeedItem(item, discovery) && (!filterItem || filterItem(item))), [items, discovery, filterItem]);
  const isEmpty = memoizedItems.length === 0 && !paginationError && !hasMore && !loadingMore && !isRestoring;
  const commentLeadCandidates = commentLeadPosts.map((item,index)=>feedCommentCandidate(item,editorialCommentOptions(index)));
  const commentPlan = useExploreCommentPresentation([...commentLeadCandidates,...memoizedItems.map(item=>feedCommentCandidate(item))],selectExploreCommentPresentation(commentLeadCandidates));
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

  useEffect(() => {
    function onSaveChange(event: Event) {
      if (event instanceof CustomEvent) {
        setItems((current) => applySavedPostChange(current, event.detail));
      }
    }
    window.addEventListener("reylumi:saved-post-state-change", onSaveChange);
    return () => window.removeEventListener("reylumi:saved-post-state-change", onSaveChange);
  }, []);

  const loadNextPage = useCallback(
    async (options: { retry?: boolean; background?: boolean } = {}) => {
      if (
        !cursor ||
        !hasMore ||
        loadingMoreRef.current ||
        restoringRef.current ||
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
      const controller = new AbortController();
      activeRequest.current?.abort();
      activeRequest.current = controller;
      const stopWatching = options.background ? watchExploreAheadAvailability(controller) : () => {};
      const startedAt = performance.now();
      let cancelled = false;

      try {
        const read = (signal: AbortSignal) => requestExploreFeed<ExploreFeedPage>({ mode: "page", cursor, discovery: discovery ?? {}, limit: currentExplorePrefetchPolicy().limit }, signal);
        const page = options.background ? await readPriorityScheduler.run({ key: `explore-feed:${aheadKey}:${cursor}`, scope: readScope, route: location.pathname + location.search, priority: 80, background: true, signal: controller.signal, run: read }) : await read(controller.signal);

        if (!mountedRef.current || controller.signal.aborted) {
          return;
        }

        if (page.error) {
          requestedCursorsRef.current.delete(cursor);
          setPaginationError(page.error);
          return;
        }

        setItems((current) => appendUniqueFeedItems(current, page.items));
        const existing = new Set(items.map(feedItemKey));
        const addsVisibleItems = page.items.some(item => !existing.has(feedItemKey(item)) && matchesExploreFeedItem(item, discovery) && (!filterItem || filterItem(item)));
        emptyPagesRef.current = addsVisibleItems ? 0 : emptyPagesRef.current + 1;
        const exhausted = page.nextCursor === cursor || !page.nextCursor || Boolean(maxEmptyPages && emptyPagesRef.current >= maxEmptyPages);
        setCursor(exhausted ? null : page.nextCursor);
        setHasMore(page.hasMore && !exhausted);
      } catch (cause) {
        cancelled = isExploreAheadCancellation(cause);
        if (mountedRef.current && !controller.signal.aborted && !cancelled) {
          requestedCursorsRef.current.delete(cursor);
          setPaginationError(exploreFeedErrorMessage(cause));
        }
      } finally {
        stopWatching();
        if (controller.signal.aborted || cancelled) requestedCursorsRef.current.delete(cursor);
        if (!controller.signal.aborted && !cancelled) recordExploreLoadDuration(performance.now() - startedAt);
        if (mountedRef.current && activeRequest.current === controller) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [cursor, hasMore, paginationError, discovery, filterItem, items, maxEmptyPages, aheadKey, readScope],
  );

  async function refreshFeed() {
    generationRef.current += 1;
    restoreRequest.current?.abort();
    restoringRef.current = false;
    setIsRestoring(false);
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchExploreFeedPage(null, discovery ?? {}, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      if (page.error) { setPaginationError(page.error); return; }
      requestedCursorsRef.current.clear();
      emptyPagesRef.current = 0;
      setItems(page.items);
      setCursor(page.nextCursor);
      setSessionCursor(page.sessionCursor ?? null);
      setHasMore(page.hasMore);
      setPaginationError("");
      sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (cause) {
      if (mountedRef.current && !controller.signal.aborted) setPaginationError(exploreFeedErrorMessage(cause));
    } finally {
      if (mountedRef.current && activeRequest.current === controller) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    if (!sessionCursor) return;
    const controller = new AbortController();
    let busy = false;
    let lastInteraction = Date.now();
    const interacted = () => { lastInteraction = Date.now(); };
    const canRefresh = () => {
      const section = sectionRef.current;
      if (!section || !section.getClientRects().length || document.visibilityState !== "visible" || restoringRef.current || loadingMoreRef.current || Date.now() - lastInteraction < 1500 || document.querySelector('[role="dialog"], [aria-modal="true"]')) return false;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable)) return false;
      const rect = section.getBoundingClientRect();
      return rect.top >= -24 && rect.top < window.innerHeight;
    };
    const check = async () => {
      if (busy || !canRefresh()) return;
      busy = true;
      try {
        const result = await requestExploreFeed<{ hasNewPosts?: boolean }>({ mode: "updates", cursor: sessionCursor, discovery }, controller.signal);
        if (controller.signal.aborted || !result.hasNewPosts || !canRefresh()) return;
        const generation = generationRef.current;
        const page = await fetchExploreFeedPage(null, discovery ?? {}, controller.signal);
        // A user moving away or opening a dialog during the request keeps their
        // current reading position. A later safe opportunity retries silently.
        if (controller.signal.aborted || !mountedRef.current || generation !== generationRef.current || !canRefresh() || page.error) return;
        generationRef.current += 1;
        activeRequest.current?.abort();
        requestedCursorsRef.current.clear();
        setItems(page.items); setCursor(page.nextCursor); setSessionCursor(page.sessionCursor ?? null); setHasMore(page.hasMore); setPaginationError("");
      } catch { /* A background freshness check does not interrupt the current page. */ }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => { void check(); }, 60000);
    const resumed = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("scroll", interacted, { passive: true });
    window.addEventListener("pointerdown", interacted, { passive: true });
    window.addEventListener("keydown", interacted);
    document.addEventListener("visibilitychange", resumed);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("scroll", interacted); window.removeEventListener("pointerdown", interacted); window.removeEventListener("keydown", interacted); document.removeEventListener("visibilitychange", resumed); };
  }, [sessionCursor, discovery]);

  useEffect(() => {
    if (!sessionCursor || !sectionRef.current || typeof IntersectionObserver === "undefined") return;
    const section = sectionRef.current;
    const controller = new AbortController();
    const timers = new Map<Element, number>();
    if (telemetryRef.current.session !== sessionCursor) telemetryRef.current = { session: sessionCursor, recorded: new Set(), queue: new Map(), retries: new Map(), flushing: false };
    const telemetry = telemetryRef.current;
    const { recorded, queue } = telemetry;
    const enqueue = (key: string, kind: string) => {
      if (queue.size < 80) queue.set(`${kind}:${key}`, { contentKey: key, kind, elapsedMs: 2000, visibleRatio: 0.5 });
    };
    const flush = async () => {
      if (!queue.size || telemetry.flushing) return;
      telemetry.flushing = true;
      const events = [...queue.values()].slice(0, 20);
      try {
        const result = await requestExploreFeed<{ error?: string }>({ mode: "events", cursor: sessionCursor, events }, controller.signal);
        if (result.error) throw new Error(result.error);
        for (const event of events) { const key = `${event.kind}:${event.contentKey}`; queue.delete(key); telemetry.retries.delete(key); }
      } catch {
        for (const event of events) { const key = `${event.kind}:${event.contentKey}`; const retries = (telemetry.retries.get(key) ?? 0) + 1; telemetry.retries.set(key, retries); if (retries >= 3) queue.delete(key); }
      } finally { telemetry.flushing = false; }
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.exploreContentKey;
        if (!key || recorded.has(key)) continue;
        const visibleArea = entry.intersectionRect.width * entry.intersectionRect.height;
        const viewableArea = Math.min(entry.boundingClientRect.width, window.innerWidth) * Math.min(entry.boundingClientRect.height, window.innerHeight);
        if (entry.isIntersecting && viewableArea > 0 && visibleArea / viewableArea >= 0.5 && document.visibilityState === "visible") {
          if (!timers.has(entry.target)) timers.set(entry.target, window.setTimeout(() => {
            if (document.visibilityState === "visible") { recorded.add(key); enqueue(key, "meaningful_view"); }
            timers.delete(entry.target);
          }, 2000));
        } else {
          const timer = timers.get(entry.target);
          if (timer !== undefined) window.clearTimeout(timer);
          timers.delete(entry.target);
        }
      }
    }, { threshold: Array.from({ length: 21 }, (_, index) => index / 20) });
    const nodes = section.querySelectorAll<HTMLElement>("[data-explore-content-key]");
    nodes.forEach(node => observer.observe(node));
    const profileClick = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/explore/salons/"]') : null;
      const key = link?.closest<HTMLElement>("[data-explore-content-key]")?.dataset.exploreContentKey;
      if (key && section.contains(link)) enqueue(key, "profile_view");
    };
    const share = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string" && items.some(item => item.contentKey === event.detail)) enqueue(event.detail, "share");
    };
    const onHide = () => {
      if (!queue.size) return;
      navigator.sendBeacon?.("/api/explore/feed", new Blob([JSON.stringify({ mode: "events", cursor: sessionCursor, events: [...queue.values()].slice(0, 20) })], { type: "application/json" }));
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") {
        timers.forEach(timer => window.clearTimeout(timer)); timers.clear();
      } else {
        nodes.forEach(node => { observer.unobserve(node); observer.observe(node); });
      }
    };
    const interval = window.setInterval(() => { void flush(); }, 5000);
    section.addEventListener("click", profileClick);
    window.addEventListener("reylumi:explore-share", share);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect(); timers.forEach(timer => window.clearTimeout(timer));
      window.clearInterval(interval); section.removeEventListener("click", profileClick);
      window.removeEventListener("reylumi:explore-share", share); window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", visibility);
      void flush().finally(() => controller.abort());
    };
  }, [items, sessionCursor]);

  useLayoutEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      activeRequest.current?.abort();
      restoreRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (restoredRef.current) {
      return;
    }

    const route = `${window.location.pathname}${window.location.search}${sessionKey ? `#${sessionKey}` : ""}`;

    if (!restoreSession) {
      restoredRef.current = true;
      clearStoredFeedState(route);
      return;
    }

    const controller = new AbortController();
    restoreRequest.current = controller;
    restoringRef.current = true;
    const generation = generationRef.current;
    let interacted = false;
    const stopScrollRestore = () => { interacted = true; pendingScrollRef.current = null; pendingAnchorRef.current = null; };
    window.addEventListener("pointerdown", stopScrollRestore, { passive: true });
    window.addEventListener("touchstart", stopScrollRestore, { passive: true });
    window.addEventListener("wheel", stopScrollRestore, { passive: true });
    window.addEventListener("keydown", stopScrollRestore);
    const restore = async () => {
      if (!shouldRestoreStoredFeedState()) {
        clearStoredFeedState(route);
        return;
      }
      const stored = readStoredFeedState(route, sessionCursor ? null : firstKey, viewer.userId);
      if (!stored || stored.items.length === 0) return;
      const revisions = await exploreFeedRevisions(stored.items);
      if (controller.signal.aborted) return;
      const known = new Map(revisions.map(row => [row.contentKey, row.revision]));
      const contentKeys = stored.items.map(item => item.contentKey).filter((key): key is string => Boolean(key));
      const visibility = stored.sessionCursor ? await requestExploreFeed<ExploreFeedValidation>({
        mode: "validate", cursor: stored.sessionCursor,
        contentKeys, revisions: contentKeys.map(key => known.get(key) ?? null),
      }, controller.signal) : null;
      if (controller.signal.aborted || generationRef.current !== generation || visibility?.error || (sessionCursor && !visibility)) return;
      const retained = visibility ? retainValidatedExploreItems(stored.items, visibility, revisions) : stored.items;
      if (!mountedRef.current) {
        return;
      }

      setItems(sessionCursor ? retained : (current) => mergeStoredFeedItems(retained, current));
      if (stored.sessionCursor) setSessionCursor(stored.sessionCursor);
      if (!interacted && !window.location.hash) { pendingScrollRef.current = stored.scrollY; pendingAnchorRef.current = stored.scrollAnchor; }
      setCursor(stored.cursor);
      setHasMore(stored.hasMore);
      setPaginationError("");
    };
    const restoreFrame = window.requestAnimationFrame(() => { restoredRef.current = true; void restore().catch(() => {}).finally(() => {
      if (generationRef.current === generation) {
        restoringRef.current = false;
        if (mountedRef.current) setIsRestoring(false);
      }
    }); });

    return () => {
      controller.abort();
      restoringRef.current = false;
      window.cancelAnimationFrame(restoreFrame);
      window.removeEventListener("pointerdown", stopScrollRestore); window.removeEventListener("touchstart", stopScrollRestore); window.removeEventListener("wheel", stopScrollRestore); window.removeEventListener("keydown", stopScrollRestore);
    };
  }, [firstKey, viewer.userId, restoreSession, sessionKey, sessionCursor]);

  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null) {
      const anchor = pendingAnchorRef.current;
      const node = anchor ? Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-explore-content-key]") ?? []).find(element => element.dataset.exploreContentKey === anchor.contentKey) : null;
      window.scrollTo(0, node && anchor ? Math.max(0, window.scrollY + node.getBoundingClientRect().top - anchor.offset) : pendingScrollRef.current);
      pendingScrollRef.current = null;
      pendingAnchorRef.current = null;
    }
  }, [items]);

  useEffect(() => {
    const route = `${window.location.pathname}${window.location.search}${sessionKey ? `#${sessionKey}` : ""}`;
    let reset = false;
    const onReset = () => { reset = true; generationRef.current += 1; activeRequest.current?.abort(); restoreRequest.current?.abort(); };
    const save = () => {
      if (reset || restoringRef.current || !sentinelRef.current?.getClientRects().length) return;
      const node = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-explore-content-key]") ?? []).find(element => element.getBoundingClientRect().bottom > 80);
      const scrollAnchor = node?.dataset.exploreContentKey ? { contentKey: node.dataset.exploreContentKey, offset: node.getBoundingClientRect().top } : null;
      writeStoredFeedState({ sessionCursor, cursor, hasMore, items, viewerId: viewer.userId, route, scrollAnchor });
    };
    let timeout = window.setTimeout(save, 250);
    const onScroll = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(save, 450);
    };
    const onNavigate = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) save();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("reylumi:experience-reset", onReset);
    document.addEventListener("click", onNavigate, true);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("reylumi:experience-reset", onReset);
      document.removeEventListener("click", onNavigate, true);
    };
  }, [cursor, hasMore, items, viewer.userId, sessionKey, sessionCursor]);

  if (isEmpty && supplementaryPosts.length === 0 && endContent) return <>{endContent(items)}</>;
  return (
    <>
    <section
      ref={sectionRef}
      aria-busy={loadingMore || isRestoring}
      aria-label="Explore discovery feed"
      className="mx-auto grid w-full max-w-[40rem] gap-2.5"
      id={feedId}
      data-testid="explore-continuous-feed"
    >
      {initialFailure ? (
        <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
          {paginationError}
        </div>
      ) : null}

      {heading && (memoizedItems.length > 0 || supplementaryPosts.length > 0) ? <div className="px-1 pb-2 pt-3"><h2 className="text-xl font-semibold">{heading}</h2>{description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}</div> : null}
      {isEmpty && supplementaryPosts.length === 0 && emptyMessage !== "" ? (
        <div className="rounded-[1.25rem] border border-dashed border-divider-subtle bg-surface-elevated p-6 text-center text-sm leading-6 text-text-secondary">
          {emptyMessage ?? (discovery?.query ? "No ideas found for this search. Try another phrase or location." : "Public beauty posts and salon visuals will appear here as Reylumi discovery grows.")}
        </div>
      ) : null}

      <div className="grid gap-3">
        {!matchingPostsFirst && memoizedItems.length === 0 ? supplementaryPosts[0] : null}
        {memoizedItems.map((item, index) => {
          const shortcutIndex = exploreShortcutIndex(index + 1);
          const shortcut =
            shortcutIndex !== null && feedDiscoveryShortcuts.length > 0
              ? feedDiscoveryShortcuts[
                  shortcutIndex % feedDiscoveryShortcuts.length
                ]
              : null;

          return (
            <Fragment key={feedItemKey(item)}>
              {item.discoveryScope === "wider" ? (
                <p className="px-2 pt-2 text-xs font-medium text-text-muted">{[item.salon?.city, item.salon?.state].filter(Boolean).join(", ")}{item.bookingMeta.distanceMiles != null ? ` Â· ${item.bookingMeta.distanceMiles.toFixed(1)} mi away` : ""}</p>
              ) : null}
              <div data-explore-content-key={item.contentKey}>
              <ExploreFeedCard
                commentPresentation={commentPlan[feedCommentCandidate(item)?.key ?? ""]}
                featured={index === 0}
                item={item}
                onCommentCountChange={updateCommentCount}
                viewer={viewer}
              />
              </div>
              {(index + 1) % 4 === 0 ? <ExploreAdSlot slotIndex={Math.floor(index / 4)} /> : null}
              {!matchingPostsFirst && (index + 1) % 4 === 0 ? supplementaryPosts[Math.floor((index + 1) / 4) - 1] : null}
              {shortcut ? (
                <FeedDiscoveryModule
                  activeResultKind={activeDiscoveryResult}
                  onSelect={onDiscoveryShortcutSelect}
                  shortcut={shortcut}
                  items={memoizedItems}
                  category={discovery?.category ?? "All"}
                  location={discovery?.location ?? ""}
                />
              ) : null}
            </Fragment>
          );
        })}
        {matchingPostsFirst ? showSearchInspiration ? supplementaryPosts : null : supplementaryPosts.slice(memoizedItems.length ? Math.floor(memoizedItems.length / 4) : 1)}
        {!matchingPostsFirst || showSearchInspiration ? supplementaryFooter : null}
      </div>

      {paginationError ? (
        <div className="grid gap-3 rounded-[1rem] bg-white p-4 text-sm text-text-secondary shadow-[0_10px_28px_rgba(35,25,22,0.035)] ring-1 ring-divider-subtle/65">
          <p>{paginationError}</p>
          <button
            className="w-fit rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => void loadNextPage({ retry: true })}
            type="button"
          >
            Retry
          </button>
          <button type="button" onClick={() => void refreshFeed()} className="w-fit rounded-full bg-brand-teal-soft px-4 py-2 text-sm font-semibold text-brand-teal">Refresh feed</button>
        </div>
      ) : null}

      {loadingMore ? (
        <div className="grid gap-3" aria-label="Loading more Explore posts">
          <ExploreFeedSkeleton />
        </div>
      ) : null}

      <div aria-hidden className="h-4" ref={sentinelRef}>
        <ExploreAutoLoad enabled={hasMore && !loadingMore && !paginationError && !isRestoring} onLoad={loadNextPage} progressKey={cursor} prepareAheadKey={aheadKey} />
      </div>

      {hasMore && !loadingMore && !paginationError ? (
        <button type="button" onClick={() => void loadNextPage()} className={`${memoizedItems.length ? "sr-only focus:not-sr-only" : ""} mx-auto rounded-full bg-surface-muted px-5 py-3 text-sm font-semibold text-text-primary`}>Explore more</button>
      ) : null}
      {!endContent && !hasMore && !loadingMore && !isRestoring && supplementaryPosts.length === 0 && !(isEmpty && emptyContent != null) ? (
        <div className="grid justify-items-center gap-2 py-5 text-center text-sm text-text-muted">
          <p>You&apos;ve explored the available results. Try another category or area.</p>
          <a href="#explore-search" className="font-semibold text-brand-teal" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Adjust your discovery</a>
        </div>
      ) : null}
    </section>
    {isEmpty && supplementaryPosts.length === 0 ? emptyContent : null}
    {!hasMore && !loadingMore && !isRestoring && !paginationError ? endContent?.(items) : null}
    {paginationError ? errorContent : null}
    </>
  );
}
