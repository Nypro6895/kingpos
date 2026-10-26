"use client";

import type { ReactNode } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { PostShareButton } from "@/components/post-share-button";
import styles from "./website-post-engagement.module.css";

export function WebsitePostEngagement({ loveButton, commentCount, onComment, shareHref, shareTitle, bookButton, bookedCount }: {
  loveButton?: ReactNode;
  commentCount: number;
  onComment?: () => void;
  shareHref?: string;
  shareTitle?: string;
  bookButton?: ReactNode;
  bookedCount?: number | null;
}) {
  const translate = useWorkspaceTranslation();
  return <div className={styles.engagement}>
    {bookedCount != null ? <p className={styles.booked}><WorkspaceText text={`${bookedCount} booked`} /></p> : null}
    <div className="post-action-toolbar">
      {loveButton}
      {onComment ? <button type="button" onClick={onComment}
        aria-label={translate(`Read ${commentCount} comments or write a comment`)}>
        <ReylumiIcon name="message" />
        <span><WorkspaceText text="Comment" /></span><span data-post-action-count className={styles.count}>{commentCount}</span>
      </button> : null}
      {shareHref ? <PostShareButton href={shareHref} title={shareTitle} /> : null}
      {bookButton ? <span className={styles.book}>{bookButton}</span> : null}
    </div>
  </div>;
}
