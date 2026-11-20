"use client";
import {WorkspaceText} from "@/components/workspace-language";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import {PERSONAL_MORE_GROUPS,ROLE_MORE_ITEMS,type RoleMoreItem,type RoleNavigationKind} from "@/app/role-navigation";
import Link from "next/link";

import type{AppLocalMoreData}from"@/lib/app-local-platform-types";
type MoreItem = RoleMoreItem;
type MoreSection = {
  id: string;
  items: MoreItem[];
  summary: string;
  title: string;
};

type MoreContent = {
  sections: MoreSection[];
};



function pickMoreItems(
  items: readonly MoreItem[],
  ids: readonly string[],
): MoreItem[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));

  return ids
    .map((id) => itemsById.get(id))
    .filter((item): item is MoreItem => Boolean(item));
}

function formatItemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function personalMoreItems(): MoreContent {
  return { sections: PERSONAL_MORE_GROUPS.map(group => ({
    id: group.id, title: group.title, summary: group.summary,
    items: pickMoreItems(ROLE_MORE_ITEMS.personal, group.ids),
  })) };
}

function roleMoreItems(roleKind: RoleNavigationKind): MoreContent {
  if (roleKind === "owner") {
    return {
      sections: [
        {
          id: "workspace",
          items: pickMoreItems(ROLE_MORE_ITEMS.owner, ["owner-my-place"]),
          summary: "Switch salons, staff workplaces, accounts, or Personal mode.",
          title: "Workspace",
        },
        {
          id: "front-desk",
          items: pickMoreItems(ROLE_MORE_ITEMS.owner, [
            "owner-pos",
            "owner-ticket",
            "owner-customers",
            "owner-staff",
            "owner-services",
          ]),
          summary: "Open daily tools for sales, tickets, customers, team, and services.",
          title: "Front desk",
        },
        {
          id: "business",
          items: pickMoreItems(ROLE_MORE_ITEMS.owner, [
            "owner-report",
            "owner-payroll",
            "owner-setting",
            "owner-market",
            "owner-campaigns",
            "owner-support",
          ]),
          summary: "Review performance, payroll, and salon configuration.",
          title: "Business",
        },
      ],
    };
  }

  if (roleKind === "staff") {
    return {
      sections: [
        {
          id: "work",
          items: pickMoreItems(ROLE_MORE_ITEMS.staff, [
            "staff-my-place",
            "staff-support",
          ]),
          summary: "Switch workplaces or get help.",
          title: "Work",
        },
        {
          id: "saved-following",
          items: pickMoreItems(ROLE_MORE_ITEMS.staff, [
            "staff-saved-post",
            "staff-following",
          ]),
          summary: "Keep track of saved posts and followed shops or Beauty profiles.",
          title: "Saved & following",
        },
      ],
    };
  }

  return personalMoreItems();
}

function MoreItemLink({ item }: { item: MoreItem }) {
  const isSavedPostItem = item.href === "/more/saved-post";

  return (
    <Link
      className="content-surface group grid min-h-[88px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle bg-surface px-4 text-left transition hover:border-brand-orange/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      data-saved-post-target={isSavedPostItem ? "true" : undefined}
      href={item.href}
    >
      <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-orange-soft text-brand-orange transition group-hover:bg-brand-orange group-hover:text-white">
        <WorkspaceNavigationIcon name={item.navigationIcon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-extrabold text-text-primary">
          <WorkspaceText text={item.label} />
        </span>
        <span className="mt-0.5 block line-clamp-1 text-xs font-semibold text-text-secondary">
          {item.description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="text-xl text-text-secondary transition group-hover:translate-x-0.5 group-hover:text-brand-orange"
      >
        {">"}
      </span>
    </Link>
  );
}


export function AppLocalMore({roleKind,campaignInstalled}:AppLocalMoreData){const more=roleMoreItems(roleKind);for(const section of more.sections)section.items=section.items.filter(item=>item.id!=="owner-campaigns"||campaignInstalled);
  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <div className="grid gap-7">
          {more.sections.map((section) => (
            <section
              aria-labelledby={`more-${section.id}-title`}
              className="grid gap-3"
              key={section.id}
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2
                    className="text-base font-extrabold text-text-primary"
                    id={`more-${section.id}-title`}
                  >
                    <WorkspaceText text={section.title} />
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-text-secondary">
                    {section.summary}
                  </p>
                </div>
                <p className="text-xs font-bold uppercase text-text-secondary">
                  <WorkspaceText text={formatItemCount(section.items.length)} />
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {section.items.map((item) => (
                  <MoreItemLink item={item} key={item.href} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <Link
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-md border border-border-subtle bg-surface px-4 text-sm font-extrabold text-text-primary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href="/settings"
        >
          <WorkspaceText text="All settings, account & security" />
        </Link>
      </div>
    </main>
  );
}
