"use client";

import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useState, type RefObject } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import type { PostCommentViewer } from "@/types/post-comments";
import styles from "./inline-comment-composer.module.css";

export function InlineCommentComposer({ viewer, value, onChange, textareaRef, canSubmit, posting, replying = false }: {
  viewer: PostCommentViewer;
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  canSubmit: boolean;
  posting: boolean;
  replying?: boolean;
}) {
  const t = useWorkspaceTranslation();
  const name = viewer.identity?.name || t(viewer.isAuthenticated ? "You" : "Guest");
  const role = t(viewer.identity?.role === "salon" ? "Salon" : viewer.identity?.role === "staff" ? "Staff" : "Personal");
  const label = `${t(replying ? "Reply as" : "Comment as")} ${name}`;
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatar = viewer.identity?.avatarUrl;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(144, Math.max(44, textarea.scrollHeight))}px`;
  }, [value, textareaRef]);

  return <div className={styles.row} data-inline-comment-composer>
    <span className={`${styles.avatar} ${viewer.identity?.role === "salon" ? styles.salonAvatar : ""}`} aria-hidden="true">
      {avatar && failedAvatar !== avatar ? <Image src={avatar} alt="" width={36} height={36} unoptimized onError={() => setFailedAvatar(avatar)} /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {viewer.identity?.role === "salon" ? <><path d="m4 9 2-5h12l2 5M4 9h16M5 9v11h14V9M9 20v-7h6v7"/><path d="M8 4v5m8-5v5"/></> : <><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>}
      </svg>}
    </span>
    {viewer.isAuthenticated ? <div className={styles.field}>
      <textarea
        ref={textareaRef}
        aria-label={`${label} · ${role}`}
        title={`${label} · ${role}`}
        placeholder={label}
        rows={1}
        maxLength={1000}
        value={value}
        onChange={event => onChange(event.currentTarget.value)}
      />
      {value.trim() || posting ? <button type="submit" className={styles.send} disabled={!canSubmit} aria-label={t(posting ? "Posting..." : replying ? "Post reply" : "Post comment")}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 19 9-19 9 4-9-4-9Z"/><path d="M7 12h15"/></svg>
      </button> : null}
    </div> : <Link prefetch={false} className={`${styles.field} ${styles.signIn}`} href="/login?next=%2Fexplore">{t("Sign in to comment.")}</Link>}
  </div>;
}
