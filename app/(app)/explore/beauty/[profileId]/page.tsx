import {
  getBeautyProfileRoutePage,
  type BeautyProfileRoutePage,
} from "@/lib/beauty-relationship";
import { BeautyFollowButton } from "@/app/explore/beauty/beauty-follow-button";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { ReylumiIcon } from "@/components/reylumi-icons";
import type { ExplorePersonalPostItem } from "@/types/explore";
import type { AccountSavedPostStateTarget } from "@/types/saved-post";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type PublicBeautyProfilePageProps = {
  params: Promise<{
    profileId: string;
  }>;
  searchParams: Promise<{
    customerId?: string;
  }>;
};

type DisplayMedia = {
  aspectRatio: number | null;
  height: number | null;
  id: string;
  role: "after" | "before" | "image";
  url: string;
  width: number | null;
};

type DisplayPost = {
  attribution: string | null;
  caption: string | null;
  commentCount: number;
  createdAt: string;
  href: string | null;
  id: string;
  media: DisplayMedia[];
  saveTarget: AccountSavedPostStateTarget | null;
  type: "before_after" | "regular";
};

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);

  return parts.length
    ? parts
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("")
    : "R";
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function mediaAspectRatio(media: DisplayMedia | undefined) {
  if (media?.aspectRatio && media.aspectRatio > 0) {
    return `${Math.min(1.55, Math.max(0.72, media.aspectRatio))}`;
  }

  if (media?.width && media.height && media.width > 0 && media.height > 0) {
    return `${Math.min(1.55, Math.max(0.72, media.width / media.height))}`;
  }

  return "4 / 5";
}

function postLabel(post: Pick<DisplayPost, "type">) {
  return post.type === "before_after" ? "Before & After" : "Beauty moment";
}

function publicPostToDisplayPost(post: ExplorePersonalPostItem): DisplayPost {
  return {
    attribution: post.salon?.name ?? null,
    caption: post.caption,
    commentCount: post.commentCount,
    createdAt: post.publishedAt,
    href: post.destination.href,
    id: post.id,
    media: post.media.map((media) => ({
      aspectRatio: media.aspectRatio,
      height: media.height,
      id: media.id,
      role: media.role,
      url: media.imageUrl,
      width: media.width,
    })),
    saveTarget: post.saveTarget,
    type: post.personal.postType,
  };
}

function postsForPage(page: BeautyProfileRoutePage) {
  return page.access === "public"
    ? page.publicPosts.map(publicPostToDisplayPost)
    : [];
}

function MediaTile({
  media,
  name,
  priority = false,
}: {
  media: DisplayMedia;
  name: string;
  priority?: boolean;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-surface-muted ring-1 ring-divider-subtle"
      style={{ aspectRatio: mediaAspectRatio(media) }}
    >
      <Image
        alt={`${name} Beauty media`}
        className="object-cover"
        fill
        priority={priority}
        sizes="(max-width: 768px) 92vw, 360px"
        src={media.url}
      />
    </div>
  );
}

function PostCard({
  name,
  post,
}: {
  name: string;
  post: DisplayPost;
}) {
  const before = post.media.find((media) => media.role === "before");
  const after = post.media.find((media) => media.role === "after");
  return (
    <article
      className="grid gap-3 rounded-2xl bg-surface p-3 shadow-[0_14px_36px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle"
      id={`post-${post.id}`}
    >
      <div className="relative">
        {post.href ? (
          <Link
            aria-label={`Open ${postLabel(post)} by ${name}`}
            className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={post.href}
          >
            {post.type === "before_after" && before && after ? (
              <div className="grid grid-cols-2 gap-2">
                <MediaTile media={before} name={name} />
                <MediaTile media={after} name={name} />
              </div>
            ) : (
              <div className="grid gap-2">
                {post.media.slice(0, 4).map((media, index) => (
                  <MediaTile
                    key={media.id}
                    media={media}
                    name={name}
                    priority={index === 0}
                  />
                ))}
              </div>
            )}
          </Link>
        ) : post.type === "before_after" && before && after ? (
          <div className="grid grid-cols-2 gap-2">
            <MediaTile media={before} name={name} />
            <MediaTile media={after} name={name} />
          </div>
        ) : (
          <div className="grid gap-2">
            {post.media.slice(0, 4).map((media, index) => (
              <MediaTile
                key={media.id}
                media={media}
                name={name}
                priority={index === 0}
              />
            ))}
          </div>
        )}
        {post.saveTarget ? (
          <SavePostButton
            className="absolute bottom-3 right-3"
            initialSaved={post.saveTarget.saved}
            target={post.saveTarget}
          />
        ) : null}
      </div>
      <div className="grid gap-2 px-1 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-brand-orange-soft px-3 py-1 text-xs font-extrabold text-brand-orange">
            {postLabel(post)}
          </span>
          <span className="text-xs font-bold text-text-muted">
            {formatDate(post.createdAt)}
          </span>
        </div>
        {post.caption ? (
          post.href ? (
            <Link
              className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={post.href}
            >
              <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary transition hover:text-brand-orange">
                {post.caption}
              </p>
            </Link>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">
              {post.caption}
            </p>
          )
        ) : null}
        {post.attribution ? (
          <p className="text-xs font-bold text-text-muted">{post.attribution}</p>
        ) : null}
        {post.href ? (
          <Link
            className="w-fit rounded-full bg-surface-muted px-3 py-1.5 text-xs font-extrabold text-text-secondary transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={`${post.href}#comments`}
          >
            {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function ProfileStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="grid justify-items-center gap-1">
      <span className="text-base font-semibold text-text-primary">{value}</span>
      <span className="text-[11px] font-semibold text-text-muted">{label}</span>
    </div>
  );
}

function ProfileActionRow({
  icon,
  label,
  value,
}: {
  icon: "bookmark" | "calendar" | "heart" | "star" | "user";
  label: string;
  value?: string;
}) {
  return (
    <button
      className="flex min-h-12 w-full items-center gap-3 border-t border-divider-subtle/70 px-1 text-left transition hover:text-brand-orange"
      type="button"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-muted text-text-secondary">
        <ReylumiIcon className="h-4 w-4" name={icon} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
        {label}
      </span>
      {value ? (
        <span className="text-xs font-semibold text-text-muted">{value}</span>
      ) : null}
      <span aria-hidden className="text-text-muted">
        &rsaquo;
      </span>
    </button>
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicBeautyProfilePageProps): Promise<Metadata> {
  const [{ profileId }, { customerId }] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = await getBeautyProfileRoutePage({ customerId, profileId });

  if (!page) {
    return {
      title: "Beauty profile not found | Reylumi",
    };
  }

  if (page.access === "private_relationship") {
    return {
      description: "This Beauty profile is private.",
      title: "Private Beauty profile | Reylumi",
    };
  }

  return {
    description:
      page.profile.bio ?? `${page.profile.displayName}'s Beauty profile on Reylumi.`,
    title: `${page.profile.displayName} | Reylumi Beauty`,
  };
}

export default async function PublicBeautyProfilePage({
  params,
  searchParams,
}: PublicBeautyProfilePageProps) {
  const [{ profileId }, { customerId }] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = await getBeautyProfileRoutePage({ customerId, profileId });

  if (!page) {
    notFound();
  }

  const posts = postsForPage(page);
  const profile = page.profile;
  const savedLookCount = posts.reduce(
    (total, post) => total + (post.saveTarget?.saveCount ?? 0),
    0,
  );
  const reviewActivityCount = posts.reduce(
    (total, post) => total + post.commentCount,
    0,
  );

  if (page.access === "private_relationship") {
    return (
      <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-3xl gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-text-primary shadow-sm ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/explore"
            >
              Explore
            </Link>
            <Link
              className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-text-primary shadow-sm ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={`/customers/${page.customerId}`}
            >
              Customer details
            </Link>
          </div>
          <section className="rounded-3xl bg-surface p-8 text-center shadow-[0_18px_48px_rgba(35,25,22,0.06)] ring-1 ring-divider-subtle sm:p-10">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-orange-soft text-2xl font-extrabold text-brand-orange">
              {profile.initials}
            </div>
            <p className="mt-5 text-xl font-extrabold text-text-primary">
              This Beauty profile is private.
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
              This customer has a ReyLUMI Beauty identity, but their Beauty
              content is not visible to salons.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fffaf7] px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <section className="overflow-hidden rounded-[1.1rem] bg-white shadow-[0_18px_48px_rgba(35,25,22,0.06)] ring-1 ring-divider-subtle/80">
          <div className="relative h-32 bg-brand-orange-soft sm:h-44 lg:h-52">
            {profile.coverImageUrl ? (
              <Image
                alt={`${profile.displayName} Beauty cover`}
                className="object-cover"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 1120px"
                src={profile.coverImageUrl}
              />
            ) : posts[0]?.media[0] ? (
              <Image
                alt={`${profile.displayName} Beauty cover`}
                className="object-cover"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 1120px"
                src={posts[0].media[0].url}
              />
            ) : (
              <div className="h-full w-full bg-[linear-gradient(135deg,var(--brand-orange-soft),var(--surface-muted))]" />
            )}
            <Link
              aria-label="Back to Explore"
              className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/92 text-text-primary shadow-sm ring-1 ring-white/80 backdrop-blur transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={{ pathname: "/explore" }}
            >
              <ReylumiIcon className="h-4 w-4" name="chevron-left" />
            </Link>
          </div>
          <div className="grid gap-4 px-4 pb-5 sm:px-6">
            <div className="-mt-10 grid justify-items-center gap-3 text-center sm:-mt-12">
              <span className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-full border-4 border-white bg-brand-orange-soft text-2xl font-semibold text-brand-orange shadow-sm">
                {profile.avatarUrl ? (
                  <Image
                    alt={`${profile.displayName} profile`}
                    className="object-cover"
                    fill
                    sizes="96px"
                    src={profile.avatarUrl}
                  />
                ) : (
                  initialsFor(profile.displayName)
                )}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-normal text-text-primary sm:text-3xl">
                  {profile.displayName}
                </h1>
                <p className="mt-1 text-sm font-medium text-text-secondary">
                  Milwaukee, WI
                </p>
              </div>
              <div className="grid w-full max-w-md grid-cols-4 gap-3 rounded-[1rem] bg-white px-2 py-3 ring-1 ring-divider-subtle/70">
                <ProfileStat label="Looks" value={posts.length} />
                <ProfileStat label="Saved" value={savedLookCount} />
                <ProfileStat label="Reviews" value={reviewActivityCount} />
                <ProfileStat label="Followers" value={profile.followerCount} />
              </div>
              {!profile.isSelf ? (
                <BeautyFollowButton
                  followerCount={profile.followerCount}
                  initialFollowing={profile.isFollowing}
                  profileId={profile.id}
                />
              ) : null}
            </div>
            {profile.bio ? (
              <p className="mx-auto max-w-xl text-center text-sm leading-6 text-text-secondary">
                {profile.bio}
              </p>
            ) : null}
            <div className="mx-auto grid w-full max-w-md">
              <ProfileActionRow
                icon="calendar"
                label="Upcoming bookings"
                value="Browse"
              />
              <ProfileActionRow
                icon="bookmark"
                label="Saved looks"
                value={String(savedLookCount)}
              />
              <ProfileActionRow
                icon="star"
                label="Reviews"
                value={String(reviewActivityCount)}
              />
              <ProfileActionRow
                icon="heart"
                label="Followers"
                value={String(profile.followerCount)}
              />
            </div>
          </div>
        </section>

        {posts.length > 0 ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} name={profile.displayName} post={post} />
            ))}
          </section>
        ) : (
          <section className="rounded-[1rem] border border-dashed border-divider-subtle bg-white p-8 text-center">
            <p className="text-sm font-semibold text-text-primary">
              No Beauty posts yet
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              This profile is ready, but there is no social content to show.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
