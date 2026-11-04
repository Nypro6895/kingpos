"use client";
import { useState } from "react";
import Image from "next/image";
import { safeAccountAvatarUrl } from "@/lib/account-avatar";
import s from "./forum.module.css";

export function ForumAvatar({ src }: { src?: string | null }) {
  const url = safeAccountAvatarUrl(src);
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={s.avatar} aria-hidden="true">{url && failed !== url
    ? <Image unoptimized src={url} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
    : <svg viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="18" fill="#ededed"/><circle cx="18" cy="13" r="7" fill="#a0a0a0"/><path d="M4 33c1-9 7-13 14-13s13 4 14 13" fill="#a0a0a0"/></svg>}</span>;
}

export function ForumIcon({ name }: { name: "search" | "compose" | "reply" }) {
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === "search" ? <><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></> : name === "compose" ? <><path d="m15 4 5 5M3 21l5-1L21 7l-5-5L3 15z"/></> : <path d="M21 11a9 9 0 0 1-9 9H7l-5 3 1-7a9 9 0 1 1 18-5Z"/>}</svg>;
}
