export type NoShowKind = "unexcused" | "excused" | null;

export type NoShowHistoryItem = {
  id: string;
  startAt: string;
  timezone: string;
  services: string[];
  note: string | null;
};

export function bookingStatusLabel(status: string, kind?: NoShowKind) {
  if (status !== "no_show") return status.replaceAll("_", " ");
  if (kind === "excused") return "No-show · With reason";
  if (kind === "unexcused") return "No-show";
  return "No-show · Unclassified";
}
