import {
  getBeautyProfileRoutePage,
  type BeautyProfileRoutePage,
} from "@/lib/beauty-relationship";
import { BeautyFollowButton } from "@/app/explore/beauty/beauty-follow-button";
import { SavePostButton } from "@/app/saved-post/save-post-button";
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
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-text-primary shadow-sm ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href="/explore"
          >
            Explore
          </Link>
        </div>

        <section className="overflow-hidden rounded-[1.5rem] bg-surface shadow-[0_18px_48px_rgba(35,25,22,0.06)] ring-1 ring-divider-subtle">
          <div className="relative h-36 bg-brand-orange-soft sm:h-48">
            {profile.coverImageUrl ? (
              <Image
                alt={`${profile.displayName} Beauty cover`}
                className="object-cover"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 1024px"
                src={profile.coverImageUrl}
              />
            ) : (
              <div className="h-full w-full bg-[linear-gradient(135deg,var(--brand-orange-soft),var(--surface-muted))]" />
            )}
          </div>
          <div className="grid gap-4 px-4 pb-5 sm:px-6">
            <div className="-mt-10 flex flex-wrap items-end justify-between gap-4">
              <span className="grid h-24 w-24 place-items-center overflow-hidden rounded-full border-4 border-white bg-brand-orange-soft text-2xl font-extrabold text-brand-orange shadow-sm">
                {profile.avatarUrl ? (
                  <Image
                    alt={`${profile.displayName} profile`}
                    className="object-cover"
                    fill={false}
                    height={96}
                    src={profile.avatarUrl}
                    width={96}
                  />
                ) : (
                  initialsFor(profile.displayName)
                )}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-teal-soft px-3 py-1 text-xs font-extrabold text-brand-teal">
                  Public Beauty profile
                </span>
                {!profile.isSelf ? (
                  <BeautyFollowButton
                    followerCount={profile.followerCount}
                    initialFollowing={profile.isFollowing}
                    profileId={profile.id}
                  />
                ) : null}
              </div>
            </div>
            <div className="max-w-2xl">
              <h1 className="text-3xl font-extrabold tracking-normal text-text-primary sm:text-4xl">
                {profile.displayName}
              </h1>
              {profile.bio ? (
                <p className="mt-2 text-sm leading-6 text-text-secondary sm:text-base">
                  {profile.bio}
                </p>
              ) : null}
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
          <section className="rounded-2xl border border-dashed border-divider-subtle bg-surface p-8 text-center">
            <p className="text-sm font-extrabold text-text-primary">
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
