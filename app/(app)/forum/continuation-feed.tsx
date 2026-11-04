"use client";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { readForum } from "./actions";
import { ForumCampaignSlot } from "@/components/explore-advertising";
import type { ForumTopic } from "@/types/forum";
import s from "./forum.module.css";

export function ForumLoadMore({ enabled, load, children }: { enabled: boolean; load: () => void; children: ReactNode }) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!enabled || !ref.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load();},{rootMargin:"400px 0px"});observer.observe(ref.current);return()=>observer.disconnect();},[enabled,load]);
  return <div ref={ref} className={s.sentinel}>{children}</div>;
}

// Each page is bounded and keyset-paginated. Never read replies for feed cards.
export function ContinuationFeed({ topicId, renderTopic }: { topicId: string; renderTopic: (topic: ForumTopic) => ReactNode }) {
  const [rows, setRows] = useState<ForumTopic[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cursor = useRef<ForumTopic | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    if (pending.current || !mounted.current) return;
    pending.current = true; setLoading(true); setError("");
    const last = cursor.current;
    try {
      const response = await readForum({ mode: "feed", exclude_id: topicId, ...(last ? { before: last.created_at, cursor_id: last.id, before_pinned: last.pinned } : {}) });
      if (!mounted.current) return;
      if (response.error) throw Error(response.error);
      const page = response.data as ForumTopic[];
      cursor.current = page.slice(0, 20).at(-1) ?? last;
      setRows(old => { const ids = new Set(old.map(x => x.id)); return [...old, ...page.slice(0, 20).filter(x => x.id !== topicId && !ids.has(x.id))]; });
      setMore(page.length > 20);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Không tải được bài tiếp theo."); }
    finally { pending.current = false; if (mounted.current) setLoading(false); }
  }, [topicId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!more || error || loading || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void load(); }, { rootMargin: "600px 0px" });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [load, more, error, loading, rows.length]);
  return <section className={s.continuation} aria-label="Bài viết tiếp theo"><div className={s.feedDivider}>Bài viết tiếp theo</div>
    {rows.map((topic, index) => <Fragment key={topic.id}>{renderTopic(topic)}<ForumCampaignSlot postIndex={index + 1} /></Fragment>)}
    {more && <div ref={sentinel} className={s.sentinel}><button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Đang tải bài viết…" : error ? "Thử tải lại" : "Xem thêm bài viết"}</button></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
