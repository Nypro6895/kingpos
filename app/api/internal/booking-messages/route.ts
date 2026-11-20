import { closeDuePayrollPeriods } from "@/lib/payroll-close-worker";
import { timingSafeEqual } from "node:crypto";
import { enqueueNotificationReminders } from "@/lib/notification-reminders";
import { dispatchBookingMessages } from "@/lib/booking-notifications";

export async function POST(request: Request) {
  const secret = process.env.BOOKING_MESSAGES_WORKER_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return new Response("Unauthorized", { status: 401 });
  const [messages, reminders, payroll] = await Promise.all([dispatchBookingMessages(), enqueueNotificationReminders().catch(() => ({ configured: false, queued: 0, error: "In-app notifications are temporarily unavailable." })), closeDuePayrollPeriods().catch(() => ({configured:true,published:0,failed:1}))]);
  return Response.json({ ...messages, reminders, payroll });
}
