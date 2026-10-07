import { isPostCommentTargetType, loadPostCommentsPage, normalizePostCommentTarget } from "@/lib/post-comments";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sourceType = params.get("sourceType");
  if (!isPostCommentTargetType(sourceType)) {
    return Response.json({ error: "Comment target is not valid." }, { status: 400 });
  }
  const target = normalizePostCommentTarget({ sourceType, sourceId: params.get("sourceId") ?? "" });
  if (!target) return Response.json({ error: "Comment target is not valid." }, { status: 400 });
  const started = performance.now();
  try {
    const page = await loadPostCommentsPage({
      target,
      offset: Number(params.get("offset") ?? 0),
      pageSize: Number(params.get("pageSize") ?? 10),
    });
    return Response.json(page, {
      status: page.error ? 503 : 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `comments;dur=${(performance.now() - started).toFixed(1)}`,
      },
    });
  } catch {
    return Response.json({ error: "Comments could not be loaded. Please try again." }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
