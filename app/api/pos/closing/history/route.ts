import { getRequestBusinessContext } from "@/lib/request-business-context";
import { isSalonManageContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { runWithReadContext } from "@/lib/read-context-scope";

export async function GET(request: Request) {
  return runWithReadContext(async () => {
    const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
    const args = new URL(request.url).searchParams;
    const salonId = args.get("salonId"), date = args.get("date");
    if (!salonId || !/^[a-f0-9-]{36}$/i.test(salonId) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply({ error: "Invalid report." }, 400);
    const context = await getRequestBusinessContext();
    if (!context.user) return reply({ error: "Sign in required." }, 401);
    if (!isSalonManageContext(context) || context.currentSalon?.id !== salonId || !await hasPermission("reports.view", context)) return reply({ error: "Report access required." }, 403);
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) return reply({ error: "Please retry." }, 503);
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("payroll_live_change_history").select("*").eq("salon_id", salonId).eq("source_table", "pos_daily_closings").eq("period_start", date).order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
      if (error) return reply({ error: "Change history could not be loaded. Please retry." }, 503);
      rows.push(...data ?? []);
      if (!data || data.length < 1000) break;
    }
    return reply({ rows });
  });
}
