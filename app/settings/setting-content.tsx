"use client";

import { Activity, useLayoutEffect, useState, type ReactNode } from "react";

export function SettingContent({ active, children, resetOnHide = false }: { active: boolean; children: ReactNode; resetOnHide?: boolean }) {
  const [visited, setVisited] = useState(active);
  const [activation, setActivation] = useState(0);
  useLayoutEffect(() => () => {
    // A parent Activity also pauses this effect. Security/deletion forms must
    // start a fresh reader and form when the whole Settings page returns.
    if (resetOnHide) setActivation(value => value + 1);
  }, [resetOnHide]);
  if (active && !visited) setVisited(true);
  if (resetOnHide) return active ? <div key={activation}>{children}</div> : null;
  // The whole page is also retained by Activity in the iPhone app. A nested
  // boundary keeps its inactive sections' effects paused when that page returns,
  // while preserving form/DOM state and refreshing the section when revealed.
  return visited || active ? <Activity mode={active ? "visible" : "hidden"}><div hidden={!active}>{children}</div></Activity> : null;
}
