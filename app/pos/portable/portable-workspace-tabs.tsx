"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { logoutPortablePosAction } from "@/app/pos/portable/actions";
import {
  isPortablePosRoute,
  type PortablePosRouteLink,
} from "@/lib/pos-portable-routes";

type PortableWorkspaceTabsProps = {
  items: PortablePosRouteLink[];
  salonName: string;
};

type IdleWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
};

export function PortableWorkspaceTabs({
  items,
  salonName,
}: PortableWorkspaceTabsProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const prefetch = () => {
      for (const item of items) {
        if (!isPortablePosRoute(pathname, item.href)) {
          router.prefetch(item.href);
        }
      }
    };
    const idleWindow = window as IdleWindow;

    if (typeof idleWindow.requestIdleCallback === "function") {
      const idleId = idleWindow.requestIdleCallback(prefetch, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = globalThis.setTimeout(prefetch, 250);
    return () => globalThis.clearTimeout(timeoutId);
  }, [items, pathname, router]);

  return (
    <header
      className="relative z-30 shrink-0 border-b border-zinc-200 bg-white/95 px-[max(0.75rem,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur"
      data-pos-workspace-shell
    >
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2">
        <p className="hidden min-w-0 max-w-48 truncate text-sm font-semibold text-zinc-700 lg:block">
          {salonName}
        </p>

        <nav
          aria-label="POS workspace"
          className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-xl bg-zinc-100 p-1 sm:mx-auto sm:max-w-xl"
        >
          {items.map((item) => {
            const active = isPortablePosRoute(pathname, item.href);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-h-10 min-w-0 items-center justify-center rounded-lg px-2 text-center text-xs font-semibold transition sm:text-sm",
                  active
                    ? "bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200"
                    : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950",
                ].join(" ")}
                href={item.href}
                key={item.id}
                prefetch
              >
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <form action={logoutPortablePosAction} className="shrink-0">
          <button
            aria-label="Lock POS"
            className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-white text-lg font-semibold text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
            title="Lock POS"
            type="submit"
          >
            <span aria-hidden="true">⌁</span>
          </button>
        </form>
      </div>
    </header>
  );
}
