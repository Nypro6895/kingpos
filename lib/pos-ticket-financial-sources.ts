import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PosTicketWithRelations } from "@/types/pos-ticket";

export async function attachTicketFinancialSources<T extends PosTicketWithRelations>(
  supabase: SupabaseClient, salonId: string, tickets: T[], signed?: {keyId:string;signature:string},
): Promise<T[]> {
  if (!tickets.length) return tickets;
  const sources = await loadTicketFinancialSourceMap(supabase,salonId,tickets.map(ticket=>ticket.id),signed);
  return tickets.map(ticket=>({...ticket,financial_sources:sources[ticket.id]}));
}

export async function loadTicketFinancialSourceMap(supabase:SupabaseClient,salonId:string,ticketIds:string[],signed?:{keyId:string;signature:string}) {
  const sources: Record<string, NonNullable<PosTicketWithRelations["financial_sources"]>> = {};
  // Bound RPC size without returning a partial receipt when any batch fails.
  for (let i=0;i<ticketIds.length;i+=500) {
    const {data,error} = await supabase.rpc("ticket_financial_sources",{
      p_salon:salonId,p_tickets:ticketIds.slice(i,i+500),
      p_key:signed?.keyId ?? null,p_signature:signed?.signature ?? null,
    });
    if (error || !data) throw new Error("Gift and Reward receipt details could not be loaded. Please retry.");
    Object.assign(sources,data);
  }
  return sources;
}
