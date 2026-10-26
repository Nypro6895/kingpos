"use client";

import { useEffect } from "react";

export const EXPLORE_HEADER_SLOT_EVENT = "reylumi:explore-header-slot-change";

export function ExploreHeaderSearchSlot() {
  useEffect(() => {
    window.dispatchEvent(new Event(EXPLORE_HEADER_SLOT_EVENT));
    return () => { window.dispatchEvent(new Event(EXPLORE_HEADER_SLOT_EVENT)); };
  }, []);
  return <div data-explore-header-search className="hidden min-h-12 min-w-0 flex-1 xl:block" />;
}
