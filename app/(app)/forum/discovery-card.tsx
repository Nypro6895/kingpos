"use client";
import { useEffect, useState } from "react";
import type { ForumSection } from "@/types/forum";
import s from "./forum.module.css";

export function ForumDiscoveryCard({ sections, postIndex, onSelect }: { sections: ForumSection[]; postIndex: number; onSelect: (id: string) => void }) {
  const [choice, setChoice] = useState<number | null>(null);
  useEffect(() => { const frame=requestAnimationFrame(() => setChoice(Math.floor(Math.random() * 10000))); return () => cancelAnimationFrame(frame); }, []);
  // Sparse fixed slots prevent content from moving under a finger; the section varies per visit.
  if (postIndex % 9 !== 4 || choice === null || !sections.length) return null;
  const section = sections[choice % sections.length];
  return <aside className={s.discoveryCard}><span>Khám phá chuyên mục</span><button onClick={() => onSelect(section.id)}><strong>{section.name}</strong><span aria-hidden="true">→</span></button><p>{section.description || "Thêm câu chuyện và kinh nghiệm từ cộng đồng nails."}</p></aside>;
}
