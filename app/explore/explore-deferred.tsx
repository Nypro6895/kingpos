"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useExplorePrefetchDistance } from "@/lib/explore-viewport-priority";

export function ExploreDeferred({ children, minHeight = 96 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null), [shown, setShown] = useState(false);
  const distance = useExplorePrefetchDistance();
  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;
    const reveal = () => {
      const bounds = node.getBoundingClientRect();
      if (node.getClientRects().length && bounds.top < innerHeight + distance && bounds.bottom > -distance) setShown(true);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(reveal, { rootMargin: `${distance}px` });
    observer?.observe(node); reveal();
    window.addEventListener("scroll", reveal, { passive: true });
    return () => { observer?.disconnect(); window.removeEventListener("scroll", reveal); };
  }, [distance, shown]);
  return <div ref={ref} style={shown ? undefined : { minHeight }} data-explore-deferred="">{shown ? children : null}</div>;
}
