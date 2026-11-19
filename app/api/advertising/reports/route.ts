import { cookies } from "next/headers";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { assertAbuseRequest } from "@/lib/abuse-server";
import { advertisingClient } from "@/lib/explore-advertising";
import { AD_REPORT_COOKIE, AD_REPORT_HEADERS, parseAdReportSubmission, reportActor, submitAdReport } from "@/lib/ad-reporting";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ ok: false, outcome: "rejected", error: "A same-origin request is required." }, { status: 403, headers: AD_REPORT_HEADERS });
  let input;
  try {
    if (request.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") throw new Error("JSON required");
    if (Number(request.headers.get("content-length")) > 40000) throw new Error("Too large");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Body required");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 40000) { await reader.cancel(); throw new Error("Too large"); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk,offset); offset += chunk.byteLength; }
    input = parseAdReportSubmission(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body)));
  } catch { return Response.json({ ok: false, outcome: "rejected", error: "Invalid ad report." }, { status: 400, headers: AD_REPORT_HEADERS }); }
  try {
    const context = await getCurrentBusinessContext();
    const actor = reportActor(context.user?.id ?? null, (await cookies()).get(AD_REPORT_COOKIE[input.kind])?.value);
    if (!actor) return Response.json({ ok: false, outcome: "rejected", error: "This report belongs to an earlier account or browser session. Reload before starting a new report." }, { status: 403, headers: AD_REPORT_HEADERS });
    const client = advertisingClient();
    const result = await submitAdReport(input, actor, { rpc: (name, args) => client.rpc(name, args), admit: () => assertAbuseRequest("report") });
    return Response.json(result, { status: result.ok ? 200 : result.outcome === "unknown" ? 503 : 400, headers: AD_REPORT_HEADERS });
  } catch { return Response.json({ ok: false, outcome: "unknown", error: "Report status is unavailable. Retry this same report." }, { status: 503, headers: AD_REPORT_HEADERS }); }
}
