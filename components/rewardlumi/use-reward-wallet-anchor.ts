"use client";

import { useEffect, type RefObject } from "react";
import { rewardWalletSalonAnchor } from "@/lib/reward-wallet-anchor";

/** A fragment only reveals a card already returned for the current account.
 * It never loads a salon, joins a program, or grants access to a balance.
 */
export function useRewardWalletAnchor({ root, salonIds, identity, enabled, path }: {
  root: RefObject<HTMLElement | null>; salonIds: readonly string[];
  identity: string; enabled: boolean; path?: string;
}) {
  const cardsKey = salonIds.join(",");
  useEffect(() => {
    const node = root.current;
    if (!node || !enabled) return;
    const returnedCards = new Set(cardsKey ? cardsKey.split(",") : []);
    let frame = 0, revealed = "", active = true;
    const reveal = () => {
      frame = 0;
      if (!active || location.pathname !== "/rewards" || location.search || !node.getClientRects().length) return;
      const id = rewardWalletSalonAnchor(location.hash);
      if (!id || id === revealed || !returnedCards.has(id.slice(6))) return;
      const card = node.querySelector<HTMLElement>("#" + id);
      if (!card || card.getAttribute("data-reward-salon") !== id.slice(6)) return;
      const details = card.querySelector<HTMLDetailsElement>("details");
      if (details) details.open = true;
      card.scrollIntoView({ block: "start" });
      revealed = id;
    };
    const schedule = () => { if (active && !frame) frame = requestAnimationFrame(reveal); };
    const changed = () => { revealed = ""; schedule(); };
    const reset = () => { active = false; if (frame) cancelAnimationFrame(frame); frame = 0; };
    window.addEventListener("hashchange", changed);
    window.addEventListener("reylumi:screen-ready", schedule);
    window.addEventListener("reylumi:experience-reset", reset);
    // The effect reruns when an authoritative wallet reply renders its cards,
    // after the browser's initial fragment lookup may already have failed.
    schedule();
    return () => {
      reset();
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("reylumi:screen-ready", schedule);
      window.removeEventListener("reylumi:experience-reset", reset);
    };
  }, [root, cardsKey, identity, enabled, path]);
}
