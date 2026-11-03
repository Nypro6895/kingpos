"use server";

import { forumRpc } from "@/lib/forum/server";
import type { ForumInput, ForumResult } from "@/types/forum";

function validated(input: ForumInput) {
  if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 30000 ||
      Object.entries(input).some(([key, value]) => key.length > 40 || (value !== null && !["string", "boolean"].includes(typeof value)))) {
    throw new Error("The forum request is too large or invalid.");
  }
  return input;
}

export async function readForum(input: ForumInput): Promise<ForumResult<unknown>> {
  try { return { data: await forumRpc("forum_read", validated(input)) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Unable to load forum." }; }
}

export async function writeForum(input: ForumInput): Promise<ForumResult<{ id?: string; ok?: boolean }>> {
  try { return { data: await forumRpc<{ id?: string; ok?: boolean }>("forum_write", validated(input)) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Unable to save changes." }; }
}
