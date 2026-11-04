"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import { rewardTransport } from "@/lib/rewardlumi-client";
import { rewardWalletCards, validateRewardWallet } from "@/lib/reward-wallet";
import type { RewardTransport, RewardView } from "@/types/rewardlumi";

type Snapshot = { key: string; cards: RewardView[] | null; error: string; loading: boolean; invalidated?: boolean };
const empty: Snapshot = { key: "", cards: null, error: "", loading: true };

/** Private reads only. Refresh on return/reconnect, with no background polling. */
export function useRewardWallet({ viewerId, transport, enabled = true }: { viewerId?: string | null; transport?: RewardTransport; enabled?: boolean } = {}) {
  const scope = useExperienceScope();
  const account = viewerId === undefined ? scope?.context.viewerId ?? "session" : viewerId;
  const allowed = enabled && Boolean(account) && (!scope || (scope.context.authenticated && (!viewerId || scope.context.viewerId === viewerId)));
  const key = `${scope?.context.scope ?? "personal"}:${account ?? "guest"}`;
  const send = useMemo(() => transport ?? rewardTransport("personal"), [transport]);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const epoch = useRef(0), request = useRef(0), mounted = useRef(false), suspended = useRef(false), lastRead = useRef(0), pending = useRef(false);
  const read = useCallback(async (force = false) => {
    if (!allowed || !mounted.current || suspended.current || pending.current || (!force && Date.now() - lastRead.current < 30_000)) return;
    const generation = epoch.current, id = ++request.current;
    pending.current = true;
    setSnapshot(previous => ({ key, cards: previous.key === key ? previous.cards : null, error: "", loading: true }));
    try {
      const reply = await send("wallet");
      validateRewardWallet(reply.cards);
      if (!mounted.current || generation !== epoch.current || id !== request.current) return;
      lastRead.current = Date.now();
      setSnapshot({ key, cards: rewardWalletCards(reply.cards), error: "", loading: false });
    } catch {
      if (mounted.current && generation === epoch.current && id === request.current) {
        setSnapshot(previous => ({ key, cards: previous.key === key ? previous.cards : null, error: "Your rewards could not be updated. Please try again.", loading: false }));
      }
    } finally { if (generation === epoch.current && id === request.current) pending.current = false; }
  }, [allowed, key, send]);
  useEffect(() => {
    let active = true;
    mounted.current = true; suspended.current = false; pending.current = false; lastRead.current = 0; epoch.current++;
    const invalidate = () => { epoch.current++; request.current++; pending.current = false; };
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine) void read(); };
    const changed = () => { invalidate(); lastRead.current = 0; void read(true); };
    const reset = () => {
      invalidate(); suspended.current = true;
      setSnapshot({ key, cards: null, error: "Your account has changed. Reopen My Rewards to refresh.", loading: false, invalidated: true });
    };
    void Promise.resolve().then(() => { if (active) void read(true); });
    window.addEventListener("reylumi:rewards-changed", changed);
    window.addEventListener("online", refresh); window.addEventListener("focus", refresh); window.addEventListener("reylumi:foreground", refresh);
    document.addEventListener("visibilitychange", refresh); window.addEventListener("reylumi:experience-reset", reset);
    return () => {
      active = false; mounted.current = false; invalidate();
      window.removeEventListener("reylumi:rewards-changed", changed);
      window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("reylumi:foreground", refresh);
      document.removeEventListener("visibilitychange", refresh); window.removeEventListener("reylumi:experience-reset", reset);
    };
  }, [read, key]);
  const current = allowed && snapshot.key === key ? snapshot : empty;
  return { cards: allowed ? current.cards : null, error: allowed ? current.error : "", loading: allowed && current.loading, invalidated: Boolean(current.invalidated), refresh: () => read(true), allowed };
}
