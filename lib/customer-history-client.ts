"use client";

import { experienceResourceCache } from "@/lib/experience-resource-cache";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import type { CustomerActivityReceipt } from "@/lib/customer-activity";
import type { CustomerBookingDetail } from "@/lib/customer-bookings";

type CustomerHistoryRead = { kind: "history"; result: { booking: CustomerBookingDetail | null; receipt: CustomerActivityReceipt | null } };
export async function loadCustomerHistoryRead(scope: string, input: { bookingId?: string; ticketId?: string }) {
  const params = new URLSearchParams({ kind: "history" });
  if (input.bookingId) params.set("bookingId", input.bookingId);
  if (input.ticketId) params.set("ticketId", input.ticketId);
  const endpoint = `/api/experience/customer?${params}`;
  const snapshot = await experienceResourceCache.load({ scope, key: endpoint }, fetchLiveExperienceResource<CustomerHistoryRead>(endpoint, scope), {
    force: true, tags: ["booking", "tickets"], freshForMs: 10000, retainForMs: 30 * 60 * 1000,
  });
  return { ...snapshot.data.result, error: null };
}
