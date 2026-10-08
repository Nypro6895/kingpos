"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type AdminNavigationItem = { href: string; label: string; group: string; icon: string; count?: number };

function AdminNavIcon({ href }: { href:string }) {
  const paths: Record<string,string> = {
    admin:"M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    users:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    businesses:"M3 21h18M5 21V3h10v18M15 8h4v13M8 7h4M8 11h4M8 15h4",
    locations:"M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    reports:"M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l2-5a8.5 8.5 0 1 1 16-3.5ZM8 10h8M8 14h5",
    recovery:"M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2",
    claims:"M8 3H5v18h14V3h-3M8 3v4h8V3ZM8 12h8M8 16h5",
    verification:"M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7ZM8 12l3 3 5-6",
    notifications:"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    inbox:"M3 5h18v14H3ZM3 5l9 7 9-7",
    advertising:"M3 10v4h4l12 5V5L7 10ZM7 14l2 7h3l-2-6M22 9v6",
    audit:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l4 2",
    team:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M16 11h6",
    settings:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z",
  };
  const section=href.split("/")[2] || "admin";
  return <svg aria-hidden="true" className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[section] ?? paths.admin}/></svg>;
}

export function AdminNavigation({ items, mobile = false }: { items: AdminNavigationItem[]; mobile?: boolean }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const current = items.find(item => item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href));
  const groups = [...new Set(items.map(item => item.group))];
  return <div>
    {mobile && <button type="button" aria-expanded={expanded} aria-controls="admin-mobile-menu" className="mt-3 flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold" onClick={() => setExpanded(!expanded)}><span>{current?.label ?? "Admin navigation"}</span><span>{expanded ? "Close menu ×" : "Menu ☰"}</span></button>}
    <nav id={mobile ? "admin-mobile-menu" : undefined} aria-label={mobile ? "Admin mobile" : "Admin"} className={mobile && !expanded ? "hidden" : "admin-navigation mt-5 grid gap-5"}>
      {groups.map(group => <div key={group}>
        {group && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-400">{group}</p>}
        <div className="grid gap-1">{items.filter(item => item.group === group).map(item => {
          const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setExpanded(false)} className={`admin-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-orange-600 ${active ? "bg-orange-50 text-orange-700" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"}`}><AdminNavIcon href={item.href}/><span>{item.label}</span>{item.count != null && item.count > 0 && <span className="admin-nav-count" aria-label={`${item.count} pending`}>{item.count > 99 ? "99+" : item.count}</span>}</Link>;
        })}</div>
      </div>)}
    </nav>
  </div>;
}
