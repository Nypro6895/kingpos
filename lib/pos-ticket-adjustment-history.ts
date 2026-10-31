export type TicketAdjustmentEventAction = "draft" | "created" | "updated";

export function ticketAdjustmentEventAction(value: unknown): TicketAdjustmentEventAction | undefined {
  return value === "draft" || value === "created" || value === "updated" ? value : undefined;
}

// Only immutable lifecycle evidence may hide an old correction. Sparse legacy
// snapshots remain visible; current ticket state cannot prove their meaning.
export function visibleTicketAdjustments<T extends { event_action?: TicketAdjustmentEventAction }>(rows: readonly T[]): T[] {
  return rows.filter(row => row.event_action !== "draft" && row.event_action !== "created");
}
