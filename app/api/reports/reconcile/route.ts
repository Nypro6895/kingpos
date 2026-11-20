import { timingSafeEqual } from "node:crypto";
import { marketServiceClient } from "@/lib/market-payments";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ""}`), actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return Response.json({error: "Unauthorized"}, {status: 401});
  const {data, error} = await marketServiceClient().rpc("reconcile_closed_business_days", {p_limit: 200});
  return error ? Response.json({error: "Reconciliation could not complete."}, {status: 503}) : Response.json({checked: data});
}
