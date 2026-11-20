import { connection } from "next/server";
import { forumRpc } from "@/lib/forum/server";
import type { ForumPreview } from "@/types/forum";

export async function GET() {
  await connection();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const posts = await forumRpc<ForumPreview[]>("forum_read", { mode: "latest_preview" });
    return Response.json({ posts }, { headers });
  } catch {
    // Optional Today content never exposes backend errors or blocks the dashboard.
    return Response.json({ posts: [] }, { status: 503, headers });
  }
}
