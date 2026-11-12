"use client";

import { useExploreAheadDistance } from "@/lib/explore-viewport-priority";
import Image, { type ImageProps } from "next/image";
import { useLayoutEffect, useRef, useState } from "react";

export function ExploreViewportImage({ priority, preload, fetchPriority, alt, ...props }: ImageProps) {
  const distance = useExploreAheadDistance();
  const ref = useRef<HTMLImageElement>(null);
  const [inFirstView, setInFirstView] = useState(false);
  const [prepared, setPrepared] = useState(false);
  useLayoutEffect(() => {
    const image = ref.current;
    if (!image) return;
    const update = () => {
      const bounds = image.getBoundingClientRect();
      if (!image.getClientRects().length || bounds.bottom <= 0 || bounds.top >= innerHeight + distance) return;
      setPrepared(true);
      if (bounds.top < innerHeight) setInFirstView(true);
    };
    update();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(update, { rootMargin: `${distance}px` });
    observer?.observe(image);
    window.addEventListener("reylumi:screen-ready", update);
    document.addEventListener("scroll", update, { capture: true, passive: true });
    return () => { observer?.disconnect(); window.removeEventListener("reylumi:screen-ready", update); document.removeEventListener("scroll", update, true); };
  }, [distance]);
  return <Image {...props} alt={alt} ref={ref} data-explore-media="" preload={preload}
    loading={preload ? undefined : priority || prepared ? "eager" : "lazy"}
    fetchPriority={preload ? undefined : fetchPriority ?? (priority || inFirstView ? "high" : "low")} />;
}
