import { isSalonId } from "@/lib/explore-social";

export const SALON_FOLLOW_CHANGED = "reylumi:salon-follow-changed";
export type SalonFollowChange = { viewerId: string; salonId: string; following: boolean };

export function salonFollowChange(event: Event, viewerId: string | null): SalonFollowChange | null {
  const value = (event as CustomEvent<SalonFollowChange>).detail;
  return viewerId && value?.viewerId === viewerId && isSalonId(value.salonId) && typeof value.following === "boolean" ? value : null;
}

export function publishSalonFollowChange(value: SalonFollowChange) {
  window.dispatchEvent(new CustomEvent(SALON_FOLLOW_CHANGED, { detail: value }));
}
