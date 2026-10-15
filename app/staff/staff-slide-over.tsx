"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayPortalHost } from "@/components/overlay-dismissal";

export function StaffSlideOver({
  children,
  closeHref,
  subtitle,
  title,
}: {
  children: ReactNode;
  closeHref: string;
  subtitle?: string;
  title: string;
}) {
  const __vt = useWorkspaceTranslation();

  const router = useRouter();
  const [open, setOpen] = useState(true);
  const portalHost = useOverlayPortalHost();

  const close = useCallback(() => {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
  }, [closeHref, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  if (!open || !portalHost) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        aria-label={__vt("Close")}
        className="absolute inset-0 bg-zinc-950/30"
        onClick={close}
        type="button"
      />
      <aside
        aria-modal="true"
        className="absolute right-0 top-0 flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top)] shadow-xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-zinc-950"><WorkspaceText text={title} /></h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-zinc-500"><WorkspaceText text={subtitle} /></p>
            ) : null}
          </div>
          <button
            aria-label={__vt("Close")}
            className="min-h-11 shrink-0 whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950"
            onClick={close}
            type="button"
          >
            <WorkspaceText text="Close" />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-6 sm:py-5">{children}</div>
      </aside>
    </div>,
    portalHost,
  );
}
