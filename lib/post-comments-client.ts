import type { PostCommentPage, PostCommentTarget } from "@/types/post-comments";

// Reads use fetch so they do not wait behind the Server Action mutation queue.
export async function fetchPostCommentsPage(input: {
  offset: number;
  pageSize: number;
  target: PostCommentTarget;
}): Promise<PostCommentPage> {
  const params = new URLSearchParams({
    sourceType: input.target.sourceType,
    sourceId: input.target.sourceId,
    offset: String(input.offset),
    pageSize: String(input.pageSize),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/post-comments?${params}`, {
      cache: "no-store", credentials: "same-origin", signal: controller.signal,
    });
    const page = await response.json();
    if (!response.ok || page.error) {
      throw new Error(page.error || "Comments could not be loaded. Please try again.");
    }
    return page as PostCommentPage;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The request took too long. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
