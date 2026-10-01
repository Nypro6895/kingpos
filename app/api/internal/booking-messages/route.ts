import { timingSafeEqual } from "node:crypto";
import { dispatchBookingMessages } from "@/lib/booking-notifications";

export async function POST(request: Request) {
  const secret = process.env.BOOKING_MESSAGES_WORKER_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return new Response("Unauthorized", { status: 401 });
  return Response.json(await dispatchBookingMessages());
}
