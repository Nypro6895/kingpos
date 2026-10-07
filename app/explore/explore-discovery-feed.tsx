"use client";

import { useEffect, useRef, useState } from "react";
import { loadExploreFeedAction } from "@/app/explore/actions";
import { ExploreFeed, ExploreFeedSkeleton } from "@/app/explore/explore-feed";
import { withRequestTimeout } from "@/lib/request-timeout";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreDiscoveryResultKind, ExploreDiscoveryShortcut, ExploreFeedItem, ExploreFeedPage } from "@/types/explore";
import type { PostCommentViewer } from "@/types/post-comments";

type ExploreDiscoveryFeedProps = {
  discovery: ExploreFeedDiscoveryOptions;
  initialPage?: ExploreFeedPage;
  viewer: PostCommentViewer;
  sessionKey: string;
  filterItem?: (item: ExploreFeedItem) => boolean;
  activeDiscoveryResult?: ExploreDiscoveryResultKind | null;
  discoveryShortcuts?: ExploreDiscoveryShortcut[];
  onDiscoveryShortcutSelect?: (shortcut: ExploreDiscoveryShortcut) => void;
  refreshToken?: object;
  allowRestore?: boolean;
};

export function ExploreDiscoveryFeed(props: ExploreDiscoveryFeedProps) {
  const token = props.refreshToken ?? props.initialPage;
  const [snapshot, setSnapshot] = useState({ token, viewerId: props.viewer.userId, revision: 0 });
  if (snapshot.token !== token || snapshot.viewerId !== props.viewer.userId) setSnapshot({ token, viewerId: props.viewer.userId, revision: snapshot.revision + 1 });
  return <ExploreDiscoveryFeedContent key={snapshot.revision} {...props} allowRestore={snapshot.revision === 0} />;
}

function ExploreDiscoveryFeedContent({ discovery, initialPage, viewer, sessionKey, filterItem, activeDiscoveryResult, discoveryShortcuts, onDiscoveryShortcutSelect, allowRestore }: ExploreDiscoveryFeedProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<ExploreFeedPage | null>(initialPage?.error ? null : initialPage ?? null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (page) return;
    let active = true;
    let started = false;
    const load = async () => {
      if (started || !anchor.current?.getClientRects().length) return;
      started = true;
      setError("");
      try {
        const result = await withRequestTimeout(loadExploreFeedAction(null, discovery));
        if (!active) return;
        if (result.error) setError(result.error);
        else setPage(result);
      } catch {
        if (active) setError("Discovery could not be loaded. Please try again.");
      }
    };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load();
    }, { rootMargin: "900px 0px" }) : null;
    if (observer && anchor.current) observer.observe(anchor.current);
    else void load();
    return () => { active = false; observer?.disconnect(); };
  }, [page, discovery, attempt]);
  return <div ref={anchor} data-testid="explore-discovery-continuation">
    {page ? <ExploreFeed initialPage={page} allowRestore={allowRestore} viewer={viewer} discovery={discovery} sessionKey={sessionKey} filterItem={filterItem} activeDiscoveryResult={activeDiscoveryResult} discoveryShortcuts={discoveryShortcuts} onDiscoveryShortcutSelect={onDiscoveryShortcutSelect} /> : error ? (
      <div role="status" className="grid justify-items-center gap-3 py-6 text-sm text-text-secondary">
        <p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-full bg-surface-muted px-5 py-3 font-semibold">Try again</button>
      </div>
    ) : <ExploreFeedSkeleton />}
  </div>;
}
