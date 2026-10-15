import { timingSafeEqual } from "node:crypto";
import { abuseServiceClient } from "@/lib/abuse-server";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization") ?? "";
  const token = expected ? `Bearer ${expected}` : "";
  if (!token || actual.length !== token.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(token))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await abuseServiceClient().rpc("cleanup_abuse_data");
  return Response.json(error ? { error: "Cleanup failed" } : { ok: true }, { status: error ? 503 : 200 });
}
