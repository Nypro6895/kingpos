"use client";

import { useEffect, useRef, useState } from "react";
import { SALON_FOLLOW_CHANGED, publishSalonFollowChange, salonFollowChange } from "@/lib/salon-follow-state";

/** Public profile payloads are cacheable; follow state belongs to the current viewer. */
export function useSalonFollowState(salonId: string, viewerId: string | null, initialFollowing: boolean) {
  const scope = `${viewerId ?? "guest"}:${salonId}`;
  const [state, setState] = useState({ scope, following: Boolean(viewerId && initialFollowing), loading: Boolean(viewerId), error: "" });
  const revision = useRef(0);
  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    const changed = (event: Event) => {
      const value = salonFollowChange(event, viewerId);
      if (!value || value.salonId !== salonId) return;
      revision.current++;
      controller?.abort();
      setState({ scope, following: value.following, loading: false, error: "" });
    };
    const read = async () => {
      if (!viewerId || document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      const request = controller;
      const version = ++revision.current;
      try {
        const response = await fetch(`/api/explore/salon-social?ids=${encodeURIComponent(salonId)}`, { cache: "no-store", signal: request.signal });
        const result = await response.json();
        const following = result.states?.[salonId]?.following;
        if (!response.ok || typeof following !== "boolean") throw Error("Follow status could not be loaded. Please try again.");
        if (alive && version === revision.current) setState({ scope, following, loading: false, error: "" });
      } catch {
        if (alive && !request.signal.aborted && version === revision.current) setState(current => ({ scope, following: current.scope === scope ? current.following : initialFollowing, loading: false, error: "Follow status could not be loaded. Please try again." }));
      }
    };
    window.addEventListener(SALON_FOLLOW_CHANGED, changed);
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    void read();
    return () => { alive = false; controller?.abort(); window.removeEventListener(SALON_FOLLOW_CHANGED, changed); window.removeEventListener("focus", read); document.removeEventListener("visibilitychange", read); };
  }, [salonId, viewerId, scope, initialFollowing]);
  const current = state.scope === scope ? state : { following: Boolean(viewerId && initialFollowing), loading: Boolean(viewerId), error: "" };
  return {
    following: viewerId ? current.following : false,
    loading: viewerId ? current.loading : false,
    error: viewerId ? current.error : "",
    commit(following: boolean) { if (viewerId) publishSalonFollowChange({ viewerId, salonId, following }); },
  };
}
