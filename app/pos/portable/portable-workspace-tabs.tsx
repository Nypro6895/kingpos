"use client";

import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { logoutPortablePosAction } from "@/app/pos/portable/actions";
import { clearPortableLocalDrafts } from "@/app/pos/portable/use-portable-draft";
import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";
import { PortableSyncIndicator } from "@/app/pos/portable/portable-sync-indicator";
import { DesktopTools } from "./desktop-tools";
import { PortableBookingNotifications } from "./portable-booking-notifications";
import { PortableFullscreenButton } from "./portable-fullscreen-button";
import { PosWorkspaceRealtimeRefresh } from "@/app/pos/pos-workspace-realtime-refresh";
import {
  isPortablePosRoute,
  type PortablePosRouteLink,
} from "@/lib/pos-portable-routes";

type PortableWorkspaceTabsProps = {
  canConfirmBookings?: boolean;
  localPanels?: boolean;
  items: PortablePosRouteLink[];
  salonId: string;
  salonLogoUrl: string | null;
  salonName: string;
  salonTimezone: string;
};

const PORTABLE_IGNORED_REFRESH_SOURCES = ["attendance"] as const;

function TabPendingIndicator() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden="true"
      className={[
        "absolute bottom-1 h-0.5 w-5 rounded-full bg-zinc-900 transition-opacity delay-100",
        pending ? "animate-pulse opacity-100" : "opacity-0",
      ].join(" ")}
    />
  );
}

type PortableNavIconName =
  | "book"
  | "checkIn"
  | "lock"
  | "pos"
  | "report"
  | "ticket";

function PortableNavIcon({ name }: { name: PortableNavIconName }) {
  let content: ReactNode;

  if (name === "pos") {
    content = <><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5M7 7h6m-6 4h3m6-4v5m-2-2h4"/></>;
  } else if (name === "ticket") {
    content = <path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm4 5h6m-6 4h6" />;
  } else if (name === "book") {
    content = (
      <>
        <path d="M7 2v3m10-3v3M4 9h16M6 4h12a2 2 0 0 1 2 2v14H4V6a2 2 0 0 1 2-2Z" />
        <path d="M8 13h3v3H8z" />
      </>
    );
  } else if (name === "checkIn") {
    content = (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0m1-7 2 2 4-4" />
      </>
    );
  } else if (name === "report") {
    content = (
      <>
        <path d="M4 20V10m6 10V4m6 16v-7m4 7V7" />
        <path d="M2 20h20" />
      </>
    );
  } else {
    content = (
      <>
        <rect height="10" rx="2" width="14" x="5" y="11" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {content}
    </svg>
  );
}

function SalonBrand({
  salonLogoUrl,
  salonName,
  salonTimezone,
}: {
  salonLogoUrl: string | null;
  salonName: string;
  salonTimezone: string;
}) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const update = () => {
      setClock(
        new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          month: "short",
          timeZone: salonTimezone,
          year: "numeric",
        }).format(new Date()),
      );
    };
    const firstUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 30_000);
    return () => {
      window.clearTimeout(firstUpdate);
      window.clearInterval(interval);
    };
  }, [salonTimezone]);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="relative hidden h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white sm:block">
        {salonLogoUrl ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="44px"
            src={salonLogoUrl}
          />
        ) : (
          <span className="grid h-full w-full place-items-center bg-emerald-950 text-sm font-bold text-white">
            {salonName.trim().charAt(0).toUpperCase() || "S"}
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold text-zinc-950">
          {salonName}
        </span>
        <span className="block truncate text-xs font-medium tabular-nums text-zinc-500">
          {clock || "Loading time..."}
        </span>
      </span>
    </div>
  );
}

export function PortableWorkspaceTabs({
  canConfirmBookings = false,
  localPanels = false,
  items,
  salonId,
  salonLogoUrl,
  salonName,
  salonTimezone,
}: PortableWorkspaceTabsProps) {
  const pathname = usePathname();
  const workspace = usePortableWorkspaceState();
  const router = useRouter();
  const [optimisticNavigation, setOptimisticNavigation] = useState<{
    from: string;
    href: string;
  } | null>(null);
  const optimisticHref =
    optimisticNavigation?.from === pathname
      ? optimisticNavigation.href
      : null;

  useEffect(() => {
    if (localPanels) return;
    let cancelled = false;
    const prefetchWithInvalidate = router.prefetch as (
      href: string,
      options: { onInvalidate: () => void },
    ) => void;

    const keepPrefetched = (href: string) => {
      prefetchWithInvalidate(href, {
        onInvalidate: () => {
          if (!cancelled) keepPrefetched(href);
        },
      });
    };

    for (const item of items) {
      if (!isPortablePosRoute(pathname, item.href)) {
        keepPrefetched(item.href);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [items, localPanels, pathname, router]);

  useEffect(() => {
    if (localPanels) return;
    const prefetch = () => {
      for (const item of items) router.prefetch(item.href);
    };

    window.addEventListener("focus", prefetch);
    document.addEventListener("visibilitychange", prefetch);
    return () => {
      window.removeEventListener("focus", prefetch);
      document.removeEventListener("visibilitychange", prefetch);
    };
  }, [items, localPanels, router]);

  return (
    <header
      className="relative z-30 shrink-0 border-b border-zinc-200 bg-white/95 px-[max(0.75rem,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] shadow-[0_1px_3px_rgba(24,24,27,0.06)] backdrop-blur"
      data-pos-workspace-shell
    >
      {!localPanels && !workspace?.offlineEnabled ? <PosWorkspaceRealtimeRefresh
        ignoredSources={PORTABLE_IGNORED_REFRESH_SOURCES}
        salonId={salonId}
      /> : null}
      <div className="mx-auto flex min-h-[60px] w-full items-center gap-3">
        <div className="hidden min-w-0 max-w-64 flex-1 items-center gap-3 xl:flex">
          <SalonBrand
            salonLogoUrl={salonLogoUrl}
            salonName={salonName}
            salonTimezone={salonTimezone}
          />
        </div>

        <nav
          aria-label="POS workspace"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto xl:justify-center"
        >
          {items.map((item) => {
            const active = optimisticHref
              ? item.href === optimisticHref
              : isPortablePosRoute(pathname, item.href);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex h-10 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-center text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 sm:text-sm xl:max-w-32",
                  active
                    ? "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-200"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
                ].join(" ")}
                href={item.href}
                key={item.id}
                onClick={() =>
                  setOptimisticNavigation({ from: pathname, href: item.href })
                }
                onFocus={() => { if (!localPanels) router.prefetch(item.href); }}
                onPointerEnter={() => { if (!localPanels) router.prefetch(item.href); }}
                prefetch={!localPanels}
              >
                <span className="hidden sm:block">
                  <PortableNavIcon name={item.id} />
                </span>
                <span className="truncate">{item.label}</span>
                <TabPendingIndicator />
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 lg:justify-self-end">
        {items.some(item => item.id === "book") ? <PortableBookingNotifications key={workspace?.scope ?? salonId} salonId={salonId} timezone={salonTimezone} canConfirm={canConfirmBookings} /> : null}
        {workspace?.offlineEnabled ? <PortableSyncIndicator scope={workspace.scope} /> : null}
        <DesktopTools />
        <PortableFullscreenButton />
        <form action={logoutPortablePosAction} onSubmit={clearPortableLocalDrafts} className="shrink-0">
          <button
            aria-label="Lock POS"
            className="grid h-10 w-10 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            title="Lock POS"
            type="submit"
          >
            <PortableNavIcon name="lock" />
          </button>
        </form>
        </div>
      </div>
    </header>
  );
}
