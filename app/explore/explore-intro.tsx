"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { EXPLORE_INTRO_MESSAGES, explorePreviewImages } from "@/lib/explore-entry-presentation";
import type { ExploreHomeContent, ExploreSearchResult } from "@/types/explore";

export function ExploreIntroHeadline() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    // Select once per visit, after hydration. Do not rotate while someone is reading.
    const frame = window.requestAnimationFrame(() => setIndex(Math.floor(Math.random() * EXPLORE_INTRO_MESSAGES.length)));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const message = EXPLORE_INTRO_MESSAGES[index];
  return <h1 data-testid="explore-intro-headline" className="min-h-[2.5em] max-w-xl text-2xl font-semibold leading-tight text-text-primary 2xl:text-3xl">
    {message.text} <span className="text-brand-orange">{message.accent}</span>
  </h1>;
}

export function ExploreSalonPreview({ content, salons }: { content: ExploreHomeContent; salons: ExploreSearchResult[] }) {
  const images = explorePreviewImages(content, salons);
  const [failed, setFailed] = useState<string[]>([]);
  const visibleImages = images.filter(image => !failed.includes(image.imageUrl));
  return <div data-testid="explore-salon-preview" className="flex min-w-0 items-center gap-3 rounded-[0.9rem] bg-white/82 px-3 py-2 ring-1 ring-divider-subtle/70">
    {visibleImages.length ? <div className="flex shrink-0 -space-x-2">
      {visibleImages.map(image => <span className="relative block size-9 overflow-hidden rounded-full bg-surface-muted ring-2 ring-white" key={image.salonId}>
        <Image alt={image.illustration ? "Beauty service illustration" : image.salonName} src={image.imageUrl} fill sizes="36px" loading="lazy" className="object-cover" onError={() => setFailed(current => [...current, image.imageUrl])} />
      </span>)}
    </div> : null}
    <div className="min-w-0">
      <p className="text-xs font-semibold text-text-primary">Discover salons and beauty inspiration</p>
      <p className="mt-0.5 text-[11px] text-text-secondary">Explore places, looks and services</p>
      {visibleImages.some(image => image.illustration) ? <p className="mt-0.5 text-[10px] text-text-muted">Includes AI illustrations</p> : null}
    </div>
  </div>;
}
