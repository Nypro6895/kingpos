"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  POS_STAFF_BROADCAST_EVENT,
  getPosStaffRealtimeChannel,
  type PosStaffBroadcastPayload,
} from "@/lib/pos-staff-realtime";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type PosWorkspaceRealtimeRefreshProps = {
  salonId?: string | null;
};

export function PosWorkspaceRealtimeRefresh({
  salonId,
}: PosWorkspaceRealtimeRefreshProps) {
  const router = useRouter();
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!salonId) {
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    function refreshSoon() {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 75);
    }

    const channel = supabase
      .channel(getPosStaffRealtimeChannel(salonId))
      .on(
        "broadcast",
        { event: POS_STAFF_BROADCAST_EVENT },
        ({ payload }: { payload: PosStaffBroadcastPayload }) => {
          if (payload.salonId === salonId) {
            refreshSoon();
          }
        },
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
  }, [router, salonId]);

  return null;
}
