"use client";
// Full shipped customer list presentation; commands use exact account-authorized wrappers.
import Link from "next/link";
import Image from "next/image";
import Form from "next/form";
import {WorkspaceLink} from "@/components/workspace-link";
import {WorkspaceText,WorkspaceElement} from "@/components/workspace-language";
import {SubmitButton} from "@/components/submit-button";
import {removeAppLocalSavedPostAction as removeSavedPostAction,removeAppLocalFollowingAction as removeFollowingAction} from "@/app/local-app/customer-social-actions";
import type {AccountFollowingFilter,AccountFollowingItem,AccountSavedPost} from "@/lib/account-social";
import type {AccountSavedPostFilter} from "@/types/saved-post";
import type {AppLocalSavedPostsData,AppLocalFollowingData,AppLocalFavoritesData} from "@/lib/app-local-platform-types";
import {SavedSalonList} from "@/components/saved-salon-list";
import {ExploreReferenceLove} from "@/components/explore-account-actions";
import {nailLookById} from "@/lib/nail-inspiration-catalog";
import {NailInspirationCard} from "@/app/explore/nail-inspiration";
import styles from "@/app/(app)/more/[section]/saved-posts.module.css";
type MoreSection={actionHref:string;actionLabel:string;description:string};
const SAVED_POST_FILTERS: Array<{
  label: string;
  value: AccountSavedPostFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Beauty posts", value: "beauty_post" },
  { label: "Salon looks", value: "salon_profile_look" },
  { label: "Salon updates", value: "salon_profile_update" },
];
const FOLLOWING_FILTERS: Array<{
  label: string;
  value: AccountFollowingFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Shops", value: "shop" },
  { label: "Beauty", value: "beauty" },
];

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

function BackLink() {
  return (
    <Link
      className="w-fit rounded-full px-2 py-1 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href="/more"
    >
      <WorkspaceText text="Back to More" />
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
        <WorkspaceText text={actionLabel} />
      </Link>
    </section>
  );
}


function SavedPostCard({ post, index }: { post: AccountSavedPost; index: number }) {
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        <WorkspaceLink
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
        </WorkspaceLink>
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
          <span className={styles.profileType}><WorkspaceText text={followingTypeLabel(item)} /></span>
          {item.secondaryLabel ? <span className={styles.profileDetail}>{item.secondaryLabel}</span> : null}
        </div>
      </Link>
      <form action={removeFollowingAction}>
        <input name="target_type" type="hidden" value={item.targetType} />
        <input name="target_id" type="hidden" value={item.targetId} />
        <SubmitButton pendingLabel="Processing…" type="submit" className={styles.unfollow} aria-label={`Unfollow ${item.name}`}><WorkspaceText text="Unfollow" /></SubmitButton>
      </form>
    </article>
  );
}

function SavedPostControls({ filter, query }: { filter: AccountSavedPostFilter; query: string }) {
  return (
    <div className={styles.controls}>
      <Form action="/more/saved-post" className={styles.search} role="search">
        <label className="sr-only" htmlFor="saved-post-search"><WorkspaceText text="Search saved posts" /></label>
        <WorkspaceElement as="input" id="saved-post-search" defaultValue={query} name="q" placeholder="Search your saved posts" type="search" />
        <input type="hidden" name="filter" value={filter} />
        <SubmitButton pendingLabel="Processing…" type="submit" aria-label="Search saved posts">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
          </svg>
        </SubmitButton>
      </Form>
      <WorkspaceElement as="nav" className={styles.filters} aria-label="Saved post filters">
        {SAVED_POST_FILTERS.map((option) => (
          <Link key={option.value} href={savedPostHref({ filter: option.value, page: 1, query })} className={styles.filter} aria-current={filter === option.value ? "page" : undefined}>
            <WorkspaceText text={option.label} />
          </Link>
        ))}
      </WorkspaceElement>
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
    <WorkspaceElement as="nav"
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
        <WorkspaceText text="Previous" />
      </Link>
      <span><WorkspaceText text="Page" /> {page}</span>
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
        <WorkspaceText text="Next" />
      </Link>
    </WorkspaceElement>
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
      <WorkspaceElement as="section" className={styles.gallery} aria-label="Saved posts">
        {posts.map((post, index) => (
          <SavedPostCard key={post.id} post={post} index={index} />
        ))}
      </WorkspaceElement>
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
        <label className="sr-only" htmlFor="following-search"><WorkspaceText text="Search following" /></label>
        <WorkspaceElement as="input" id="following-search" defaultValue={query} name="q" placeholder="Search people and shops" type="search" />
        <input type="hidden" name="filter" value={filter} />
        <SubmitButton pendingLabel="Processing…" type="submit" aria-label="Search following">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
          </svg>
        </SubmitButton>
      </Form>
      <WorkspaceElement as="nav" className={styles.filters} aria-label="Following filters">
        {FOLLOWING_FILTERS.map((option) => (
          <Link key={option.value} href={followingHref({ filter: option.value, page: 1, query })} className={styles.filter} aria-current={filter === option.value ? "page" : undefined}>
            <WorkspaceText text={option.label} />
          </Link>
        ))}
      </WorkspaceElement>
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
    <WorkspaceElement as="nav"
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
        <WorkspaceText text="Previous" />
      </Link>
      <span>
        <WorkspaceText text="Page" /> {page} <WorkspaceText text="of" /> {totalPages}
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
        <WorkspaceText text="Next" />
      </Link>
    </WorkspaceElement>
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
      <WorkspaceElement as="section" className={styles.followingList} aria-label="Following">
        {items.map((item) => (
          <FollowingRow item={item} key={item.id} />
        ))}
      </WorkspaceElement>
      <FollowingPagination
        filter={filter}
        page={page}
        query={query}
        totalPages={totalPages}
      />
    </div>
  );
}


export function AppLocalSavedPosts({data}:{data:AppLocalSavedPostsData}){return <main className="mx-auto grid max-w-6xl gap-5 p-6"><BackLink/><h1 className="text-3xl font-semibold">Saved posts</h1><SavedPostsSection {...data} filter={data.filter as AccountSavedPostFilter}/></main>}
export function AppLocalFollowing({data}:{data:AppLocalFollowingData}){return <main className="mx-auto grid max-w-4xl gap-5 p-6"><BackLink/><h1 className="text-3xl font-semibold">Following</h1><FollowingSection {...data}/></main>}
export function AppLocalFavorites({data}:{data:AppLocalFavoritesData}) { const {salons,favorites,next}=data;return <main className="mx-auto max-w-3xl space-y-5 p-6"><Link href="/explore" className="text-brand-orange">← Explore</Link><h1 className="text-3xl font-semibold">Your favorites ♡</h1><p className="text-zinc-600">Your saved directory places and inspiration previews.</p><div className="flex gap-4"><Link className="text-brand-orange" href="/more/saved-post">Saved posts</Link><Link className="text-brand-orange" href="/more/following">Followed salons &amp; artists</Link></div>{salons.length?<><SavedSalonList items={salons}/>{data.hasMoreSalons?<Link href={`/explore/favorites?salons=${data.salonOffset+20}`} className="text-brand-orange">More salons →</Link>:null}</>:null}{favorites.length?favorites.map(item=>item.nailLookId&&nailLookById(item.nailLookId)?<NailInspirationCard key={item.key} look={nailLookById(item.nailLookId)!} initialSaved/>:<article key={item.key} className="flex items-center justify-between rounded-2xl border p-4"><Link href={item.href} className="font-semibold">{item.name}</Link><ExploreReferenceLove itemKey={item.key} name={item.name} initialActive/></article>):<p className="rounded-2xl bg-orange-50 p-5">Find something you love on Explore and tap the heart to keep it here.</p>}{next?<Link className="text-brand-orange" href={`/explore/favorites?after=${encodeURIComponent(next)}`}>More favorites →</Link>:null}</main>}
