"use client";
import { useEffect, useRef, useState } from "react";
import { fetchPostCommentsPage } from "@/lib/post-comments-client";
import type { PostComment, PostCommentTarget } from "@/types/post-comments";

export function ExploreCommentPreview({ target, onOpen }: { target: PostCommentTarget; onOpen: () => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState<PostComment | null>(null);
  const { sourceId, sourceType } = target;
  useEffect(() => {
    let alive = true, started = false;
    const load = async () => {
      if (started || !anchor.current?.getClientRects().length) return;
      started = true;
      try {
        const page = await fetchPostCommentsPage({ target: { sourceId, sourceType }, offset: 0, pageSize: 1 });
        if (alive && !page.error) setComment(page.items.find(item => item.targetId === sourceId && item.targetType === sourceType && !item.parentCommentId && !item.moderationPending && item.body.trim()) ?? null);
      } catch { /* Optional preview: never replace the post with an error. */ }
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load();
    }, { rootMargin: "180px" });
    if (observer && anchor.current) observer.observe(anchor.current); else void load();
    return () => { alive = false; observer?.disconnect(); };
  }, [sourceId, sourceType]);
  const visible = comment?.targetId === sourceId && comment.targetType === sourceType ? comment : null;
  return <div ref={anchor} data-comment-preview-slot>
    {visible ? <button type="button" onClick={onOpen} className="mb-1 mt-2 block w-full rounded-2xl bg-zinc-100 px-3 py-2 text-left text-sm leading-5 text-zinc-600" data-comment-preview>
      <span className="line-clamp-2 break-words"><strong className="font-semibold text-zinc-800">{visible.authorDisplayName}</strong>{" · "}{visible.body}</span>
    </button> : null}
  </div>;
}
