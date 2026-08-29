"use server";

import {
  createPostComment,
  deletePostComment,
  hidePostComment,
  loadPostCommentsPage,
  updatePostComment,
  type PostComment,
  type PostCommentPage,
  type PostCommentTarget,
} from "@/lib/post-comments";
import { getSalonProfileHref } from "@/lib/salon-profile";
import { revalidatePath } from "next/cache";

type CommentMutationResult<T extends object = object> =
  | ({ error: null } & T)
  | { error: string };

function revalidatePostCommentTarget(target: PostCommentTarget) {
  revalidatePath("/", "layout");
  revalidatePath("/explore");
  revalidatePath("/notifications");

  if (target.salonId) {
    revalidatePath("/salon-profile");
    revalidatePath(getSalonProfileHref(target.salonId));
  }

  if (target.sourceType === "beauty_post") {
    revalidatePath("/beauty");

    if (target.profileId) {
      revalidatePath(`/explore/beauty/${target.profileId}`);
      revalidatePath(`/explore/beauty/${target.profileId}/posts/${target.sourceId}`);
    }
  }
}

export async function loadPostCommentsAction(input: {
  offset?: number | null;
  pageSize?: number | null;
  target: PostCommentTarget;
}): Promise<PostCommentPage> {
  return loadPostCommentsPage(input);
}

export async function createPostCommentAction(input: {
  asSalonReply?: boolean;
  body: string;
  parentCommentId?: string | null;
  target: PostCommentTarget;
}): Promise<CommentMutationResult<{ comment: PostComment; totalCount: number }>> {
  try {
    const result = await createPostComment(input);
    revalidatePostCommentTarget(input.target);
    return { ...result, error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Comment could not be posted.",
    };
  }
}

export async function updatePostCommentAction(input: {
  body: string;
  commentId: string;
  target: PostCommentTarget;
}): Promise<CommentMutationResult<{ comment: PostComment; totalCount: number }>> {
  try {
    const result = await updatePostComment(input);
    revalidatePostCommentTarget(input.target);
    return { ...result, error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Comment could not be saved.",
    };
  }
}

export async function deletePostCommentAction(input: {
  commentId: string;
  target: PostCommentTarget;
}): Promise<CommentMutationResult<{ totalCount: number }>> {
  try {
    const result = await deletePostComment(input);
    revalidatePostCommentTarget(input.target);
    return { ...result, error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Comment could not be deleted.",
    };
  }
}

export async function hidePostCommentAction(input: {
  commentId: string;
  target: PostCommentTarget;
}): Promise<CommentMutationResult<{ totalCount: number }>> {
  try {
    const result = await hidePostComment(input);
    revalidatePostCommentTarget(input.target);
    return { ...result, error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Comment could not be hidden.",
    };
  }
}
