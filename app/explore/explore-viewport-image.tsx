"use client";

import Image, { type ImageProps } from "next/image";
import { useLayoutEffect, useRef, useState } from "react";

export function ExploreViewportImage({ priority, preload, fetchPriority, alt, ...props }: ImageProps) {
  const ref = useRef<HTMLImageElement>(null);
  const [inFirstView, setInFirstView] = useState(false);
  useLayoutEffect(() => {
    const image = ref.current;
    if (!image) return;
    const update = () => {
      const bounds = image.getBoundingClientRect();
      if (!image.getClientRects().length || bounds.bottom <= 0 || bounds.top >= innerHeight) return;
      setInFirstView(true);
    };
    update();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(update, { rootMargin: "0px" });
    observer?.observe(image);
    window.addEventListener("reylumi:screen-ready", update);
    return () => { observer?.disconnect(); window.removeEventListener("reylumi:screen-ready", update); };
  }, []);
  return <Image {...props} alt={alt} ref={ref} data-explore-media="" preload={preload}
    loading={preload ? undefined : priority || inFirstView ? "eager" : "lazy"}
    fetchPriority={preload ? undefined : fetchPriority ?? (priority || inFirstView ? "high" : "low")} />;
}
