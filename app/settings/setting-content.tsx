"use client";

import { Activity, useState, type ReactNode } from "react";

export function SettingContent({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  // The whole page is also retained by Activity in the iPhone app. A nested
  // boundary keeps its inactive sections' effects paused when that page returns,
  // while preserving form/DOM state and refreshing the section when revealed.
  return visited || active ? <Activity mode={active ? "visible" : "hidden"}><div hidden={!active}>{children}</div></Activity> : null;
}
