"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { BeautyTimelinePost } from "@/types/beauty";

export function BeautyLibrary({ posts }: { posts: BeautyTimelinePost[] }) {
  const [filter, setFilter] = useState<"all" | "regular" | "before_after">("all");
  const groups = new Map<string, BeautyTimelinePost[]>();
  for (const post of posts) {
    if ((filter !== "all" && post.type !== filter) || !post.media.some(media => media.url)) continue;
    const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(post.createdAt));
    groups.set(month, [...(groups.get(month) ?? []), post]);
  }
  return <>
    <h2 className="text-lg font-semibold">Your photo library</h2>
    <p className="mt-1 text-xs text-text-secondary">Photos from your posts</p>
    <div className="my-3 flex gap-2" aria-label="Filter your photos">
      {(["all", "regular", "before_after"] as const).map(value => <button key={value} type="button" className="beauty-action" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "regular" ? "Photos" : "Before & After"}</button>)}
    </div>
    {[...groups].map(([month, entries]) => <section key={month} className="mb-5" aria-label={month}>
      <h3 className="mb-2 text-sm font-semibold">{month}</h3>
      <div className="beauty-library">{entries.flatMap(post => post.media.filter(media => media.url).map(media => <Link key={media.id} href={`/explore/beauty/${post.profileId}/posts/${post.id}`} aria-label={`Open ${post.type === "before_after" ? "Before & After" : "Beauty moment"} from ${month}`}>
        <Image src={media.url!} width={320} height={320} sizes="(min-width: 1024px) 300px, 33vw" loading="lazy" alt={post.caption ?? "Beauty photo"} />
        {post.type === "before_after" ? <span>Before &amp; After</span> : null}
      </Link>))}</div>
    </section>)}
    {!groups.size ? <p className="py-5 text-sm text-text-secondary">No photos in this view yet.</p> : null}
  </>;
}
