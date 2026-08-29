import "server-only";

import { getHistoricalUserDisplayName } from "@/lib/deleted-user-display";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import {
  POST_COMMENT_TARGET_TYPES,
  type PostComment,
  type PostCommentPage,
  type PostCommentTarget,
  type PostCommentTargetType,
  type PostCommentViewer,
} from "@/types/post-comments";
import type { KingUser } from "@/types/user";

export { POST_COMMENT_TARGET_TYPES };
export type {
  PostComment,
  PostCommentPage,
  PostCommentTarget,
  PostCommentTargetType,
  PostCommentViewer,
};

type CommentRow = {
  author_display_name: string | null;
  author_user_id: string | null;
  beauty_post_id?: string | null;
  body: string;
  created_at: string;
  edited_at?: string | null;
  id: string;
  is_salon_reply: boolean | null;
  look_id: string | null;
  parent_comment_id: string | null;
  root_count?: number | string | null;
  salon_id: string | null;
  total_count?: number | string | null;
  updated_at: string;
  update_id: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_COMMENT_PAGE_SIZE = 10;
const MAX_POST_COMMENT_PAGE_SIZE = 24;

function cleanUuid(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function cleanBody(value: string | null | undefined) {
  return value?.trim().replace(/\r\n/g, "\n") ?? "";
}

function cleanTitle(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") || "this post";
}

function readCount(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function normalizePageSize(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) {
    return POST_COMMENT_PAGE_SIZE;
  }

  return Math.max(1, Math.min(MAX_POST_COMMENT_PAGE_SIZE, Math.floor(value)));
}

function displayNameForUser(user: KingUser) {
  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return user.display_name?.trim() || fullName || "Reylumi customer";
}

export function isPostCommentTargetType(
  value: string | null | undefined,
): value is PostCommentTargetType {
  return POST_COMMENT_TARGET_TYPES.includes(value as PostCommentTargetType);
}

export function normalizePostCommentTarget(
  input: PostCommentTarget,
): PostCommentTarget | null {
  const sourceId = cleanUuid(input.sourceId);

  if (!sourceId || !isPostCommentTargetType(input.sourceType)) {
    return null;
  }

  return {
    profileId: cleanUuid(input.profileId ?? null),
    salonId: cleanUuid(input.salonId ?? null),
    sourceId,
    sourceType: input.sourceType,
    title: cleanTitle(input.title),
  };
}

export function emptyPostCommentPage(
  error: string | null = null,
): PostCommentPage {
  return {
    error,
    hasMore: false,
    items: [],
    nextOffset: null,
    rootCount: 0,
    totalCount: 0,
  };
}

function commentTargetColumns(target: PostCommentTarget) {
  return {
    beauty_post_id:
      target.sourceType === "beauty_post" ? target.sourceId : null,
    look_id:
      target.sourceType === "salon_profile_look" ? target.sourceId : null,
    update_id:
      target.sourceType === "salon_profile_update" ? target.sourceId : null,
  };
}

function commentTargetKey(target: PostCommentTarget) {
  return `${target.sourceType}:${target.sourceId}`;
}

function rowTargetType(row: CommentRow): PostCommentTargetType {
  if (row.beauty_post_id) {
    return "beauty_post";
  }

  return row.update_id ? "salon_profile_update" : "salon_profile_look";
}

function rowTargetId(row: CommentRow) {
  return row.beauty_post_id ?? row.update_id ?? row.look_id ?? "";
}

function mapCommentRow(row: CommentRow): PostComment {
  const targetType = rowTargetType(row);

  return {
    authorDisplayName: getHistoricalUserDisplayName({
      context: "review",
      fallbackName: row.author_display_name ?? "Reylumi customer",
    }),
    authorUserId: row.author_user_id,
    beautyPostId: row.beauty_post_id ?? null,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    id: row.id,
    isSalonReply: row.is_salon_reply === true,
    lookId: row.look_id,
    parentCommentId: row.parent_comment_id,
    salonId: row.salon_id,
    targetId: rowTargetId(row),
    targetType,
    updatedAt: row.updated_at,
    updateId: row.update_id,
  };
}

async function getReadableSupabaseClient() {
  return (await createAuthenticatedSupabaseServerClient()) ?? createSupabaseServerClient();
}

export async function getPostCommentViewer(
  options: {
    canModerate?: boolean;
    canReplyAsSalon?: boolean;
  } = {},
): Promise<PostCommentViewer> {
  const user = await getCurrentKingUser();

  return {
    canModerate: options.canModerate === true,
    canReplyAsSalon: options.canReplyAsSalon === true,
    isAuthenticated: Boolean(user),
    userId: user?.id ?? null,
  };
}

export async function loadPostCommentsPage(input: {
  offset?: number | null;
  pageSize?: number | null;
  target: PostCommentTarget;
}): Promise<PostCommentPage> {
  const target = normalizePostCommentTarget(input.target);

  if (!target) {
    return emptyPostCommentPage("Comment target is not valid.");
  }

  const supabase = await getReadableSupabaseClient();

  if (!supabase) {
    return emptyPostCommentPage("Comments are unavailable right now.");
  }

  const pageSize = normalizePageSize(input.pageSize);
  const offset =
    typeof input.offset === "number" && Number.isFinite(input.offset)
      ? Math.max(0, Math.floor(input.offset))
      : 0;
  const { data, error } = await supabase.rpc("get_public_post_comments", {
    p_limit: pageSize,
    p_offset: offset,
    p_target_id: target.sourceId,
    p_target_type: target.sourceType,
  });

  if (error) {
    console.error("Supabase load post comments failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      target: commentTargetKey(target),
    });

    return emptyPostCommentPage("Comments could not be loaded.");
  }

  const rows = Array.isArray(data) ? (data as CommentRow[]) : [];
  const first = rows[0];
  const rootCount = readCount(first?.root_count);
  const totalCount = readCount(first?.total_count);
  const rootItems = rows.filter((row) => !row.parent_comment_id);
  const nextOffset = offset + rootItems.length;
  const hasMore = nextOffset < rootCount;

  return {
    error: null,
    hasMore,
    items: rows.map(mapCommentRow),
    nextOffset: hasMore ? nextOffset : null,
    rootCount,
    totalCount,
  };
}

async function countForTarget(target: PostCommentTarget) {
  const normalized = normalizePostCommentTarget(target);
  const supabase = await getReadableSupabaseClient();

  if (!normalized || !supabase) {
    return 0;
  }

  const { data, error } = await supabase.rpc("count_public_post_comments", {
    p_target_id: normalized.sourceId,
    p_target_type: normalized.sourceType,
  });

  if (error) {
    return 0;
  }

  return readCount(data as number | string | null);
}

export async function getPostCommentCounts(targets: PostCommentTarget[]) {
  const normalizedTargets = targets
    .map(normalizePostCommentTarget)
    .filter((target): target is PostCommentTarget => Boolean(target));
  const uniqueTargets = Array.from(
    new Map(normalizedTargets.map((target) => [commentTargetKey(target), target])).values(),
  );
  const counts = new Map<string, number>();

  await Promise.all(
    uniqueTargets.map(async (target) => {
      counts.set(commentTargetKey(target), await countForTarget(target));
    }),
  );

  return counts;
}

export function getPostCommentCount(
  counts: Map<string, number>,
  target: PostCommentTarget,
) {
  return counts.get(commentTargetKey(target)) ?? 0;
}

async function ensureCommentBelongsToTarget(input: {
  commentId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  target: PostCommentTarget;
}) {
  const columns = commentTargetColumns(input.target);
  let query = input.supabase
    .from("salon_profile_comments")
    .select("id, author_user_id, salon_id, look_id, update_id, beauty_post_id, parent_comment_id")
    .eq("id", input.commentId);

  if (columns.look_id) {
    query = query.eq("look_id", columns.look_id);
  }

  if (columns.update_id) {
    query = query.eq("update_id", columns.update_id);
  }

  if (columns.beauty_post_id) {
    query = query.eq("beauty_post_id", columns.beauty_post_id);
  }

  const { data, error } = await query.maybeSingle<{
    author_user_id: string | null;
    beauty_post_id: string | null;
    id: string;
    look_id: string | null;
    parent_comment_id: string | null;
    salon_id: string | null;
    update_id: string | null;
  }>();

  if (error || !data) {
    throw new Error("Comment could not be found.");
  }

  return data;
}

export async function createPostComment(input: {
  asSalonReply?: boolean;
  body: string;
  parentCommentId?: string | null;
  target: PostCommentTarget;
}): Promise<{ comment: PostComment; totalCount: number }> {
  const target = normalizePostCommentTarget(input.target);
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!target || !supabase || !user) {
    throw new Error("Sign in to comment.");
  }

  const body = cleanBody(input.body);

  if (!body) {
    throw new Error("Write a comment before posting.");
  }

  if (body.length > 1000) {
    throw new Error("Keep comments under 1000 characters.");
  }

  const parentCommentId = cleanUuid(input.parentCommentId ?? null);
  const insertPayload = {
    author_display_name: displayNameForUser(user),
    author_user_id: user.id,
    body,
    is_salon_reply: input.asSalonReply === true,
    parent_comment_id: parentCommentId,
    salon_id: target.salonId ?? null,
    status: "visible",
    ...commentTargetColumns(target),
  };

  const { data, error } = await supabase
    .from("salon_profile_comments")
    .insert(insertPayload)
    .select(
      "id, salon_id, look_id, update_id, beauty_post_id, parent_comment_id, author_user_id, author_display_name, body, is_salon_reply, created_at, updated_at, edited_at",
    )
    .single<CommentRow>();

  if (error || !data) {
    console.error("Supabase create post comment failed", {
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      message: error?.message,
      target: commentTargetKey(target),
      userId: user.id,
    });
    throw new Error(error?.message ?? "Comment could not be posted.");
  }

  return {
    comment: mapCommentRow(data),
    totalCount: await countForTarget(target),
  };
}

export async function updatePostComment(input: {
  body: string;
  commentId: string;
  target: PostCommentTarget;
}): Promise<{ comment: PostComment; totalCount: number }> {
  const target = normalizePostCommentTarget(input.target);
  const commentId = cleanUuid(input.commentId);
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!target || !commentId || !supabase || !user) {
    throw new Error("Sign in to edit this comment.");
  }

  const body = cleanBody(input.body);

  if (!body) {
    throw new Error("Write a comment before saving.");
  }

  if (body.length > 1000) {
    throw new Error("Keep comments under 1000 characters.");
  }

  const current = await ensureCommentBelongsToTarget({
    commentId,
    supabase,
    target,
  });

  if (current.author_user_id !== user.id) {
    throw new Error("Only the author can edit this comment.");
  }

  const { data, error } = await supabase
    .from("salon_profile_comments")
    .update({ body })
    .eq("id", commentId)
    .select(
      "id, salon_id, look_id, update_id, beauty_post_id, parent_comment_id, author_user_id, author_display_name, body, is_salon_reply, created_at, updated_at, edited_at",
    )
    .single<CommentRow>();

  if (error || !data) {
    throw new Error(error?.message ?? "Comment could not be saved.");
  }

  return {
    comment: mapCommentRow(data),
    totalCount: await countForTarget(target),
  };
}

export async function deletePostComment(input: {
  commentId: string;
  target: PostCommentTarget;
}): Promise<{ totalCount: number }> {
  const target = normalizePostCommentTarget(input.target);
  const commentId = cleanUuid(input.commentId);
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!target || !commentId || !supabase || !user) {
    throw new Error("Sign in to delete this comment.");
  }

  const current = await ensureCommentBelongsToTarget({
    commentId,
    supabase,
    target,
  });

  if (current.author_user_id !== user.id) {
    throw new Error("Only the author can delete this comment.");
  }

  const { error } = await supabase
    .from("salon_profile_comments")
    .update({ status: "deleted" })
    .eq("id", commentId);

  if (error) {
    throw new Error(error.message);
  }

  return {
    totalCount: await countForTarget(target),
  };
}

export async function hidePostComment(input: {
  commentId: string;
  target: PostCommentTarget;
}): Promise<{ totalCount: number }> {
  const target = normalizePostCommentTarget(input.target);
  const commentId = cleanUuid(input.commentId);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!target || !commentId || !supabase) {
    throw new Error("Sign in to update this comment.");
  }

  await ensureCommentBelongsToTarget({
    commentId,
    supabase,
    target,
  });

  const { error } = await supabase
    .from("salon_profile_comments")
    .update({ status: "hidden" })
    .eq("id", commentId);

  if (error) {
    throw new Error(error.message);
  }

  return {
    totalCount: await countForTarget(target),
  };
}
