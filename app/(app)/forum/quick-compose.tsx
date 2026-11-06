"use client";
import { useEffect, useState } from "react";
import type { ForumSection } from "@/types/forum";
import { ForumIcon } from "./forum-avatar";
import s from "./forum.module.css";

export function ForumQuickCompose({ sections, postIndex, onCompose }: { sections: ForumSection[]; postIndex: number; onCompose: (id: string) => void }) {
  const [choice, setChoice] = useState<number | null>(null);
  useEffect(() => { let alive = true; queueMicrotask(() => { if (alive) setChoice(Math.floor(Math.random() * 10000)); }); return () => { alive = false; }; }, []);
  // Sparse slots keep scrolling stable; each slot suggests a random section for this mount.
  if (choice === null || postIndex % 8 !== 3 || !sections.length) return null;
  const section = sections[choice % sections.length];
  return <aside className={s.quickCompose} aria-label="Tạo bài viết nhanh"><button type="button" onClick={() => onCompose(section.id)}><ForumIcon name="compose"/><span><strong>Chia sẻ với mọi người…</strong><small>{section.name}</small></span><span aria-hidden="true">+</span></button></aside>;
}
