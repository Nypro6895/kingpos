import type { PortableBookAppointment } from "@/app/pos/portable/actions";
import type { PortableOperation } from "./portable-operations";

function version(item: PortableBookAppointment) {
  const value = Date.parse(item.updatedAt ?? "");
  return Number.isFinite(value) ? value : 0;
}

/** Server refreshes may race reads/mutations; never roll back a newer booking. */
export function mergeBookingSnapshots(current: PortableBookAppointment[], incoming: PortableBookAppointment[]) {
  const rows = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) {
    const existing = rows.get(item.id);
    if (!existing || version(item) >= version(existing)) rows.set(item.id, { ...existing, ...item });
  }
  return [...rows.values()];
}

/** A synced operation is a creation receipt, not a live copy of the booking. */
export function reconcileBookingOperations(current: PortableBookAppointment[], operations: PortableOperation[]) {
  const rows = new Map(current.map(item => [item.id, item]));
  for (const operation of operations) {
    if (operation.kind !== "booking") continue;
    const local = operation.payload.localAppointment as PortableBookAppointment | undefined;
    if (!local?.id) continue;
    if (operation.state === "cancelled") { rows.delete(local.id); continue; }
    if (operation.state !== "synced") {
      if (!rows.has(local.id)) rows.set(local.id, local);
      continue;
    }
    const saved = operation.result as PortableBookAppointment | undefined;
    if (!saved?.id) continue;
    if (saved.id !== local.id) rows.delete(local.id);
    const existing = rows.get(saved.id);
    if (!existing || version(saved) > version(existing)) rows.set(saved.id, { ...existing, ...saved });
  }
  return [...rows.values()].sort((a,b) => a.startAt.localeCompare(b.startAt));
}
