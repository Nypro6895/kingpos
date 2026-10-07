
import Form from "next/form";
import { SubmitButton } from "@/components/submit-button";
import {
  getAccountFollowing,
  getAccountSavedPosts,
  removeAccountBeautyProfileFollow,
  removeAccountFavoriteShop,
  removeAccountSavedPost,
  type AccountFollowingFilter,
  type AccountFollowingItem,
  type AccountSavedPost,
} from "@/lib/account-social";
import { getCurrentBusinessContext } from "@/lib/current-context";
import type {
  AccountSavedPostFilter,
  AccountSavedPostSourceType,
} from "@/types/saved-post";
import styles from "./saved-posts.module.css";
import { revalidatePath } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type MoreSectionSearchParams = {
  filter?: string | string[];
  page?: string | string[];
  q?: string | string[];
};

type MoreSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
  searchParams?: Promise<MoreSectionSearchParams>;
};

type MoreSection = {
  actionHref: string;
  actionLabel: string;
  description: string;
};

const MORE_SECTIONS: Record<string, MoreSection> = {
  memberships: {
    actionHref: "/explore",
    actionLabel: "Browse salons",
    description:
      "Customer memberships will appear here when they are available for your account.",
  },
  reviews: {
    actionHref: "/explore",
    actionLabel: "Explore salons",
    description:
      "Reviews posted from your customer account will appear here.",
  },
  "gift-cards": {
    actionHref: "/more",
    actionLabel: "Back to More",
    description:
      "Gift card balances and history will appear here when they are available.",
  },
  reports: {
    actionHref: "/notifications",
    actionLabel: "Open notifications",
    description:
      "Support updates tied to your customer account will appear here when they are available.",
  },
};
const SAVED_POST_PAGE_SIZE = 10;
const SAVED_POST_FILTERS: Array<{
  label: string;
  value: AccountSavedPostFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Beauty posts", value: "beauty_post" },
  { label: "Salon looks", value: "salon_profile_look" },
  { label: "Salon updates", value: "salon_profile_update" },
];
const FOLLOWING_PAGE_SIZE = 10;
const FOLLOWING_FILTERS: Array<{
  label: string;
  value: AccountFollowingFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Shops", value: "shop" },
  { label: "Beauty", value: "beauty" },
];

function normalizeSection(section: string) {
  if (section === "saved-designs") {
    return "saved-post";
  }

  return section;
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSavedPostPage(value: string | undefined) {
  const page = Number.parseInt(value ?? "", 10);

  return Number.isFinite(page) ? Math.max(1, page) : 1;
}

function parseSavedPostFilter(value: string | undefined): AccountSavedPostFilter {
  if (
    value === "beauty_post" ||
    value === "salon_profile_look" ||
    value === "salon_profile_update"
  ) {
    return value;
  }

  return "all";
}

function savedPostHref(input: {
  filter: AccountSavedPostFilter;
  page: number;
  query: string;
}) {
  const params = new URLSearchParams();

  if (input.query) {
    params.set("q", input.query);
  }

  if (input.filter !== "all") {
    params.set("filter", input.filter);
  }

  if (input.page > 1) {
    params.set("page", String(input.page));
  }

  const queryString = params.toString();

  return queryString ? `/more/saved-post?${queryString}` : "/more/saved-post";
}

function parseFollowingFilter(value: string | undefined): AccountFollowingFilter {
  return value === "beauty" || value === "shop" ? value : "all";
}

function followingHref(input: {
  filter: AccountFollowingFilter;
  page: number;
  query: string;
}) {
  const params = new URLSearchParams();

  if (input.query) {
    params.set("q", input.query);
  }

  if (input.filter !== "all") {
    params.set("filter", input.filter);
  }

  if (input.page > 1) {
    params.set("page", String(input.page));
  }

  const queryString = params.toString();

  return queryString ? `/more/following?${queryString}` : "/more/following";
}

async function removeSavedPostAction(formData: FormData) {
  "use server";

  const sourceType = readFormString(formData, "source_type") as
    | AccountSavedPostSourceType
    | "";
  const sourceId = readFormString(formData, "source_id");
  const salonId = readFormString(formData, "salon_id");

  if (sourceType && sourceId) {
    await removeAccountSavedPost({
      salonId,
      sourceId,
      sourceType,
    });
    revalidatePath("/more/saved-post");
    revalidatePath("/more/saved-designs");
  }
}

async function removeFollowingAction(formData: FormData) {
  "use server";

  const targetType = readFormString(formData, "target_type");
  const targetId = readFormString(formData, "target_id");

  if (targetType === "shop" && targetId) {
    await removeAccountFavoriteShop(targetId);
    revalidatePath("/more/favorite-shop");
    revalidatePath("/more/following");
    revalidatePath(`/explore/salons/${targetId}`);
  }

  if (targetType === "beauty" && targetId) {
    await removeAccountBeautyProfileFollow(targetId);
    revalidatePath("/more/favorite-customer");
    revalidatePath("/more/following");
    revalidatePath(`/explore/beauty/${targetId}`);
  }
}

function BackLink() {
  return (
    <Link
      className="w-fit rounded-full px-2 py-1 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href="/more"
    >
      Back to More
    </Link>
  );
}

function EmptyState({
  actionHref,
  actionLabel,
  description,
}: MoreSection) {
  return (
    <section className="content-surface grid gap-4 border-border-subtle bg-surface px-5 py-8 text-center rounded-none border-y shadow-none">
      <p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">
        {description}
      </p>
      <Link
        className="mx-auto inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#ef5d28] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href={actionHref}
      >
        {actionLabel}
      </Link>
    </section>
  );
}


function SavedPostCard({ post, index }: { post: AccountSavedPost; index: number }) {
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        <Link
          className={styles.thumbnail}
          style={{ aspectRatio: ["4 / 5", "1 / 1", "3 / 4"][index % 3] }}
          href={post.href}
          aria-label={`View ${post.title}`}
        >
          {post.imageUrl ? (
            <Image
              alt={post.title}
              className={styles.image}
              fill
              sizes="(min-width: 768px) 280px, 50vw"
              src={post.imageUrl}
            />
          ) : (
            <span className={styles.fallback}>{post.title}</span>
          )}
          <span className={styles.badge}>{post.contentLabel}</span>
        </Link>
        <form action={removeSavedPostAction} className={styles.removeForm}>
          <input name="source_type" type="hidden" value={post.sourceType} />
          <input name="source_id" type="hidden" value={post.sourceId} />
          <input name="salon_id" type="hidden" value={post.salonId ?? ""} />
          <SubmitButton pendingLabel="Processing…" type="submit" className={styles.remove} aria-label={`Remove ${post.title} from saved posts`} title="Remove from saved posts">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 4h12v17l-6-4-6 4V4Z" strokeLinejoin="round" />
            </svg>
          </SubmitButton>
        </form>
      </div>
      <Link href={post.href} className={styles.caption}>
        <h2>{post.title}</h2>
        {post.salonName ? <p>{post.salonName}</p> : null}
      </Link>
    </article>
  );
}

function followingTypeLabel(item: AccountFollowingItem) {
  return item.targetType === "beauty" ? "Beauty" : "Shop";
}

function FollowingRow({ item }: { item: AccountFollowingItem }) {
  return (
    <article className={styles.followingRow}>
      <Link className={styles.followingProfile} href={item.href}>
        <span className={styles.avatar}>
          {item.imageUrl ? (
            <Image alt="" className="object-cover" fill sizes="52px" src={item.imageUrl} />
          ) : item.name.slice(0, 1)}
        </span>
        <div className={styles.profileInfo}>
          <h2>{item.name}</h2>
          <span className={styles.profileType}>{followingTypeLabel(item)}</span>
          {item.secondaryLabel ? <span className={styles.profileDetail}>{item.secondaryLabel}</span> : null}
        </div>
      </Link>
      <form action={removeFollowingAction}>
        <input name="target_type" type="hidden" value={item.targetType} />
        <input name="target_id" type="hidden" value={item.targetId} />
        <SubmitButton pendingLabel="Processing…" type="submit" className={styles.unfollow} aria-label={`Unfollow ${item.name}`}>Unfollow</SubmitButton>
      </form>
    </article>
  );
}

function SavedPostControls({ filter, query }: { filter: AccountSavedPostFilter; query: string }) {
  return (
    <div className={styles.controls}>
      <Form action="/more/saved-post" className={styles.search} role="search">
        <label className="sr-only" htmlFor="saved-post-search">Search saved posts</label>
        <input id="saved-post-search" defaultValue={query} name="q" placeholder="Search your saved posts" type="search" />
        <input type="hidden" name="filter" value={filter} />
        <SubmitButton pendingLabel="Processing…" type="submit" aria-label="Search saved posts">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
          </svg>
        </SubmitButton>
      </Form>
      <nav className={styles.filters} aria-label="Saved post filters">
        {SAVED_POST_FILTERS.map((option) => (
          <Link key={option.value} href={savedPostHref({ filter: option.value, page: 1, query })} className={styles.filter} aria-current={filter === option.value ? "page" : undefined}>
            {option.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function SavedPostPagination({
  filter,
  hasNext,
  page,
  query,
}: {
  filter: AccountSavedPostFilter;
  hasNext: boolean;
  page: number;
  query: string;
}) {
  if (page <= 1 && !hasNext) {
    return null;
  }

  return (
    <nav
      aria-label="Saved posts pages"
      className="flex flex-wrap items-center justify-between gap-3 border-y border-border-subtle bg-surface p-3 text-sm font-bold text-text-secondary"
    >
      <Link
        aria-disabled={page <= 1}
        className={[
          "inline-flex min-h-10 items-center rounded-full px-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
          page <= 1
            ? "pointer-events-none bg-surface-muted text-text-muted"
            : "bg-surface-muted text-text-primary hover:text-brand-orange",
        ].join(" ")}
        href={savedPostHref({ filter, page: Math.max(1, page - 1), query })}
      >
        Previous
      </Link>
      <span>Page {page}</span>
      <Link
        aria-disabled={!hasNext}
        className={[
          "inline-flex min-h-10 items-center rounded-full px-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
          !hasNext
            ? "pointer-events-none bg-surface-muted text-text-muted"
            : "bg-brand-orange text-white hover:bg-brand-orange-hover",
        ].join(" ")}
        href={savedPostHref({ filter, page: page + 1, query })}
      >
        Next
      </Link>
    </nav>
  );
}

function SavedPostsSection({
  filter,
  hasNext,
  page,
  posts,
  query,
}: {
  filter: AccountSavedPostFilter;
  hasNext: boolean;
  page: number;
  posts: AccountSavedPost[];
  query: string;
}) {
  if (posts.length === 0) {
    return (
      <div className="grid gap-3">
        <SavedPostControls filter={filter} query={query} />
        <EmptyState
          actionHref="/explore"
          actionLabel="Explore salons"
          description={
            query || filter !== "all"
              ? "No saved posts match this search or filter."
              : "Saved posts will appear here from Personal, Staff, and Owner."
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <SavedPostControls filter={filter} query={query} />
      <section className={styles.gallery} aria-label="Saved posts">
        {posts.map((post, index) => (
          <SavedPostCard key={post.id} post={post} index={index} />
        ))}
      </section>
      <SavedPostPagination
        filter={filter}
        hasNext={hasNext}
        page={page}
        query={query}
      />
    </div>
  );
}

function FollowingControls({ filter, query }: { filter: AccountFollowingFilter; query: string }) {
  return (
    <div className={styles.controls}>
      <Form action="/more/following" className={styles.search} role="search">
        <label className="sr-only" htmlFor="following-search">Search following</label>
        <input id="following-search" defaultValue={query} name="q" placeholder="Search people and shops" type="search" />
        <input type="hidden" name="filter" value={filter} />
        <SubmitButton pendingLabel="Processing…" type="submit" aria-label="Search following">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
          </svg>
        </SubmitButton>
      </Form>
      <nav className={styles.filters} aria-label="Following filters">
        {FOLLOWING_FILTERS.map((option) => (
          <Link key={option.value} href={followingHref({ filter: option.value, page: 1, query })} className={styles.filter} aria-current={filter === option.value ? "page" : undefined}>
            {option.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function FollowingPagination({
  filter,
  page,
  query,
  totalPages,
}: {
  filter: AccountFollowingFilter;
  page: number;
  query: string;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Following pages"
      className="flex flex-wrap items-center justify-between gap-3 border-y border-border-subtle bg-surface p-3 text-sm font-bold text-text-secondary"
    >
      <Link
        aria-disabled={page <= 1}
        className={[
          "inline-flex min-h-10 items-center rounded-full px-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
          page <= 1
            ? "pointer-events-none bg-surface-muted text-text-muted"
            : "bg-surface-muted text-text-primary hover:text-brand-orange",
        ].join(" ")}
        href={followingHref({ filter, page: Math.max(1, page - 1), query })}
      >
        Previous
      </Link>
      <span>
        Page {page} of {totalPages}
      </span>
      <Link
        aria-disabled={page >= totalPages}
        className={[
          "inline-flex min-h-10 items-center rounded-full px-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
          page >= totalPages
            ? "pointer-events-none bg-surface-muted text-text-muted"
            : "bg-brand-orange text-white hover:bg-brand-orange-hover",
        ].join(" ")}
        href={followingHref({ filter, page: page + 1, query })}
      >
        Next
      </Link>
    </nav>
  );
}

function FollowingSection({
  filter,
  items,
  page,
  query,
  totalPages,
}: {
  filter: AccountFollowingFilter;
  items: AccountFollowingItem[];
  page: number;
  query: string;
  totalPages: number;
}) {
  if (items.length === 0) {
    return (
      <div className="grid gap-3">
        <FollowingControls filter={filter} query={query} />
        <EmptyState
          actionHref={query || filter !== "all" ? "/more/following" : "/explore"}
          actionLabel={query || filter !== "all" ? "Clear filters" : "Explore"}
          description={
            query || filter !== "all"
              ? "No followed shops or Beauty profiles match this search."
              : "Followed shops and Beauty profiles will appear here."
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <FollowingControls filter={filter} query={query} />
      <section className={styles.followingList} aria-label="Following">
        {items.map((item) => (
          <FollowingRow item={item} key={item.id} />
        ))}
      </section>
      <FollowingPagination
        filter={filter}
        page={page}
        query={query}
        totalPages={totalPages}
      />
    </div>
  );
}

export default async function MoreSectionPage({
  params,
  searchParams,
}: MoreSectionPageProps) {
  const [{ section }, rawSearchParams, context] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<MoreSectionSearchParams>({}),
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect(`/login?next=/more/${encodeURIComponent(section)}`);
  }

  const normalizedSection = normalizeSection(section);

  if (normalizedSection === "saved-post") {
    const savedPostQuery = stringParam(rawSearchParams.q)?.trim() ?? "";
    const filter = parseSavedPostFilter(stringParam(rawSearchParams.filter));
    const page = parseSavedPostPage(stringParam(rawSearchParams.page));
    const postsPlusOne = await getAccountSavedPosts({
      filter,
      limit: SAVED_POST_PAGE_SIZE + 1,
      offset: (page - 1) * SAVED_POST_PAGE_SIZE,
      query: savedPostQuery,
    });
    const posts = postsPlusOne.slice(0, SAVED_POST_PAGE_SIZE);
    const hasNext = postsPlusOne.length > SAVED_POST_PAGE_SIZE;

    return (
      <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-4xl gap-5">
          <BackLink />
          <SavedPostsSection
            filter={filter}
            hasNext={hasNext}
            page={page}
            posts={posts}
            query={savedPostQuery}
          />
        </div>
      </main>
    );
  }

  if (section === "favorite-shop" || section === "favorite-customer") {
    const legacyQuery = stringParam(rawSearchParams.q)?.trim() ?? "";

    redirect(
      followingHref({
        filter: section === "favorite-shop" ? "shop" : "beauty",
        page: 1,
        query: legacyQuery,
      }),
    );
  }

  if (normalizedSection === "following") {
    const followingQuery = stringParam(rawSearchParams.q)?.trim() ?? "";
    const filter = parseFollowingFilter(stringParam(rawSearchParams.filter));
    const page = parseSavedPostPage(stringParam(rawSearchParams.page));
    const following = await getAccountFollowing({
      filter,
      page,
      pageSize: FOLLOWING_PAGE_SIZE,
      query: followingQuery,
    });

    if (following.totalCount > 0 && page > following.totalPages) {
      redirect(
        followingHref({
          filter,
          page: following.totalPages,
          query: followingQuery,
        }),
      );
    }

    return (
      <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-4xl gap-5">
          <BackLink />
          <FollowingSection
            filter={filter}
            items={following.items}
            page={following.page}
            query={following.query}
            totalPages={following.totalPages}
          />
        </div>
      </main>
    );
  }

  const content = MORE_SECTIONS[normalizedSection];

  if (!content) {
    notFound();
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <BackLink />
        <EmptyState {...content} />
      </div>
    </main>
  );
}
