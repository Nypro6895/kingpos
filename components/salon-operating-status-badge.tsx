"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OperatingHoursDisplay } from "@/app/salon-profile/operating-hours-display";
import { WorkspaceText } from "@/components/workspace-language";
import type { SalonOperatingStatus } from "@/types/salon-operating-status";

type SalonOperatingStatusBadgeProps = {
  variant?: "badge" | "text";
  className?: string;
  salonId?: string;
  inverted?: boolean;
  showDetail?: boolean;
  status: SalonOperatingStatus;
};

function badgeClass(status: SalonOperatingStatus, inverted: boolean) {
  if (inverted) {
    return status.isOpen
      ? "bg-emerald-400/16 text-emerald-50 ring-emerald-200/30"
      : status.kind === "permanently_closed"
        ? "bg-red-400/16 text-red-50 ring-red-200/30"
        : status.kind === "special_closure"
          ? "bg-amber-300/18 text-amber-50 ring-amber-100/30"
          : "bg-white/14 text-white/82 ring-white/20";
  }

  if (status.isOpen) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status.kind === "permanently_closed") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  if (status.kind === "special_closure") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  return "bg-zinc-100 text-zinc-600 ring-zinc-200";
}

export function SalonOperatingStatusBadge({
  variant = "badge",
  className,
  salonId,
  inverted = false,
  showDetail = false,
  status,
}: SalonOperatingStatusBadgeProps) {
  const [opened, setOpened] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialogRef.current;
    if (opened && element && !element.open) element.showModal();
    return () => { element?.close(); };
  }, [opened]);
  const label = status.kind === "hours_unset" ? "Hours unavailable" : status.label;
  const detail = showDetail && status.kind !== "hours_unset" ? status.detail : null;

  const badge = (
    <span
      className={[
        variant === "text"
          ? "inline-flex min-h-6 max-w-full flex-wrap items-center gap-1 text-xs font-normal leading-5"
          : "inline-flex min-h-6 max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-5 ring-1 ring-inset",
        variant === "text" ? (status.isOpen ? "text-emerald-700" : status.kind === "hours_unset" ? "text-zinc-500" : "text-red-700") : badgeClass(status, inverted),
        className ?? "",
      ].join(" ")}
    >
      <span className="shrink-0"><WorkspaceText text={label} /></span>
      {detail ? (
        <>
          <span aria-hidden className="opacity-55">
            {"\u00b7"}
          </span>
          <span className="truncate">{detail}</span>
        </>
      ) : null}
    </span>
  );
  if (!salonId) return badge;
  return <>
    <button type="button" aria-haspopup="dialog" aria-label="View salon operating hours" className="rounded-full text-left hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange" onClick={event => { event.stopPropagation(); setOpened(true); }}>{badge}</button>
    {opened && typeof document !== "undefined" ? createPortal(<dialog ref={dialogRef} onClose={() => setOpened(false)} aria-label="Operating hours" className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/50" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
      <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold"><WorkspaceText text="Operating hours" /></h2><button autoFocus type="button" aria-label="Close operating hours" className="grid size-10 place-items-center rounded-full hover:bg-zinc-100" onClick={() => dialogRef.current?.close()}>×</button></div>
      {opened ? <OperatingHoursDisplay salonId={salonId} /> : null}
    </dialog>, document.body) : null}
  </>;
}
