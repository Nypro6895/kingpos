import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { adminCsvCell } from "@/lib/platform-admin/csv";

type LedgerRow = { id: string; occurred_at: string; kind: string; bank_account_id: string; bank_reference: string; order_reference: string | null; plugin_name: string | null; publisher: string | null; salon_id: string | null; amount_cents: number; revenue_cents: number; tax_cents: number; fee_cents: number; commission_cents: number; publisher_payable_cents: number; unapplied_cents: number; expense_cents: number; note: string | null };
const money = (cents: number) => cents / 100;
const csvCell = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : adminCsvCell(value);

export async function GET(request: NextRequest) {
  const actor = await getCurrentPlatformAdminContext();
  if (actor?.roleSlug !== "platform_owner" || !actor.permissions.includes(P.teamManage)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const from = request.nextUrl.searchParams.get("from"), to = request.nextUrl.searchParams.get("to");
  if ([from, to].some(value => value && (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) || !Number.isFinite(Date.parse(value)))) || (from && to && Date.parse(from) >= Date.parse(to))) return NextResponse.json({ error: "Choose a valid date range. The end date is exclusive." }, { status: 400 });
  try {
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
    const { data, error } = await client.rpc("market_billing_export_ledger", { p_from: from, p_to: to });
    if (error || !data || !Array.isArray(data.ledger) || data.row_count !== data.ledger.length) throw new Error("Incomplete export");
    const rows = [["Entry ID", "Date (UTC)", "Kind", "Bank account ID", "Bank reference", "Order reference", "Plugin", "Publisher", "Business ID", "Cash in USD", "Cash out USD", "Revenue USD", "Tax USD", "Fees USD", "Commission USD", "Publisher payable USD", "Unapplied movement USD", "Business expense USD", "Note"], ...(data.ledger as LedgerRow[]).map(entry => [entry.id, entry.occurred_at, entry.kind, entry.bank_account_id, entry.bank_reference, entry.order_reference, entry.plugin_name, entry.publisher, entry.salon_id, money(entry.kind === "cash_in" ? entry.amount_cents : 0), money(entry.kind !== "cash_in" ? entry.amount_cents : 0), money(entry.revenue_cents), money(entry.tax_cents), money(entry.fee_cents), money(entry.commission_cents), money(entry.publisher_payable_cents), money(entry.unapplied_cents), money(entry.expense_cents), entry.note])];
    return new NextResponse("\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=reylumi-market-ledger.csv", "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "The ledger could not be exported completely. Please retry." }, { status: 503 }); }
}
