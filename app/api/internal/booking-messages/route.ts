import { timingSafeEqual } from "node:crypto";
import { enqueueNotificationReminders } from "@/lib/notification-reminders";
import { dispatchBookingMessages } from "@/lib/booking-notifications";

export async function POST(request: Request) {
  const secret = process.env.BOOKING_MESSAGES_WORKER_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return new Response("Unauthorized", { status: 401 });
  const [messages, reminders] = await Promise.all([dispatchBookingMessages(), enqueueNotificationReminders().catch(() => ({ configured: false, queued: 0, error: "In-app notifications are temporarily unavailable." }))]);
  return Response.json({ ...messages, reminders });
}
