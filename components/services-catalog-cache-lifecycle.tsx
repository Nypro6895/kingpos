"use client";

import { useEffect, useLayoutEffect } from "react";
import { subscribeExperienceResets } from "@/lib/experience-cache-events";
import { getServicesCatalogStore, invalidateServicesCatalog, observeServicesCatalogScope } from "@/lib/services-catalog-runtime";

/** Server props can retire a partition; only the online endpoint can admit it. */
export function ServicesCatalogCacheLifecycle({ enabled, viewerId, accountId, scope }: {
  enabled: boolean; viewerId: string | null; accountId: string | null; scope: string;
}) {
  useLayoutEffect(() => {
    observeServicesCatalogScope(enabled ? scope : null);
    if (!enabled || !viewerId || !accountId) invalidateServicesCatalog("identity");
    else void getServicesCatalogStore().observeAccount(viewerId, accountId);
  }, [enabled, viewerId, accountId, scope]);
  useEffect(() => subscribeExperienceResets(reason => invalidateServicesCatalog(reason)), []);
  return null;
}
