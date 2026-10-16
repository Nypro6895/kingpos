import { timingSafeEqual } from "node:crypto";
import { abuseServiceClient } from "@/lib/abuse-server";
import { cleanupAppLocalUploadStages } from "@/lib/app-local-upload-server";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get("authorization") ?? "";
  const token = expected ? `Bearer ${expected}` : "";
  if (!token || actual.length !== token.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(token))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await abuseServiceClient().rpc("cleanup_abuse_data");
  // Reuse the existing authenticated maintenance schedule. Only random objects
  // belonging to expired, service-only upload sessions can be removed here.
  await cleanupAppLocalUploadStages(32).catch(() => {});
  return Response.json(error ? { error: "Cleanup failed" } : { ok: true }, { status: error ? 503 : 200 });
}
