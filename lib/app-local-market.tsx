"use client";
import { useCallback, useEffect, useRef } from "react";
import { MarketClient } from "@/app/market/market-client";
import { reconcileMarketReturnAction } from "@/app/market/payment-return-actions";
import type { MarketExperienceData } from "@/types/market-experience";
import type { MarketBrowse } from "@/app/market/market-browse";

export function AppLocalMarket({ data, refresh, verifiedAt, returnSequence, initialBrowse }: {
  data: MarketExperienceData;
  refresh: () => Promise<void>;
  verifiedAt?: number;
  returnSequence: string | null;
  initialBrowse?: MarketBrowse;
}) {
  const { experienceScope, marketSalonId } = data;
  const refreshMarket = useCallback(() => { void refresh(); }, [refresh]);
  const reconciliation = useRef<{ key: string; revision?: number; attemptedRevision?: number; attempted: boolean; inFlight: boolean; complete: boolean } | undefined>(undefined);
  useEffect(() => () => { reconciliation.current = undefined; }, []);
  useEffect(() => {
    if (!returnSequence || !marketSalonId || !experienceScope) { reconciliation.current = undefined; return; }
    const generation = window.__reylumiAppLocalContext?.generation;
    const key = JSON.stringify([returnSequence, marketSalonId, experienceScope, generation]);
    if (reconciliation.current?.key !== key) reconciliation.current = { key, revision: verifiedAt, attempted: false, inFlight: false, complete: false };
    const attempt = reconciliation.current;
    attempt.revision = verifiedAt;
    const current = () => reconciliation.current === attempt && generation === window.__reylumiAppLocalContext?.generation;
    const reconcile = () => {
      if (!current() || attempt.inFlight || attempt.complete || attempt.attempted && (!attempt.revision || attempt.attemptedRevision === attempt.revision)) return;
      const revision = attempt.revision;
      attempt.attempted = true; attempt.attemptedRevision = revision;
      attempt.inFlight = true;
      void reconcileMarketReturnAction(marketSalonId).then(() => {
        attempt.inFlight = false;
        if (!current()) return;
        attempt.complete = true;
        void refresh().catch(() => {});
      }, () => {
        // A native foreground read can renew admission after the first command
        // was rejected before dispatch. Retry only after a verified page read;
        // this reconciles saved purchases and never restarts Checkout.
        attempt.inFlight = false;
        if (current() && attempt.revision !== revision) reconcile();
      });
    };
    reconcile();
  }, [returnSequence, marketSalonId, experienceScope, verifiedAt, refresh]);
  return <MarketClient {...data} initialBrowse={initialBrowse}
    accessRevision={verifiedAt ? String(verifiedAt) : undefined}
    onMarketRefresh={refreshMarket} />;
}
