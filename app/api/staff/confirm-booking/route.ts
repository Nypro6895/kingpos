import { confirmStaffBookingWithReviewAction } from "@/app/staff/appointments/actions";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ ok: false, message: "Invalid request origin." }, { status: 403 });
  }
  const started = performance.now();
  try {
    const input = await request.json();
    if (!/^[0-9a-f-]{36}$/i.test(input.bookingId ?? "") || (input.acknowledgeNoShow !== undefined && typeof input.acknowledgeNoShow !== "boolean")) {
      return Response.json({ ok: false, message: "Invalid booking." }, { status: 400 });
    }
    const result = await confirmStaffBookingWithReviewAction(input);
    const { timings, ...body } = result;
    const timing = [`confirm;dur=${(performance.now() - started).toFixed(1)}`];
    if (timings) timing.push(`auth;dur=${timings.auth.toFixed(1)}`, `rpc;dur=${timings.rpc.toFixed(1)}`);
    return Response.json(body, { headers: { "Cache-Control": "no-store", "Server-Timing": timing.join(",") } });
  } catch {
    return Response.json({ ok: false, message: "Unable to confirm appointment. Please try again." }, { status: 500 });
  }
}
