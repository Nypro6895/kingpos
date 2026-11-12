/** Operational counts describe visits, never booking completion or draft revenue. */
export type TodayCheckinOperations = {
  businessDate: string;
  currentDay: boolean;
  enabled: boolean;
  counts: {
    checkedIn: number;
    waiting: number;
    inService: number;
    readyToPay: number;
    submitted: number;
    cancelled: number;
  };
  staff: { busy: number; available: number; offDuty: number } | null;
  staffStates: Array<{
    staffId: string;
    state: "busy" | "available" | "offDuty";
    visitIds: string[];
  }>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseTodayCheckinOperations(value: unknown, expectedDate: string): TodayCheckinOperations {
  const data = record(value);
  const counts = record(data?.counts);
  const staff = record(data?.staff);
  const keys = ["checkedIn", "waiting", "inService", "readyToPay", "submitted", "cancelled"] as const;
  if (!data || data.businessDate !== expectedDate || typeof data.enabled !== "boolean" ||
      typeof data.currentDay !== "boolean" || !counts || !keys.every(key => count(counts[key])) ||
      !Array.isArray(data.staffStates) ||
      (data.currentDay && (!staff || !["busy", "available", "offDuty"].every(key => count(staff[key]))))) {
    throw new Error("Check-in activity could not be verified. Please refresh.");
  }
  const staffStates: TodayCheckinOperations["staffStates"] = data.staffStates.map(value => {
    const row = record(value);
    if (!row || typeof row.staffId !== "string" ||
        !["busy", "available", "offDuty"].includes(String(row.state)) ||
        !Array.isArray(row.visitIds) || !row.visitIds.every(id => typeof id === "string")) {
      throw new Error("Staff activity could not be verified. Please refresh.");
    }
    return { staffId: row.staffId, state: row.state as "busy" | "available" | "offDuty", visitIds: row.visitIds as string[] };
  });
  return {
    businessDate: expectedDate,
    currentDay: data.currentDay,
    enabled: data.enabled,
    counts: Object.fromEntries(keys.map(key => [key, counts[key]])) as TodayCheckinOperations["counts"],
    staff: data.currentDay ? {
      busy: staff!.busy as number,
      available: staff!.available as number,
      offDuty: staff!.offDuty as number,
    } : null,
    staffStates: data.currentDay ? staffStates : [],
  };
}
