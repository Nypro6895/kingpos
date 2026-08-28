import { getCurrentBusinessContext } from "@/lib/current-context";
import {
  ROLE_MORE_ITEMS,
  roleNavigationKindForContext,
  type RoleMoreIcon,
  type RoleMoreItem,
  type RoleNavigationKind,
} from "@/app/role-navigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

type MoreIconName = RoleMoreIcon;
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

function MoreIcon({ name }: { name: MoreIconName }) {
  const common = {
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };
  const paths: Record<MoreIconName, ReactNode> = {
    badge: (
      <>
        <path d="M12 3 4 7v6c0 4 3.2 7.4 8 8 4.8-.6 8-4 8-8V7z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      </>
    ),
    cash: (
      <>
        <rect height="12" rx="2" width="18" x="3" y="6" />
        <path d="M8 12h.01M16 12h.01M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4" />
      </>
    ),
    flag: (
      <>
        <path d="M5 21V4" />
        <path d="M5 4h11l-1 4 1 4H5" />
      </>
    ),
    gift: (
      <>
        <rect height="13" rx="2" width="18" x="3" y="8" />
        <path d="M12 8v13M3 12h18M7.5 8A2.5 2.5 0 1 1 12 6a2.5 2.5 0 1 1 4.5 2" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </>
    ),
    grid: (
      <>
        <rect height="7" rx="1.5" width="7" x="3" y="3" />
        <rect height="7" rx="1.5" width="7" x="14" y="3" />
        <rect height="7" rx="1.5" width="7" x="3" y="14" />
        <rect height="7" rx="1.5" width="7" x="14" y="14" />
      </>
    ),
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />,
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    receipt: (
      <>
        <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2z" />
        <path d="M8 7h8M8 12h8M8 17h5" />
      </>
    ),
    scissors: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.1 15.9M8.1 8.1 20 20" />
      </>
    ),
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />,
    store: (
      <>
        <path d="M4 10h16l-1-6H5z" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}

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
  return {
    sections: [
      {
        id: "workspace",
        items: pickMoreItems(ROLE_MORE_ITEMS.personal, ["personal-my-place"]),
        summary: "Choose the account, salon, or workplace you want to use.",
        title: "Workspace",
      },
      {
        id: "beauty-history",
        items: pickMoreItems(ROLE_MORE_ITEMS.personal, [
          "personal-activity",
          "personal-saved-post",
          "personal-following",
        ]),
        summary: "Review visits, saved posts, and followed shops or Beauty profiles.",
        title: "Beauty & history",
      },
      {
        id: "account",
        items: pickMoreItems(ROLE_MORE_ITEMS.personal, [
          "personal-memberships",
          "personal-reviews",
          "personal-gift-cards",
          "personal-reports",
        ]),
        summary: "Manage memberships, reviews, rewards, and support history.",
        title: "Account",
      },
    ],
  };
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
            "staff-payroll",
            "staff-statistics",
          ]),
          summary: "Switch workplaces and review your pay or performance.",
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
      className="group grid min-h-[88px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border-subtle bg-surface px-4 text-left shadow-sm transition hover:border-brand-orange/40 hover:shadow-[0_16px_36px_rgba(23,19,22,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      data-saved-post-target={isSavedPostItem ? "true" : undefined}
      href={item.href}
    >
      <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-orange-soft text-brand-orange transition group-hover:bg-brand-orange group-hover:text-white">
        <MoreIcon name={item.icon} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-extrabold text-text-primary">
          {item.label}
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

export default async function MorePage() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect("/login?next=/more");
  }

  const roleKind = roleNavigationKindForContext({
    salonMode: context.salonMode,
    workspaceType: context.workspaceType,
  });
  const more = roleMoreItems(roleKind);

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
                    {section.title}
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-text-secondary">
                    {section.summary}
                  </p>
                </div>
                <p className="text-xs font-bold uppercase text-text-secondary">
                  {formatItemCount(section.items.length)}
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
      </div>
    </main>
  );
}
