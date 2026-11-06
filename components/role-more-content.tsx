"use client";

import Link from "@/components/feedback-link";
import type { RoleNavigationKind } from "@/app/role-navigation";
import { roleMoreGroups } from "@/app/role-more-groups";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { WorkspaceNavigationIcon as Icon } from "@/components/workspace-navigation-icon";
import "./role-more-content.css";

/** Shared presentation; links retain their original destinations. */
export function RoleMoreContent({ roleKind, activeItemIds, onNavigate, onClose = onNavigate, listClassName = "", workspace = "standard" }: {
  roleKind: RoleNavigationKind;
  activeItemIds: readonly string[];
  onNavigate: () => void;
  onClose?: () => void;
  listClassName?: string;
  workspace?: "standard" | "pos";
}) {
  const destinations: Record<string,string> = workspace === "pos" ? {"/bookings":"/pos/book","/reports":"/pos/report","/pos-tickets":"/pos/ticket"} : {};
  const translate = useWorkspaceTranslation();
  return <>
    <div className="role-more-header">
      <h2><WorkspaceText text="More" /></h2>
      <Link className="role-more-all" href={workspace === "pos" ? "/pos/more" : "/more"} onClick={onNavigate}><WorkspaceText text="All" /></Link>
      <button type="button" className="role-more-close" aria-label={translate("Close")} onClick={onClose}><span aria-hidden="true">×</span></button>
    </div>
    <div className={["role-more-groups", listClassName].join(" ")} data-role-more-items>
      {roleMoreGroups(roleKind).map(group => <section className="role-more-group" key={group.id} aria-label={translate(group.title)}>
        <h3><WorkspaceText text={group.title} /></h3>
        <div className="role-more-grid">
          {group.items.map(item => <Link
            aria-current={activeItemIds.includes(item.id) ? "page" : undefined}
            className="role-more-item"
            data-saved-post-target={item.href === "/more/saved-post" ? "true" : undefined}
            href={destinations[item.href] ?? item.href} key={item.id} onClick={onNavigate}
          ><Icon name={item.navigationIcon} /><span><WorkspaceText text={item.label} /></span></Link>)}
        </div>
      </section>)}
    </div>
    <div className="role-more-footer">
      <Link className="role-more-settings" href="/settings" onClick={onNavigate}>
        <Icon name="gear" /><span><WorkspaceText text="All Settings" /></span><span className="role-more-chevron" aria-hidden="true" />
      </Link>
      {workspace === "pos" ? <Link className="role-more-settings" href="/" onClick={onNavigate}><WorkspaceText text="Exit POS" /></Link> : null}
    </div>
  </>;
}
