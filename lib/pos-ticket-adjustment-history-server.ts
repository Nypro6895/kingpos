import "server-only";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { ticketAdjustmentEventAction, visibleTicketAdjustments } from "@/lib/pos-ticket-adjustment-history";

type Client = NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;

export async function loadVisibleTicketAdjustments<T extends { id: string }>(client: Client, rows: readonly T[]) {
  const ids = [...new Set(rows.map(row => row.id))];
  const actions = new Map<string, ReturnType<typeof ticketAdjustmentEventAction>>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const result = await client.rpc("get_pos_ticket_adjustment_metadata", { p_adjustment_ids: ids.slice(offset, offset + 500) });
    if (result.error || !Array.isArray(result.data)) throw new Error("Ticket correction history could not be loaded. Please retry.");
    for (const item of result.data as Array<{ adjustment_id: string; event_action: unknown }>) {
      const action = ticketAdjustmentEventAction(item.event_action);
      if (action) actions.set(item.adjustment_id, action);
    }
  }
  if (ids.some(id => !actions.has(id))) throw new Error("Ticket correction history is incomplete. Please retry.");
  return visibleTicketAdjustments(rows.map(row => ({ ...row, event_action: actions.get(row.id) })));
}
