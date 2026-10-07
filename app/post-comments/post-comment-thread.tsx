"use client";

import {
  createPostCommentAction,
  deletePostCommentAction,
  hidePostCommentAction,
  updatePostCommentAction,
} from "@/app/post-comments/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type {
  PostComment,
  PostCommentTarget,
  PostCommentViewer,
} from "@/types/post-comments";
import { completeCommentRequest, prepareCommentRequest } from "@/lib/comment-request";
import { withRequestTimeout } from "@/lib/request-timeout";
import { fetchPostCommentsPage } from "@/lib/post-comments-client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

type PostCommentThreadProps = {
  autoFocusComposer?: boolean;
  className?: string;
  compact?: boolean;
  initialCount?: number;
  onCountChange?: (count: number) => void;
  pageSize?: number;
  target: PostCommentTarget;
  viewer: PostCommentViewer;
};

type DraftComment = PostComment & {
  optimistic?: boolean;
};

type RealtimeCommentPayload = {
  eventType?: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
};

type TargetRealtimeFilter = {
  column: "beauty_post_id" | "look_id" | "update_id";
  value: string;
};

const DEFAULT_PAGE_SIZE = 10;

function mergeComments(current: DraftComment[], incoming: PostComment[]) {
  const next = new Map(current.map((comment) => [comment.id, comment]));

  for (const comment of incoming) {
    next.set(comment.id, comment);
  }

  return Array.from(next.values());
}

function targetKey(target: PostCommentTarget) {
  return `${target.sourceType}:${target.sourceId}`;
}

function displayCommentCount(count: number) {
  return `${count} comment${count === 1 ? "" : "s"}`;
}

function nowIso() {
  return new Date().toISOString();
}

function humanTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));

  if (seconds < 45) {
    return "Just now";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.round(hours / 24);

  if (days < 7) {
    return `${days}d`;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function commentMatchesTarget(comment: PostComment, target: PostCommentTarget) {
  return comment.targetType === target.sourceType && comment.targetId === target.sourceId;
}

function targetRealtimeFilter(
  target: PostCommentTarget,
): TargetRealtimeFilter | null {
  if (target.sourceType === "beauty_post") {
    return { column: "beauty_post_id", value: target.sourceId };
  }

  if (target.sourceType === "salon_profile_update") {
    return { column: "update_id", value: target.sourceId };
  }

  if (target.sourceType === "salon_profile_look") {
    return { column: "look_id", value: target.sourceId };
  }

  return null;
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown) {
  return value === true;
}

function readInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function visibleRealtimeComment(row: Record<string, unknown>) {
  const status = readText(row.status);

  return status === "published" || status === "visible";
}

function realtimeTargetType(
  row: Record<string, unknown>,
): PostComment["targetType"] | null {
  if (readText(row.beauty_post_id)) {
    return "beauty_post";
  }

  if (readText(row.update_id)) {
    return "salon_profile_update";
  }

  if (readText(row.look_id)) {
    return "salon_profile_look";
  }

  return null;
}

function realtimeTargetId(row: Record<string, unknown>) {
  return (
    readText(row.beauty_post_id) ??
    readText(row.update_id) ??
    readText(row.look_id) ??
    ""
  );
}

function mapRealtimeComment(
  row: Record<string, unknown>,
  target: PostCommentTarget,
): PostComment | null {
  const id = readText(row.id);
  const body = readText(row.body);
  const targetType = realtimeTargetType(row);
  const targetId = realtimeTargetId(row);

  if (!id || !body || !targetType || targetId !== target.sourceId) {
    return null;
  }

  return {
    authorDisplayName: readText(row.author_display_name) ?? "Reylumi customer",
    authorUserId: readText(row.author_user_id),
    beautyPostId: readText(row.beauty_post_id),
    body,
    createdAt: readText(row.created_at) ?? nowIso(),
    editedAt: readText(row.edited_at),
    id,
    isSalonReply: readBoolean(row.is_salon_reply),
    lookId: readText(row.look_id),
    parentCommentId: readText(row.parent_comment_id),
    replyDepth: readInteger(row.reply_depth),
    rootCommentId: readText(row.root_comment_id),
    salonId: readText(row.salon_id),
    targetId,
    targetType,
    updatedAt: readText(row.updated_at) ?? nowIso(),
    updateId: readText(row.update_id),
  };
}

function optimisticMatchesRealtimeComment(
  draft: DraftComment,
  incoming: PostComment,
) {
  return (
    draft.optimistic === true &&
    draft.authorUserId === incoming.authorUserId &&
    draft.body === incoming.body &&
    draft.parentCommentId === incoming.parentCommentId &&
    draft.targetId === incoming.targetId &&
    draft.targetType === incoming.targetType
  );
}

function removeCommentBranch(
  current: DraftComment[],
  commentId: string,
) {
  const target = current.find((comment) => comment.id === commentId);

  if (!target || target.parentCommentId) {
    return current.filter((comment) => comment.id !== commentId);
  }

  return current.filter(
    (comment) => comment.id !== commentId && comment.rootCommentId !== commentId,
  );
}

function rootIdForComment(
  comment: DraftComment,
  commentsById: Map<string, DraftComment>,
) {
  if (!comment.parentCommentId) {
    return comment.id;
  }

  if (comment.rootCommentId) {
    return comment.rootCommentId;
  }

  let current = commentsById.get(comment.parentCommentId);
  let guard = 0;

  while (current?.parentCommentId && guard < 8) {
    current = commentsById.get(current.parentCommentId);
    guard += 1;
  }

  return current?.id ?? comment.parentCommentId;
}

function createOptimisticComment(input: {
  asSalonReply: boolean;
  body: string;
  parentComment: PostComment | null;
  target: PostCommentTarget;
  viewer: PostCommentViewer;
}): DraftComment {
  const createdAt = nowIso();
  const parentCommentId = input.parentComment?.id ?? null;

  return {
    authorDisplayName: input.asSalonReply ? "Salon" : "You",
    authorUserId: input.viewer.userId,
    beautyPostId: input.target.sourceType === "beauty_post" ? input.target.sourceId : null,
    body: input.body,
    createdAt,
    editedAt: null,
    id: `optimistic-${createdAt}-${Math.random().toString(16).slice(2)}`,
    isSalonReply: input.asSalonReply,
    lookId:
      input.target.sourceType === "salon_profile_look" ? input.target.sourceId : null,
    parentCommentId,
    replyDepth: input.parentComment ? input.parentComment.replyDepth + 1 : 0,
    rootCommentId: input.parentComment
      ? input.parentComment.rootCommentId ?? input.parentComment.id
      : null,
    salonId: input.target.salonId ?? null,
    targetId: input.target.sourceId,
    targetType: input.target.sourceType,
    updatedAt: createdAt,
    updateId:
      input.target.sourceType === "salon_profile_update" ? input.target.sourceId : null,
    optimistic: true,
  };
}

function buttonClass(tone: "danger" | "primary" | "subtle" = "subtle") {
  const base =
    "inline-flex min-h-8 items-center justify-center rounded-md px-2.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-60";

  if (tone === "primary") {
    return `${base} bg-zinc-950 text-white hover:bg-zinc-800`;
  }

  if (tone === "danger") {
    return `${base} text-red-700 hover:bg-red-50`;
  }

  return `${base} text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950`;
}

export function PostCommentThread(props: PostCommentThreadProps) {
  return <PostCommentThreadContent {...props} key={`${props.viewer.userId ?? "guest"}:${targetKey(props.target)}`} />;
}

function PostCommentThreadContent({
  autoFocusComposer = false,
  className,
  compact = false,
  initialCount = 0,
  onCountChange,
  pageSize = DEFAULT_PAGE_SIZE,
  target,
  viewer,
}: PostCommentThreadProps) {
  const [comments, setComments] = useState<DraftComment[]>([]);
  const [totalCount, setTotalCount] = useState(Math.max(0, initialCount));
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [hasMore, setHasMore] = useState(initialCount > 0);
  const [loaded, setLoaded] = useState(false);
  const [loading, startLoadTransition] = useTransition();
  const [posting, startPostTransition] = useTransition();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [asSalonReply, setAsSalonReply] = useState(false);
  const [status, setStatus] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightedCommentIdRef = useRef<string | null>(null);
  const onCountChangeRef = useRef(onCountChange);
  const refreshTimerRef = useRef<number | null>(null);
  const submitPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const loadVersionRef = useRef(0);
  const loadPendingRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const loadedThroughRef = useRef(0);
  const hasRenderedPageRef = useRef(false);
  const draftVersionRef = useRef(0);
  const [loadError, setLoadError] = useState(false);
  const key = targetKey(target);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadVersionRef.current += 1;
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  useEffect(() => {
    onCountChangeRef.current?.(totalCount);
  }, [totalCount]);

  useEffect(() => {
    if (!autoFocusComposer) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusComposer, key]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    highlightedCommentIdRef.current = params.get("comment");
  }, [key]);

  useEffect(() => {
    loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") {
      return;
    }

    const highlightedCommentId = highlightedCommentIdRef.current;

    if (!highlightedCommentId) {
      return;
    }

    const element = document.getElementById(`comment-${highlightedCommentId}`);

    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [comments, loaded]);

  useEffect(() => {
    function refreshOnFocus() {
      if (document.visibilityState === "visible") {
        refreshCommentsSoon();
      }
    }

    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const filter = targetRealtimeFilter(target);

    if (!supabase || !filter) {
      return;
    }

    // Channel removal is asynchronous; a remount must not reuse a subscribed channel.
    let active = true;
    const channel = supabase
      .channel(`post-comments:${target.sourceType}:${target.sourceId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `${filter.column}=eq.${filter.value}`,
          schema: "public",
          table: "salon_profile_comments",
        },
        (payload: RealtimeCommentPayload) => {
          if (!active) return;
          if (submitPendingRef.current) {
            loadVersionRef.current += 1;
            refreshQueuedRef.current = true;
            return;
          }
          if (loadPendingRef.current) {
            // Finish showing the current page, then reconcile once in the background.
            refreshQueuedRef.current = true;
            return;
          }
          loadVersionRef.current += 1;
          const nextRow = payload.new ?? {};
          const oldRow = payload.old ?? {};
          const incoming =
            visibleRealtimeComment(nextRow) && payload.eventType !== "DELETE"
              ? mapRealtimeComment(nextRow, target)
              : null;

          if (incoming) {
            setComments((current) =>
              mergeComments(
                current.filter(
                  (comment) => !optimisticMatchesRealtimeComment(comment, incoming),
                ),
                [incoming],
              ),
            );
          } else {
            const removedId = readText(oldRow.id) ?? readText(nextRow.id);

            if (removedId) {
              setComments((current) => removeCommentBranch(current, removedId));
            }
          }

          refreshCommentsSoon();
        },
      )
      .subscribe((status) => {
        if (active && status === "SUBSCRIBED") {
          refreshCommentsSoon();
        }
      });

    return () => {
      active = false;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function loadPage(offset: number, replace = false) {
    if (submitPendingRef.current || loadPendingRef.current) {
      if (replace) refreshQueuedRef.current = true;
      return;
    }
    loadPendingRef.current = true;
    const version = ++loadVersionRef.current;
    const through = replace ? Math.max(pageSize, loadedThroughRef.current) : offset + pageSize;
    startLoadTransition(async () => {
      try {
        let next = offset;
        let incoming: PostComment[] = [];
        let page;
        do {
          page = await fetchPostCommentsPage({ offset: next, pageSize, target });
          if (!mountedRef.current || version !== loadVersionRef.current) return;
          if (page.error) throw new Error(page.error);
          incoming = mergeComments(incoming, page.items);
          // Render the first page immediately while restoring any later pages.
          setComments((current) => mergeComments(current, incoming));
          hasRenderedPageRef.current = true;
          setTotalCount(page.totalCount);
          setHasMore(page.hasMore);
          setNextOffset(page.nextOffset);
          setLoaded(true);
          setLoadError(false);
          if (!page.hasMore || page.nextOffset === null || page.nextOffset <= next) break;
          next = page.nextOffset;
        } while (replace && next < through);
        setComments((current) => mergeComments(replace ? [] : current, incoming));
        loadedThroughRef.current = page.nextOffset ?? through;
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset);
        setLoaded(true);
        setLoadError(false);
      } catch (error) {
        if (mountedRef.current && version === loadVersionRef.current) {
          setStatus(error instanceof Error ? error.message : "Comments could not be loaded. Please try again.");
          setLoaded(true);
          setLoadError(!hasRenderedPageRef.current);
        }
      } finally {
        loadPendingRef.current = false;
        if (mountedRef.current && refreshQueuedRef.current && !submitPendingRef.current) {
          refreshQueuedRef.current = false;
          refreshCommentsSoon();
        }
      }
    });
  }

  function refreshCommentsSoon() {
    if (typeof window === "undefined") {
      return;
    }

    if (loadPendingRef.current || submitPendingRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      loadPage(0, true);
    }, 300);
  }

  const groupedComments = useMemo(() => {
    const targetComments = comments.filter((comment) =>
      commentMatchesTarget(comment, target),
    );
    const commentsById = new Map(
      targetComments.map((comment) => [comment.id, comment]),
    );
    const roots = targetComments
      .filter((comment) => !comment.parentCommentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const replies = new Map<string, DraftComment[]>();

    for (const comment of targetComments) {
      if (!comment.parentCommentId) {
        continue;
      }

      const rootId = rootIdForComment(comment, commentsById);
      const nextReplies = replies.get(rootId) ?? [];
      nextReplies.push(comment);
      replies.set(rootId, nextReplies);
    }

    for (const nextReplies of replies.values()) {
      nextReplies.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }

    return { commentsById, replies, roots };
  }, [comments, target]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (submitPendingRef.current) return;

    if (!viewer.isAuthenticated) {
      setStatus("Sign in to comment.");
      return;
    }

    const nextBody = body.trim();

    if (!nextBody) {
      setStatus("Write a comment first.");
      return;
    }

    const parentComment = replyTo;
    const parentCommentId = parentComment?.id ?? null;
    const postAsSalon = asSalonReply && viewer.canReplyAsSalon;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Storage is optional. */ }
    const request = prepareCommentRequest(
      `${viewer.userId}:${key}`,
      { body: nextBody, parentCommentId, asSalonReply: postAsSalon },
      storage,
      () => crypto.randomUUID(),
    );
    const optimisticComment = createOptimisticComment({
      asSalonReply: postAsSalon,
      body: nextBody,
      parentComment,
      target,
      viewer,
    });
    const previousBody = body;
    const previousReply = replyTo;
    const draftVersion = draftVersionRef.current;

    submitPendingRef.current = true;
    loadVersionRef.current += 1;

    setComments((current) =>
      parentCommentId ? [...current, optimisticComment] : [optimisticComment, ...current],
    );
    setTotalCount((current) => current + 1);
    setBody("");
    setReplyTo(null);
    setStatus("");

    startPostTransition(async () => {
      const result = await withRequestTimeout(createPostCommentAction({
        requestId: request.id,
        asSalonReply: postAsSalon,
        body: nextBody,
        parentCommentId,
        target,
      })).catch(() => ({ error: "Connection interrupted. Refresh to check whether your comment was posted before trying again." }));

      submitPendingRef.current = false;
      if (result.error === null) completeCommentRequest(request.key, storage);
      if (!mountedRef.current) return;
      refreshCommentsSoon();

      if (result.error !== null) {
        setComments((current) =>
          current.filter((comment) => comment.id !== optimisticComment.id),
        );
        setTotalCount((current) => Math.max(0, current - 1));
        if (draftVersionRef.current === draftVersion) {
          setBody(previousBody);
          setReplyTo(previousReply);
        }
        setStatus(result.error);
        return;
      }

      setComments((current) =>
        mergeComments(
          current.filter((comment) => comment.id !== optimisticComment.id),
          [result.comment],
        ),
      );
      setTotalCount(result.totalCount);
      setStatus("Comment posted.");
    });
  }

  function beginReply(comment: PostComment) {
    draftVersionRef.current += 1;
    setReplyTo(comment);
    setAsSalonReply(viewer.canReplyAsSalon);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: false });
    });
  }

  function saveEdit(comment: DraftComment, nextBody: string) {
    if (submitPendingRef.current) return;
    const cleanBody = nextBody.trim();

    if (!cleanBody || cleanBody === comment.body) {
      return;
    }

    submitPendingRef.current = true;
    loadVersionRef.current += 1;
    setComments((current) =>
      current.map((item) =>
        item.id === comment.id
          ? { ...item, body: cleanBody, editedAt: nowIso(), updatedAt: nowIso() }
          : item,
      ),
    );
    setStatus("");

    startPostTransition(async () => {
      const result = await updatePostCommentAction({
        body: cleanBody,
        commentId: comment.id,
        target,
      }).catch(() => ({ error: "Connection interrupted. Refresh to check whether your comment was saved." }));

      submitPendingRef.current = false;
      if (!mountedRef.current) return;
      refreshCommentsSoon();

      if (result.error !== null) {
        setComments((current) => current.map((item) => item.id === comment.id ? comment : item));
        setStatus(result.error);
        return;
      }

      setComments((current) => mergeComments(current, [result.comment]));
      setTotalCount(result.totalCount);
    });
  }

  function removeComment(comment: DraftComment, mode: "delete" | "hide") {
    if (submitPendingRef.current) return;
    submitPendingRef.current = true;
    loadVersionRef.current += 1;
    const previous = comments;
    const previousTotalCount = totalCount;
    const removedIds = new Set<string>([comment.id]);

    if (!comment.parentCommentId) {
      for (const item of comments) {
        if (item.rootCommentId === comment.id || item.parentCommentId === comment.id) {
          removedIds.add(item.id);
        }
      }
    }

    setComments((current) => current.filter((item) => !removedIds.has(item.id)));
    setTotalCount((current) => Math.max(0, current - removedIds.size));
    setStatus("");

    startPostTransition(async () => {
      const result =
        mode === "hide"
          ? await hidePostCommentAction({ commentId: comment.id, target }).catch(() => ({ error: "Connection interrupted. Refresh to check the comment status." }))
          : await deletePostCommentAction({ commentId: comment.id, target }).catch(() => ({ error: "Connection interrupted. Refresh to check the comment status." }));

      submitPendingRef.current = false;
      if (!mountedRef.current) return;
      refreshCommentsSoon();

      if (result.error !== null) {
        setComments((current) => mergeComments(current, previous.filter((item) => removedIds.has(item.id))));
        setTotalCount(previousTotalCount);
        setStatus(result.error);
        return;
      }

      setTotalCount(result.totalCount);
    });
  }

  const canSubmit = viewer.isAuthenticated && body.trim().length > 0 && !posting;

  return (
    <section className={[compact ? "grid gap-3" : "grid gap-4", className].filter(Boolean).join(" ")}>
      {compact ? (
        <h3 className="sr-only">Comments for {target.title ?? "post"}</h3>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-zinc-950">Comments</h3>
            <span className="text-xs font-semibold text-zinc-500">
              {displayCommentCount(totalCount)}
            </span>
          </div>
          {target.title ? (
            <p className="mt-1 text-sm text-zinc-500">{target.title}</p>
          ) : null}
        </div>
      )}

      <div
        className={
          compact ? "grid max-h-80 gap-2 overflow-y-auto pr-1" : "grid gap-3"
        }
      >
        {!loaded && comments.length === 0 ? (
          <p className="rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-600">
            Loading comments...
          </p>
        ) : loadError ? (
          <button type="button" className={buttonClass()} onClick={() => loadPage(0, true)} disabled={loading}>
            Retry loading comments
          </button>
        ) : groupedComments.roots.length === 0 ? (
          <p
            className={[
              "rounded-lg text-sm text-zinc-600",
              compact ? "bg-white px-3 py-2.5" : "bg-zinc-50 p-4",
            ].join(" ")}
          >
            No comments yet.
          </p>
        ) : (
          groupedComments.roots.map((comment) => (
            <CommentItem
              comment={comment}
              commentsById={groupedComments.commentsById}
              key={comment.id}
              onDelete={(item) => removeComment(item, "delete")}
              onEdit={saveEdit}
              onHide={(item) => removeComment(item, "hide")}
              onReply={beginReply}
              replies={groupedComments.replies.get(comment.id) ?? []}
              viewer={viewer}
            />
          ))
        )}
        {hasMore && nextOffset !== null ? (
          <button
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
            disabled={loading}
            onClick={() => loadPage(nextOffset)}
            type="button"
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        ) : null}
      </div>

      <form className="grid gap-2" onSubmit={submit}>
        {replyTo ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <span>Replying to {replyTo.authorDisplayName}</span>
            <button
              className="font-semibold underline-offset-4 hover:underline"
              onClick={() => setReplyTo(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        ) : null}
        <textarea
          className={[
            "resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition focus:border-zinc-950",
            compact ? "min-h-14" : "min-h-24",
          ].join(" ")}
          disabled={!viewer.isAuthenticated}
          maxLength={1000}
          onChange={(event) => {
            draftVersionRef.current += 1;
            setBody(event.currentTarget.value);
          }}
          placeholder={
            viewer.isAuthenticated
              ? replyTo
                ? "Write a reply..."
                : "Write a public comment..."
              : "Sign in to comment."
          }
          ref={textareaRef}
          value={body}
        />
        {viewer.canReplyAsSalon ? (
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              checked={asSalonReply}
              className="size-4"
              onChange={(event) => setAsSalonReply(event.currentTarget.checked)}
              type="checkbox"
            />
            Reply as salon
          </label>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="min-h-5 text-sm text-zinc-600">
            {status}
          </p>
          <button className={buttonClass("primary")} disabled={!canSubmit} type="submit">
            {posting ? "Posting..." : replyTo ? "Post reply" : "Post comment"}
          </button>
        </div>
      </form>
    </section>
  );
}

function CommentItem({
  comment,
  commentsById,
  onDelete,
  onEdit,
  onHide,
  onReply,
  replies,
  replyingToName,
  viewer,
}: {
  comment: DraftComment;
  commentsById: Map<string, DraftComment>;
  onDelete: (comment: DraftComment) => void;
  onEdit: (comment: DraftComment, body: string) => void;
  onHide: (comment: DraftComment) => void;
  onReply: (comment: PostComment) => void;
  replies: DraftComment[];
  replyingToName?: string | null;
  viewer: PostCommentViewer;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftState, setDraftState] = useState(() => ({
    body: comment.body,
    commentId: comment.id,
  }));
  const draft =
    draftState.commentId === comment.id ? draftState.body : comment.body;
  const canEdit = Boolean(viewer.userId && comment.authorUserId === viewer.userId);
  const canDelete = canEdit;
  const canHide = viewer.canModerate && !comment.optimistic;
  const canReply =
    viewer.isAuthenticated && !comment.optimistic && comment.replyDepth < 8;

  return (
    <div className="grid gap-2" id={`comment-${comment.id}`}>
      <div
        className={[
          "rounded-lg p-3",
          comment.optimistic ? "bg-zinc-100 opacity-80" : "bg-zinc-50",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-950">
              {comment.authorDisplayName}
              {comment.isSalonReply ? (
                <span className="ml-2 rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                  Salon
                </span>
              ) : null}
            </p>
            {isEditing ? (
              <div className="mt-2 grid gap-2">
                <textarea
                  className="min-h-20 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition focus:border-zinc-950"
                  maxLength={1000}
                  onChange={(event) =>
                    setDraftState({
                      body: event.currentTarget.value,
                      commentId: comment.id,
                    })
                  }
                  value={draft}
                />
                <div className="flex justify-end gap-2">
                  <button
                    className={buttonClass()}
                    onClick={() => {
                      setDraftState({
                        body: comment.body,
                        commentId: comment.id,
                      });
                      setIsEditing(false);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className={buttonClass("primary")}
                    onClick={() => {
                      onEdit(comment, draft);
                      setIsEditing(false);
                    }}
                    type="button"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                {replyingToName ? (
                  <p className="mt-1 text-xs font-semibold text-zinc-500">
                    Replying to {replyingToName}
                  </p>
                ) : null}
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">
                  {comment.body}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {humanTime(comment.createdAt)}
                  {comment.editedAt ? " · Edited" : ""}
                  {comment.optimistic ? " · Sending" : ""}
                </p>
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {canReply ? (
              <button
                className={buttonClass()}
                onClick={() => onReply(comment)}
                type="button"
              >
                Reply
              </button>
            ) : null}
            {canEdit ? (
              <button
                className={buttonClass()}
                disabled={comment.optimistic}
                onClick={() => setIsEditing(true)}
                type="button"
              >
                Edit
              </button>
            ) : null}
            {canDelete ? (
              <button
                className={buttonClass("danger")}
                disabled={comment.optimistic}
                onClick={() => onDelete(comment)}
                type="button"
              >
                Delete
              </button>
            ) : null}
            {canHide ? (
              <button
                className={buttonClass("danger")}
                onClick={() => onHide(comment)}
                type="button"
              >
                Hide
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {replies.length > 0 ? (
        <div className="ml-5 grid gap-2 border-l border-zinc-200 pl-3">
          {replies.map((reply) => (
            <CommentItem
              comment={reply}
              commentsById={commentsById}
              key={reply.id}
              onDelete={onDelete}
              onEdit={onEdit}
              onHide={onHide}
              onReply={onReply}
              replies={[]}
              replyingToName={
                reply.parentCommentId && reply.parentCommentId !== comment.id
                  ? commentsById.get(reply.parentCommentId)?.authorDisplayName ?? null
                  : null
              }
              viewer={viewer}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
