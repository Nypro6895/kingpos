import "server-only";

import { loadHistoryDetailsAction } from "@/app/activity/history-details-actions";
import { getCustomerActivity } from "@/lib/customer-activity";

export class CustomerExperienceReadError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function recordId(value: string | null) {
  if (!value) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new CustomerExperienceReadError(400, "Invalid record");
  return value;
}
/** These reads reuse the pages' ownership and linked-receipt checks verbatim. */
export async function loadCustomerExperienceResource(query: URLSearchParams) {
  const kind = query.get("kind") ?? "activity";
  if (kind === "activity") {
    const result = await getCustomerActivity({ limit: 50 });
    if (!result.ok) throw new CustomerExperienceReadError(result.code === "sign_in_required" ? 401 : 503, result.message);
    return { kind, result: result.data };
  }
  if (kind === "history") {
    const bookingId = recordId(query.get("bookingId")), ticketId = recordId(query.get("ticketId"));
    if (!bookingId && !ticketId) throw new CustomerExperienceReadError(400, "A history record is required");
    const result = await loadHistoryDetailsAction({ bookingId, ticketId });
    if (result.error) throw new CustomerExperienceReadError(404, result.error);
    return { kind, result: { booking: result.booking ?? null, receipt: result.receipt ?? null } };
  }
  throw new CustomerExperienceReadError(400, "Invalid customer view");
}
