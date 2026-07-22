import { getCurrentBusinessContext } from "@/lib/current-context";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

type MoreIconName =
  | "badge"
  | "flag"
  | "gift"
  | "heart"
  | "star"
  | "users";

type MoreItem = {
  description: string;
  href: string;
  icon: MoreIconName;
  label: string;
};

const CUSTOMER_MORE_ITEMS: MoreItem[] = [
  {
    description: "Looks and designs saved from salon profiles.",
    href: "/more/saved-designs",
    icon: "heart",
    label: "Saved Designs",
  },
  {
    description: "Salons you follow for updates and offers.",
    href: "/more/following",
    icon: "users",
    label: "Following",
  },
  {
    description: "Customer memberships connected to your account.",
    href: "/more/memberships",
    icon: "badge",
    label: "Memberships",
  },
  {
    description: "Reviews you have posted as a customer.",
    href: "/more/reviews",
    icon: "star",
    label: "Reviews",
  },
  {
    description: "Gift cards available to your customer account.",
    href: "/more/gift-cards",
    icon: "gift",
    label: "Gift Cards",
  },
  {
    description: "Support updates and customer report history.",
    href: "/more/reports",
    icon: "flag",
    label: "Reports",
  },
];

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
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />,
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

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <header>
          <p className="text-xs font-bold uppercase text-brand-orange">More</p>
          <h1 className="mt-1 text-3xl font-extrabold text-text-primary">
            More
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold text-text-secondary">
            Saved designs, follows, memberships, reviews, gift cards, and
            customer support.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2" aria-label="More options">
          {CUSTOMER_MORE_ITEMS.map((item) => (
            <MoreItemLink item={item} key={item.href} />
          ))}
        </section>
      </div>
    </main>
  );
}
