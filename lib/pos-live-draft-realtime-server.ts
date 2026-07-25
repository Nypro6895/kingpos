import "server-only";

import {
  getPosLiveDraftRealtimeChannel,
  POS_LIVE_DRAFT_BROADCAST_EVENT,
  type PosLiveDraftBroadcastPayload,
} from "@/lib/pos-live-draft-realtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PosLiveDraftView } from "@/types/pos-desk";

export async function broadcastPosLiveDraftSnapshot(
  snapshot: PosLiveDraftView,
  source: PosLiveDraftBroadcastPayload["source"],
) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const channel = supabase.channel(
    getPosLiveDraftRealtimeChannel(snapshot.token),
  );

  try {
    await channel.httpSend(POS_LIVE_DRAFT_BROADCAST_EVENT, {
      resetAt: snapshot.reset_at,
      source,
      status: snapshot.status,
      token: snapshot.token,
      updatedAt: snapshot.updated_at,
      version: snapshot.version,
    } satisfies PosLiveDraftBroadcastPayload);
  } catch (error) {
    console.warn("Unable to broadcast POS live draft snapshot", {
      error: error instanceof Error ? error.message : error,
      token: snapshot.token,
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}
