"use client";

import { loadExploreFeedAction } from "@/app/explore/actions";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import { LumiTrustPopover } from "@/components/reylumi-trust";
import type {
  ExploreFeedCursor,
  ExploreFeedItem,
  ExploreFeedMedia,
  ExploreFeedPage,
} from "@/types/explore";
import {
  buildReylumiTrustSummary,
  type ReylumiTrustSummary,
} from "@/lib/reylumi-trust";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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
const EXPLORE_FEED_SESSION_VERSION = 9;
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
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg group-hover/action:block group-focus-within/action:block"
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
        <span className="block truncate text-sm font-semibold text-text-primary transition hover:text-brand-orange">
          {authorName}
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

  return (
    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-medium text-text-secondary">
      {profileHref ? (
        <Link
          className="min-w-0 max-w-[12rem] truncate rounded-md font-semibold text-text-primary transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={profileHref}
        >
          {item.salon.name}
        </Link>
      ) : (
        <span className="min-w-0 max-w-[12rem] truncate font-semibold text-text-primary">
          {item.salon.name}
        </span>
      )}
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
    showContextBadge ? itemContextLabel(item) : null,
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
        title={status === "copied" ? "Copied" : "Share"}
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
  item,
  media,
}: {
  item: ExploreFeedItem;
  media: ExploreFeedMedia;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const isCoverFallback = isRecommendationCoverMedia(item, media);

  return (
    <div
      className={[
        "relative overflow-hidden bg-surface-muted",
        isCoverFallback ? "h-[13rem] sm:h-[16rem] lg:h-[17rem]" : "",
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
      aspectClassName="aspect-[4/5] sm:aspect-[4/3]"
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

  const isBeforeAfter =
    item.sourceType === "personal" &&
    item.personal?.postType === "before_after";
  const media = isBeforeAfter ? (
    <BeforeAfterMedia item={item} />
  ) : (
    <SingleMedia item={item} media={firstMedia} />
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
  href,
  item,
}: {
  href: string | null;
  item: ExploreFeedItem;
}) {
  const router = useRouter();
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const media = <FeedMedia item={item} />;
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

function ExploreFeedCard({ item }: { item: ExploreFeedItem }) {
  const service = serviceLabel(item);
  const href = item.destination.href;
  const isSalonRecommendation = item.contentType === "salon_recommendation";
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

  return (
    <article
      className="overflow-visible rounded-[0.95rem] bg-white shadow-[0_8px_22px_rgba(35,25,22,0.035)] ring-1 ring-divider-subtle/65"
      data-feed-key={item.feedKey}
      data-source-type={item.sourceType}
      data-testid="explore-feed-card"
    >
      <div className="flex min-w-0 items-center justify-between gap-2.5 px-3 py-2.5">
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

      <FeedMediaFrame href={href} item={item} />

      <div className="grid gap-2 px-3 py-2.5">
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
                      bookedCountText ? "Book this post" : booking?.label ?? "Book",
                      bookedCountText,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    className="inline-flex h-8 max-w-full items-center justify-center gap-1.5 rounded-full bg-brand-orange px-2.5 text-xs font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    href={bookingHref}
                    title={
                      bookedCountText
                        ? `${bookedCountText}. Book this post`
                        : booking?.label ?? "Book"
                    }
                  >
                    <BookActionIcon />
                    <span className="truncate">
                      {bookedCountText ?? "Book"}
                    </span>
                  </Link>
                </ActionTooltip>
              ) : null}
              {actionHref ? <FeedShareButton href={actionHref} item={item} /> : null}
            </div>
            {item.saveTarget ? (
              <SavePostButton
                className="ml-auto shrink-0"
                initialSaved={item.saveTarget.saved}
                saveCount={item.saveTarget.saveCount}
                size="compact"
                target={item.saveTarget}
              />
            ) : null}
          </div>
        </div>
      </div>
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
