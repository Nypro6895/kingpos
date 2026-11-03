"use client";
import {BeautyProfileHeader} from "@/components/beauty-profile-header";
import {BeautyFollowButton} from "@/app/explore/beauty/beauty-follow-button";
import type {BeautyProfileRoutePage} from "@/lib/beauty-relationship";
import Image from "next/image";
import Link from "next/link";
export function BeautyProfileReadView({page}:{page:BeautyProfileRoutePage}){
  if (page.access === "private_relationship") return <main className="mx-auto grid max-w-3xl gap-4 px-3 py-4">
    <Link href={"/customers/" + page.customerId} className="text-sm font-semibold text-brand-orange">Customer details</Link>
    <section className="rounded-2xl border border-divider-subtle bg-surface p-6 text-center"><h1 className="text-xl font-semibold">This Beauty profile is private.</h1><p className="mt-2 text-sm text-text-secondary">Beauty content is not visible to salons.</p></section>
  </main>;
  const { profile, publicPosts: posts } = page;
  return <main className="min-h-screen bg-surface-muted px-3 py-4 sm:px-6">
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <Link href="/explore" className="w-fit py-2 text-sm font-semibold text-text-secondary">Back to Explore</Link>
      <BeautyProfileHeader profile={profile} footer={<BeautyFollowButton followerCount={profile.followerCount} initialFollowing={profile.isFollowing} profileId={profile.id} />} />
      <section aria-labelledby="beauty-looks-heading" className="grid gap-3">
        <h2 id="beauty-looks-heading" className="text-base font-semibold">Public looks</h2>
        {page.postsError ? <div role="alert" className="rounded-xl bg-surface p-5 text-sm"><p>Looks could not be loaded.</p><Link href={"/explore/beauty/" + profile.id} className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand-orange">Try again</Link></div> : posts.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{posts.map(post => <Link key={post.id} prefetch={false} href={post.destination.href || "/explore"} className="group min-w-0 overflow-hidden rounded-xl bg-surface ring-1 ring-divider-subtle focus-visible:outline-2 focus-visible:outline-brand-orange">
          <div className="relative aspect-[4/5] overflow-hidden bg-surface-muted">{post.media[0] ? <Image src={post.media[0].imageUrl} alt={post.caption || "Beauty look by " + profile.displayName} fill sizes="(max-width: 640px) 48vw, 240px" className="object-cover transition motion-safe:group-hover:scale-105" /> : null}</div>
          <div className="grid gap-1 p-2.5"><p className="line-clamp-2 break-words text-sm">{post.caption || (post.personal.postType === "before_after" ? "Before & After" : "Beauty moment")}</p>{post.salon ? <p className="truncate text-xs text-text-secondary">{post.salon.name}</p> : null}</div>
        </Link>)}</div> : <p className="rounded-xl bg-surface p-5 text-sm text-text-secondary">No public looks to show.</p>}
        {page.hasMore && page.nextCursor ? <Link className="justify-self-center rounded-full border border-divider-subtle bg-surface px-5 py-3 text-sm font-semibold" href={{ pathname: "/explore/beauty/" + profile.id, query: { before: page.nextCursor.createdAt, post: page.nextCursor.postId } }}>More looks</Link> : null}
      </section>
    </div>
  </main>;
}
