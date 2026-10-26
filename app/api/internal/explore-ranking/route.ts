import { timingSafeEqual } from "node:crypto";
import { runExploreSearchRankingWorker } from "@/lib/explore-search-ranking";


export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ configured: false }, { status: 503 });
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response("Unauthorized", { status: 401 });
  try {
    const result = await runExploreSearchRankingWorker({ batchSize: 50, maxBatches: 6, signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]) });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const failure = cause as { code?: unknown; phase?: unknown };
    const code = typeof failure?.code === "string" && /^[0-9A-Z]{5}$/.test(failure.code) ? failure.code : null;
    const phase = typeof failure?.phase === "string" && /^[a-z_]{1,80}$/.test(failure.phase) ? failure.phase : "worker";
    return Response.json({ error: "Ranking refresh could not finish.", code, phase }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = POST;
