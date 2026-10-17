"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ContentViewer } from "@/components/content-viewer";
import { ExploreSalonMenu, ExploreSocialActions, useSalonSocial } from "@/components/explore-social";
import { SalonTrustLine, SalonVerifiedBadge } from "@/components/salon-trust-line";
import { SalonOperatingStatusBadge } from "@/components/salon-operating-status-badge";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { PostCommentThread } from "@/app/post-comments/post-comment-thread";
import { usePostCaption } from "@/components/post-change-state";
import { isSalonId } from "@/lib/explore-social";
import type { ExploreFeedItem, ExploreInspirationItem } from "@/types/explore";
import type { PostCommentTarget, PostCommentViewer } from "@/types/post-comments";
import styles from "./salon-post-preview.module.css";

type SalonPostPreviewItem = Pick<ExploreInspirationItem, "salonId" | "salonName" | "salonCity" | "salonState" | "salonLogoImageUrl" | "imageUrl" | "commentCount" | "contentId" | "contentType" | "captionExcerpt" | "bookingEnabled" | "bookingHref" | "phoneHref" | "trust" | "operatingStatus"> & {
  saveTarget: ExploreInspirationItem["saveTarget"] | null;
};

export function SalonPostPreview({ item, viewer, onClose, location, service, price, duration, href }: {
  item: SalonPostPreviewItem;
  viewer: PostCommentViewer;
  onClose: () => void;
  location: string | null;
  service: string | null;
  price: string | null;
  duration: string | null;
  href: string;
}) {
  const t = useWorkspaceTranslation();
  const [focusKey, setFocusKey] = useState(0);
  const [count, setCount] = useState(item.commentCount ?? 0);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const social = useSalonSocial(item.salonId);
  const salonHref = `/explore/salons/${item.salonId}`;
  const salon = { id: item.salonId, name: item.salonName, href: salonHref, city: item.salonCity, state: item.salonState,
    bookingHref: item.bookingEnabled ? item.bookingHref : null, phone: item.phoneHref?.replace(/^tel:/, "") };
  const target: PostCommentTarget = { salonId: item.salonId, salonName: item.salonName, sourceId: item.contentId,
    sourceType: item.contentType === "look" ? "salon_profile_look" : "salon_profile_update", title: item.captionExcerpt };
  const caption = usePostCaption(target, item.captionExcerpt, viewer.userId) ?? null;
  const realPost = isSalonId(item.contentId);
  const logo = item.salonLogoImageUrl;

  return <ContentViewer aria-labelledby="inspiration-preview-title" onClose={onClose} open={!social.state.hidden} className={styles.overlay}>
    <article className={styles.panel} data-salon-post-preview>
      <div className={styles.media}>
        <Image alt={`${item.salonName} nail inspiration preview`} className={styles.photo} fill
          sizes="(max-width: 639px) 100vw, (max-width: 899px) 560px, 60vw" src={item.imageUrl} />
        <button type="button" aria-label={t("Close preview")} className={styles.close} onClick={onClose}>
          <ReylumiIcon name="close" className="size-5" />
        </button>
      </div>
      <div className={styles.body}>
        <header className={styles.header}>
          <Link prefetch={false} href={salonHref} className={styles.identity} aria-label={`${t("View salon")} ${item.salonName}`}>
            <span className={styles.logo}>
              {logo && failedLogo !== logo ? <Image src={logo} alt={`${item.salonName} logo`} width={40} height={40} unoptimized onError={() => setFailedLogo(logo)} />
                : <ReylumiIcon name="home" className="size-5" />}
            </span>
            <h2 id="inspiration-preview-title" className={styles.name}>{item.salonName}<SalonVerifiedBadge verified={item.trust.identityVerified} /></h2>
          </Link>
          <ExploreSalonMenu salon={salon} target={realPost ? target : undefined} onHidden={onClose} />
        </header>
        <div className={styles.metadata}>
          <SalonTrustLine signals={item.trust} href={salonHref} name={item.salonName} className={styles.trust} />
          {location ? <p className={styles.location}>{location}</p> : null}
          <SalonOperatingStatusBadge salonId={item.salonId} showDetail status={item.operatingStatus} variant="text" />
        </div>
        {service || price || duration || caption ? <div className={styles.content}>
          {service || price || duration ? <div className={styles.serviceRow}>
            <span className={styles.service}><WorkspaceText text={service} /></span>
            <span className={styles.price}>{[price, duration].filter(Boolean).join(" · ")}</span>
          </div> : null}
          {caption ? <p className={styles.caption}>{caption}</p> : null}
        </div> : null}
        <div className={styles.actions}>
          <ExploreSocialActions salon={salon} href={href} target={item.saveTarget} commentCount={count}
            onComment={realPost ? () => setFocusKey(value => value + 1) : undefined} />
        </div>
        {realPost ? <PostCommentThread compact inlineComposer expanded focusKey={focusKey} initialCount={count}
          onCountChange={setCount} target={target} viewer={viewer} /> : null}
      </div>
    </article>
  </ContentViewer>;
}

/** Both the initial inspiration list and the hydrated feed open the same salon post. */
export function SalonFeedPostPreview({ item, viewer, onClose }: { item: ExploreFeedItem; viewer: PostCommentViewer; onClose: () => void }) {
  const salon = item.salon, media = item.media[0];
  if (!salon || !media || (item.contentType !== "look" && item.contentType !== "update")) return null;
  const minutes = item.bookingMeta.durationMinutes;
  const duration = minutes == null ? null : minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
  const price = item.bookingMeta.price == null ? null : `${new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:item.bookingMeta.price % 1 === 0 ? 0 : 2 }).format(item.bookingMeta.price)}+`;
  return <SalonPostPreview item={{ salonId:salon.id, salonName:salon.name, salonCity:salon.city, salonState:salon.state,
    salonLogoImageUrl:salon.logoImageUrl, imageUrl:media.imageUrl, commentCount:item.commentCount, contentId:item.contentId,
    contentType:item.contentType, captionExcerpt:item.caption, bookingEnabled:Boolean(item.booking?.eligible), bookingHref:item.booking?.href ?? null,
    phoneHref:null, trust:salon.trust, operatingStatus:salon.operatingStatus, saveTarget:item.saveTarget }}
    viewer={viewer} onClose={onClose} location={[salon.city,salon.state].filter(Boolean).join(", ") || null}
    service={item.serviceName || item.serviceCategory} price={price} duration={duration}
    href={item.destination.href ?? `/explore/salons/${salon.id}#${item.contentType}-${item.contentId}`} />;
}
