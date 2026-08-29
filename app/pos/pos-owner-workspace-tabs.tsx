"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const OWNER_POS_TABS = [
  { href: "/pos", id: "ticket", label: "Ticket" },
  { href: "/bookings", id: "book", label: "Book" },
  { href: "/staff/today", id: "check-in", label: "Check In" },
  { href: "/reports", id: "report", label: "Report" },
] as const;

type IdleWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
};

function isActive(pathname: string, href: string) {
  if (href === "/pos") return pathname === "/pos";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PosOwnerWorkspaceTabs() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const prefetch = () => {
      for (const tab of OWNER_POS_TABS) {
        if (!isActive(pathname, tab.href)) router.prefetch(tab.href);
      }
    };
    const idleWindow = window as IdleWindow;

    if (typeof idleWindow.requestIdleCallback === "function") {
      const id = idleWindow.requestIdleCallback(prefetch, { timeout: 1000 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }

    const id = globalThis.setTimeout(prefetch, 200);
    return () => globalThis.clearTimeout(id);
  }, [pathname, router]);

  return (
    <nav
      aria-label="POS workspace"
      className="grid grid-cols-4 gap-1 rounded-2xl bg-zinc-200/70 p-1"
      data-pos-owner-workspace-tabs
    >
      {OWNER_POS_TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={[
              "flex min-h-11 min-w-0 items-center justify-center rounded-xl px-2 text-center text-xs font-bold transition sm:text-sm",
              active
                ? "bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200"
                : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950",
            ].join(" ")}
            href={tab.href}
            key={tab.id}
            prefetch
          >
            <span className="truncate">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
