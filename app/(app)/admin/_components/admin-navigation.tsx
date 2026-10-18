"use client";

import { SettingsIcon } from "@/components/settings-icon";

import { AdminIcon, ADMIN_ICON_PATHS, type AdminIconName } from "./admin-icon";
import Link from "@/components/feedback-link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type AdminNavigationItem = { href: string; label: string; group: string; icon: string; count?: number };

function AdminNavIcon({ href }: { href:string }) {
  const section = href.split("/")[2] || "dashboard";
  if (section === "settings") return <SettingsIcon className="h-[18px] w-[18px] shrink-0" strokeWidth="1.7" />;
  const names: Record<string, AdminIconName> = { market: "business", locations: "business", businesses: "business", inbox: "mail", recovery: "history", "post-safety": "flag" };
  const name = names[section] ?? (section in ADMIN_ICON_PATHS ? section as AdminIconName : "dashboard");
  return <AdminIcon name={name} size={18} className="shrink-0" />;
}

export function AdminNavigation({ items, mobile = false }: { items: AdminNavigationItem[]; mobile?: boolean }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const current = items.filter(item => pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`))).sort((a,b)=>b.href.length-a.href.length)[0];
  const groups = [...new Set(items.map(item => item.group))];
  return <div>
    {mobile && <button type="button" aria-expanded={expanded} aria-controls="admin-mobile-menu" className="mt-3 flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold" onClick={() => setExpanded(!expanded)}><span>{current?.label ?? "Admin navigation"}</span><span>{expanded ? "Close menu ×" : "Menu ☰"}</span></button>}
    <nav id={mobile ? "admin-mobile-menu" : undefined} aria-label={mobile ? "Admin mobile" : "Admin"} className={mobile && !expanded ? "hidden" : "admin-navigation mt-5 grid gap-5"}>
      {groups.map(group => <div key={group}>
        {group && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-400">{group}</p>}
        <div className="grid gap-1">{items.filter(item => item.group === group).map(item => {
          const active = current?.href === item.href;
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setExpanded(false)} className={`admin-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-orange-600 ${active ? "bg-orange-50 text-orange-700" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"}`}><AdminNavIcon href={item.href}/><span>{item.label}</span>{item.count != null && item.count > 0 && <span className="admin-nav-count" aria-label={`${item.count} pending`}>{item.count > 99 ? "99+" : item.count}</span>}</Link>;
        })}</div>
      </div>)}
    </nav>
  </div>;
}
