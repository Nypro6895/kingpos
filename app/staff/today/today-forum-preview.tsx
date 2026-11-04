"use client";

import { useEffect, useState } from "react";
import { WorkspaceLink } from "@/components/workspace-link";
import { WorkspaceText } from "@/components/workspace-language";
import type { ForumPreview } from "@/types/forum";

export function TodayForumPreview() {
  const [posts, setPosts] = useState<ForumPreview[]>([]);
  useEffect(() => {
    let alive = true, pending = false, lastAttempt = 0;
    let activeRequest: AbortController | null = null;
    async function refresh() {
      if (pending || Date.now() - lastAttempt < 60_000 || document.visibilityState === "hidden") return;
      pending = true; lastAttempt = Date.now();
      const timeout = new AbortController(); activeRequest = timeout;
      const timer = setTimeout(() => timeout.abort(), 6000);
      try {
        const response = await fetch("/api/forum/latest", { cache: "no-store", signal: timeout.signal });
        if (!response.ok) return;
        const data = await response.json() as { posts?: ForumPreview[] };
        if (alive) setPosts(Array.isArray(data.posts) ? data.posts.slice(0, 2) : []);
      } catch { /* Keep Today usable when offline or the forum is unavailable. */ }
      finally { clearTimeout(timer); pending = false; }
    }
    void refresh();
    const visible = () => { void refresh(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; activeRequest?.abort(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, []);

  if (!posts.length) return null;
  return <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3" aria-label="Latest forum posts">
    <div className="mb-1 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-[#1d807c]"><WorkspaceText text="From the forum" /></h2>
      <WorkspaceLink prefetch={false} href="/forum" className="inline-flex min-h-11 items-center text-xs font-medium text-[#1d807c]"><WorkspaceText text="View all" /> <span aria-hidden="true">→</span></WorkspaceLink>
    </div>
    <div className="divide-y divide-zinc-100">{posts.map(post => <WorkspaceLink key={post.id} prefetch={false} href={`/forum?topic=${encodeURIComponent(post.id)}`} className="block min-w-0 py-3 focus-visible:outline-2 focus-visible:outline-[#1d807c]">
      <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-900">{post.title}</h3>
      <p className="mt-1 truncate text-xs leading-5 text-zinc-500">{post.excerpt}</p>
    </WorkspaceLink>)}</div>
  </section>;
}
