import "server-only";
import { marketServiceClient } from "./market-payments";
import type { ReceiptBrand } from "@/types/receipt-print";

/** Call only after the original Portable session/salon authorization. */
export async function loadPortableReceiptBrand(session: { salon_id: string; salon_name: string; salon_logo_url: string | null }): Promise<ReceiptBrand> {
  const basic = { salonName: session.salon_name, logoUrl: session.salon_logo_url };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.salon_id)) throw new Error("Invalid POS salon context.");
  try {
    const { data } = await marketServiceClient().from("locations").select("phone,address_line1,address_line2,city,state,postal_code").eq("id", session.salon_id).abortSignal(AbortSignal.timeout(3000)).maybeSingle();
    return { ...basic, phone: data?.phone ?? null, address: data ? [data.address_line1, data.address_line2, data.city, data.state, data.postal_code].filter(Boolean).join(", ") : null };
  } catch { return basic; }
}
