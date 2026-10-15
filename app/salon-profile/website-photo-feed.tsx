"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
/* eslint-disable @next/next/no-img-element -- Public profile media URLs. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./website-photo-feed.module.css";

export type WebsiteLibraryPhoto = {
  id: string;
  imageUrl: string;
  title: string;
  publishedAt: string | null;
};

export function selectWebsiteFeedPhotos<T extends WebsiteLibraryPhoto>(photos: T[], excludedUrls: string[]) {
  const seen = new Set(excludedUrls);
  return [...photos].filter(photo => Boolean(photo.publishedAt && photo.imageUrl))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.id.localeCompare(b.id))
    .filter(photo => {
      if (seen.has(photo.imageUrl)) return false;
      seen.add(photo.imageUrl);
      return true;
    });
}

const PAGE_SIZE = 6;

export function WebsitePhotoFeed({ photos, onOpen, renderActions, renderEngagement }: {
  photos: WebsiteLibraryPhoto[];
  onOpen: (photo: WebsiteLibraryPhoto) => void;
  renderActions?: (photo: WebsiteLibraryPhoto) => ReactNode;
  renderEngagement?: (photo: WebsiteLibraryPhoto) => ReactNode;
}) {
  const __vt = useWorkspaceTranslation();

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const available = photos.filter(photo => !failedUrls.includes(photo.imageUrl));
  const hasMore = visibleCount < available.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (!hasScrolled.current || !entries.some(entry => entry.isIntersecting)) return;
      // One batch per observation; the next sentinel moves below the new cards.
      observer.disconnect();
      setVisibleCount(count => Math.min(count + PAGE_SIZE, available.length));
    }, { rootMargin: "240px 0px", threshold: 0 });
    const onScroll = (event: Event) => {
      const scrolledDown = event.target instanceof HTMLElement ? event.target.scrollTop > 0 : window.scrollY > 0;
      if (hasScrolled.current || !scrolledDown) return;
      hasScrolled.current = true;
      // Recheck a sentinel already near the viewport on a short profile.
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    };
    window.addEventListener("scroll", onScroll, true);
    observer.observe(sentinel);
    return () => { observer.disconnect(); window.removeEventListener("scroll", onScroll, true); };
  }, [hasMore, visibleCount, available.length]);

  if (!available.length) return null;
  return <div className={styles.feed}>
    {visibleCount > 0 ? <>
      <header className={styles.heading}><h3><WorkspaceText text="More from the salon" /></h3><p><WorkspaceText text="Explore the salon’s photo library" /></p></header>
      <div className={styles.grid}>{available.slice(0, visibleCount).map(photo => <article key={photo.id} className={styles.card}>
        <button type="button" className={styles.open} onClick={() => onOpen(photo)} aria-label={__vt(`Open ${photo.title || "salon photo"}`)}>
          <img src={photo.imageUrl} alt={__vt(photo.title || "Salon photo")} loading="lazy" decoding="async" width={640} height={480}
            onError={() => setFailedUrls(urls => urls.includes(photo.imageUrl) ? urls : [...urls, photo.imageUrl])}/>
          {photo.title ? <strong><WorkspaceText text={photo.title} /></strong> : null}
        </button>
        {renderActions ? <div className={styles.actions}>{renderActions(photo)}</div> : null}
        {renderEngagement?.(photo)}
      </article>)}</div>
    </> : null}
    {hasMore ? <div ref={sentinelRef} className={styles.sentinel}>
      <button type="button" onClick={() => setVisibleCount(count => Math.min(count + PAGE_SIZE, available.length))}>
        <WorkspaceText text={visibleCount ? "Load more photos" : "Explore more photos"} />
      </button>
    </div> : <p role="status" className={styles.end}><WorkspaceText text="You’ve seen all photos in this library." /></p>}
  </div>;
}
