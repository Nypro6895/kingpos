import { bookingDepositStatus } from "@/lib/booking-deposit";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  try { return Response.json(await bookingDepositStatus(new URL(request.url).searchParams.get("token") ?? ""), { headers }); }
  catch { return Response.json({ ok: false, message: "Payment could not be checked. Please retry." }, { status: 503, headers }); }
}
