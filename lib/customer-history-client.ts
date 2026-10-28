"use client";

import { experienceResourceCache } from "@/lib/experience-resource-cache";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import { getAppLocalHost } from "@/lib/app-local-host";
import { getAppLocalCommandScope } from "@/lib/app-local-command-client";
import type { CustomerActivityReceipt } from "@/lib/customer-activity";
import type { CustomerBookingDetail } from "@/lib/customer-bookings";

type CustomerHistoryRead = { kind: "history"; result: { booking: CustomerBookingDetail | null; receipt: CustomerActivityReceipt | null } };
export async function loadCustomerHistoryRead(scope: string, input: { bookingId?: string; ticketId?: string }) {
  const host = getAppLocalHost();
  if (host.isNative) {
    if (getAppLocalCommandScope() !== scope) throw new Error("Your account has changed. Please reopen this page.");
    // This named read retains the server's customer/linked-receipt checks. The
    // web live-resource URL is not a network endpoint on the native scheme.
    const result = await host.read<CustomerHistoryRead>("customer.history", input, { scope, fresh: true });
    if (result.scope !== scope || getAppLocalCommandScope() !== scope) throw new Error("Your account has changed. Please reopen this page.");
    if (result.status !== 200 || result.data?.kind !== "history" || !result.data.result
      || typeof result.data.result !== "object" || Array.isArray(result.data.result)
      || !("booking" in result.data.result) || !("receipt" in result.data.result)) {
      throw new Error("Details could not be loaded. Please try again.");
    }
    return { ...result.data.result, error: null };
  }
  const params = new URLSearchParams({ kind: "history" });
  if (input.bookingId) params.set("bookingId", input.bookingId);
  if (input.ticketId) params.set("ticketId", input.ticketId);
  const endpoint = `/api/experience/customer?${params}`;
  const snapshot = await experienceResourceCache.load({ scope, key: endpoint }, fetchLiveExperienceResource<CustomerHistoryRead>(endpoint, scope), {
    force: true, tags: ["booking", "tickets"], freshForMs: 10000, retainForMs: 30 * 60 * 1000,
  });
  return { ...snapshot.data.result, error: null };
}
