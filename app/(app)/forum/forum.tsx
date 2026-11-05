"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { readForum, writeForum } from "./actions";
import type { ForumAudit, ForumContext, ForumInput, ForumMessage, ForumReply, ForumReport, ForumRestriction, ForumSection, ForumTopic } from "@/types/forum";
import s from "./forum.module.css";
import { ForumDiscoveryCard } from "./discovery-card";
import { ForumAvatar, ForumIcon } from "./forum-avatar";
import { forumRelativeTime } from "@/lib/forum-presentation";
import { ContinuationFeed, ForumLoadMore } from "./continuation-feed";
import { ForumCampaignSlot } from "@/components/explore-advertising";

const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
type View = "feed" | "sections" | "chat" | "saved" | "following" | "mine" | "topic" | "write" | "manage";
type Moderation = { op: string; kind?: string; id: string; label: string };
type Detail = { topic: ForumTopic; replies: ForumReply[] };
const time = (v: string) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });


export default function Forum({ initialContext, initialTopics, avatarUrl }: { initialContext: ForumContext; initialTopics: ForumTopic[]; avatarUrl?: string | null }) {
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
  const [focusReply, setFocusReply] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const followPending = useRef(false);
  const pagePending = useRef(false);
  const seenTopic = useRef("");
  const restoredPosition = useRef("");
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
  const navigation = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const composeDialog = useRef<HTMLDialogElement>(null);
  const firstLoad = useRef(true);
  const draftLoaded = useRef(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const profile = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const refs = [menu, profile];
    const outside = (event: PointerEvent) => refs.forEach(ref => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      refs.forEach(ref => { if (ref.current?.open) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } });
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const user = context.user_id;
  const activeSections = context.sections.filter(x => !x.archived);
  const canModerate = context.can_moderate;
  const sectionName = (id: string) => context.sections.find(x => x.id === id)?.name ?? "Section";

  function navigate(next: View, id = "", nextSection = section) {
    try { sessionStorage.setItem('forum-position:'+user+':'+(topicId || view), String(window.scrollY)); } catch {}
    if (menu.current) menu.current.open = false;
    if (profile.current) profile.current.open = false;
    navigation.current++; seenTopic.current=""; restoredPosition.current="";
    request.current++;
    setFocusReply(""); if(next==="topic" && id!==topicId)setReply(""); setView(next); setTopicId(id); setError(""); setNotice(""); setLoading(false);
    if (next === "topic") setDetail(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("topic"); url.searchParams.delete("view"); url.searchParams.delete("reply");
    if (nextSection) url.searchParams.set("section", nextSection); else url.searchParams.delete("section");
    if (next === "topic") url.searchParams.set("topic", id);
    else if (next !== "feed") url.searchParams.set("view", next);
    window.history.pushState(null, "", url); window.scrollTo({top:0, behavior:"instant"});
  }

  useEffect(() => {
    function restore() {
      navigation.current++; request.current++; seenTopic.current=""; restoredPosition.current=""; setDetail(null); setReply("");
      const p = new URLSearchParams(window.location.search), id = p.get("topic"), v = p.get("view");
      setSection(p.get("section") ?? ""); setFocusReply(/^[0-9a-f-]{36}$/i.test(p.get("reply") ?? "") ? p.get("reply")! : "");
      if (id && /^[0-9a-f-]{36}$/i.test(id)) { setTopicId(id); setView("topic"); }
      else if (["sections", "chat", "saved", "following", "mine", "write", "manage"].includes(v ?? "")) { setTopicId(""); setView(v as View); }
      else { setTopicId(""); setView("feed"); }
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
    const seq = ++request.current; pagePending.current=false;
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
    void readForum({ mode, id: topicId, reply_id: focusReply, q: view === "manage" ? "" : search, state: view === "manage" ? "" : state, section: view === "manage" ? "" : section, unanswered: view === "manage" ? false : unanswered }).then(response => {
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
  }, [view, topicId, focusReply, search, state, section, unanswered, panel, revision, canModerate, refreshContext]);

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
      {topic && !deleted && <button disabled={busy} onClick={()=>void mutate({op:"bookmark",id,enabled:!topic.bookmarked},topic.bookmarked?"Đã bỏ lưu":"Đã lưu bài viết")}>{topic.bookmarked?"Bỏ lưu bài viết":"Lưu bài viết"}</button>}
      {topic && view==="topic" && id===topicId && author===user && !topic.locked && !deleted && <button onClick={()=>{setEditingTopic(id);setDraft({title:topic.title,body:topic.body??"",section:topic.section_id,state:topic.state??""});navigate("write");}}>Sửa bài viết</button>}
      {!deleted && <button onClick={() => setModeration({ op: "report", kind, id, label: "Report content" })}>Report</button>}
      {!deleted && author === user && !canModerate && kind !== "chat" && <button onClick={() => setModeration({ op: "remove_own", kind, id, label: "Delete your content" })}>Delete my content</button>}
      {canModerate && <>
        <button onClick={() => setModeration({ op: deleted ? "restore" : "delete", kind, id, label: deleted ? "Restore content" : "Delete content" })}>{deleted ? "Restore" : "Delete"}</button>
        {topic && <><button onClick={() => setModeration({ op: topic.locked ? "unlock" : "lock", kind, id, label: topic.locked ? "Unlock discussion" : "Lock discussion" })}>{topic.locked ? "Unlock" : "Lock"}</button><button onClick={() => setModeration({ op: topic.pinned ? "unpin" : "pin", kind, id, label: topic.pinned ? "Unpin topic" : "Pin topic" })}>{topic.pinned ? "Unpin" : "Pin"}</button><button onClick={() => setModeration({ op: "move", kind, id, label: "Move topic" })}>Move section</button></>}
        {author && author !== user && <button onClick={() => setModeration({ op: "restrict", id: author, label: "Restrict forum participation" })}>Restrict author</button>}
      </>}
    </div></details>;
  }

  const sectionLabel = (id: string) => ({"Owner lounge":"Đời thợ nails","Salon operations":"Vận hành tiệm","Team & hiring":"Thợ & tuyển dụng","Marketing":"Khách & marketing"}[sectionName(id)] ?? sectionName(id));
  function topicRow(t: ForumTopic) {
    return <article className={s.post} key={t.id} data-forum-topic={t.id}>
      <div className={s.row}><div className={s.author}><ForumAvatar src={t.author_avatar}/><div><div><strong>{t.author_name}</strong><span className={s.metaTime}> · {forumRelativeTime(t.created_at)}</span></div><small>{sectionLabel(t.section_id)}{t.state ? ' · '+t.state : ''}</small></div></div>{controls("topic",t.id,t.author_id,Boolean(t.deleted_at),t)}</div>
      <button className={s.topicTitle} onClick={() => navigate("topic",t.id)}>{t.title}</button>
      {t.body && <p className={s.excerpt}>{t.body}</p>}
      <div className={s.row}><button className={s.replyCount} onClick={() => navigate("topic",t.id)}><ForumIcon name="reply"/>{t.reply_count ?? 0} trả lời</button><button className={s.readPost} onClick={() => navigate("topic",t.id)}>Xem bài</button></div>
      {(t.pinned || t.locked || t.deleted_at || Boolean(t.unread_replies)) && <div className={s.badges}>{t.pinned && <span>Đã ghim</span>}{t.locked && <span>Đã khóa</span>}{t.deleted_at && <span>Đã xóa</span>}{Boolean(t.unread_replies) && <span>{t.unread_replies} trả lời mới</span>}</div>}
    </article>;
  }
  async function followPost() {
    if (!detail || followPending.current) return;
    followPending.current=true; setBusy(true); const id=detail.topic.id, enabled=!detail.topic.following;
    try { const result=await writeForum({op:"follow",id,enabled}); if(result.error) setError(result.error);
      else setDetail(old=>old?.topic.id===id ? {...old,topic:{...old.topic,following:enabled}} : old);
    } catch { setError("Không lưu được lựa chọn theo dõi. Vui lòng thử lại."); }
    finally { followPending.current=false;setBusy(false); }
  }
  useEffect(()=>{
    if(view!=="topic" || !detail || loading || detail.topic.id!==topicId) return;
    if(seenTopic.current!==topicId) { seenTopic.current=topicId; void writeForum({op:"seen",id:topicId}).catch(()=>{}); }
    const restoreKey=topicId+":"+focusReply; if(restoredPosition.current===restoreKey)return;restoredPosition.current=restoreKey;
    const target=focusReply ? document.getElementById('forum-reply-'+focusReply) : null;
    if(target) { target.scrollIntoView({block:"center"}); return; }
    try { const offset=Number(sessionStorage.getItem('forum-position:'+user+':'+topicId)); if(offset>0) window.scrollTo({top:offset,behavior:"instant"}); } catch {}
  },[view,topicId,detail?.topic.id,loading,focusReply,user]);

  async function moreTopics() {
    if (busy || loading || pagePending.current) return;
    const last = topics.at(-1); if (!last) return;
    pagePending.current=true; setLoading(true); const seq = request.current;
    try { const r = await readForum({ mode: view === "manage" ? "removed" : view, q: view === "manage" ? "" : search, state: view === "manage" ? "" : state, section: view === "manage" ? "" : section, unanswered: view === "manage" ? false : unanswered, before: last.created_at, cursor_id: last.id, before_pinned: last.pinned }); if (seq !== request.current) return; if (r.error) setError(r.error); else { const rows = r.data as ForumTopic[]; setTopics(old => [...old, ...rows.slice(0, 20)]); setTopicsMore(rows.length > 20); } }
    finally { if (seq === request.current) { pagePending.current=false; setLoading(false); } }
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
    const started = navigation.current;
    const result = await mutate({ op: editingTopic ? "edit_topic" : "topic", id: editingTopic ?? "", ...draft }, editingTopic ? "Topic updated." : "Topic published.");
    const id = editingTopic ?? result?.id;
    if (result && id) { setDraft({ title: "", body: "", section: activeSections[0]?.id ?? "", state: "" }); setEditingTopic(null); if (navigation.current === started) navigate("topic", id); }
  }

  return <section className={s.forum} aria-label="Owner forum">
    <div className={s.stickyHeader}>
    <header className={s.header} aria-label="Forum header">
      <button type="button" className={s.logo} aria-label="Reylumi · Forum home" onClick={()=>{setSection("");setQuery("");setState("");setUnanswered(false);navigate("feed","","");}}><Image unoptimized src="/brand/forum-logo.webp" alt="Reylumi" width={112} height={31}/></button>
      <h1 className={s.srOnly}>Owner forum</h1>
      <button type="button" className={s.iconButton} aria-label="Tìm kiếm & bộ lọc" aria-expanded={showSearch} onClick={()=>setShowSearch(v=>!v)}><ForumIcon name="search"/></button>
      <details ref={profile} className={s.profile}><summary aria-label="Your profile and forum menu"><ForumAvatar src={avatarUrl}/></summary><div><strong>{context.display_name}</strong><nav aria-label="Forum"><button onClick={()=>navigate("feed")}>Mới nhất</button><button onClick={()=>navigate("following")}>Following</button><button onClick={()=>navigate("chat")}>Chat chung</button><button onClick={()=>navigate("saved")}>Đã lưu</button><button onClick={()=>navigate("mine")}>Bài của tôi</button>{canModerate && <button onClick={()=>navigate("manage")}>Quản lý</button>}</nav><Link href="/account">Hồ sơ cá nhân</Link><Link href="/support">Trợ giúp</Link></div></details>
      <button type="button" className={s.iconButton} aria-label="New topic" onClick={()=>{setEditingTopic(null);navigate("write");}}><ForumIcon name="compose"/></button>
    </header>
    <nav className={s.fixedTabs} aria-label="Chuyên mục diễn đàn">
      <button aria-current={view==="feed"&&!section?"page":undefined} onClick={()=>{setSection("");navigate("feed","","");}}>Mới nhất</button>
      <button aria-current={view==="following"?"page":undefined} onClick={()=>{setSection("");navigate("following","","");}}>Following</button>
      <button aria-current={view==="chat"?"page":undefined} onClick={()=>{setSection("");navigate("chat","","");}}>Chat</button>
      <details className={s.sectionMenu} ref={menu}><summary aria-label="Các chuyên mục khác"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></summary><div>{activeSections.map(x=><button key={x.id} aria-current={section===x.id&&view==="feed"?"page":undefined} onClick={()=>{setSection(x.id);navigate("feed","",x.id);}}>{sectionLabel(x.id)}</button>)}<button onClick={()=>navigate("saved")}>Bài đã lưu</button><button onClick={()=>navigate("mine")}>Bài của tôi</button>{canModerate&&<button onClick={()=>navigate("manage")}>Quản lý diễn đàn</button>}</div></details>
    </nav>
    </div>
    {showSearch && <div className={s.searchPanel}><div className={s.search}><input autoFocus type="search" aria-label="Search forum" placeholder="Tìm trong diễn đàn…" value={query} maxLength={150} onChange={e=>{setQuery(e.target.value);if(view==="topic")navigate("feed");}}/></div><div className={s.filters}><select aria-label="State" value={state} onChange={e=>setState(e.target.value)}><option value="">Tất cả tiểu bang</option>{STATES.map(x=><option key={x}>{x}</option>)}</select><label><input type="checkbox" checked={unanswered} onChange={e=>setUnanswered(e.target.checked)}/>Chưa có trả lời</label></div></div>}
    {context.restriction && <div className={s.warning}>Your {context.restriction.scope === "all" ? "forum participation" : context.restriction.scope} is restricted{context.restriction.expires_at ? ` until ${time(context.restriction.expires_at)}` : " until further notice"}. {context.restriction.reason} <Link href="/support">Contact support</Link></div>}
    {error && <div className={s.warning} role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>Retry loading</button></div>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {loading && <p className={s.loading} role="status">Loading…</p>}
    {["feed","saved","following","mine"].includes(view) && <><div aria-busy={loading}>{topics.map((topic,index)=><Fragment key={topic.id}>{topicRow(topic)}<ForumCampaignSlot postIndex={index+1}/><ForumDiscoveryCard sections={activeSections.filter(x=>x.id!==section)} postIndex={index+1} onSelect={id=>{setSection(id);navigate("feed","",id);}}/></Fragment>)}</div>{!topics.length&&!loading&&<div className={s.empty}><h2>{view==="following"?"Chưa có bài đang follow":"Chưa có bài viết"}</h2><p>{view==="following"?"Mở một bài và chọn Follow this post. Bài bạn đăng hoặc đã trả lời cũng xuất hiện ở đây.":"Chia sẻ câu chuyện của bạn hoặc thử bỏ bộ lọc."}</p></div>}{topicsMore&&<ForumLoadMore enabled={!loading&&!error} load={()=>void moreTopics()}><button disabled={loading} onClick={moreTopics}>Xem thêm bài viết</button></ForumLoadMore>}</>}
    {view === "sections" && <div className={s.sections}>{activeSections.map(x => <button key={x.id} onClick={() => { setSection(x.id); navigate("feed"); }}><span><strong>{x.name}</strong><small>{x.description}</small></span><span>→</span></button>)}</div>}
    {view === "write" && <form className={s.compose} onSubmit={submitPost}><div className={s.row}><h2>{editingTopic ? "Edit topic" : "New topic"}</h2><button type="button" onClick={() => navigate("feed")}>Back</button></div><p className={s.meta}>Draft text is saved for this browser session.</p><label>Title<input required minLength={5} maxLength={180} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="What would you like to share?" /></label><div className={s.pickers}><label>Section<select disabled={Boolean(editingTopic)} required value={draft.section} onChange={e => setDraft({ ...draft, section: e.target.value })}>{activeSections.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>State<select disabled={Boolean(editingTopic)} value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value })}><option value="">Nationwide</option>{STATES.map(x => <option key={x}>{x}</option>)}</select></label></div><label>Content<textarea required maxLength={20000} rows={9} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Your experience could help another salon owner…" /></label><p className={s.meta}>Never include customer contact details, payroll records or other private information.</p><button className={s.primary} disabled={busy}>{busy ? "Saving…" : editingTopic ? "Save changes" : "Publish topic"}</button></form>}
    {view === "topic" && detail?.topic.id === topicId && <><article className={s.detail}><div className={s.row}><span className={s.category}>{sectionName(detail.topic.section_id)} · {detail.topic.state ?? "Nationwide"}</span>{controls("topic", detail.topic.id, detail.topic.author_id, Boolean(detail.topic.deleted_at), detail.topic)}</div><h2>{detail.topic.title}</h2><div className={s.meta}><ForumAvatar src={detail.topic.author_avatar}/>{detail.topic.author_name} · {time(detail.topic.created_at)}</div><p className={s.body}>{detail.topic.body}</p><button className={s.followPost} aria-pressed={Boolean(detail.topic.following)} disabled={busy} onClick={()=>void followPost()}>{detail.topic.following ? "Following this post" : "Follow this post"}</button>{detail.topic.locked && <p className={s.meta}>Thảo luận đã khóa</p>}</article><h3>Bình luận · {detail.replies.length}{replyMore?"+":""}</h3>{focusReply && <button onClick={()=>{setFocusReply("");const u=new URL(window.location.href);u.searchParams.delete("reply");window.history.replaceState(null,"",u);setRevision(n=>n+1);}}>Xem từ bình luận đầu</button>}{detail.replies.map(x => <article className={`${s.reply} ${x.deleted_at ? s.deleted : ""}`} key={x.id} id={"forum-reply-"+x.id} data-unread={focusReply===x.id || undefined}><div className={s.row}><div className={s.meta}><ForumAvatar src={x.author_avatar}/>{x.author_name} · {time(x.created_at)}</div>{controls("reply", x.id, x.author_id, Boolean(x.deleted_at))}</div><p className={s.body}>{x.body}</p>{x.deleted_at && <span className={s.meta}>Deleted · visible to moderators</span>}</article>)}{replyMore && <button disabled={loading} onClick={moreReplies}>More replies →</button>}{!detail.topic.locked && !detail.topic.deleted_at && <form className={s.replyForm} onSubmit={async e => { e.preventDefault(); const started=navigation.current, body=reply; if (await mutate({ op: "reply", id: topicId, body }, "Reply posted.") && navigation.current===started) setReply(current=>current===body?"":current); }}><label><span className={s.srOnly}>Reply as {context.display_name}</span><textarea placeholder="Viết bình luận…" required maxLength={10000} rows={1} value={reply} onChange={e => setReply(e.target.value)} /></label><button className={s.primary} disabled={busy}>Gửi</button></form>}{!replyMore && !detail.topic.deleted_at && <ContinuationFeed key={topicId} topicId={topicId} renderTopic={topicRow} renderDiscovery={index=><ForumDiscoveryCard sections={activeSections.filter(x=>x.id!==detail.topic.section_id)} postIndex={index} onSelect={id=>{setSection(id);navigate("feed","",id);}}/>}/>}</>}
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
