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
    <section className="grid gap-4 rounded-2xl border border-dashed border-border-subtle bg-surface px-5 py-8 text-center shadow-sm">
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

function RemoveButton({ children }: { children: string }) {
  return (
    <button
      className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/40 hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      type="submit"
    >
      {children}
    </button>
  );
}

function SavedPostCard({ post }: { post: AccountSavedPost }) {
  return (
    <article className="grid gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-sm sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <Link
        className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-surface-muted"
        href={post.href}
      >
        {post.imageUrl ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="(min-width: 640px) 7.5rem, calc(100vw - 2.5rem)"
            src={post.imageUrl}
          />
        ) : null}
      </Link>
      <div className="grid min-w-0 content-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase text-brand-orange">
            {[post.contentLabel, post.salonName].filter(Boolean).join(" / ")}
          </p>
          <h2 className="mt-1 line-clamp-2 text-lg font-extrabold text-text-primary">
            {post.title}
          </h2>
          {post.caption ? (
            <p className="mt-1 line-clamp-2 text-sm font-semibold text-text-secondary">
              {post.caption}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={post.href}
          >
            View
          </Link>
          <form action={removeSavedPostAction}>
            <input name="source_type" type="hidden" value={post.sourceType} />
            <input name="source_id" type="hidden" value={post.sourceId} />
            <input name="salon_id" type="hidden" value={post.salonId ?? ""} />
            <RemoveButton>Remove</RemoveButton>
          </form>
        </div>
      </div>
    </article>
  );
}

function followingTypeLabel(item: AccountFollowingItem) {
  return item.targetType === "beauty" ? "Beauty" : "Shop";
}

function FollowingRow({ item }: { item: AccountFollowingItem }) {
  return (
    <article className="grid min-h-[84px] gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <Link
        className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-surface-muted text-sm font-extrabold text-brand-orange ring-1 ring-divider-subtle"
        href={item.href}
      >
        {item.imageUrl ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="56px"
            src={item.imageUrl}
          />
        ) : (
          followingTypeLabel(item).slice(0, 1)
        )}
      </Link>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase text-brand-orange">
          {followingTypeLabel(item)}
        </p>
        <h2 className="mt-1 truncate text-base font-extrabold text-text-primary sm:text-lg">
          {item.name}
        </h2>
        {item.secondaryLabel ? (
          <p className="mt-1 truncate text-sm font-semibold text-text-secondary">
            {item.secondaryLabel}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={item.href}
        >
          View
        </Link>
        <form action={removeFollowingAction}>
          <input name="target_type" type="hidden" value={item.targetType} />
          <input name="target_id" type="hidden" value={item.targetId} />
          <RemoveButton>Unfollow</RemoveButton>
        </form>
      </div>
    </article>
  );
}

function SavedPostControls({
  filter,
  query,
}: {
  filter: AccountSavedPostFilter;
  query: string;
}) {
  return (
    <form
      action="/more/saved-post"
      className="grid gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
    >
      <label className="grid gap-1.5">
        <span className="text-xs font-bold uppercase text-text-secondary">
          Search
        </span>
        <input
          className="min-h-11 rounded-xl border border-border-subtle bg-surface-muted px-3 text-sm font-semibold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
          defaultValue={query}
          name="q"
          placeholder="Search saved posts"
          type="search"
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-bold uppercase text-text-secondary">
          Filter
        </span>
        <select
          className="min-h-11 rounded-xl border border-border-subtle bg-surface-muted px-3 text-sm font-semibold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
          defaultValue={filter}
          name="filter"
        >
          {SAVED_POST_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="min-h-11 self-end rounded-full bg-brand-orange px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        type="submit"
      >
        Search
      </button>
    </form>
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
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-3 text-sm font-bold text-text-secondary shadow-sm ring-1 ring-border-subtle"
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
      <section className="grid gap-3" aria-label="Saved posts">
        {posts.map((post) => (
          <SavedPostCard key={post.id} post={post} />
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

function FollowingControls({
  filter,
  query,
}: {
  filter: AccountFollowingFilter;
  query: string;
}) {
  return (
    <form
      action="/more/following"
      className="grid gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
    >
      <label className="grid gap-1.5">
        <span className="text-xs font-bold uppercase text-text-secondary">
          Search
        </span>
        <input
          className="min-h-11 rounded-xl border border-border-subtle bg-surface-muted px-3 text-sm font-semibold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
          defaultValue={query}
          name="q"
          placeholder="Search following"
          type="search"
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-bold uppercase text-text-secondary">
          Filter
        </span>
        <select
          className="min-h-11 rounded-xl border border-border-subtle bg-surface-muted px-3 text-sm font-semibold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
          defaultValue={filter}
          name="filter"
        >
          {FOLLOWING_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="min-h-11 self-end rounded-full bg-brand-orange px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        type="submit"
      >
        Search
      </button>
    </form>
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
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-3 text-sm font-bold text-text-secondary shadow-sm ring-1 ring-border-subtle"
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
      <section className="grid gap-3" aria-label="Following">
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
