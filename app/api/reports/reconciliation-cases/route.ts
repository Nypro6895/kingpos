import { getRequestBusinessContext } from "@/lib/request-business-context";
import { isOwnerMembership, isSalonManageContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, salonId = params.get("salonId"), start = params.get("start"), end = params.get("end");
  const context = await getRequestBusinessContext();
  const reply = (body: unknown, status = 200) => Response.json(body, {status, headers: {"Cache-Control": "private, no-store"}});
  if (!context.user || !isSalonManageContext(context) || !isOwnerMembership(context.currentMembership) || context.currentSalon?.id !== salonId) return reply({error: "Owner access required."}, 403);
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return reply({error: "Invalid date range."}, 400);
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) return reply({error: "Please retry."}, 503);
  const {data, error} = await client.from("daily_reconciliation_cases").select("id,business_date,revision,status,latest_values,updated_at,revisions:daily_reconciliation_revisions(revision,values,created_at)").eq("salon_id", salonId).gte("business_date", start).lte("business_date", end).order("business_date", {ascending: false});
  return error ? reply({error: "Daily reconciliation reports could not be loaded."}, 503) : reply({rows: data ?? []});
}
