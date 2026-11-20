import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { ForumInput } from "@/types/forum";

export async function forumRpc<T>(name: "forum_read" | "forum_write", input: ForumInput): Promise<T> {
  const client = await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true });
  if (!client) throw new Error("Please sign in to use the forum.");
  const { data, error } = await client.rpc(name, { p_input: input });
  if (error) {
    // PostgreSQL validation errors are safe; never return raw infrastructure diagnostics.
    if (error.code === "42501" || error.code === "P0001" || error.code === "P0002") throw new Error(error.message);
    if (error.code === "23505") throw new Error("That record already exists. Try another section name.");
    if (error.code === "23514" || error.code === "23502" || error.code === "22P02") throw new Error("Check the required fields and their lengths, then try again.");
    console.error("Forum RPC failed", { name, code: error.code });
    throw new Error(error.code === "PGRST202" ? "The forum is being prepared. Please try again shortly." : "Forum service is temporarily unavailable. Please retry.");
  }
  return data as T;
}
