"use client";
import { PostIdentity } from "@/components/post-identity";
import {ExploreBookButton} from "@/components/explore-account-actions";
import type { getPublicExploreBeautyPost } from "@/lib/explore-personal";
import { PostCommentThread } from "@/app/post-comments/post-comment-thread";
import { PostShareButton } from "@/components/post-share-button";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import { ReylumiIcon } from "@/components/reylumi-icons";
import type { ExploreFeedItem, ExploreFeedMedia } from "@/types/explore";
import Image from "next/image";
import Link from "next/link";
import type {PostCommentViewer} from "@/types/post-comments";
function mediaAspectRatio(media: ExploreFeedMedia | undefined) {
  if (media?.aspectRatio && media.aspectRatio > 0) {
    return `${Math.min(1.55, Math.max(0.72, media.aspectRatio))}`;
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

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function postLabel(item: ExploreFeedItem) {
  return item.personal?.postType === "before_after"
    ? "Before & After"
    : "Beauty moment";
}

function verificationLabel(item: ExploreFeedItem) {
  return item.verification?.state === "verified" ? "Verified visit" : null;
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

function bookingPriceLabel(item: ExploreFeedItem) {
  return item.bookingMeta.price !== null
    ? `${formatMoney(item.bookingMeta.price)}+`
    : item.booking?.eligible
      ? "Price varies"
      : null;
}

function bookingDurationLabel(item: ExploreFeedItem) {
  return item.bookingMeta.durationMinutes !== null
    ? formatDuration(item.bookingMeta.durationMinutes)
    : item.booking?.eligible
      ? "Time varies"
      : null;
}

function locationLabel(item: ExploreFeedItem) {
  return [item.salon?.city, item.salon?.state].filter(Boolean).join(", ") || null;
}

function PostHeaderTitle({ item }: { item: ExploreFeedItem }) {
  return <PostIdentity source={item.sourceType} salonName={item.salon?.name} salonHref={item.salon?.href} authorName={item.sourceType === "salon" ? item.salonAuthorName : item.author.name} authorRole={item.salonAuthorRole} authorHref={`/explore/beauty/${encodeURIComponent(item.personal?.profileId ?? item.author.id)}`} />;
}

function SingleMedia({
  item,
  media,
}: {
  item: ExploreFeedItem;
  media: ExploreFeedMedia;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[1.25rem] bg-surface-muted ring-1 ring-divider-subtle/80"
      style={{ aspectRatio: mediaAspectRatio(media) }}
    >
      <Image
        alt={`Beauty post by ${item.author.name}`}
        className="object-cover"
        fill
        priority
        sizes="(max-width: 768px) 100vw, 720px"
        src={media.imageUrl}
      />
    </div>
  );
}

function PostMedia({ item }: { item: ExploreFeedItem }) {
  const before = item.media.find((media) => media.role === "before");
  const after = item.media.find((media) => media.role === "after");

  if (item.personal?.postType === "before_after" && before && after) {
    return (
      <BeforeAfterCompare
        after={{
          alt: `After image from ${item.author.name}`,
          id: after.id,
          url: after.imageUrl,
        }}
        aspectClassName="aspect-[4/5]"
        before={{
          alt: `Before image from ${item.author.name}`,
          id: before.id,
          url: before.imageUrl,
        }}
        priority
        roundedClassName="rounded-[1.25rem]"
        sizes="(max-width: 768px) 100vw, 720px"
      />
    );
  }

  if (item.media.length > 1) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {item.media.slice(0, 4).map((media) => (
          <SingleMedia item={item} key={media.id} media={media} />
        ))}
      </div>
    );
  }

  const firstMedia = item.media[0];

  return firstMedia ? <SingleMedia item={item} media={firstMedia} /> : null;
}

export function BeautyPostReadView({item,commentViewer,profileId,postId}:{item:NonNullable<Awaited<ReturnType<typeof getPublicExploreBeautyPost>>>;commentViewer:PostCommentViewer;profileId:string;postId:string}){
  const booking = item.booking?.eligible ? item.booking : null;
  const price = item.serviceName ? bookingPriceLabel(item) : null;
  const duration = item.serviceName ? bookingDurationLabel(item) : null;
  const verifiedLabel = verificationLabel(item);
  return <main className="min-h-screen bg-surface-muted px-3 py-4 sm:px-6">
    <article className="mx-auto grid w-full max-w-3xl gap-4" id={"post-" + item.id}>
      <div className="flex items-center justify-between gap-3 text-sm"><Link href={"/explore/beauty/" + profileId} className="min-w-0 truncate py-2 font-semibold text-text-secondary">Back to {item.author.name}</Link><span className="shrink-0 text-xs text-text-muted">{formatDate(item.publishedAt)}</span></div>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-divider-subtle bg-surface">
        <header className="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4">
          <Link href={"/explore/beauty/" + profileId} aria-label={"Open " + item.author.name} className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-orange-soft text-sm font-semibold text-brand-orange">
            {item.author.avatarUrl ? <Image alt="" src={item.author.avatarUrl} fill sizes="40px" className="object-cover" /> : initialsFor(item.author.name)}
          </Link>
          <div className="min-w-0 flex-1 text-sm"><PostHeaderTitle item={item} /></div>
          {verifiedLabel ? <span className="rounded-full bg-brand-teal-soft px-2 py-1 text-[11px] font-semibold text-brand-teal">{verifiedLabel}</span> : null}
        </header>
        <PostMedia item={item} />
        <div className="grid gap-3 px-3 py-3 sm:px-4">
          {item.caption ? <h1 className="whitespace-pre-wrap break-words text-base font-normal leading-6">{item.caption}</h1> : <h1 className="text-base font-semibold">{postLabel(item)}</h1>}
          <div className="post-action-toolbar">
            {item.saveTarget ? <SavePostButton size="toolbar" initialSaved={item.saveTarget.saved} saveCount={item.saveTarget.saveCount} isAuthenticated={commentViewer.isAuthenticated} target={item.saveTarget} /> : null}
            <a href="#comments" aria-label="Comment"><ReylumiIcon name="message" /><span>Comment</span></a>
            <PostShareButton href={item.destination.href || "/explore/beauty/" + profileId + "/posts/" + postId} title={item.caption || item.author.name} />
            <ExploreBookButton href={booking?.href ?? null} name={item.salon?.name ?? item.author.name} contactHref={item.salon?.href} />
          </div>
        </div>
        {item.salon ? <section className="grid gap-2 border-t border-divider-subtle px-3 py-3 sm:px-4" aria-label="Salon and booking">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.salon.name}</p>{locationLabel(item) ? <p className="mt-0.5 text-xs text-text-secondary">{locationLabel(item)}</p> : null}</div>
            {item.salon.href ? <Link href={item.salon.href} className="inline-flex min-h-11 items-center rounded-full border border-divider-subtle px-4 text-sm font-semibold">View salon</Link> : null}
          </div>
          {item.serviceName ? <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-secondary"><span>{item.serviceName}</span>{price ? <span>{price}</span> : null}{duration ? <span>{duration}</span> : null}</p> : null}
          {booking ? <p className="text-xs text-text-secondary">Choose Book to check available services and times.</p> : null}
        </section> : null}
      </section>
      <section id="comments" className="min-w-0 rounded-2xl border border-divider-subtle bg-surface p-3 sm:p-4">
        <PostCommentThread initialCount={item.commentCount} target={{ profileId: item.personal.profileId, salonId: item.salon?.id ?? null, sourceId: item.id, sourceType: "beauty_post", title: item.caption ?? postLabel(item) }} viewer={commentViewer} />
      </section>
    </article>
  </main>;
}

