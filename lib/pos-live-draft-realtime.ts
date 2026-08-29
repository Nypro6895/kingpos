export const POS_LIVE_DRAFT_BROADCAST_EVENT = "snapshot_changed";

export type PosLiveDraftBroadcastPayload = {
  resetAt: string | null;
  source: "customer_display" | "pos" | "system";
  status: string;
  token: string;
  updatedAt: string;
  version: number;
};

export function getPosLiveDraftRealtimeChannel(token: string) {
  return `pos-live-draft:${token.trim()}`;
}
