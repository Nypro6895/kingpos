import { ShowcaseBookIntent } from "@/app/explore/showcase-book-intent";
import { ReylumiIcon } from "@/components/reylumi-icons";
import {
  getExploreShowcaseLookPage,
  type ExploreShowcaseLookPage,
  type ExploreShowcaseRelatedLook,
} from "@/lib/explore-showcase-content";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type ShowcaseLookRouteProps = {
  params: Promise<{
    lookId: string;
  }>;
};

function formatMoney(value: number) {
  return `$${Math.round(value)}+`;
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

function formatDistance(value: number) {
  return value < 10 ? `${value.toFixed(1)} mi` : `${Math.round(value)} mi`;
}

export async function generateMetadata({
  params,
}: ShowcaseLookRouteProps): Promise<Metadata> {
  const { lookId } = await params;
  const look = getExploreShowcaseLookPage(lookId);

  if (!look) {
    return {
      title: "Explore look | Reylumi",
    };
  }

  return {
    description: look.description,
    title: `${look.service} at ${look.salonName} | Reylumi`,
  };
}

function ShowcaseAvatar({ name }: { name: string }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-text-primary text-sm font-black text-white ring-4 ring-white">
      {name
        .replace(/[^a-z0-9\s]/gi, " ")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "R"}
    </span>
  );
}

function LookStat({
  icon,
  label,
  value,
}: {
  icon: "bookmark" | "calendar" | "image" | "share";
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 justify-items-center gap-1 rounded-[0.8rem] bg-white px-3 py-2 text-center ring-1 ring-divider-subtle/70">
      <ReylumiIcon className="h-4 w-4 text-text-secondary" name={icon} />
      <p className="text-sm font-bold text-text-primary">{value}</p>
      <p className="text-[11px] font-semibold text-text-muted">{label}</p>
    </div>
  );
}

function SlotButton({ label, selected = false }: { label: string; selected?: boolean }) {
  return (
    <button
      className={[
        "min-h-10 rounded-[0.65rem] px-3 text-xs font-bold ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
        selected
          ? "bg-text-primary text-white ring-text-primary"
          : "bg-white text-text-primary ring-divider-subtle hover:bg-surface-muted",
      ].join(" ")}
      type="button"
    >
      {label}
    </button>
  );
}

function RelatedLookCard({ item }: { item: ExploreShowcaseRelatedLook }) {
  return (
    <Link
      className="group grid overflow-hidden rounded-[0.85rem] bg-white shadow-[0_8px_22px_rgba(35,25,22,0.04)] ring-1 ring-divider-subtle/70 transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(35,25,22,0.08)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href={item.href}
    >
      <span className="relative block aspect-[4/3] overflow-hidden bg-surface-muted">
        <Image
          alt={`${item.service} from ${item.salonName}`}
          className="object-cover transition duration-500 group-hover:scale-[1.03]"
          fill
          sizes="(max-width: 768px) 50vw, 18vw"
          src={item.imageUrl}
        />
      </span>
      <span className="grid gap-1.5 p-3">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-bold text-text-primary">
            {item.salonName}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-text-secondary">
            <ReylumiIcon
              className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
              name="star"
            />
            {item.rating.toFixed(1)}
          </span>
        </span>
        <span className="truncate text-xs font-semibold text-text-primary">
          {item.service}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <span>{formatMoney(item.price)}</span>
          <span>{formatDistance(item.distanceMiles)}</span>
        </span>
      </span>
    </Link>
  );
}

function LookMediaStage({ look }: { look: ExploreShowcaseLookPage }) {
  return (
    <section className="grid gap-3 lg:grid-cols-[4.8rem_minmax(0,1fr)]">
      <div className="hidden gap-2 lg:grid">
        {look.gallery.map((item) => (
          <Link
            className={[
              "relative block aspect-square overflow-hidden rounded-[0.65rem] bg-surface-muted ring-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
              item.id === look.id
                ? "ring-brand-orange"
                : "ring-transparent hover:ring-brand-orange/35",
            ].join(" ")}
            href={item.href}
            key={item.id}
          >
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="76px"
              src={item.imageUrl}
            />
          </Link>
        ))}
      </div>
      <div className="relative overflow-hidden rounded-[1rem] bg-surface-muted shadow-[0_16px_40px_rgba(35,25,22,0.08)] ring-1 ring-divider-subtle/75">
        <div className="relative aspect-[4/3] sm:aspect-[16/10] lg:aspect-[4/3]">
          <Image
            alt={`${look.service} from ${look.salonName}`}
            className="object-cover"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 62vw"
            src={look.imageUrl}
          />
        </div>
        <Link
          aria-label="Back to Explore"
          className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/92 text-text-primary shadow-sm ring-1 ring-white/80 backdrop-blur transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href="/explore"
        >
          <ReylumiIcon className="h-4 w-4" name="chevron-left" />
        </Link>
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <button
            aria-label="Save look"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/92 text-text-primary shadow-sm ring-1 ring-white/80 backdrop-blur transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            type="button"
          >
            <ReylumiIcon className="h-5 w-5" name="heart" />
          </button>
          <button
            aria-label="Share look"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/92 text-text-primary shadow-sm ring-1 ring-white/80 backdrop-blur transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            type="button"
          >
            <ReylumiIcon className="h-5 w-5" name="share" />
          </button>
        </div>
      </div>
    </section>
  );
}

export default async function ShowcaseLookPage({
  params,
}: ShowcaseLookRouteProps) {
  const { lookId } = await params;
  const look = getExploreShowcaseLookPage(lookId);

  if (!look) {
    notFound();
  }

  const price = formatMoney(look.price);
  const duration = formatDuration(look.durationMinutes);
  const distance = formatDistance(look.distanceMiles);

  return (
    <main className="min-w-0 bg-[linear-gradient(180deg,#fffaf7_0%,#ffffff_56%)] px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(21rem,28rem)] lg:items-start">
        <div className="order-1 lg:col-start-1 lg:row-start-1">
          <LookMediaStage look={look} />
        </div>

        <aside className="order-2 grid gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <section
            className="grid gap-4 rounded-[1rem] bg-white p-4 shadow-[0_16px_42px_rgba(35,25,22,0.06)] ring-1 ring-divider-subtle/75"
            id="shop"
          >
            <div className="flex min-w-0 items-center gap-3">
              <ShowcaseAvatar name={look.salonName} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-base font-bold text-text-primary">
                  <span className="truncate">{look.salonName}</span>
                  <ReylumiIcon
                    className="h-4 w-4 shrink-0 text-sky-500"
                    name="verified"
                  />
                </p>
                <p className="mt-0.5 text-xs font-semibold text-text-secondary">
                  <span className="text-amber-500">★</span>{" "}
                  {look.rating.toFixed(1)} ({look.reviews}) · Milwaukee, WI ·{" "}
                  {distance}
                </p>
              </div>
            </div>

            <div>
              <h1 className="text-xl font-bold leading-tight text-text-primary">
                {look.service}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-text-secondary">
                <span className="text-text-primary">{price}</span>
                <span>{duration}</span>
                <span>Advanced</span>
              </p>
            </div>

            <p className="line-clamp-3 text-sm leading-6 text-text-secondary lg:line-clamp-none">
              {look.description}
            </p>

            <div className="flex flex-wrap gap-2">
              {look.tags.map((tag) => (
                <span
                  className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-text-secondary ring-1 ring-divider-subtle/70"
                  key={tag}
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="grid gap-2" id="availability">
              <p className="text-sm font-bold text-emerald-700">
                {look.availability}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
                {look.slots.map((slot, index) => (
                  <SlotButton
                    key={slot}
                    label={slot}
                    selected={index === 1}
                  />
                ))}
              </div>
            </div>

            <ShowcaseBookIntent
              availability={look.availability}
              bookingHref={look.bookingHref}
              className="w-full"
              duration={duration}
              price={price}
              salonName={look.salonName}
              service={look.service}
            />
          </section>

          <section className="rounded-[1rem] bg-white p-4 ring-1 ring-divider-subtle/70">
            <h2 className="text-sm font-bold text-text-primary">
              Share this look
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["share", "message", "image", "more"] as const).map((icon) => (
                <button
                  aria-label={icon === "more" ? "More share options" : icon}
                  className="grid h-11 w-11 place-items-center rounded-full bg-surface-muted text-text-primary ring-1 ring-divider-subtle/70 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  key={icon}
                  type="button"
                >
                  <ReylumiIcon className="h-4 w-4" name={icon} />
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className="order-3 grid gap-4 lg:col-start-1 lg:row-start-2">
          <section className="grid grid-cols-4 gap-2">
            <LookStat
              icon="bookmark"
              label="Saves"
              value={look.stats.saves.toLocaleString("en-US")}
            />
            <LookStat
              icon="calendar"
              label="Booked"
              value={look.stats.booked.toLocaleString("en-US")}
            />
            <LookStat
              icon="image"
              label="Photos"
              value={look.stats.photos.toLocaleString("en-US")}
            />
            <LookStat
              icon="share"
              label="Videos"
              value={look.stats.videos.toLocaleString("en-US")}
            />
          </section>
          <section className="rounded-[1rem] bg-white p-4 ring-1 ring-divider-subtle/70">
            <h2 className="text-sm font-bold text-text-primary">
              About this look
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {look.description}
            </p>
          </section>
        </div>
      </div>

      <section className="mx-auto mt-5 grid w-full max-w-[92rem] gap-3 pb-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">
              More looks like this
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Compare similar styles, prices, distance, and open times.
            </p>
          </div>
          <Link
            className="shrink-0 text-sm font-bold text-brand-orange transition hover:text-brand-orange-hover"
            href={look.searchHref}
          >
            View all
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {look.related.map((item) => (
            <RelatedLookCard item={item} key={item.id} />
          ))}
        </div>
      </section>
    </main>
  );
}
