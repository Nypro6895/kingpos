import {ExploreBookButton} from "@/components/explore-account-actions";
import {SalonTrustLine,SalonVerifiedBadge} from "@/components/salon-trust-line";
import { getPublicExploreBeautyPost } from "@/lib/explore-personal";
import { getPostCommentViewer } from "@/lib/post-comments";
import { PostCommentThread } from "@/app/post-comments/post-comment-thread";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import { ReylumiIcon } from "@/components/reylumi-icons";
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

function bookingDistanceLabel(item: ExploreFeedItem) {
  const distance = item.bookingMeta.distanceMiles;

  if (distance === null) {
    return null;
  }

  return distance < 10 ? `${distance.toFixed(1)} mi` : `${Math.round(distance)} mi`;
}

function bookingAvailabilityLabel(item: ExploreFeedItem) {
  return (
    item.bookingMeta.availabilityLabel ??
    (item.salon?.operatingStatus.isOpen
      ? "Available today"
      : item.salon?.operatingStatus.nextOpensLabel) ??
    null
  );
}


function locationLabel(item: ExploreFeedItem) {
  return [item.salon?.city, item.salon?.state].filter(Boolean).join(", ") || null;
}

function SalonLogo({ item }: { item: ExploreFeedItem }) {
  const salon = item.salon;

  if (!salon) {
    return null;
  }

  return (
    <span
      aria-hidden
      className="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-orange-soft text-[0.65rem] font-extrabold text-brand-orange ring-1 ring-divider-subtle"
    >
      {salon.logoImageUrl ? (
        <Image
          alt=""
          className="object-cover"
          fill
          sizes="24px"
          src={salon.logoImageUrl}
        />
      ) : (
        initialsFor(salon.name)
      )}
    </span>
  );
}

function PostHeaderTitle({ item }: { item: ExploreFeedItem }) {
  const salon = item.salon;
  const authorHref = `/explore/beauty/${encodeURIComponent(
    item.personal?.profileId ?? item.author.id,
  )}`;

  if (!salon) {
    return (
      <Link
        className="block truncate rounded-md text-base font-semibold text-text-primary transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href={authorHref}
      >
        {item.author.name}
      </Link>
    );
  }

  const salonIdentity = (
    <span className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5">
      <SalonLogo item={item} />
      <span className="truncate">{salon.name}</span>
      <SalonVerifiedBadge verified={salon.trust.identityVerified}/>
    </span>
  );

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-base font-semibold text-text-primary">
      <Link
        className="block min-w-0 max-w-[10rem] truncate rounded-md transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:max-w-[13rem]"
        href={authorHref}
      >
        {item.author.name}
      </Link>
      <span className="shrink-0 font-medium text-text-secondary">at</span>
      {salon.href ? (
        <Link
          className="min-w-0 rounded-md transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={salon.href}
        >
          {salonIdentity}
        </Link>
      ) : (
        salonIdentity
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

function LookMediaStage({ item }: { item: ExploreFeedItem }) {
  const thumbnails = item.media.slice(0, 6);

  return (
    <div className="grid gap-2 lg:grid-cols-[4.75rem_minmax(0,1fr)]">
      {thumbnails.length > 1 ? (
        <div className="hidden grid-rows-6 gap-2 lg:grid">
          {thumbnails.map((media) => (
            <div
              className="relative min-h-16 overflow-hidden rounded-[0.65rem] bg-surface-muted ring-1 ring-divider-subtle/80"
              key={media.id}
            >
              <Image
                alt=""
                className="object-cover"
                fill
                sizes="76px"
                src={media.imageUrl}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <PostMedia item={item} />
        <div className="absolute left-3 top-3 flex gap-2">
          <Link
            aria-label="Back to Explore"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/92 text-text-primary shadow-sm ring-1 ring-white/80 backdrop-blur transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={{ pathname: "/explore" }}
          >
            <ReylumiIcon className="h-4 w-4" name="chevron-left" />
          </Link>
        </div>
        {item.saveTarget ? (
          <SavePostButton
            className="absolute right-14 top-3"
            initialSaved={item.saveTarget.saved}
            saveCount={item.saveTarget.saveCount}
            size="compact"
            target={item.saveTarget}
          />
        ) : null}
        <button
          aria-label="More options"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center bg-transparent text-text-primary transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          type="button"
        >
          <ReylumiIcon className="h-4 w-4" name="more" />
        </button>
      </div>
    </div>
  );
}

function LookStat({
  icon,
  label,
  value,
}: {
  icon: "bookmark" | "calendar" | "image" | "message";
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 justify-items-center gap-1 rounded-[0.8rem] bg-white px-3 py-2 text-center ring-1 ring-divider-subtle/70">
      <ReylumiIcon className="h-4 w-4 text-text-secondary" name={icon} />
      <p className="text-sm font-semibold text-text-primary">{value}</p>
      <p className="text-[11px] font-semibold text-text-muted">{label}</p>
    </div>
  );
}

function AvailabilityChips({ item }: { item: ExploreFeedItem }) {
  const availability = bookingAvailabilityLabel(item);
  const times = availability
    ? ["2:30 PM", "3:30 PM", "4:30 PM", "+ More"]
    : ["Check times"];

  return (
    <div className="grid gap-2">
      {availability ? (
        <p className="text-xs font-semibold text-emerald-700">
          {availability}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {times.map((time) => (
          <span
            className="rounded-[0.55rem] bg-white px-3 py-2 text-xs font-semibold text-text-primary ring-1 ring-divider-subtle/80"
            key={time}
          >
            {time}
          </span>
        ))}
      </div>
    </div>
  );
}

function ShareButtons() {
  const actions = [
    { icon: "share" as const, label: "Copy link" },
    { icon: "image" as const, label: "Photos" },
    { icon: "message" as const, label: "Message" },
    { icon: "more" as const, label: "More" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          className="grid h-10 w-10 place-items-center rounded-full bg-surface-muted text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange"
          key={action.label}
          type="button"
        >
          <ReylumiIcon className="h-4 w-4" name={action.icon} />
        </button>
      ))}
    </div>
  );
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
  const [item, commentViewer] = await Promise.all([
    getPublicExploreBeautyPost({ postId, profileId }),
    getPostCommentViewer(),
  ]);

  if (!item || item.personal.profileId !== profileId) {
    notFound();
  }

  const booking = item.booking?.eligible ? item.booking : null;
  const bookingHref = booking?.href ?? null;
  const verifiedLabel = verificationLabel(item);
  const bookedCount = booking?.bookedCount ?? null;
  const showPostTypeBadge = item.personal?.postType !== "before_after";
  const detailContext =
    [
      showPostTypeBadge ? postLabel(item) : null,
      locationLabel(item),
    ]
      .filter(Boolean)
      .join(" / ") || postLabel(item);
  const serviceTitle = item.serviceName ?? item.serviceCategory ?? postLabel(item);
  const price = bookingPriceLabel(item);
  const duration = bookingDurationLabel(item);
  const distance = bookingDistanceLabel(item);
  const salonLocation = locationLabel(item);
  const bookedCountText =
    bookedCount !== null ? bookingCountLabel(bookedCount) : null;

  return (
    <main className="min-h-screen bg-[#fffaf7] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
      <article
        className="mx-auto grid max-w-[82rem] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]"
        id={`post-${item.id}`}
      >
        <section className="grid gap-3 rounded-[1.1rem] bg-white p-2 shadow-[0_18px_44px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80 sm:p-3">
          <LookMediaStage item={item} />
          <div className="grid grid-cols-4 gap-2">
            <LookStat
              icon="bookmark"
              label="Saves"
              value={String(item.saveTarget?.saveCount ?? 0)}
            />
            <LookStat
              icon="calendar"
              label="Booked"
              value={bookedCountText?.replace(" booked", "") ?? "0"}
            />
            <LookStat
              icon="image"
              label="Photos"
              value={String(item.media.length)}
            />
            <LookStat
              icon="message"
              label="Comments"
              value={String(item.commentCount)}
            />
          </div>
          <section className="rounded-[0.9rem] bg-white p-3 ring-1 ring-divider-subtle/70">
            <h2 className="text-sm font-semibold text-text-primary">
              About this look
            </h2>
            {item.caption ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
                {item.caption}
              </p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                This look is ready to compare by shop, artist, service, price,
                duration, and availability.
              </p>
            )}
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <section className="grid gap-4 rounded-[1.1rem] bg-white p-4 shadow-[0_18px_44px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80">
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
                <PostHeaderTitle item={item} />
                {item.salon?<SalonTrustLine signals={item.salon.trust} href={item.salon.href} name={item.salon.name} distance={distance} expanded className="text-text-secondary"/>:null}
                {salonLocation?<span className="block text-[11px] text-text-secondary">{salonLocation}</span>:null}
              </span>
            </div>

            <div>
              <h1 className="text-xl font-semibold leading-tight text-text-primary">
                {serviceTitle}
              </h1>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-text-secondary">
                {price ? <span className="text-text-primary">{price}</span> : null}
                {duration ? <span>{duration}</span> : null}
                <span>{detailContext}</span>
              </p>
              <p className="mt-2 text-xs font-semibold text-text-muted">
                {formatDate(item.publishedAt)}
              </p>
            </div>

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

            <AvailabilityChips item={item} />

            <ExploreBookButton href={bookingHref} name={item.salon?.name??item.author.name} contactHref={item.salon?.href}/>


            {item.salon?.href ? (
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-[0.75rem] bg-surface-muted px-4 py-2 text-sm font-semibold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={item.salon.href}
              >
                View salon
              </Link>
            ) : null}

            <div className="rounded-[0.9rem] bg-brand-orange-soft/45 p-3 text-sm leading-6 text-text-secondary ring-1 ring-brand-orange/12">
              <span className="font-semibold text-brand-orange">
                Create an account
              </span>{" "}
              to save this look and book faster next time.
            </div>
          </section>

          <section className="grid gap-3 rounded-[1.1rem] bg-white p-4 shadow-[0_18px_44px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80">
            <h2 className="text-sm font-semibold text-text-primary">
              Share this look
            </h2>
            <ShareButtons />
          </section>
        </aside>
      </article>

      <section
        className="mx-auto mt-4 max-w-[82rem] rounded-[1.1rem] bg-white p-4 shadow-[0_18px_44px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80"
        id="comments"
      >
          <PostCommentThread
            initialCount={item.commentCount}
            target={{
              profileId: item.personal.profileId,
              salonId: item.salon?.id ?? null,
              sourceId: item.id,
              sourceType: "beauty_post",
              title: item.caption ?? postLabel(item),
            }}
            viewer={commentViewer}
          />
      </section>
    </main>
  );
}
