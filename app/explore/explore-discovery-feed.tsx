"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { exploreFeedErrorMessage, requestExploreFeed } from "@/lib/explore-feed-client";
import { recordExploreLoadDuration, useExplorePrefetchDistance, useExploreVisibleAfterFirstContent } from "@/lib/explore-viewport-priority";
import { ExploreFeed, ExploreFeedSkeleton } from "@/app/explore/explore-feed";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreDiscoveryResultKind, ExploreDiscoveryShortcut, ExploreFeedItem, ExploreFeedPage } from "@/types/explore";
import type { PostCommentViewer } from "@/types/post-comments";
import { useNailInspiration } from "@/app/explore/nail-inspiration";
import { ExploreReferenceFeed } from "@/app/explore/explore-reference-feed";
import { buildExploreRecommendationPlan, exploreRecommendationKeys, type ExploreRecommendationStage } from "@/lib/explore-recommendation-plan";

type ExploreDiscoveryFeedProps = {
  commentLeadPosts?: ExploreFeedItem[];
  discovery: ExploreFeedDiscoveryOptions;
  initialPage?: ExploreFeedPage;
  initialPagePromise?: Promise<ExploreFeedPage | null>;
  viewer: PostCommentViewer;
  sessionKey: string;
  prepareAheadKey?: string;
  filterItem?: (item: ExploreFeedItem) => boolean;
  activeDiscoveryResult?: ExploreDiscoveryResultKind | null;
  discoveryShortcuts?: ExploreDiscoveryShortcut[];
  onDiscoveryShortcutSelect?: (shortcut: ExploreDiscoveryShortcut) => void;
  refreshToken?: object;
  showOrderControls?: boolean;
  allowRestore?: boolean;
  emptyContent?: ReactNode;
  emptyMessage?: string;
  feedId?: string;
  supplementaryPosts?: ReactNode[];
  supplementaryFooter?: ReactNode;
  excludeKeys?: string[];
  firstHeading?: string;
};

export function ExploreDiscoveryFeed(props: ExploreDiscoveryFeedProps) {
  return <>
    {props.initialPagePromise ? <Suspense fallback={<ExploreFeedSkeleton />}><ExploreSeededDiscoveryFeed {...props} initialPagePromise={props.initialPagePromise} /></Suspense> : <ExploreDiscoveryFeedReady {...props} />}
  </>;
}
function ExploreSeededDiscoveryFeed(props: ExploreDiscoveryFeedProps & { initialPagePromise: Promise<ExploreFeedPage | null> }) {
  const seed = use(props.initialPagePromise);
  return <ExploreDiscoveryFeedReady {...props} initialPagePromise={undefined} initialPage={seed ?? props.initialPage} />;
}
function ExploreDiscoveryFeedReady(props: ExploreDiscoveryFeedProps) {
  const plan = useMemo(() => buildExploreRecommendationPlan(props.discovery), [props.discovery]);
  const token = props.initialPage?.sessionCursor ?? props.sessionKey;
  const [snapshot, setSnapshot] = useState({ token, viewerId: props.viewer.userId, revision: 0 });
  if (snapshot.token !== token || snapshot.viewerId !== props.viewer.userId) setSnapshot({ token, viewerId: props.viewer.userId, revision: snapshot.revision + 1 });
  return <ExploreDiscoveryStage key={props.sessionKey + ":" + snapshot.revision} {...props}
    plan={plan} stageIndex={0} excluded={[...(props.excludeKeys ?? []), ...(props.commentLeadPosts ?? []).flatMap(exploreRecommendationKeys)]}
    allowRestore={props.allowRestore !== false && snapshot.revision === 0} />;
}

function ExploreDiscoveryStage(props: ExploreDiscoveryFeedProps & {
  plan: ExploreRecommendationStage[]; stageIndex: number; excluded: string[]; excludeLookIds?: string[];
}) {
  const stage = props.plan[props.stageIndex];
  const anchor = useRef<HTMLDivElement>(null);
  const nailsEnabled = useExploreVisibleAfterFirstContent(anchor);
  const nails = useNailInspiration(stage.discovery, {}, props.viewer.userId, anchor, undefined, 6, nailsEnabled);
  const excluded = useMemo(() => new Set(props.excluded), [props.excluded]);
  const { stageIndex, filterItem: originalFilter } = props;
  const filterItem = useCallback((item: ExploreFeedItem) =>
    !exploreRecommendationKeys(item).some(key => excluded.has(key)) && (stageIndex > 0 || !originalFilter || originalFilter(item)),
  [excluded, originalFilter, stageIndex]);
  const references = <ExploreReferenceFeed query={props.discovery.query} category={props.discovery.category} excludeLookIds={props.excludeLookIds} />;
  const continuation = (items: ExploreFeedItem[]) => {
    if (nails.hasMore) return null;
    const lookIds = [...new Set([...(props.excludeLookIds ?? []), ...nails.lookIds])];
    if (props.stageIndex + 1 === props.plan.length) return <ExploreReferenceFeed
      query={props.discovery.query} category={props.discovery.category} excludeLookIds={lookIds} />;
    return <ExploreDiscoveryStage {...props} stageIndex={props.stageIndex + 1}
      initialPage={undefined} commentLeadPosts={[]} allowRestore={false}
      excluded={[...new Set([...props.excluded, ...items.flatMap(exploreRecommendationKeys)])]}
      excludeLookIds={lookIds} />;
  };
  return <div ref={anchor} className="grid gap-3" data-discovery-stage={props.stageIndex}>
    <ExploreDiscoveryFeedContent {...props}
      discovery={stage.discovery}
      sessionKey={props.sessionKey + ":stage:" + props.stageIndex}
      prepareAheadKey={props.prepareAheadKey ?? props.sessionKey}
      feedId={props.stageIndex === 0 ? props.feedId : (props.feedId ?? "explore-feed") + "-stage-" + props.stageIndex}
      initialPage={props.stageIndex === 0 ? props.initialPage : undefined}
      heading={stage.label || (props.stageIndex === 0 ? props.firstHeading ?? "" : "")} description={stage.description}
      filterItem={filterItem}
      emptyMessage=""
      emptyContent={undefined}
      supplementaryPosts={nails.posts}
      supplementaryFooter={nails.footer}
      endContent={continuation}
      errorContent={references}
      maxEmptyPages={props.stageIndex > 0 ? 3 : undefined}
    />
  </div>;
}

function ExploreDiscoveryFeedContent({ commentLeadPosts, discovery, initialPage, viewer, sessionKey, prepareAheadKey, filterItem, activeDiscoveryResult, discoveryShortcuts, onDiscoveryShortcutSelect, allowRestore, feedId, supplementaryPosts, supplementaryFooter, endContent, errorContent, maxEmptyPages, heading, description }: ExploreDiscoveryFeedProps & {
  endContent: (items: ExploreFeedItem[]) => ReactNode; errorContent: ReactNode;
  maxEmptyPages?: number; heading: string; description: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<ExploreFeedPage | null>(initialPage?.sessionCursor && !initialPage.error ? initialPage : null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const distance = useExplorePrefetchDistance();
  useEffect(() => {
    if (page) return;
    let active = true;
    const controller = new AbortController();
    let started = false;
    const load = async () => {
      if (started || !anchor.current?.getClientRects().length) return;
      started = true;
      const startedAt = performance.now();
      setError("");
      try {
        const result = await requestExploreFeed<ExploreFeedPage>({ mode: "page", cursor: null, discovery, limit: 4 }, controller.signal);
        if (!active) return;
        if (result.error) setError(result.error);
        else setPage(result);
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(exploreFeedErrorMessage(cause));
      } finally { if (!controller.signal.aborted) recordExploreLoadDuration(performance.now() - startedAt); }
    };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load();
    }, { rootMargin: `${distance}px 0px` }) : null;
    if (observer && anchor.current) observer.observe(anchor.current);
    else void load();
    return () => { active = false; controller.abort(); observer?.disconnect(); };
  }, [page, discovery, attempt, distance]);
  return <div ref={anchor} data-testid="explore-discovery-continuation">
    {page ? <ExploreFeed commentLeadPosts={commentLeadPosts} initialPage={page} allowRestore={allowRestore}
      viewer={viewer} discovery={discovery} sessionKey={sessionKey} filterItem={filterItem}
      prepareAheadKey={prepareAheadKey}
      activeDiscoveryResult={activeDiscoveryResult} discoveryShortcuts={discoveryShortcuts} onDiscoveryShortcutSelect={onDiscoveryShortcutSelect}
      emptyMessage="" feedId={feedId} supplementaryPosts={supplementaryPosts} supplementaryFooter={supplementaryFooter}
      endContent={endContent} errorContent={errorContent} maxEmptyPages={maxEmptyPages} heading={heading} description={description} /> : <>
      {error ? <>
        <div role="status" className="mx-auto flex max-w-[40rem] items-center justify-between gap-3 py-3 text-sm text-text-secondary">
          <p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-11 shrink-0 rounded-full bg-surface-muted px-5 py-3 font-semibold">Try again</button>
        </div>
        {errorContent}
      </> : <ExploreFeedSkeleton />}
    </>}
  </div>;
}
