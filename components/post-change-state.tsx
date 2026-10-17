"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { PostCommentTarget } from "@/types/post-comments";
import type { PostChange } from "@/types/post-actions";

export const POST_CHANGED_EVENT = "reylumi:post-changed";

export function announcePostChange(change: PostChange, viewerId?: string | null) {
  window.dispatchEvent(new CustomEvent(POST_CHANGED_EVENT, { detail: { change, viewerId: viewerId ?? null } }));
}

/** Synchronize mounted card/detail copies; fresh server props supersede the local patch. */
export function usePostCaption(target: Pick<PostCommentTarget, "sourceType" | "sourceId"> | null | undefined, initialCaption: string | null | undefined, viewerId?: string | null) {
  const identity = target ? `${target.sourceType}:${target.sourceId}` : "";
  const [patch, setPatch] = useState<{ identity: string; initial: typeof initialCaption; caption: string | null; viewerId: string | null } | null>(null);
  // The listener stays subscribed while this callback reads the latest committed
  // props, including before passive effects run after a server-data refresh.
  const applyChange = useEffectEvent((event: Event) => {
    const detail = (event as CustomEvent<{ change: PostChange; viewerId: string | null }>).detail;
    if (!detail?.change || detail.viewerId !== (viewerId ?? null)) return;
    const { change } = detail;
    if (change.action === "edit" && `${change.target.sourceType}:${change.target.sourceId}` === identity && "caption" in change)
      setPatch({ identity, initial: initialCaption, caption: change.caption ?? null, viewerId: viewerId ?? null });
  });
  useEffect(() => {
    const changed = (event: Event) => applyChange(event);
    window.addEventListener(POST_CHANGED_EVENT, changed);
    return () => window.removeEventListener(POST_CHANGED_EVENT, changed);
  }, []);
  return patch?.identity === identity && patch.initial === initialCaption && patch.viewerId === (viewerId ?? null) ? patch.caption : initialCaption;
}
