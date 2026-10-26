"use client";

import Link from "@/components/feedback-link";
import { ROLE_MORE_ITEMS, type RoleNavigationKind } from "@/app/role-navigation";
import { WorkspaceText } from "@/components/workspace-language";
import { WorkspaceNavigationIcon as Icon } from "@/components/workspace-navigation-icon";

/** The same menu body in the global navigation and the POS dropdown. */
export function RoleMoreContent({ roleKind, activeItemIds, onNavigate, listClassName = "", workspace = "standard" }: {
  roleKind: RoleNavigationKind;
  activeItemIds: readonly string[];
  onNavigate: () => void;
  listClassName?: string;
  workspace?: "standard" | "pos";
}) {
  const items = ROLE_MORE_ITEMS[roleKind];
  const destinations: Record<string, string> = workspace === "pos" ? { "/bookings": "/pos/book", "/reports": "/pos/report", "/pos-tickets": "/pos/ticket" } : {};

  return <>
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-text-secondary"><WorkspaceText text="More" /></p>
      <Link className="inline-flex min-h-8 items-center justify-center rounded-full bg-brand-orange-soft px-3 text-xs font-bold text-brand-orange transition hover:bg-brand-orange hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange" href={workspace === "pos" ? "/pos/more" : "/more"} onNavigate={onNavigate}>
        <WorkspaceText text="All" />
      </Link>
    </div>
    <div className={["grid min-h-0 gap-1 overflow-y-auto overscroll-contain p-2", listClassName].join(" ")} data-role-more-items>
      {items.map(item => {
        const isActive = activeItemIds.includes(item.id);
        return <Link
          aria-current={isActive ? "page" : undefined}
          className={["grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange", isActive ? "bg-brand-orange-soft text-brand-orange" : "text-text-primary hover:bg-surface-muted"].join(" ")}
          data-saved-post-target={item.href === "/more/saved-post" ? "true" : undefined}
          href={destinations[item.href] ?? item.href}
          key={item.id}
          onNavigate={onNavigate}
        >
          <span className={["grid h-9 w-9 shrink-0 place-items-center rounded-full", isActive ? "bg-white" : "bg-brand-orange-soft text-brand-orange"].join(" ")}><Icon name={item.navigationIcon} /></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold"><WorkspaceText text={item.label} /></span>
            <span className="mt-0.5 block truncate text-xs font-medium text-text-secondary">{item.description}</span>
          </span>
        </Link>;
      })}
    </div>
    <div className="shrink-0 border-t border-border-subtle p-2">
      <Link className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 text-sm font-bold text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange" href={workspace === "pos" ? "/pos/settings" : "/settings"} onNavigate={onNavigate}>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-orange-soft text-brand-orange"><Icon name="gear" /></span>
        <span><WorkspaceText text="View all settings" /></span>
      </Link>
      {workspace === "pos" ? <Link className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold" href="/" onNavigate={onNavigate}><WorkspaceText text="Exit POS" /></Link> : null}
    </div>
  </>;
}
