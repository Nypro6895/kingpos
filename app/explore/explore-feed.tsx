"use client";

import { loadExploreFeedAction } from "@/app/explore/actions";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import type {
  ExploreFeedCursor,
  ExploreFeedItem,
  ExploreFeedMedia,
  ExploreFeedPage,
} from "@/types/explore";
import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const EXPLORE_FEED_SESSION_KEY = "kingpos-explore-continuous-feed";
const EXPLORE_FEED_SESSION_VERSION = 5;
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

function verificationLabel(item: ExploreFeedItem) {
  return item.verification?.state === "verified" ? "Verified visit" : null;
}

function bookingCountLabel(count: number) {
  return `${count} booked`;
}

function timeAgo(value: string) {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    return "Recently";
  }

  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000));

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function mediaAspectRatio(media: ExploreFeedMedia | undefined) {
  if (media?.aspectRatio && media.aspectRatio > 0) {
    const ratio = Math.min(1.45, Math.max(0.86, media.aspectRatio));
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
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-text-primary text-sm font-semibold text-white">
      {item.author.avatarUrl ? (
        <Image
          alt={`${item.author.name} profile`}
          className="object-cover"
          fill
          sizes="40px"
          src={item.author.avatarUrl}
        />
      ) : (
        initialsFor(item.author.name)
      )}
    </span>
  );
}

function SingleMedia({
  item,
  media,
}: {
  item: ExploreFeedItem;
  media: ExploreFeedMedia;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div
      className="relative overflow-hidden bg-surface-muted"
      style={{ aspectRatio: mediaAspectRatio(media) }}
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

function BeforeAfterMedia({ item }: { item: ExploreFeedItem }) {
  const pair = beforeAfterMediaPair(item);
  const firstMedia = item.media[0];

  if (!pair) {
    return firstMedia ? <SingleMedia item={item} media={firstMedia} /> : null;
  }

  return (
    <BeforeAfterCompare
      after={{
        alt: `After image from ${item.author.name}`,
        id: pair.after.id,
        url: pair.after.imageUrl,
      }}
      aspectClassName="aspect-[4/5]"
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

function FeedMedia({ item }: { item: ExploreFeedItem }) {
  const firstMedia = item.media[0];

  if (!firstMedia) {
    return (
      <div className="grid aspect-[4/5] place-items-center bg-surface-muted px-6 text-center text-sm font-semibold text-text-secondary">
        {item.author.name}
      </div>
    );
  }

  if (
    item.sourceType === "personal" &&
    item.personal?.postType === "before_after"
  ) {
    return <BeforeAfterMedia item={item} />;
  }

  return (
    <div className="relative">
      <SingleMedia item={item} media={firstMedia} />
      {item.media.length > 1 ? (
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">
          {item.media.length} photos
        </span>
      ) : null}
    </div>
  );
}

function ExploreFeedCard({ item }: { item: ExploreFeedItem }) {
  const service = serviceLabel(item);
  const location = locationLabel(item);
  const verifiedLabel = verificationLabel(item);
  const href = item.destination.href;
  const isSalonRecommendation = item.contentType === "salon_recommendation";
  const booking = item.booking?.eligible ? item.booking : null;
  const bookingHref = booking?.href ?? null;
  const bookedCount = booking?.bookedCount ?? null;
  const showBeautyBookedCount =
    item.contentType === "beauty_post" && bookedCount !== null;
  const showContextBadge =
    !(
      item.sourceType === "personal" &&
      item.personal?.postType === "before_after"
    );
  const contextLine =
    isSalonRecommendation
      ? [location, service].filter(Boolean).join(" / ") || "Recommended salon"
      : item.sourceType === "personal"
        ? [item.salon?.name, location, verifiedLabel].filter(Boolean).join(" / ") ||
          "Beauty Profile"
        : [item.salon?.name, location].filter(Boolean).join(" / ");
  const postHref = href && !isSalonRecommendation ? href : null;
  const recommendationProfileHref =
    href && isSalonRecommendation && !bookingHref ? href : null;
  const salonHref =
    item.salon?.href && !isSalonRecommendation && item.salon.href !== href
      ? item.salon.href
      : null;
  const media = <FeedMedia item={item} />;

  return (
    <article
      className="overflow-hidden rounded-[1rem] bg-white shadow-[0_10px_28px_rgba(35,25,22,0.04)] ring-1 ring-divider-subtle/65"
      data-feed-key={item.feedKey}
      data-source-type={item.sourceType}
      data-testid="explore-feed-card"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-3">
        <Link
          className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={href ?? item.salon?.href ?? "/explore"}
        >
          <FeedAvatar item={item} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">
              {displayName(item.author.name, "Reylumi")}
            </span>
            <span className="block truncate text-xs font-medium text-text-secondary">
              {contextLine}
            </span>
          </span>
        </Link>
        <span className="shrink-0 text-[11px] font-semibold text-text-muted">
          {timeAgo(item.publishedAt)}
        </span>
      </div>

      {href ? (
        beforeAfterMediaPair(item) ? (
          media
        ) : (
          <Link
            aria-label={`Open ${itemContextLabel(item)} by ${item.author.name}`}
            className="group block focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange"
            href={href}
          >
            {media}
          </Link>
        )
      ) : (
        media
      )}

      <div className="grid gap-2.5 px-3.5 py-3">
        {item.caption ? (
          <p className="line-clamp-3 text-sm leading-6 text-text-primary">
            {item.caption}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {service ? (
            <span className="rounded-full bg-brand-orange-soft px-2.5 py-1 text-[11px] font-semibold text-brand-orange">
              {service}
            </span>
          ) : null}
          {showContextBadge ? (
            <span className="rounded-full bg-brand-teal-soft px-2.5 py-1 text-[11px] font-semibold text-brand-teal">
              {itemContextLabel(item)}
            </span>
          ) : null}
          {verifiedLabel ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
              {verifiedLabel}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2 pt-0.5">
          {showBeautyBookedCount ? (
            <p className="text-xs font-semibold text-text-muted">
              {bookingCountLabel(bookedCount)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {bookingHref ? (
              <Link
                aria-label={[
                  booking?.label ?? "Book",
                  showBeautyBookedCount
                    ? bookingCountLabel(bookedCount)
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                className={[
                  "inline-flex min-h-9 max-w-full items-center justify-center rounded-full bg-brand-orange px-3.5 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                  item.contentType === "beauty_post" ? "w-full sm:w-auto" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                href={bookingHref}
              >
                <span className="truncate">{booking?.label ?? "Book"}</span>
              </Link>
            ) : null}
            {postHref ? (
              <Link
                className="inline-flex min-h-9 items-center rounded-full bg-surface-muted px-3.5 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={postHref}
              >
                View post
              </Link>
            ) : null}
            {recommendationProfileHref ? (
              <Link
                className="inline-flex min-h-9 items-center rounded-full bg-surface-muted px-3.5 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={recommendationProfileHref}
              >
                View salon
              </Link>
            ) : null}
            {salonHref ? (
              <Link
                className="inline-flex min-h-9 items-center rounded-full bg-surface-muted px-3.5 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={salonHref}
              >
                View salon
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function ExploreFeedSkeleton() {
  return (
    <article className="overflow-hidden rounded-[1rem] bg-white shadow-[0_10px_28px_rgba(35,25,22,0.035)] ring-1 ring-divider-subtle/65">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="h-10 w-10 rounded-full bg-surface-muted" />
        <div className="grid flex-1 gap-2">
          <div className="h-3 w-32 rounded-full bg-surface-muted" />
          <div className="h-3 w-48 max-w-full rounded-full bg-surface-muted" />
        </div>
      </div>
      <div className="aspect-[4/3] bg-surface-muted" />
      <div className="grid gap-2.5 px-3.5 py-3">
        <div className="h-3 w-11/12 rounded-full bg-surface-muted" />
        <div className="h-3 w-7/12 rounded-full bg-surface-muted" />
      </div>
    </article>
  );
}

export function ExploreFeed({ initialPage }: { initialPage: ExploreFeedPage }) {
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
      className="mx-auto grid w-full max-w-[44rem] gap-3"
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

      <div className="grid gap-4">
        {memoizedItems.map((item) => (
          <ExploreFeedCard item={item} key={feedItemKey(item)} />
        ))}
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
        <div className="grid gap-4" aria-label="Loading more Explore posts">
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
