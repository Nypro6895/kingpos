import "server-only";
import { marketServiceClient } from "@/lib/market-payments";
import type { PosDeskService } from "@/types/pos-desk";

// Called only after the Portable session has been verified. Scope to that salon
// and to the existing RPC catalog; never expand the services returned by the RPC.
export async function withPortableServiceAddOns(services: PosDeskService[], salonId: string): Promise<PosDeskService[]> {
  if (!services.length) return services;
  const { data, error } = await marketServiceClient().from("services")
    .select("id, booking_parent_service_id").eq("salon_id", salonId).in("id", services.map(service=>service.id));
  if (error) throw new Error("Unable to load service groups. Please try again.");
  const parents = new Map((data ?? []).map(service=>[service.id,service.booking_parent_service_id]));
  return services.map(service=>({...service,booking_parent_service_id:parents.get(service.id) ?? null}));
}
