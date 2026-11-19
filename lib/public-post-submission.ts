import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export class PostSubmissionUnknownError extends Error {
  constructor() { super("We could not confirm whether your post was published. Retry this same post to check safely."); }
}
export type PostSubmission = { requestId: string; request: Record<string, unknown> };

export async function publishSalonPostOnce<T>(input: {
  client: SupabaseClient; submission: PostSubmission; kind: "look" | "update";
  row: Record<string, unknown>; hashtags: string[]; booking: Record<string, unknown>;
}): Promise<T> {
  let result;
  try {
    result = await input.client.rpc("publish_salon_post_once", {
      p_request_id: input.submission.requestId, p_request: input.submission.request,
      p_kind: input.kind, p_row: input.row, p_hashtags: input.hashtags, p_booking: input.booking,
    });
  } catch { throw new PostSubmissionUnknownError(); }
  if (result.error) {
    // SQL exceptions roll the entire transaction back. Transport errors do not prove rollback.
    if (result.error.code === "P0001") throw new Error(result.error.message);
    throw new PostSubmissionUnknownError();
  }
  const data = result.data as { id?: string; status?: string; safety_hold?: boolean } | null;
  if (!data || data.id !== input.submission.requestId || data.status !== "published" || data.safety_hold !== false) throw new PostSubmissionUnknownError();
  return data as T;
}
