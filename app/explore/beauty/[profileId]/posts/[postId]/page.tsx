import { getPublicExploreBeautyPost } from "@/lib/explore-personal";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import type { ExploreFeedItem, ExploreFeedMedia } from "@/types/explore";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type PublicBeautyPostPageProps = {
  params: Promise<{
    postId: string;
    profileId: string;
  }>;
};

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

function bookingCountLabel(count: number) {
  return `${count} booked`;
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

export async function generateMetadata({
  params,
}: PublicBeautyPostPageProps): Promise<Metadata> {
  const { postId, profileId } = await params;
  const item = await getPublicExploreBeautyPost({ postId, profileId });

  if (!item) {
    return {
      title: "Beauty post not found | Reylumi",
    };
  }

  return {
    title: `${item.author.name} on Reylumi`,
    description: item.caption ?? `Explore this ${postLabel(item)} on Reylumi.`,
  };
}

export default async function PublicBeautyPostPage({
  params,
}: PublicBeautyPostPageProps) {
  const { postId, profileId } = await params;
  const item = await getPublicExploreBeautyPost({ postId, profileId });

  if (!item || item.personal.profileId !== profileId) {
    notFound();
  }

  const booking = item.booking?.eligible ? item.booking : null;
  const bookingHref = booking?.href ?? null;
  const verifiedLabel = verificationLabel(item);
  const bookedCount = booking?.bookedCount ?? null;
  const showPostTypeBadge = item.personal?.postType !== "before_after";

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <article className="mx-auto grid max-w-[44rem] gap-4">
        <section
          className="overflow-hidden rounded-[1.35rem] bg-surface-elevated shadow-[0_18px_44px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80"
          id={`post-${item.id}`}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-text-primary text-sm font-semibold text-white">
                {item.author.avatarUrl ? (
                  <Image
                    alt={`${item.author.name} profile`}
                    className="object-cover"
                    fill
                    sizes="48px"
                    src={item.author.avatarUrl}
                  />
                ) : (
                  initialsFor(item.author.name)
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-text-primary">
                  {item.author.name}
                </span>
                <span className="block truncate text-sm font-medium text-text-muted">
                  {[postLabel(item), item.salon?.name].filter(Boolean).join(" / ")}
                </span>
              </span>
            </div>
            <span className="shrink-0 text-xs font-semibold text-text-muted">
              {formatDate(item.publishedAt)}
            </span>
          </div>

          <PostMedia item={item} />

          {(bookingHref || item.salon?.href) ? (
            <div className="grid gap-2 px-4 pt-4">
              {bookedCount !== null ? (
                <p className="text-xs font-semibold text-text-muted">
                  {bookingCountLabel(bookedCount)}
                </p>
              ) : null}
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                {bookingHref ? (
                  <Link
                    aria-label={[
                      booking?.label ?? "Book",
                      bookedCount !== null ? bookingCountLabel(bookedCount) : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    className="inline-flex min-h-10 max-w-full items-center justify-center rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    href={bookingHref}
                  >
                    <span className="truncate">{booking?.label ?? "Book"}</span>
                  </Link>
                ) : null}
                {item.salon?.href ? (
                  <Link
                    className="inline-flex min-h-10 items-center justify-center rounded-full bg-surface px-4 py-2 text-sm font-semibold text-text-primary shadow-sm ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    href={item.salon.href}
                  >
                    View salon
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 p-4">
            {item.caption ? (
              <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">
                {item.caption}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {item.serviceName || item.serviceCategory ? (
                <span className="rounded-full bg-brand-orange-soft px-3 py-1 text-xs font-semibold text-brand-orange">
                  {item.serviceName ?? item.serviceCategory}
                </span>
              ) : null}
              {showPostTypeBadge ? (
                <span className="rounded-full bg-brand-teal-soft px-3 py-1 text-xs font-semibold text-brand-teal">
                  {postLabel(item)}
                </span>
              ) : null}
              {verifiedLabel ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                  {verifiedLabel}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      </article>
    </main>
  );
}
