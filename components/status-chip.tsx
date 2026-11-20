import type { ReactNode } from "react";
export function statusLabel(status: string) {
  const label = status.replaceAll("_", " ");
  return label ? label.charAt(0).toUpperCase()+label.slice(1) : "";
}
export function StatusChip({status,label,className,children,tone}: {status: string; label?: string; className?: string; children?: ReactNode; tone?: string}) {
  return <span className={className} data-record-status={status} data-tone={tone}>{children ?? label ?? statusLabel(status)}</span>;
}
