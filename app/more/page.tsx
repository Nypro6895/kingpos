import {
  getCurrentBusinessContext,
  isSalonManageContext,
  isSalonStaffContext,
} from "@/lib/current-context";
import {
  ROLE_MORE_ITEMS,
  type RoleMoreIcon,
  type RoleMoreItem,
} from "@/app/role-navigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

type MoreIconName = RoleMoreIcon;
type MoreItem = RoleMoreItem;

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

function moreItemsForContext(
  context: Awaited<ReturnType<typeof getCurrentBusinessContext>>,
) {
  if (isSalonStaffContext(context)) {
    return {
      eyebrow: "Staff",
      items: ROLE_MORE_ITEMS.staff,
      summary: "Payroll, statistics, saved posts, and shared favorites.",
      title: "More",
    };
  }

  if (isSalonManageContext(context)) {
    return {
      eyebrow: "Owner",
      items: ROLE_MORE_ITEMS.owner,
      summary: "Owner tools for the current salon.",
      title: "More",
    };
  }

  return {
    eyebrow: "Personal",
    items: ROLE_MORE_ITEMS.personal,
    summary: "Saved posts, favorite profiles, memberships, and account support.",
    title: "More",
  };
}

function MoreItemLink({ item }: { item: MoreItem }) {
  return (
    <Link
      className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border-subtle bg-surface px-4 text-left shadow-sm transition hover:border-brand-orange/40 hover:shadow-[0_16px_36px_rgba(23,19,22,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href={item.href}
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-orange-soft text-brand-orange">
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
      <span aria-hidden="true" className="text-xl text-text-secondary">
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

  const more = moreItemsForContext(context);

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <header>
          <p className="text-xs font-bold uppercase text-brand-orange">
            {more.eyebrow}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold text-text-primary">
            {more.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold text-text-secondary">
            {more.summary}
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2" aria-label="More options">
          {more.items.map((item) => (
            <MoreItemLink item={item} key={item.href} />
          ))}
        </section>
      </div>
    </main>
  );
}
