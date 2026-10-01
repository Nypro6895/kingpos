"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// The server supplies only panels permitted by the current device session.
// Keep them mounted: changing a tab must not discard a cart or await an action.
export function PortablePanels({ panels, children }: {
  panels: Record<string, ReactNode>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const panelRoute = search.size === 0 && Object.hasOwn(panels, pathname);

  useEffect(() => {
    function navigate(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
          event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== location.origin || url.search || url.hash ||
          !Object.hasOwn(panels, url.pathname)) return;
      event.preventDefault();
      // Next integrates native history with usePathname/useSearchParams.
      window.history.pushState(null, "", url.pathname);
    }
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, [panels]);

  return <>
    {Object.entries(panels).map(([path, panel]) => (
      <div className="h-full" hidden={!panelRoute || pathname !== path}
        key={path} data-portable-panel={path}>{panel}</div>
    ))}
    {!panelRoute ? children : null}
  </>;
}
