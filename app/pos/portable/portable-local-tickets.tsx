"use client";
import { CustomerName } from "@/components/customer-name";
import { useEffect, useState } from "react";
import { listPortableOperations, PORTABLE_OPERATIONS_CHANGED, type PortableOperation } from "@/lib/portable-operations";
import { usePortableWorkspaceState } from "./portable-workspace-state";

export function PortableLocalTickets({ serverIds, date, timezone, query }: { serverIds: string[]; date: string; timezone: string; query: string }) {
  const workspace = usePortableWorkspaceState();
  const [rows, setRows] = useState<PortableOperation[]>([]);
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    const refresh = () => { void listPortableOperations(workspace.scope).then(items => { if (active) setRows(items); }).catch(() => {}); };
    refresh(); window.addEventListener(PORTABLE_OPERATIONS_CHANGED, refresh);
    return () => { active = false; window.removeEventListener(PORTABLE_OPERATIONS_CHANGED, refresh); };
  }, [workspace]);
  const visible = rows.filter(row => row.kind === "receipt" && !serverIds.includes(String(row.result?.ticketId)) &&
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.occurredAt)) === date &&
    (!query || JSON.stringify([row.payload.customerName, row.result?.ticketNumber, row.payload.lines]).toLowerCase().includes(query.toLowerCase())));
  if (!visible.length) return null;
  return <div className="mt-4 divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 bg-white" data-portable-local-tickets>{visible.reverse().map(row => {
    const lines = row.payload.lines as { total: number; serviceLabel: string; staffId: string }[];
    const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
    const discount = Number(row.payload.discountValue ?? 0);
    const total = Math.max(0, subtotal - (row.payload.discountType === "percentage" ? subtotal * discount / 100 : discount)) + Number(row.payload.tipAmount ?? 0);
    const status = row.state === "cancelled" ? "Cancelled" : row.state === "synced" ? "Up to date" : row.state === "attention" ? "Needs review" : "Saved on device";
    return <article key={row.id} className="text-sm">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-zinc-50 px-3 py-3">
        <strong>{String(row.result?.ticketNumber ?? "Ticket")}</strong>
        <time className="text-zinc-600">{new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(row.occurredAt))}</time>
        <span className="min-w-0 flex-1"><CustomerName name={String(row.payload.customerName || "")} /></span>
        <span>Total: <strong>${total.toFixed(2)}</strong></span>
        <span>Tip: ${Number(row.payload.tipAmount ?? 0).toFixed(2)}</span>
        <span title={status} aria-label={status} className={row.state === "cancelled" ? "text-zinc-500" : row.state === "synced" ? "text-emerald-700" : "text-amber-700"}>{row.state === "cancelled" ? "Cancelled" : row.state === "synced" ? "✓" : row.state === "attention" ? "!" : "↑"}</span>
      </header>
      {lines.map((line, index) => <div key={index} className="grid grid-cols-[1fr_2fr_auto] gap-3 border-t border-zinc-100 px-3 py-3"><strong>{workspace?.staffRoster.find(staff => staff.id === line.staffId)?.display_name ?? "Staff"}</strong><span>{line.serviceLabel}</span><span>${line.total.toFixed(2)}</span></div>)}
    </article>;
  })}</div>;
}
