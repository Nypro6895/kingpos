"use client";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import { SalonName } from "@/components/salon-member-badge";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { SubmitButton } from "@/components/submit-button";

import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutPortablePosAction } from "@/app/pos/portable/actions";
import { clearPortableLocalDrafts } from "@/app/pos/portable/use-portable-draft";
import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";
import { PortableSyncIndicator } from "@/app/pos/portable/portable-sync-indicator";
import { DesktopTools } from "./desktop-tools";
import { DeviceInputSettingsButton } from "./device-input-settings";
import { PortableBookingNotifications } from "./portable-booking-notifications";
import { PortableFullscreenButton } from "./portable-fullscreen-button";
import { PosWorkspaceRealtimeRefresh } from "@/app/pos/pos-workspace-realtime-refresh";
import {
  isPortablePosRoute,
  PORTABLE_POS_ROUTES,
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
  const icons = { book: "calendar", checkIn: "check", lock: "lock", pos: "store", report: "list", ticket: "receipt" } as const;
  return <WorkspaceNavigationIcon name={icons[name]} className="h-5 w-5 shrink-0" />;
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
  const __vt = useWorkspaceTranslation();

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
            alt={__vt("")}
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
          <SalonName name={salonName} currentSalon/>
        </span>
        <span className="block truncate text-xs font-medium tabular-nums text-zinc-500">
          <WorkspaceText text={clock || "Loading time..."} />
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
  const __vt = useWorkspaceTranslation();

  const pathname = usePathname();
  const workspace = usePortableWorkspaceState();
  const router = useRouter();
  const [optimisticNavigation, setOptimisticNavigation] = useState<{
    from: string;
    href: string;
  } | null>(null);
  const optimisticHref =
    !localPanels && optimisticNavigation?.from === pathname
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
        <div className="hidden min-w-0 max-w-72 shrink-0 items-center gap-3 border-r border-zinc-200 pr-5 xl:flex">
          <SalonBrand
            salonLogoUrl={salonLogoUrl}
            salonName={salonName}
            salonTimezone={salonTimezone}
          />
        </div>

        <nav
          aria-label={__vt("POS workspace")}
          className="flex min-w-0 flex-1 self-stretch items-stretch gap-1 overflow-x-auto"
        >
          {items.map((item) => {
            const active = optimisticHref
              ? item.href === optimisticHref
              : isPortablePosRoute(pathname, item.href);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex min-h-[60px] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-none px-3 text-center text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#007A75] sm:text-sm xl:flex-none xl:px-4",
                  active
                    ? "bg-[#E7F7F5] text-[#007A75]"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
                ].join(" ")}
                href={item.href}
                key={item.id}
                onClick={() => {
                  if (!localPanels) setOptimisticNavigation({ from: pathname, href: item.href });
                }}
                onFocus={() => { if (!localPanels) router.prefetch(item.href); }}
                onPointerEnter={() => { if (!localPanels) router.prefetch(item.href); }}
                prefetch={!localPanels}
              >
                <span className="hidden sm:block">
                  <PortableNavIcon name={item.id} />
                </span>
                <span className="truncate"><WorkspaceText text={item.label} /></span>
                <TabPendingIndicator />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
        {items.some(item => item.id === "book") ? <PortableBookingNotifications key={workspace?.scope ?? salonId} salonId={salonId} timezone={salonTimezone} canConfirm={canConfirmBookings} /> : null}
        {workspace?.offlineEnabled ? <PortableSyncIndicator scope={workspace.scope} visible={isPortablePosRoute((optimisticHref ?? pathname).split(/[?#]/, 1)[0], PORTABLE_POS_ROUTES.pos)} /> : null}
        <DesktopTools />
        <DeviceInputSettingsButton />
        <PortableFullscreenButton />
        <form action={logoutPortablePosAction} onSubmit={clearPortableLocalDrafts} className="shrink-0">
          <SubmitButton
            aria-label={__vt("Lock POS")}
            className="grid h-10 w-10 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            title={__vt("Lock POS")}
            pendingLabel=""
            type="submit"
          >
            <PortableNavIcon name="lock" />
          </SubmitButton>
        </form>
        </div>
      </div>
    </header>
  );
}
