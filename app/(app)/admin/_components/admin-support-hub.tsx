"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminIcon } from "./admin-icon";
import { ActionFeedback } from "@/components/action-feedback";
import { AdminConversationChat } from "./admin-conversation-chat";
import type { SupportConversation } from "@/lib/support-cases";
import { ADMIN_SUPPORT_OPEN } from "@/lib/admin-support-client";

type Activity = { id: string; report_id: string | null; kind: string; title: string; href: string; created_at: string; can_chat: boolean; unread: boolean };
type Feed = { items: Activity[]; unread_count: number };
export function AdminSupportHub() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>({ items: [], unread_count: 0 });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [error, setError] = useState("");
  const [chatError, setChatError] = useState("");
  const [incoming, setIncoming] = useState<Activity | null>(null);
  const [minimized,setMinimized]=useState(false);
  const [marking,setMarking]=useState(0);
  const cache=useRef(new Map<string,{data:SupportConversation;etag:string;at:number}>());
  const requests=useRef(new Map<string,Promise<void>>());
  const current = useRef<string | null>(null), draft = useRef(false), seen = useRef<Set<string> | null>(null), running = useRef(false), loadVersion = useRef(0);
  const draftChanged=useCallback((value:boolean)=>{draft.current=value;},[]);
  const loadConversation = useCallback(async (id: string) => {
    if(requests.current.has(id))return requests.current.get(id)!;
    const task=(async()=>{
      try {
        const stored=cache.current.get(id), headers:Record<string,string>={};
        if(stored&&Date.now()-stored.at<480000)headers["If-None-Match"]=stored.etag;
        const response=await fetch(`/admin/api/support-conversation?case=${id}`,{cache:"no-store",headers,signal:AbortSignal.timeout(10000)});
        if(response.status===304){if(current.current===id)setChatError("");return;}
        const data=await response.json();
        if(!response.ok){cache.current.delete(id);if(current.current===id)setConversation(null);throw Error(data.error||"Conversation unavailable.");}
        cache.current.set(id,{data,etag:response.headers.get("etag")||"",at:Date.now()});
        if(cache.current.size>10)cache.current.delete(cache.current.keys().next().value!);
        if(current.current===id){setConversation(data);setChatError("");}
      }catch(error){if(current.current===id)setChatError(error instanceof Error?error.message:"Could not load conversation.");}
    })();
    requests.current.set(id,task);
    try{await task;}finally{requests.current.delete(id);}
  },[]);
  const open = useCallback((id: string, automatic = false) => {
    if (id !== current.current && draft.current) {
      if (automatic || !window.confirm("Discard the unsent reply and open another conversation?")) return;
    }
    if (id !== current.current) {
      const stored = cache.current.get(id);
      // Attachment URLs expire after ten minutes; never reopen an older snapshot.
      setConversation(stored && Date.now() - stored.at < 480000 ? stored.data : null);
      draft.current = false;
    }
    current.current = id; setReportId(id); setMinimized(false); setChatError(""); setNotificationsOpen(false); setIncoming(null); void loadConversation(id);
  }, [loadConversation]);
  const refresh = useCallback(async () => {
    if (running.current || document.visibilityState !== "visible") return;
    running.current = true;
    try {
      const response = await fetch("/admin/api/support-activity", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const data: Feed & { error?: string } = await response.json();
      if (!response.ok) throw Error(data.error || "Team notifications unavailable.");
      setFeed(data); setError("");
      const fresh = seen.current ? data.items.filter(item => !seen.current!.has(item.id)) : [];
      seen.current = new Set(data.items.map(item => item.id));
      const reply = fresh.find(item => item.can_chat && item.report_id && ["user_reply", "user_attachment"].includes(item.kind));
      if (reply?.report_id) {
        router.refresh();
        if (!current.current) open(reply.report_id, true);
        else if (current.current === reply.report_id) void loadConversation(reply.report_id);
        else setIncoming(reply);
      }
      if (!reply && current.current) void loadConversation(current.current);
    } catch (error) { setError(error instanceof Error ? error.message : "Team notifications unavailable."); }
    finally { running.current = false; }
  }, [loadConversation, open, router]);
  useEffect(() => {
    const requested = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (/^[0-9a-f-]{36}$/i.test(id)) open(id); };
    const visible = () => { void refresh(); };
    window.addEventListener(ADMIN_SUPPORT_OPEN, requested); window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    const initial = setTimeout(visible, 0); const timer = setInterval(visible, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); window.removeEventListener(ADMIN_SUPPORT_OPEN, requested); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [open, refresh]);
  async function mark(ids: string[]) {
    if (!ids.length) return;
    setMarking(count=>count+1);
    try {
      const response = await fetch("/admin/api/support-activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!response.ok) throw Error("Could not mark notifications read.");
      void refresh();
    } catch { setError("Could not mark notifications read. Please retry."); }
    finally { setMarking(count=>Math.max(0,count-1)); }
  }
  function choose(item: Activity) { void mark([item.id]); if (item.can_chat && item.report_id) open(item.report_id); else setNotificationsOpen(false); }
  const close = () => { if (draft.current && !window.confirm("Discard the unsent reply?")) return; current.current = null; draft.current = false; loadVersion.current++; setReportId(null); setConversation(null); };
  return <div className="admin-support-hub">
    <button type="button" aria-label="Team notifications" aria-expanded={notificationsOpen} className="dashboard-icon-button admin-team-bell" onClick={() => { setNotificationsOpen(value => !value); void refresh(); }}><AdminIcon name="notifications" size={20} />{feed.unread_count > 0 && <span className="admin-team-count">{feed.unread_count > 99 ? "99+" : feed.unread_count}</span>}</button>
    {notificationsOpen && <section className="admin-team-feed" aria-label="Team notifications"><header><strong>Team notifications</strong><button type="button" aria-label="Close team notifications" onClick={() => setNotificationsOpen(false)}>×</button></header><p className="admin-team-hint">New requests, replies and evidence · refreshes every 5 seconds</p>{error && <p role="alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></p>}<div className="admin-team-events">{feed.items.map(item => item.can_chat ? <button type="button" key={item.id} className={item.unread ? "is-unread" : ""} onClick={() => choose(item)}><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString()}</small></button> : <Link key={item.id} className={item.unread ? "is-unread" : ""} href={item.href} onClick={() => choose(item)}><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString()}</small></Link>)}{!feed.items.length && <p>No team notifications.</p>}</div><footer><button type="button" disabled={marking>0} aria-busy={marking>0} onClick={() => void mark(feed.items.filter(item => item.unread).map(item => item.id))}><ActionFeedback pending={marking>0} pendingLabel="Marking as read…">Mark shown as read</ActionFeedback></button><Link href="/admin/reports">All support cases</Link></footer></section>}
    {incoming && <div role="status" className="admin-support-incoming"><strong>{incoming.title}</strong><button type="button" onClick={() => choose(incoming)}>Open conversation</button><button type="button" aria-label="Dismiss new reply" onClick={() => setIncoming(null)}>×</button></div>}
    {reportId && <aside role="dialog" aria-label="Reporter conversation" className={`admin-support-chat ${minimized?"is-minimized":""}`}><header><strong>Support conversation</strong><button type="button" aria-label={minimized?"Restore conversation":"Minimize conversation"} onClick={()=>setMinimized(v=>!v)}>{minimized?"□":"−"}</button><button type="button" aria-label="Close conversation" onClick={close}>×</button></header><div className="admin-support-chat-body">{chatError && <p role="alert">{chatError} <button type="button" onClick={() => void loadConversation(reportId)}>Retry</button></p>}{conversation ? <AdminConversationChat key={reportId} conversation={conversation} onRefresh={async()=>{await loadConversation(reportId);void refresh();}} onDraftChange={draftChanged} /> : !chatError && <p role="status">Loading conversation…</p>}</div><footer><Link href={conversation?.review?.kind === "claim" ? "/admin/claims?status=all" : `/admin/reports/${reportId}`}>Open case in Platform Admin</Link></footer></aside>}
  </div>;
}
