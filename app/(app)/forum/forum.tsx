"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { readForum, writeForum } from "./actions";
import type { ForumAudit, ForumContext, ForumInput, ForumMessage, ForumReply, ForumReport, ForumRestriction, ForumSection, ForumTopic } from "@/types/forum";
import s from "./forum.module.css";

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
type View = "feed" | "sections" | "chat" | "saved" | "mine" | "topic" | "write" | "manage";
type Moderation = { op: string; kind?: string; id: string; label: string };
type Detail = { topic: ForumTopic; replies: ForumReply[] };
const time = (v: string) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const initials = (v: string) => v.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();

export default function Forum({ initialContext, initialTopics }: { initialContext: ForumContext; initialTopics: ForumTopic[] }) {
  const [context, setContext] = useState(initialContext);
  const [view, setView] = useState<View>("feed");
  const [topics, setTopics] = useState(initialTopics.slice(0, 20));
  const [topicsMore, setTopicsMore] = useState(initialTopics.length > 20);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [messages, setMessages] = useState<ForumMessage[]>([]);
  const [reports, setReports] = useState<ForumReport[]>([]);
  const [restrictions, setRestrictions] = useState<ForumRestriction[]>([]);
  const [audit, setAudit] = useState<ForumAudit[]>([]);
  const [panel, setPanel] = useState("reports");
  const [topicId, setTopicId] = useState("");
  const [state, setState] = useState("");
  const [section, setSection] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [unanswered, setUnanswered] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [moderation, setModeration] = useState<Moderation | null>(null);
  const [editing, setEditing] = useState<ForumSection | null | undefined>(undefined);
  const [chatHistory, setChatHistory] = useState(false);
  const [replyMore, setReplyMore] = useState(false);
  const [chatMore, setChatMore] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", section: initialContext.sections.find(x => !x.archived)?.id ?? "", state: "" });
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const composeDialog = useRef<HTMLDialogElement>(null);
  const firstLoad = useRef(true);
  const draftLoaded = useRef(false);
  const user = context.user_id;
  const activeSections = context.sections.filter(x => !x.archived);
  const canModerate = context.can_moderate;
  const sectionName = (id: string) => context.sections.find(x => x.id === id)?.name ?? "Section";

  function navigate(next: View, id = "") {
    request.current++;
    setView(next); setTopicId(id); setError(""); setNotice(""); setLoading(false);
    if (next === "topic") setDetail(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("topic"); url.searchParams.delete("view");
    if (next === "topic") url.searchParams.set("topic", id);
    else if (next !== "feed") url.searchParams.set("view", next);
    window.history.pushState(null, "", url);
  }

  useEffect(() => {
    function restore() {
      const p = new URLSearchParams(window.location.search), id = p.get("topic"), v = p.get("view");
      if (id && /^[0-9a-f-]{36}$/i.test(id)) { setTopicId(id); setView("topic"); }
      else if (["sections", "chat", "saved", "mine", "write", "manage"].includes(v ?? "")) setView(v as View);
      else setView("feed");
    }
    let alive = true;
    window.addEventListener("popstate", restore);
    queueMicrotask(() => {
    if (!alive) return;
    restore();
    try {
      const saved = JSON.parse(sessionStorage.getItem(`forum-draft:${user}`) ?? "null");
      if (saved && typeof saved.title === "string" && typeof saved.body === "string") setDraft(d => ({ ...d, title: saved.title.slice(0, 180), body: saved.body.slice(0, 20000) }));
    } catch { /* Storage may be unavailable in private browsing. */ }
    draftLoaded.current = true;
    });
    return () => { alive = false; window.removeEventListener("popstate", restore); };
  }, [user]);
  useEffect(() => { if (draftLoaded.current) { try { sessionStorage.setItem(`forum-draft:${user}`, JSON.stringify({ title: draft.title, body: draft.body })); } catch {} } }, [draft.title, draft.body, user]);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { if (moderation && !dialog.current?.open) dialog.current?.showModal(); }, [moderation]);
  useEffect(() => { if (editing !== undefined && !composeDialog.current?.open) composeDialog.current?.showModal(); }, [editing]);

  const refreshContext = useCallback(async () => {
    const response = await readForum({ mode: "context" });
    if (response.error) throw new Error(response.error);
    setContext(response.data as ForumContext);
  }, []);

  useEffect(() => {
    const seq = ++request.current;
    let canceled = false;
    if (["write", "sections"].includes(view)) return;
    if (view === "manage" && !canModerate) return;
    if (firstLoad.current && view === "feed" && !search && !state && !section && !unanswered && revision === 0) { firstLoad.current = false; return; }
    firstLoad.current = false;
    async function load() {
    await Promise.resolve();
    if (canceled) return;
    let mode: string = view === "topic" ? "topic" : view === "manage" ? panel : view;
    if (mode === "sections") mode = "context";
    if (view === "manage" && panel === "sections") { void refreshContext().catch(e => setError(e.message)); return; }
    setLoading(true); setError("");
    void readForum({ mode, id: topicId, q: search, state, section, unanswered }).then(response => {
      if (canceled || seq !== request.current) return;
      if (response.error) { setError(response.error); return; }
      if (view === "topic") { const d = response.data as Detail; setReplyMore(d.replies.length > 30); setDetail({ ...d, replies: d.replies.slice(0, 30) }); }
      else if (view === "chat") { const m = response.data as ForumMessage[]; setChatMore(m.length > 40); setMessages(m.slice(-40)); setChatHistory(false); }
      else if (view === "manage" && panel === "reports") setReports(response.data as ForumReport[]);
      else if (view === "manage" && panel === "restrictions") setRestrictions(response.data as ForumRestriction[]);
      else if (view === "manage" && panel === "audit") setAudit(response.data as ForumAudit[]);
      else { const rows = response.data as ForumTopic[]; setTopics(rows.slice(0, 20)); setTopicsMore(rows.length > 20); }
    }).catch(() => { if (seq === request.current) setError("Unable to load forum. Please retry."); }).finally(() => { if (seq === request.current) setLoading(false); });
    }
    void load();
    return () => { canceled = true; };
  }, [view, topicId, search, state, section, unanswered, panel, revision, canModerate, refreshContext]);

  // Chat is the only live surface. No background sockets or polling on other pages.
  useEffect(() => {
    if (view !== "chat" || chatHistory) return;
    let alive = true, running = false;
    async function poll() {
      if (document.visibilityState !== "visible" || running) return;
      running = true;
      try {
        const response = await readForum({ mode: "chat" });
        if (!alive) return;
        if (response.error) { setError(response.error); return; }
        const rows = response.data as ForumMessage[];
        setMessages(rows.slice(-40)); setChatMore(rows.length > 40);
      } catch { if (alive) setError("Connection interrupted. Chat will retry automatically."); }
      finally { running = false; }
    }
    const timer = setInterval(() => void poll(), 12000);
    document.addEventListener("visibilitychange", poll);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [view, chatHistory]);

  async function mutate(input: ForumInput, success: string) {
    if (busy) return null;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await writeForum(input);
      if (response.error) { setError(response.error); return null; }
      setNotice(success); setRevision(n => n + 1);
      if (["restrict", "unrestrict", "section_save", "section_move"].includes(String(input.op))) await refreshContext();
      return response.data;
    } catch { setError("Connection interrupted. Check whether the change was saved before retrying."); return null; }
    finally { setBusy(false); }
  }

  function controls(kind: string, id: string, author: string | null, deleted = false, topic?: ForumTopic) {
    return <details className={s.tools}><summary aria-label="Content actions">•••</summary><div>
      {!deleted && <button onClick={() => setModeration({ op: "report", kind, id, label: "Report content" })}>Report</button>}
      {!deleted && author === user && !canModerate && kind !== "chat" && <button onClick={() => setModeration({ op: "remove_own", kind, id, label: "Delete your content" })}>Delete my content</button>}
      {canModerate && <>
        <button onClick={() => setModeration({ op: deleted ? "restore" : "delete", kind, id, label: deleted ? "Restore content" : "Delete content" })}>{deleted ? "Restore" : "Delete"}</button>
        {topic && <><button onClick={() => setModeration({ op: topic.locked ? "unlock" : "lock", kind, id, label: topic.locked ? "Unlock discussion" : "Lock discussion" })}>{topic.locked ? "Unlock" : "Lock"}</button><button onClick={() => setModeration({ op: topic.pinned ? "unpin" : "pin", kind, id, label: topic.pinned ? "Unpin topic" : "Pin topic" })}>{topic.pinned ? "Unpin" : "Pin"}</button><button onClick={() => setModeration({ op: "move", kind, id, label: "Move topic" })}>Move section</button></>}
        {author && author !== user && <button onClick={() => setModeration({ op: "restrict", id: author, label: "Restrict forum participation" })}>Restrict author</button>}
      </>}
    </div></details>;
  }

  function topicRow(t: ForumTopic) {
    return <article className={s.post} key={t.id}><div className={s.row}><span className={s.category}>{sectionName(t.section_id)}{t.state ? ` · ${t.state}` : " · Nationwide"}</span>{controls("topic", t.id, t.author_id, Boolean(t.deleted_at), t)}</div><button className={s.topicTitle} onClick={() => navigate("topic", t.id)}>{t.title}</button><div className={s.meta}><span className={s.avatar}>{initials(t.author_name)}</span><span>{t.author_name} · {time(t.created_at)}</span></div><div className={s.row}><span className={s.meta}>{t.reply_count ?? 0} replies</span><span className={s.badges}>{t.pinned && <span>Pinned</span>}{t.locked && <span>Locked</span>}{t.deleted_at && <span>Deleted</span>}{t.reply_count === 0 && <span>Unanswered</span>}</span></div></article>;
  }

  async function moreTopics() {
    if (busy || loading) return;
    const last = topics.at(-1); if (!last) return;
    setLoading(true); const seq = request.current;
    try { const r = await readForum({ mode: view === "manage" ? "removed" : view, q: search, state, section, unanswered, before: last.created_at, cursor_id: last.id }); if (seq !== request.current) return; if (r.error) setError(r.error); else { const rows = r.data as ForumTopic[]; setTopics(old => [...old, ...rows.slice(0, 20)]); setTopicsMore(rows.length > 20); } }
    finally { if (seq === request.current) setLoading(false); }
  }
  async function olderChat() {
    if (!messages[0] || loading) return;
    setLoading(true); const seq = request.current;
    try { const r = await readForum({ mode: "chat", before_id: messages[0].id }); if (seq !== request.current) return; if (r.error) setError(r.error); else { const a = r.data as ForumMessage[]; setMessages(old => [...a.slice(-40), ...old]); setChatMore(a.length > 40); setChatHistory(true); } }
    finally { if (seq === request.current) setLoading(false); }
  }
  async function moreReplies() {
    const last = detail?.replies.at(-1); if (!last || loading) return;
    setLoading(true); const seq = request.current;
    try { const r = await readForum({ mode: "topic", id: topicId, after: last.created_at, cursor_id: last.id }); if (seq !== request.current) return; if (r.error) setError(r.error); else { const d = r.data as Detail; setReplyMore(d.replies.length > 30); setDetail(old => old ? { ...d, replies: [...old.replies, ...d.replies.slice(0, 30)] } : d); } }
    finally { if (seq === request.current) setLoading(false); }
  }

  async function submitPost(e: FormEvent) {
    e.preventDefault();
    const result = await mutate({ op: editingTopic ? "edit_topic" : "topic", id: editingTopic ?? "", ...draft }, editingTopic ? "Topic updated." : "Topic published.");
    const id = editingTopic ?? result?.id;
    if (result && id) { setDraft({ title: "", body: "", section: activeSections[0]?.id ?? "", state: "" }); setEditingTopic(null); navigate("topic", id); }
  }

  return <section className={s.forum} aria-label="Owner forum">
    <header className={s.header}><div><p className={s.eyebrow}>REYLUMI COMMUNITY</p><h1>Owner forum</h1><p className={s.subtitle}>Share experience. Grow together.</p></div><button className={s.primary} onClick={() => { setEditingTopic(null); navigate("write"); }}>+ New topic</button></header>
    <div className={s.account}><span className={s.meta}>Posting as <strong>{context.display_name}</strong></span><details className={s.tools}><summary>My forum ▾</summary><div><button onClick={() => navigate("mine")}>My topics</button><button onClick={() => navigate("saved")}>Saved topics</button>{canModerate && <button onClick={() => navigate("manage")}>Moderation</button>}</div></details></div>
    <nav className={s.tabs} aria-label="Forum"><button aria-current={["feed", "saved", "mine", "topic", "write"].includes(view) ? "page" : undefined} onClick={() => navigate("feed")}>Latest</button><button aria-current={view === "sections" ? "page" : undefined} onClick={() => navigate("sections")}>Sections</button><button aria-current={view === "chat" ? "page" : undefined} onClick={() => navigate("chat")}>General chat</button>{canModerate && <button aria-current={view === "manage" ? "page" : undefined} onClick={() => navigate("manage")}>Manage</button>}</nav>
    {context.restriction && <div className={s.warning}>Your {context.restriction.scope === "all" ? "forum participation" : context.restriction.scope} is restricted{context.restriction.expires_at ? ` until ${time(context.restriction.expires_at)}` : " until further notice"}. {context.restriction.reason} <Link href="/support">Contact support</Link></div>}
    {error && <div className={s.warning} role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>Retry loading</button></div>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {loading && <p className={s.loading} role="status">Loading…</p>}
    {["feed", "saved", "mine"].includes(view) && <><div className={s.search}><input type="search" aria-label="Search forum" placeholder="Search the community…" maxLength={150} value={query} onChange={e => setQuery(e.target.value)} /></div><div className={s.filters}><select aria-label="State" value={state} onChange={e => setState(e.target.value)}><option value="">All states</option>{STATES.map(x => <option key={x}>{x}</option>)}</select><select aria-label="Section" value={section} onChange={e => setSection(e.target.value)}><option value="">All sections</option>{activeSections.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select><label><input type="checkbox" checked={unanswered} onChange={e => setUnanswered(e.target.checked)} /> Unanswered</label></div>{view !== "feed" && <h2>{view === "saved" ? "Saved topics" : "My topics"}</h2>}<div aria-busy={loading}>{topics.map(topicRow)}</div>{!topics.length && !loading && <div className={s.empty}><h2>Start a conversation</h2><p>No topics match this view. Share a question or clear your filters.</p><button onClick={() => { setState(""); setSection(""); setQuery(""); setUnanswered(false); }}>Clear filters</button></div>}{topicsMore && <button disabled={loading} onClick={moreTopics}>More topics →</button>}</>}
    {view === "sections" && <div className={s.sections}>{activeSections.map(x => <button key={x.id} onClick={() => { setSection(x.id); navigate("feed"); }}><span><strong>{x.name}</strong><small>{x.description}</small></span><span>→</span></button>)}</div>}
    {view === "write" && <form className={s.compose} onSubmit={submitPost}><div className={s.row}><h2>{editingTopic ? "Edit topic" : "New topic"}</h2><button type="button" onClick={() => navigate("feed")}>Back</button></div><p className={s.meta}>Draft text is saved for this browser session.</p><label>Title<input required minLength={5} maxLength={180} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="What would you like to share?" /></label><div className={s.pickers}><label>Section<select disabled={Boolean(editingTopic)} required value={draft.section} onChange={e => setDraft({ ...draft, section: e.target.value })}>{activeSections.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>State<select disabled={Boolean(editingTopic)} value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value })}><option value="">Nationwide</option>{STATES.map(x => <option key={x}>{x}</option>)}</select></label></div><label>Content<textarea required maxLength={20000} rows={9} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Your experience could help another salon owner…" /></label><p className={s.meta}>Never include customer contact details, payroll records or other private information.</p><button className={s.primary} disabled={busy}>{busy ? "Saving…" : editingTopic ? "Save changes" : "Publish topic"}</button></form>}
    {view === "topic" && detail && <><button className={s.back} onClick={() => navigate("feed")}>‹ Back to topics</button><article className={s.detail}><div className={s.row}><span className={s.category}>{sectionName(detail.topic.section_id)} · {detail.topic.state ?? "Nationwide"}</span>{controls("topic", detail.topic.id, detail.topic.author_id, Boolean(detail.topic.deleted_at), detail.topic)}</div><h2>{detail.topic.title}</h2><div className={s.meta}><span className={s.avatar}>{initials(detail.topic.author_name)}</span>{detail.topic.author_name} · {time(detail.topic.created_at)}</div><p className={s.body}>{detail.topic.body}</p><div className={s.row}><button disabled={busy} onClick={() => void mutate({ op: "bookmark", id: detail.topic.id, enabled: !detail.topic.bookmarked }, detail.topic.bookmarked ? "Bookmark removed." : "Topic saved.")}>{detail.topic.bookmarked ? "✓ Saved" : "+ Save topic"}</button>{detail.topic.author_id === user && !detail.topic.locked && !detail.topic.deleted_at && <button onClick={() => { setEditingTopic(detail.topic.id); setDraft({ title: detail.topic.title, body: detail.topic.body ?? "", section: detail.topic.section_id, state: detail.topic.state ?? "" }); navigate("write"); }}>Edit topic</button>}<span className={s.meta}>{detail.topic.locked ? "Discussion locked" : "Open discussion"}{detail.topic.deleted_at ? " · Deleted" : ""}</span></div></article><h3>Discussion</h3>{detail.replies.map(x => <article className={`${s.reply} ${x.deleted_at ? s.deleted : ""}`} key={x.id}><div className={s.row}><div className={s.meta}><span className={s.avatar}>{initials(x.author_name)}</span>{x.author_name} · {time(x.created_at)}</div>{controls("reply", x.id, x.author_id, Boolean(x.deleted_at))}</div><p className={s.body}>{x.body}</p>{x.deleted_at && <span className={s.meta}>Deleted · visible to moderators</span>}</article>)}{replyMore && <button disabled={loading} onClick={moreReplies}>More replies →</button>}{!detail.topic.locked && !detail.topic.deleted_at && <form className={s.replyForm} onSubmit={async e => { e.preventDefault(); if (await mutate({ op: "reply", id: topicId, body: reply }, "Reply posted.")) setReply(""); }}><label>Reply as {context.display_name}<textarea required maxLength={10000} rows={3} value={reply} onChange={e => setReply(e.target.value)} /></label><button className={s.primary} disabled={busy}>Send reply</button></form>}</>}
    {view === "chat" && <div className={s.chat}><div className={s.row}><div><h2>Owner lounge</h2><span className={s.meta}>Every owner can read and join this conversation.</span></div><button disabled={loading} onClick={() => setRevision(n => n + 1)}>Refresh</button></div><p className={s.chatPin}>Be respectful. Use topics for discussions worth keeping.</p>{chatHistory && <button onClick={() => { setChatHistory(false); setRevision(n => n + 1); }}>Return to latest messages</button>}{chatMore && <button disabled={loading} onClick={olderChat}>Earlier messages</button>}<div aria-live="polite">{messages.map(x => <article key={x.id} className={`${s.message} ${x.author_id === user ? s.own : ""}`}><div className={s.row}><span className={s.meta}>{x.author_name} · {time(x.created_at)}</span>{controls("chat", x.id, x.author_id)}</div><p>{x.body}</p></article>)}</div>{!messages.length && !loading && <p className={s.empty}>Be the first to say hello.</p>}<form className={s.chatCompose} onSubmit={async e => { e.preventDefault(); if (await mutate({ op: "chat", body: message }, "Message sent.")) { setMessage(""); setChatHistory(false); } }}><label className={s.srOnly} htmlFor="forum-message">Message</label><input id="forum-message" required maxLength={2000} placeholder="Message the community…" value={message} onChange={e => setMessage(e.target.value)} /><button className={s.primary} disabled={busy}>Send</button></form></div>}
    {view === "manage" && canModerate && <section className={s.management}><div className={s.row}><h2>Forum management</h2><Link href="/admin/team">Platform team ↗</Link></div><p className={s.meta}>Moderators come from Platform Admin Team. Restrictions apply only to the forum and chat.</p><div className={s.managementTabs}>{[["reports", "Reports"], ["restrictions", "Restricted accounts"], ["removed", "Deleted topics"], ["audit", "History"], ...(context.can_manage ? [["sections", "Sections"]] : [])].map(([id, label]) => <button key={id} aria-pressed={panel === id} onClick={() => setPanel(id)}>{label}</button>)}</div>
      {panel === "reports" && <>{reports.map(x => <article className={s.case} key={x.id}><div className={s.category}>{x.target_type} report · {time(x.created_at)}</div><p><strong>{x.reason}</strong></p><p className={s.body}>{x.preview ?? "Content unavailable"}</p><span className={s.meta}>Reported by {x.reporter_name}</span><div className={s.wrap}>{x.topic_id && <button onClick={() => navigate("topic", x.topic_id!)}>Open discussion</button>}<button onClick={() => setModeration({ op: "delete", kind: x.target_type, id: x.target_id, label: "Delete reported content" })}>Delete content</button>{x.author_id && <button onClick={() => setModeration({ op: "restrict", id: x.author_id!, label: "Restrict author" })}>Restrict author</button>}<button onClick={() => setModeration({ op: "resolve", id: x.id, label: "Resolve report" })}>Resolve</button></div></article>)}{!reports.length && !loading && <p className={s.empty}>No open reports.</p>}</>}
      {panel === "restrictions" && <>{restrictions.map(x => <article className={s.case} key={x.user_id}><h3>{x.display_name}</h3><p>{x.reason}</p><p className={s.meta}>{x.scope} · {x.expires_at ? `Until ${time(x.expires_at)}` : "Until lifted"}</p><button onClick={() => setModeration({ op: "unrestrict", id: x.user_id, label: "Restore forum participation" })}>Lift restriction</button></article>)}{!restrictions.length && !loading && <p className={s.empty}>No active restrictions.</p>}</>}
      {panel === "removed" && <>{topics.map(topicRow)}{topicsMore && <button disabled={loading} onClick={moreTopics}>More deleted topics →</button>}</>}
      {panel === "audit" && <>{audit.map(x => <article className={s.case} key={x.id}><strong>{x.actor_name} · {x.action.replaceAll("_", " ")}</strong><p>{x.reason}</p><p className={s.meta}>{x.target_type} · {time(x.created_at)}</p>{x.action === "delete" && ["topic", "reply", "chat"].includes(x.target_type) && <button onClick={() => setModeration({ op: "restore", kind: x.target_type, id: x.target_id, label: "Restore deleted content" })}>Restore content</button>}</article>)}{!audit.length && !loading && <p className={s.empty}>No moderation history.</p>}</>}
      {panel === "sections" && context.can_manage && <><button className={s.primary} onClick={() => setEditing(null)}>+ Add section</button>{context.sections.map((x, i) => <article className={s.sectionEdit} key={x.id}><div><strong>{x.name}</strong><p className={s.meta}>{x.description}{x.archived ? " · Archived" : ""}</p></div><div className={s.wrap}><button disabled={busy || i === 0} aria-label={`Move ${x.name} up`} onClick={() => void mutate({ op: "section_move", id: x.id, direction: "up", reason: "Reorder sections" }, "Section moved.")}>↑</button><button disabled={busy || i === context.sections.length - 1} aria-label={`Move ${x.name} down`} onClick={() => void mutate({ op: "section_move", id: x.id, direction: "down", reason: "Reorder sections" }, "Section moved.")}>↓</button><button onClick={() => setEditing(x)}>Edit</button></div></article>)}</>}
      <p className={s.meta}>Reports, restrictions and history show the latest 50 records.</p>
    </section>}
    {view === "manage" && !canModerate && <p className={s.empty}>You do not have moderation access.</p>}
    <dialog ref={dialog} className={s.dialog} onCancel={() => setModeration(null)} onClose={() => setModeration(null)}>{moderation && <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); const response = await mutate({ ...moderation, reason: String(f.get("reason") ?? ""), scope: String(f.get("scope") ?? "all"), days: String(f.get("days") ?? ""), section: String(f.get("section") ?? "") }, "Action completed."); if (response) { dialog.current?.close(); setModeration(null); } }}><h2>{moderation.label}</h2>{["delete", "remove_own"].includes(moderation.op) && <p>Content will be hidden. Moderators can restore it from its discussion or moderation history.</p>}{moderation.op === "restrict" && <><p>Restrict this account in the forum only. Salon and POS access remain available.</p><label>Scope<select name="scope"><option value="all">Posting and chat</option><option value="posting">Topics and replies</option><option value="chat">Chat only</option></select></label><label>Duration<select name="days"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="">Until lifted</option></select></label></>}{moderation.op === "move" && <label>Destination section<select name="section" required>{activeSections.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}<label>Reason<textarea autoFocus name="reason" required minLength={3} maxLength={1000} rows={3} /></label>{error && <p role="alert">{error}</p>}<div className={s.wrap}><button className={s.primary} disabled={busy}>Confirm</button><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button></div></form>}</dialog>
    <dialog ref={composeDialog} className={s.dialog} onCancel={() => setEditing(undefined)} onClose={() => setEditing(undefined)}>{editing !== undefined && <form key={editing?.id ?? "new"} onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await mutate({ op: "section_save", id: editing?.id ?? "", name: String(f.get("name")), description: String(f.get("description")), archived: f.has("archived"), reason: String(f.get("reason")) }, "Section saved.")) { composeDialog.current?.close(); setEditing(undefined); } }}><h2>{editing ? "Edit section" : "New section"}</h2><label>Name<input autoFocus name="name" required maxLength={80} defaultValue={editing?.name ?? ""} /></label><label>Description<textarea name="description" maxLength={400} rows={3} defaultValue={editing?.description ?? ""} /></label>{editing && <label className={s.checkbox}><input type="checkbox" name="archived" defaultChecked={editing.archived} /> Archived (keeps existing topics)</label>}<label>Reason<input name="reason" required minLength={3} maxLength={1000} /></label>{error && <p role="alert">{error}</p>}<div className={s.wrap}><button className={s.primary} disabled={busy}>Save section</button><button type="button" disabled={busy} onClick={() => composeDialog.current?.close()}>Cancel</button></div></form>}</dialog>
  </section>;
}
