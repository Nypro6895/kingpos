import type { SalonOperatingStatus } from "@/types/salon-operating-status";

type SalonOperatingStatusBadgeProps = {
  className?: string;
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
  className,
  inverted = false,
  showDetail = false,
  status,
}: SalonOperatingStatusBadgeProps) {
  const detail = showDetail ? status.detail : null;

  return (
    <span
      className={[
        "inline-flex min-h-6 max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-5 ring-1 ring-inset",
        badgeClass(status, inverted),
        className ?? "",
      ].join(" ")}
    >
      <span className="shrink-0">{status.label}</span>
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
}
