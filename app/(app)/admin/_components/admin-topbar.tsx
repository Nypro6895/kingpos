"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { openDashboardRecord } from "@/lib/admin-record-navigation";

type SearchGroup = { label: string; items: Array<{ id: string; label: string; detail: string; href: string }>; unavailable: boolean };
export function AdminGlobalSearch() {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  const results = groups.flatMap(group => group.items);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); inputRef.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener("keydown", shortcut); window.addEventListener("admin:record", close);
    return () => { document.removeEventListener("keydown", shortcut); window.removeEventListener("admin:record", close); };
  }, []);
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/admin/dashboard/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Search unavailable. Please retry.");
        const data = await response.json();
        if (!controller.signal.aborted) setGroups(data.groups);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Search unavailable."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open]);
  const visible = open && query.trim().length >= 2;
  return <form action="/admin/search" className="admin-global-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onSubmit={event => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    const chosen = active >= 0 ? results[active] : null;
    setOpen(false);
    if (chosen && openDashboardRecord(chosen.href)) return;
    router.push(chosen?.href.startsWith("/admin/") ? chosen.href : `/admin/search?q=${encodeURIComponent(query.trim())}`);
  }}>
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg>
    <input ref={inputRef} name="q" type="search" role="combobox" aria-label="Search admin records" aria-autocomplete="list" aria-expanded={visible} aria-controls={id} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} autoComplete="off" placeholder="Search users, salons, email, phone, or case ID…" minLength={2} maxLength={100} value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setGroups([]); setError(""); setLoading(false); setActive(-1); setOpen(true); }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
      if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(index => Math.min(results.length - 1, index + 1)); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(-1, index - 1)); }
    }} />
    <kbd className="admin-search-shortcut">Ctrl K</kbd>{visible && <div className="admin-search-results"><div role="listbox" id={id} aria-label="Matching admin records">{groups.map(group => <div role="group" key={group.label} aria-label={group.label}><p>{group.label}</p>{group.items.map(item => { const index = results.indexOf(item); return <Link id={`${id}-${index}`} role="option" aria-selected={index === active} className={index === active ? "is-active" : ""} key={item.id} href={item.href} onClick={() => setOpen(false)}><strong>{item.label}</strong><small>{item.detail}</small></Link>; })}{group.unavailable && <span className="admin-search-message">This group is temporarily unavailable.</span>}</div>)}</div>{loading && <p role="status" className="admin-search-message">Searching…</p>}{error && <p role="alert" className="admin-search-message">{error}</p>}{!loading && !error && !results.length && <p className="admin-search-message">No matching records.</p>}<Link className="admin-search-all" href={`/admin/search?q=${encodeURIComponent(query.trim())}`} onClick={() => setOpen(false)}>View all search results →</Link></div>}
  </form>;
}

export function AdminTopbar({ roleName, canNotifications }: { roleName: string; canNotifications: boolean }) {
  const pathname = usePathname();
  const section = pathname.split("/")[2];
  const labels: Record<string, string> = { users: "Users", businesses: "Businesses", locations: "Locations", claims: "Ownership claims", verification: "Salon verification", reports: "Support cases", "post-safety": "Post safety", inbox: "Support inbox", notifications: "Notifications", audit: "Audit log", recovery: "Recovery", team: "Admin team", settings: "Settings", advertising: "Advertising", search: "Search" };
  return <div className="admin-topbar"><nav aria-label="Admin breadcrumb"><Link href="/admin">Platform</Link><span>/</span><span>{labels[section] || "Dashboard"}</span></nav><AdminGlobalSearch /><div className="admin-topbar-account">{canNotifications && <Link href="/admin/notifications" aria-label="Admin notifications" className="dashboard-icon-button"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></Link>}<details className="admin-account-menu"><summary><span className="admin-avatar" aria-hidden="true">{roleName.split(" ").map(word => word[0]).slice(0, 2).join("")}</span><span>{roleName}</span><span aria-hidden="true">⌄</span></summary><div><Link href="/account">My account</Link><Link href="/admin/settings">Admin settings</Link></div></details></div></div>;
}
