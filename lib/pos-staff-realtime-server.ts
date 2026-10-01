import "server-only";

import {
  getPosStaffRealtimeChannel,
  POS_STAFF_BROADCAST_EVENT,
  type PosStaffBroadcastPayload,
} from "@/lib/pos-staff-realtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function broadcastPosStaffChange(
  salonId: string,
  source: PosStaffBroadcastPayload["source"],
) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const channel = supabase.channel(getPosStaffRealtimeChannel(salonId));

  try {
    await channel.httpSend(POS_STAFF_BROADCAST_EVENT, {
      changedAt: new Date().toISOString(),
      salonId,
      source,
    } satisfies PosStaffBroadcastPayload);
  } catch (error) {
    console.warn("Unable to broadcast POS staff change", {
      error: error instanceof Error ? error.message : error,
      salonId,
      source,
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}
