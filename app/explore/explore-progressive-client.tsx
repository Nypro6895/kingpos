"use client";

import { useEffect, useState } from "react";
import type { ExploreDiscoveryContent, ExploreFeedPage, ExploreHomeContent } from "@/types/explore";
import { ExploreClient, type ExploreClientProps, type ExploreQuickAction } from "./explore-client";

export type ExploreStartupExtras = { discoveryContent: ExploreDiscoveryContent; homeContent: ExploreHomeContent; quickActions: ExploreQuickAction[] };

export function ExploreProgressiveClient({ initial, extras, feed }: {
  initial: ExploreClientProps;
  extras: Promise<ExploreStartupExtras>;
  feed?: Promise<ExploreFeedPage | null>;
}) {
  const [extraData, setExtraData] = useState<ExploreStartupExtras | null>(null);
  useEffect(() => {
    let active = true;
    let pending: ExploreStartupExtras | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let interactedAt = 0;
    const apply = () => {
      if (!active || !pending || document.visibilityState !== "visible") return;
      const focused = document.activeElement;
      if (window.scrollY > 80 || Date.now() - interactedAt < 800 || focused instanceof HTMLElement && (focused.matches("input,textarea,select") || focused.isContentEditable)) return;
      setExtraData(pending); pending = undefined;
    };
    const wake = () => { if (timer) clearTimeout(timer); timer = setTimeout(apply, 850); };
    const interact = () => { interactedAt = Date.now(); wake(); };
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("pointerdown", interact, { passive: true });
    window.addEventListener("keydown", interact);
    window.addEventListener("focusout", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void extras.then(value => { pending = value; apply(); }, () => {});
    return () => { active = false; if (timer) clearTimeout(timer); window.removeEventListener("scroll", wake); window.removeEventListener("pointerdown", interact); window.removeEventListener("keydown", interact); window.removeEventListener("focusout", wake); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [extras]);
  return <ExploreClient {...initial} {...extraData} initialFeedPromise={feed} startupExtrasPending={!extraData} />;
}
