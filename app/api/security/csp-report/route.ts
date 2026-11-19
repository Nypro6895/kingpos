import { createCspReportBudget, readCspReportBody, summarizeCspReports } from "@/lib/csp-report";
import { RequestBodyError } from "@/lib/request-body";
import { effectiveRequestOrigin } from "@/lib/request-origin";

const admit = createCspReportBudget();
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  const origin = effectiveRequestOrigin(request);
  const claimedOrigin = request.headers.get("origin");
  if ((claimedOrigin && claimedOrigin !== origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403, headers });
  }
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  if (!["application/csp-report", "application/reports+json", "application/json"].includes(type ?? "")) {
    return new Response(null, { status: 415, headers });
  }
  if (!admit()) return new Response(null, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  try {
    const summaries = summarizeCspReports(await readCspReportBody(request), origin, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (summaries.length) console.warn("security.csp", JSON.stringify(summaries));
    return new Response(null, { status: 204, headers });
  } catch (error) {
    return new Response(null, { status: error instanceof RequestBodyError ? error.status : 400, headers });
  }
}
