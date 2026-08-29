export const POS_STAFF_BROADCAST_EVENT = "staff_queue_changed";

export type PosStaffBroadcastPayload = {
  changedAt: string;
  salonId: string;
  source: "attendance" | "pos" | "turn_adjust" | "waiting";
};

export function getPosStaffRealtimeChannel(salonId: string) {
  return `pos-staff:${salonId.trim()}`;
}
